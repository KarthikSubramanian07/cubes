//! The lattice: dimensions, playable mask, topology and neighbour tables.
//!
//! Cells are indexed `x + w * (y + h * z)`. 2D boards are lattices with
//! `d == 1`. Neighbour lists only ever contain playable cells.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardShape {
    Square,
    Octagon,
    Cross,
    Diamond,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Topology {
    Flat,
    Torus,
}

/// Compressed sparse rows: `data[off[i]..off[i+1]]` are the neighbours of `i`.
#[derive(Clone, Debug, Default)]
pub struct Csr {
    off: Vec<u32>,
    data: Vec<u32>,
}

impl Csr {
    fn build(n: usize, mut f: impl FnMut(usize, &mut Vec<u32>)) -> Self {
        let mut off = Vec::with_capacity(n + 1);
        let mut data = Vec::new();
        off.push(0);
        for i in 0..n {
            f(i, &mut data);
            off.push(data.len() as u32);
        }
        Csr { off, data }
    }

    #[inline]
    pub fn get(&self, i: usize) -> &[u32] {
        &self.data[self.off[i] as usize..self.off[i + 1] as usize]
    }
}

#[derive(Clone, Debug)]
pub struct Lattice {
    pub w: i32,
    pub h: i32,
    pub d: i32,
    pub torus: bool,
    pub shape: BoardShape,
    pub playable: Vec<bool>,
    /// Face neighbours (2D: 4 edge neighbours, 3D: 6 face neighbours).
    pub face: Csr,
    /// Link neighbours (2D: 4 diagonals, 3D: 12 edge + 8 vertex neighbours).
    pub link: Csr,
}

impl Lattice {
    pub fn new(dims: [u8; 3], shape: BoardShape, topology: Topology) -> Self {
        let (w, h, d) = (dims[0] as i32, dims[1] as i32, dims[2].max(1) as i32);
        let torus = topology == Topology::Torus && d == 1;
        let n = (w * h * d) as usize;
        let mut playable = vec![false; n];
        for z in 0..d {
            for y in 0..h {
                for x in 0..w {
                    playable[(x + w * (y + h * z)) as usize] = shape_contains(shape, w, h, x, y);
                }
            }
        }
        let mut lat = Lattice {
            w,
            h,
            d,
            torus,
            shape,
            playable,
            face: Csr::default(),
            link: Csr::default(),
        };
        let three_d = d > 1;
        let face = Csr::build(n, |i, out| {
            if !lat.playable[i] {
                return;
            }
            let start = out.len();
            let (x, y, z) = lat.coords(i);
            for (dx, dy, dz) in neighbour_offsets(three_d, false) {
                if let Some(j) = lat.index(x + dx, y + dy, z + dz) {
                    if lat.playable[j] {
                        out.push(j as u32);
                    }
                }
            }
            dedup_from(out, start);
        });
        let link = Csr::build(n, |i, out| {
            if !lat.playable[i] {
                return;
            }
            let start = out.len();
            let (x, y, z) = lat.coords(i);
            for (dx, dy, dz) in neighbour_offsets(three_d, true) {
                if let Some(j) = lat.index(x + dx, y + dy, z + dz) {
                    if lat.playable[j] && j != i {
                        out.push(j as u32);
                    }
                }
            }
            dedup_from(out, start);
        });
        lat.face = face;
        lat.link = link;
        lat
    }

