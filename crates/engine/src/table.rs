//! Every possible placement on a lattice, precomputed once and indexed by
//! the cells it covers. Move generation then only has to look at placements
//! that touch a candidate cell.

use crate::geometry::Lattice;
use crate::pieces::{Cell3, Kit};

#[derive(Clone, Debug)]
pub struct Table {
    pub piece: Vec<u8>,
    pub orient: Vec<u16>,
    /// Lattice coordinates of the orientation's origin (may be negative-free
    /// only on flat boards; on a torus it is the wrapped anchor).
    pub origin: Vec<[i16; 3]>,
    cell_off: Vec<u32>,
    cell_data: Vec<u32>,
    by_cell_off: Vec<u32>,
    by_cell_data: Vec<u32>,
}

impl Table {
    pub fn build(lat: &Lattice, kit: &Kit) -> Table {
        let mut t = Table {
            piece: Vec::new(),
            orient: Vec::new(),
            origin: Vec::new(),
            cell_off: vec![0],
            cell_data: Vec::new(),
            by_cell_off: Vec::new(),
            by_cell_data: Vec::new(),
        };
        let mut buf: Vec<usize> = Vec::with_capacity(5);
        for piece in 0..=kit.spark_index {
            for (oi, cells) in kit.orients(piece).iter().enumerate() {
                for z in 0..lat.d {
                    for y in 0..lat.h {
                        for x in 0..lat.w {
                            if place_cells(lat, cells, [x, y, z], &mut buf) {
                                t.piece.push(piece as u8);
                                t.orient.push(oi as u16);
                                t.origin.push([x as i16, y as i16, z as i16]);
                                t.cell_data.extend(buf.iter().map(|&c| c as u32));
                                t.cell_off.push(t.cell_data.len() as u32);
                            }
                        }
                    }
                }
            }
        }
        // Invert: placements covering each cell.
        let n = lat.len();
        let mut counts = vec![0u32; n + 1];
        for c in &t.cell_data {
            counts[*c as usize + 1] += 1;
        }
        for i in 0..n {
            counts[i + 1] += counts[i];
        }
        let mut fill = counts.clone();
        let mut data = vec![0u32; t.cell_data.len()];
        for pid in 0..t.len() {
            for &c in t.cells(pid) {
                let slot = &mut fill[c as usize];
                data[*slot as usize] = pid as u32;
                *slot += 1;
            }
        }
        t.by_cell_off = counts;
        t.by_cell_data = data;
        t
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.piece.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.piece.is_empty()
    }

    #[inline]
    pub fn cells(&self, pid: usize) -> &[u32] {
        &self.cell_data[self.cell_off[pid] as usize..self.cell_off[pid + 1] as usize]
    }

    #[inline]
    pub fn covering(&self, cell: usize) -> &[u32] {
        &self.by_cell_data[self.by_cell_off[cell] as usize..self.by_cell_off[cell + 1] as usize]
    }
}

/// Cells covered by an orientation anchored at `at`. Returns false if any cell
/// falls off the lattice, onto an unplayable cell, or (torus) onto itself.
pub fn place_cells(lat: &Lattice, cells: &[Cell3], at: [i32; 3], out: &mut Vec<usize>) -> bool {
    out.clear();
    for c in cells {
        match lat.index(at[0] + c[0], at[1] + c[1], at[2] + c[2]) {
            Some(i) if lat.playable[i] => {
                if out.contains(&i) {
                    return false;
                }
                out.push(i);
            }
            _ => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{BoardShape, Topology};
    use crate::pieces::KitKind;

    #[test]
    fn placement_counts_match_known_values() {
        // The 2D kit plus the Spark is every free polyomino of size 1..=5,
        // which has 30433 placements on 20x20 and 13729 on 14x14.
        let kit = Kit::new(KitKind::Shards);
        let big = Table::build(
            &Lattice::new([20, 20, 1], BoardShape::Square, Topology::Flat),
            &kit,
        );
        assert_eq!(big.len(), 30433);
        let small = Table::build(
            &Lattice::new([14, 14, 1], BoardShape::Square, Topology::Flat),
            &kit,
        );
        assert_eq!(small.len(), 13729);
    }

    #[test]
    fn by_cell_index_is_consistent() {
        let kit = Kit::new(KitKind::Shards);
        let lat = Lattice::new([10, 10, 1], BoardShape::Octagon, Topology::Flat);
        let t = Table::build(&lat, &kit);
        for cell in 0..lat.len() {
            for &pid in t.covering(cell) {
                assert!(t.cells(pid as usize).contains(&(cell as u32)));
            }
            if !lat.playable[cell] {
                assert!(t.covering(cell).is_empty());
            }
        }
    }

    #[test]
    fn torus_places_everywhere() {
        let kit = Kit::new(KitKind::Shards);
        let lat = Lattice::new([10, 10, 1], BoardShape::Square, Topology::Torus);
        let t = Table::build(&lat, &kit);
        let orients: usize = (0..=kit.spark_index).map(|p| kit.orients(p).len()).sum();
        assert_eq!(t.len(), orients * 100);
    }

    #[test]
    fn cubes_table_builds() {
        let kit = Kit::new(KitKind::Cubes);
        let lat = Lattice::new([8, 8, 8], BoardShape::Square, Topology::Flat);
        let t = Table::build(&lat, &kit);
        assert!(t.len() > 50_000, "{}", t.len());
    }
}