    #[inline]
    pub fn len(&self) -> usize {
        (self.w * self.h * self.d) as usize
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn is_3d(&self) -> bool {
        self.d > 1
    }

    #[inline]
    pub fn coords(&self, i: usize) -> (i32, i32, i32) {
        let i = i as i32;
        (i % self.w, (i / self.w) % self.h, i / (self.w * self.h))
    }

    /// Index of (x, y, z), wrapping x/y on a torus. `None` when out of bounds.
    #[inline]
    pub fn index(&self, x: i32, y: i32, z: i32) -> Option<usize> {
        let (x, y) = if self.torus {
            (x.rem_euclid(self.w), y.rem_euclid(self.h))
        } else {
            (x, y)
        };
        if x < 0 || y < 0 || z < 0 || x >= self.w || y >= self.h || z >= self.d {
            return None;
        }
        Some((x + self.w * (y + self.h * z)) as usize)
    }

    /// Chebyshev distance between two cells, honouring torus wrap.
    pub fn chebyshev(&self, a: usize, b: usize) -> i32 {
        let (ax, ay, az) = self.coords(a);
        let (bx, by, bz) = self.coords(b);
        let mut dx = (ax - bx).abs();
        let mut dy = (ay - by).abs();
        if self.torus {
            dx = dx.min(self.w - dx);
            dy = dy.min(self.h - dy);
        }
        dx.max(dy).max((az - bz).abs())
    }

    /// All playable cells within Chebyshev distance `r` of `i` (including `i`).
    pub fn ball(&self, i: usize, r: i32, out: &mut Vec<usize>) {
        let (x, y, z) = self.coords(i);
        let rz = if self.is_3d() { r } else { 0 };
        for dz in -rz..=rz {
            for dy in -r..=r {
                for dx in -r..=r {
                    if let Some(j) = self.index(x + dx, y + dy, z + dz) {
                        if self.playable[j] {
                            out.push(j);
                        }
                    }
                }
            }
        }
        if self.torus {
            out.sort_unstable();
            out.dedup();
        }
    }

    /// Cell directly below `i`, if any.
    #[inline]
    pub fn below(&self, i: usize) -> Option<usize> {
        let (x, y, z) = self.coords(i);
        if z == 0 {
            None
        } else {
            self.index(x, y, z - 1)
        }
    }

    /// Cell directly above `i`, if any.
    #[inline]
    pub fn above(&self, i: usize) -> Option<usize> {
        let (x, y, z) = self.coords(i);
        self.index(x, y, z + 1)
    }

    /// Distance from the outer edge of the (x, y) footprint, used by the storm.
    pub fn ring(&self, i: usize) -> i32 {
        let (x, y, _) = self.coords(i);
        x.min(y).min(self.w - 1 - x).min(self.h - 1 - y)
    }
}

fn dedup_from(v: &mut Vec<u32>, start: usize) {
    // Torus wrap on tiny boards can map two offsets to the same cell.
    let mut tail: Vec<u32> = v.split_off(start);
    tail.sort_unstable();
    tail.dedup();
    v.extend(tail);
}

fn neighbour_offsets(three_d: bool, link: bool) -> Vec<(i32, i32, i32)> {
    let mut out = Vec::new();
    let zr: i32 = if three_d { 1 } else { 0 };
    for dz in -zr..=zr {
        for dy in -1..=1i32 {
            for dx in -1..=1i32 {
                let nz = dx.abs() + dy.abs() + dz.abs();
                if nz == 0 {
                    continue;
                }
                let is_face = nz == 1;
                if is_face != link {
                    out.push((dx, dy, dz));
                }
            }
        }
    }
    out
}

fn shape_contains(shape: BoardShape, w: i32, h: i32, x: i32, y: i32) -> bool {
    match shape {
        BoardShape::Square => true,
        BoardShape::Octagon => {
            let c = (w.min(h) / 4).max(1);
            let corner = |a: i32, b: i32| a + b < c;
            !(corner(x, y)
                || corner(w - 1 - x, y)
                || corner(x, h - 1 - y)
                || corner(w - 1 - x, h - 1 - y))
        }
        BoardShape::Cross => {
            let arm = w.min(h) / 4;
            let in_corner_x = x < arm || x >= w - arm;
            let in_corner_y = y < arm || y >= h - arm;
            !(in_corner_x && in_corner_y)
        }
        BoardShape::Diamond => {
            // |x - cx| + |y - cy| <= r, using doubled coordinates for even sizes.
            let (x2, y2) = (2 * x + 1 - w, 2 * y + 1 - h);
            x2.abs() + y2.abs() <= w.max(h)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coords_roundtrip() {
        let l = Lattice::new([8, 6, 4], BoardShape::Square, Topology::Flat);
        for i in 0..l.len() {
            let (x, y, z) = l.coords(i);
            assert_eq!(l.index(x, y, z), Some(i));
        }
    }

    #[test]
    fn neighbour_counts_2d() {
        let l = Lattice::new([5, 5, 1], BoardShape::Square, Topology::Flat);
        let centre = l.index(2, 2, 0).unwrap();
        assert_eq!(l.face.get(centre).len(), 4);
        assert_eq!(l.link.get(centre).len(), 4);
        let corner = l.index(0, 0, 0).unwrap();
        assert_eq!(l.face.get(corner).len(), 2);
        assert_eq!(l.link.get(corner).len(), 1);
    }

    #[test]
    fn neighbour_counts_3d() {
        let l = Lattice::new([5, 5, 5], BoardShape::Square, Topology::Flat);
        let centre = l.index(2, 2, 2).unwrap();
        assert_eq!(l.face.get(centre).len(), 6);
        assert_eq!(l.link.get(centre).len(), 20);
    }

    #[test]
    fn torus_wraps() {
        let l = Lattice::new([6, 6, 1], BoardShape::Square, Topology::Torus);
        let corner = l.index(0, 0, 0).unwrap();
        assert_eq!(l.face.get(corner).len(), 4);
        assert_eq!(l.link.get(corner).len(), 4);
        assert!(l
            .link
            .get(corner)
            .contains(&(l.index(5, 5, 0).unwrap() as u32)));
        assert_eq!(l.chebyshev(corner, l.index(5, 5, 0).unwrap()), 1);
    }

    #[test]
    fn shapes_are_symmetric() {
        for shape in [BoardShape::Octagon, BoardShape::Cross, BoardShape::Diamond] {
            let l = Lattice::new([20, 20, 1], shape, Topology::Flat);
            for y in 0..20 {
                for x in 0..20 {
                    let a = l.playable[l.index(x, y, 0).unwrap()];
                    let b = l.playable[l.index(19 - y, x, 0).unwrap()];
                    assert_eq!(a, b, "{shape:?} not 4-fold symmetric at {x},{y}");
                }
            }
            let count = l.playable.iter().filter(|p| **p).count();
            assert!(count > 200 && count < 400, "{shape:?} has {count} cells");
        }
    }

    #[test]
    fn unplayable_cells_have_no_neighbours() {
        let l = Lattice::new([12, 12, 1], BoardShape::Octagon, Topology::Flat);
        let i = l.index(0, 0, 0).unwrap();
        assert!(!l.playable[i]);
        assert!(l.face.get(i).is_empty());
        let j = l.index(1, 1, 0).unwrap();
        for &n in l.link.get(j) {
            assert!(l.playable[n as usize]);
        }
    }
}
