//! Bitboards and fast move generation.
//!
//! Every lattice row (fixed `y` and `z`) is one `u64` whose bit `x` is the
//! cell `(x, y, z)`. On top of that sit three ideas borrowed from the
//! strongest engines in the genre:
//!
//! 1. **Row bitboards.** Forbidden cells, attach points and the Leap reach
//!    are a handful of shifts and ORs per row instead of a neighbour walk per
//!    cell.
//! 2. **Local windows (Pentobi-style).** Every cell of a shard of at most
//!    five cells lies within L1 distance 4 of any other of its cells. That
//!    diamond around `c`, minus `c` itself, is 40 cells in 2D and exactly 128
//!    in 3D. For every cell `c` and shard, the placements covering `c` are
//!    precomputed with a `u128` mask of the window cells they use (and, under
//!    gravity, the cells that need support from below). At generation time
//!    the window's forbidden status is read from padded rows once per anchor,
//!    and each placement is then decided by one or two ANDs. The test is
//!    exact: there is no per-cell fallback.
//! 3. **Incremental state.** [`Board`] keeps each seat's forbidden rows and
//!    attach points up to date as shards land, so bots never recompute them
//!    from scratch inside a search.

use std::collections::HashMap;

use crate::game::{is_seat, Ctx, GenMode, Move, Scratch, EMPTY, SCAR};
use crate::geometry::Lattice;
use crate::pieces::Kit;
use crate::table::Table;

/// Bit offset of x = 0 inside a padded row.
const PX: usize = 8;
/// Window radius (L1). A five-cell shard spans at most four steps.
const R: i32 = 4;
const NONE: u32 = u32::MAX;

/// One contiguous run of window cells along x: (dz, dy, first dx, length,
/// first bit).
type Run = (i8, i8, i8, u8, u8);

/// Lattice geometry in bitboard form plus the per-cell placement windows.
#[derive(Clone, Debug)]
pub struct Geo {
    pub w: usize,
    pub h: usize,
    pub d: usize,
    pub torus: bool,
    pub three_d: bool,
    /// Canonical rows: `y + h * z`.
    pub rows: usize,
    pub wmask: u64,
    runs: Vec<Run>,
    py: usize,
    pz: usize,
    /// Padded rows per z layer, and in total.
    pstride: usize,
    pub prows: usize,
    /// Row neighbours of each canonical row: y-1, y+1, z-1, z+1.
    nbr: Vec<[u32; 4]>,
    /// Padded (row, bit) positions of each cell (several on a torus).
    pad_off: Vec<u32>,
    pad_pos: Vec<(u32, u8)>,
    /// Placements by (cell, piece): ids and window masks.
    ent_off: Vec<u32>,
    ent_pid: Vec<u32>,
    ent_mask: Vec<u128>,
    /// Gravity only: window cells that need support from below, and whether
    /// the anchor itself does.
    ent_need: Vec<u128>,
    ent_cneed: Vec<bool>,
    /// Within each (cell, piece) list, entries are sorted by the subset of
    /// the anchor's face neighbours they cover. `grp_off` holds, per list,
    /// `subsets + 1` offsets relative to the list start.
    grp_off: Vec<u16>,
    /// Window bit of each face direction, and the number of subsets.
    face_bits: Vec<u8>,
    subsets: usize,
    gravity: bool,
    pieces: usize,
    /// Playable cells as canonical rows.
    pub playable: Vec<u64>,
}

impl Geo {
    pub fn build(lat: &Lattice, kit: &Kit, table: &Table, gravity: bool) -> Geo {
        let (w, h, d) = (lat.w as usize, lat.h as usize, lat.d as usize);
        let three_d = d > 1;
        let py = R as usize;
        let pz = if three_d { R as usize } else { 0 };
        let pstride = h + 2 * py;
        let prows = pstride * (d + 2 * pz);
        let rows = h * d;
        let torus = lat.torus;

        // The L1 diamond of radius R around the anchor, minus the anchor,
        // as runs along x.
        let mut runs: Vec<Run> = Vec::new();
        let mut bit_of: HashMap<(i32, i32, i32), u8> = HashMap::new();
        let mut next_bit = 0u32;
        let zr = if three_d { R } else { 0 };
        for dz in -zr..=zr {
            for dy in -R..=R {
                let k = R - dz.abs() - dy.abs();
                if k < 0 {
                    continue;
                }
                let spans: Vec<(i32, i32)> = if dz == 0 && dy == 0 {
                    vec![(-k, -1), (1, k)]
                } else {
                    vec![(-k, k)]
                };
                for (a, b) in spans {
                    runs.push((
                        dz as i8,
                        dy as i8,
                        a as i8,
                        (b - a + 1) as u8,
                        next_bit as u8,
                    ));
                    for dx in a..=b {
                        bit_of.insert((dx, dy, dz), next_bit as u8);
                        next_bit += 1;
                    }
                }
            }
        }
        assert!(next_bit <= 128, "window does not fit in 128 bits");

        let mut nbr = vec![[NONE; 4]; rows];
        for z in 0..d {
            for y in 0..h {
                let yw = |dy: i32| -> u32 {
                    let ny = y as i32 + dy;
                    if torus {
                        (ny.rem_euclid(h as i32) as usize + h * z) as u32
                    } else if ny < 0 || ny >= h as i32 {
                        NONE
                    } else {
                        (ny as usize + h * z) as u32
                    }
                };
                let zw = |dz: i32| -> u32 {
                    let nz = z as i32 + dz;
                    if nz < 0 || nz >= d as i32 {
                        NONE
                    } else {
                        (y + h * nz as usize) as u32
                    }
                };
                nbr[y + h * z] = [yw(-1), yw(1), zw(-1), zw(1)];
            }
        }

        // Padded positions of every cell.
        let n = lat.len();
        let mut lists: Vec<Vec<(u32, u8)>> = vec![Vec::new(); n];
        for pzi in 0..(d + 2 * pz) {
            for pyi in 0..pstride {
                let z = pzi as i32 - pz as i32;
                let y = pyi as i32 - py as i32;
                if z < 0 || z >= d as i32 {
                    continue;
                }
                let yy = if torus {
                    y.rem_euclid(h as i32)
                } else if y < 0 || y >= h as i32 {
                    continue;
                } else {
                    y
                };
                for b in 0..(PX + w + PX) {
                    let x = b as i32 - PX as i32;
                    let xx = if torus {
                        x.rem_euclid(w as i32)
                    } else if x < 0 || x >= w as i32 {
                        continue;
                    } else {
                        x
                    };
                    let cell = xx as usize + w * (yy as usize + h * z as usize);
                    lists[cell].push(((pyi + pstride * pzi) as u32, b as u8));
                }
            }
        }
        // The canonical position first, so `pad_test` reads the real cell.
        for (cell, l) in lists.iter_mut().enumerate() {
            let x = cell % w;
            let ri = cell / w;
            let (y, z) = (ri % h, ri / h);
            let home = (((y + py) + pstride * (z + pz)) as u32, (x + PX) as u8);
            if let Some(i) = l.iter().position(|&p| p == home) {
                l.swap(0, i);
            }
        }
        let mut pad_off = vec![0u32];
        let mut pad_pos = Vec::new();
        for l in &lists {
            pad_pos.extend_from_slice(l);
            pad_off.push(pad_pos.len() as u32);
        }
        let mut playable = vec![0u64; rows];
        for i in 0..n {
            if lat.playable[i] {
                playable[i / w] |= 1 << (i % w);
            }
        }

        // Window entries per (cell, piece), grouped by the face neighbours
        // of the anchor they cover.
        let dirs: &[(i32, i32, i32)] = if three_d {
            &[
                (-1, 0, 0),
                (1, 0, 0),
                (0, -1, 0),
                (0, 1, 0),
                (0, 0, -1),
                (0, 0, 1),
            ]
        } else {
            &[(-1, 0, 0), (1, 0, 0), (0, -1, 0), (0, 1, 0)]
        };
        let face_bits: Vec<u8> = dirs.iter().map(|k| bit_of[k]).collect();
        let subsets = 1usize << face_bits.len();
        let subset_of = |mask: u128| -> usize {
            face_bits
                .iter()
                .enumerate()
                .filter(|(_, &b)| mask >> b & 1 != 0)
                .fold(0, |acc, (i, _)| acc | 1 << i)
        };
        let pieces = kit.spark_index + 1;
        let mut buckets: Vec<Vec<(u32, u128, u128, bool)>> = vec![Vec::new(); n * pieces];
        for pid in 0..table.len() {
            let piece = table.piece[pid] as usize;
            let orient = &kit.orients(piece)[table.orient[pid] as usize];
            let cells = table.cells(pid);
            // `cells` follows `orient` order, so offsets between shape cells
            // are the true (unwrapped) displacements, even on a torus.
            let needs: Vec<bool> = cells
                .iter()
                .map(|&c| match lat.below(c as usize) {
                    None => false,
                    Some(b) => !cells.contains(&(b as u32)),
                })
                .collect();
            for (i, &c) in cells.iter().enumerate() {
                let (mut mask, mut need) = (0u128, 0u128);
                for (j, o) in orient.iter().enumerate() {
                    if j == i {
                        continue;
                    }
                    let key = (
                        o[0] - orient[i][0],
                        o[1] - orient[i][1],
                        o[2] - orient[i][2],
                    );
                    let bit = *bit_of.get(&key).expect("shards fit the window");
                    mask |= 1u128 << bit;
                    if needs[j] {
                        need |= 1u128 << bit;
                    }
                }
                buckets[c as usize * pieces + piece].push((pid as u32, mask, need, needs[i]));
            }
        }
        let mut ent_off = Vec::with_capacity(n * pieces + 1);
        let mut ent_pid = Vec::new();
        let mut ent_mask = Vec::new();
        let mut ent_need = Vec::new();
        let mut ent_cneed = Vec::new();
        let mut grp_off: Vec<u16> = Vec::with_capacity(n * pieces * (subsets + 1));
        ent_off.push(0);
        for b in buckets.iter_mut() {
            b.sort_by_key(|e| (subset_of(e.1), e.0));
            let mut k = 0;
            for sub in 0..=subsets {
                while k < b.len() && subset_of(b[k].1) < sub {
                    k += 1;
                }
                grp_off.push(k as u16);
            }
            for &(p, m, nd, cn) in b.iter() {
                ent_pid.push(p);
                ent_mask.push(m);
                if gravity {
                    ent_need.push(nd);
                    ent_cneed.push(cn);
                }
            }
            ent_off.push(ent_pid.len() as u32);
        }
        Geo {
            w,
            h,
            d,
            torus,
            three_d,
            rows,
            wmask: if w >= 64 { !0 } else { (1u64 << w) - 1 },
            runs,
            py,
            pz,
            pstride,
            prows,
            nbr,
            pad_off,
            pad_pos,
            ent_off,
            ent_pid,
            ent_mask,
            ent_need,
            ent_cneed,
            grp_off,
            face_bits,
            subsets,
            gravity,
            pieces,
            playable,
        }
    }

    #[inline]
    fn sx_up(&self, v: u64) -> u64 {
        if self.torus {
            ((v << 1) | (v >> (self.w - 1))) & self.wmask
        } else {
            (v << 1) & self.wmask
        }
    }

    #[inline]
    fn sx_down(&self, v: u64) -> u64 {
        if self.torus {
            (v >> 1) | ((v & 1) << (self.w - 1))
        } else {
            v >> 1
        }
    }

    /// Both x neighbours.
    #[inline]
    pub fn xn(&self, v: u64) -> u64 {
        self.sx_up(v) | self.sx_down(v)
    }

    #[inline]
    fn row(src: &[u64], i: u32) -> u64 {
        if i == NONE {
            0
        } else {
            src[i as usize]
        }
    }

    /// `dst = face neighbours of src`.
    pub fn face(&self, src: &[u64], dst: &mut [u64]) {
        for ri in 0..self.rows {
            let [ym, yp, zm, zp] = self.nbr[ri];
            dst[ri] = self.xn(src[ri])
                | Self::row(src, ym)
                | Self::row(src, yp)
                | Self::row(src, zm)
                | Self::row(src, zp);
        }
    }

    /// `dst = link neighbours of src` (2D diagonals; 3D edges and vertices).
    pub fn link(&self, src: &[u64], dst: &mut [u64]) {
        for ri in 0..self.rows {
            let [ym, yp, zm, zp] = self.nbr[ri];
            let mut v = self.xn(Self::row(src, ym) | Self::row(src, yp));
            if self.three_d {
                v |= self.xn(Self::row(src, zm) | Self::row(src, zp));
                let mut diag = 0;
                for zr in [zm, zp] {
                    if zr == NONE {
                        continue;
                    }
                    let [a, b, _, _] = self.nbr[zr as usize];
                    diag |= Self::row(src, a) | Self::row(src, b);
                }
                v |= diag | self.xn(diag);
            }
            dst[ri] = v;
        }
    }

    /// `dst = every cell within Chebyshev distance 2 of src`.
    pub fn ball2(&self, src: &[u64], dst: &mut [u64], tmp: &mut [u64]) {
        for ri in 0..self.rows {
            let v = src[ri];
            let v1 = v | self.xn(v);
            tmp[ri] = v1 | self.xn(v1);
        }
        for ri in 0..self.rows {
            let [ym, yp, _, _] = self.nbr[ri];
            let mut v = tmp[ri] | Self::row(tmp, ym) | Self::row(tmp, yp);
            if ym != NONE {
                v |= Self::row(tmp, self.nbr[ym as usize][0]);
            }
            if yp != NONE {
                v |= Self::row(tmp, self.nbr[yp as usize][1]);
            }
            dst[ri] = v;
        }
        if self.three_d {
            tmp[..self.rows].copy_from_slice(&dst[..self.rows]);
            for ri in 0..self.rows {
                let [_, _, zm, zp] = self.nbr[ri];
                let mut v = tmp[ri] | Self::row(tmp, zm) | Self::row(tmp, zp);
                if zm != NONE {
                    v |= Self::row(tmp, self.nbr[zm as usize][2]);
                }
                if zp != NONE {
                    v |= Self::row(tmp, self.nbr[zp as usize][3]);
                }
                dst[ri] = v;
            }
        }
    }

    /// Expand canonical rows into padded rows. Off-board cells are set; a
    /// torus wraps instead.
    pub fn pad(&self, f: &[u64], out: &mut [u64]) {
        let (w, h) = (self.w, self.h);
        let pm = (1u64 << PX) - 1;
        for pzi in 0..(self.d + 2 * self.pz) {
            for pyi in 0..self.pstride {
                let z = pzi as i32 - self.pz as i32;
                let y = pyi as i32 - self.py as i32;
                let o = pyi + self.pstride * pzi;
                if z < 0 || z >= self.d as i32 {
                    out[o] = !0;
                    continue;
                }
                let yy = if self.torus {
                    y.rem_euclid(h as i32) as usize
                } else if y < 0 || y >= h as i32 {
                    out[o] = !0;
                    continue;
                } else {
                    y as usize
                };
                let row = f[yy + h * z as usize];
                out[o] = if self.torus {
                    (row << PX) | ((row >> (w - PX)) & pm) | ((row & pm) << (PX + w))
                } else {
                    (row << PX) | pm | (!0u64 << (PX + w))
                };
            }
        }
    }

    /// Canonical row `ri` read back out of padded rows.
    #[inline]
    pub fn unpad_row(&self, fp: &[u64], ri: usize) -> u64 {
        let (y, z) = (ri % self.h, ri / self.h);
        (fp[(y + self.py) + self.pstride * (z + self.pz)] >> PX) & self.wmask
    }

    #[inline]
    fn pad_positions(&self, cell: usize) -> &[(u32, u8)] {
        &self.pad_pos[self.pad_off[cell] as usize..self.pad_off[cell + 1] as usize]
    }

    /// Set `cell` in padded rows.
    #[inline]
    pub fn pad_set(&self, fp: &mut [u64], cell: usize) {
        for &(r, b) in self.pad_positions(cell) {
            fp[r as usize] |= 1 << b;
        }
    }

    /// Clear `cell` in padded rows.
    #[inline]
    pub fn pad_clear(&self, fp: &mut [u64], cell: usize) {
        for &(r, b) in self.pad_positions(cell) {
            fp[r as usize] &= !(1 << b);
        }
    }

    #[inline]
    pub fn pad_test(&self, fp: &[u64], cell: usize) -> bool {
        let (r, b) = self.pad_pos[self.pad_off[cell] as usize];
        fp[r as usize] >> b & 1 != 0
    }

    /// Status of the window around `cell` in padded rows `fp`.
    #[inline]
    fn window(&self, fp: &[u64], cell: usize) -> u128 {
        let x = (cell % self.w + PX) as i32;
        let ri = cell / self.w;
        let y = (ri % self.h + self.py) as i32;
        let z = (ri / self.h + self.pz) as i32;
        let ps = self.pstride as i32;
        let mut win = 0u128;
        for &(dz, dy, dx0, len, off) in &self.runs {
            let row = fp[((y + dy as i32) + ps * (z + dz as i32)) as usize];
            let bits = (row >> (x + dx0 as i32)) & ((1u64 << len) - 1);
            win |= (bits as u128) << off;
        }
        win
    }

    #[inline]
    fn entries(&self, cell: usize, piece: usize) -> (&[u32], &[u128]) {
        let i = cell * self.pieces + piece;
        let (a, b) = (self.ent_off[i] as usize, self.ent_off[i + 1] as usize);
        (&self.ent_pid[a..b], &self.ent_mask[a..b])
    }

    /// Visit the set bits of canonical rows as cell indices until `f`
    /// returns false.
    #[inline]
    pub fn for_each_cell(&self, rows: &[u64], mut f: impl FnMut(usize) -> bool) {
        for (ri, &row) in rows.iter().enumerate().take(self.rows) {
            let mut v = row;
            while v != 0 {
                let x = v.trailing_zeros() as usize;
                v &= v - 1;
                if !f(x + self.w * ri) {
                    return;
                }
            }
        }
    }

    #[inline]
    pub fn count(rows: &[u64]) -> u32 {
        rows.iter().map(|r| r.count_ones()).sum()
    }
}

/// The window status around one anchor, for repeated single-shard probes.
#[derive(Clone, Copy, Debug)]
pub struct AnchorWin {
    pub cell: usize,
    win: u128,
    awin: u128,
    c_air: bool,
    /// Open face neighbours; zero means no shard of two or more cells fits.
    pub open: usize,
}

impl Geo {
    /// The first legal placement of `piece` through the anchor, scanning
    /// its entries from `start` (mod length). Playouts use this to pick a
    /// random fitting placement without enumerating them all.
    #[inline]
    pub fn first_fit(&self, aw: &AnchorWin, piece: usize, start: u32) -> Option<u32> {
        let i = aw.cell * self.pieces + piece;
        let gs = self.subsets + 1;
        let base = self.ent_off[i] as usize;
        let grp = &self.grp_off[i * gs..(i + 1) * gs];
        let (a, b) = (base + grp[1] as usize, base + grp[self.subsets] as usize);
        let len = b - a;
        if len == 0 {
            return None;
        }
        let s0 = start as usize % len;
        for k in 0..len {
            let mut e = a + s0 + k;
            if e >= b {
                e -= len;
            }
            if self.ent_mask[e] & aw.win != 0 {
                continue;
            }
            if self.gravity && (self.ent_need[e] & aw.awin != 0 || (aw.c_air && self.ent_cneed[e]))
            {
                continue;
            }
            return Some(self.ent_pid[e]);
        }
        None
    }
}

/// Inputs shared by every move-generation call.
pub struct GenInput<'a> {
    /// Padded forbidden rows of the seat.
    pub fp: &'a [u64],
    /// Candidate anchors (canonical rows).
    pub cand: &'a [u64],
    /// Gravity only: padded rows of cells with nothing solid below them.
    pub air: &'a [u64],
    /// Kit shards still available, as a bit mask over piece indices.
    pub pieces: u32,
    pub spark: bool,
    pub leap: bool,
}

/// Kit availability as a bit mask.
pub fn kit_mask(pieces: &[bool]) -> u32 {
    pieces
        .iter()
        .enumerate()
        .filter(|(_, &p)| p)
        .fold(0, |m, (i, _)| m | 1 << i)
}

/// Generate every placement that covers a candidate anchor and whose window
/// is clear. Returns true if anything was generated.
pub fn generate(
    ctx: &Ctx,
    inp: &GenInput,
    stamp: &mut [u32],
    epoch: u32,
    out: &mut Vec<Move>,
    first_only: bool,
) -> bool {
    let mut found = false;
    ctx.geo.for_each_cell(inp.cand, |c| {
        let before = out.len();
        let stop = anchor_moves::<true>(ctx, inp, c, stamp, epoch, out, first_only);
        found |= out.len() > before;
        !stop
    });
    found
}

/// Placements through the single anchor `c` (assumed clear). Returns true
/// when `first_only` is set and a move was found. With `DEDUPE`, placements
/// already stamped with `epoch` are skipped (they were found from another
/// anchor in the same call).
#[inline]
pub(crate) fn anchor_moves<const DEDUPE: bool>(
    ctx: &Ctx,
    inp: &GenInput,
    c: usize,
    stamp: &mut [u32],
    epoch: u32,
    out: &mut Vec<Move>,
    first_only: bool,
) -> bool {
    let geo = &ctx.geo;
    let spark_index = ctx.kit.spark_index;
    let gravity = geo.gravity;
    let c_air = gravity && geo.pad_test(inp.air, c);
    if inp.spark {
        // A spark covers only `c`, a clear candidate.
        if !c_air {
            let (pids, _) = geo.entries(c, spark_index);
            out.push(Move {
                pid: pids[0],
                leap: inp.leap,
            });
            return first_only;
        }
        return false;
    }
    let win = geo.window(inp.fp, c);
    let awin = if gravity { geo.window(inp.air, c) } else { 0 };
    // Face neighbours of the anchor that are still open. Every shard of
    // two or more cells covers at least one, so only non-empty subsets of
    // `open` can hold legal placements.
    let mut open = 0usize;
    for (i, &b) in geo.face_bits.iter().enumerate() {
        if win >> b & 1 == 0 {
            open |= 1 << i;
        }
    }
    if open == 0 {
        return false;
    }
    let gs = geo.subsets + 1;
    // All neighbours open: the whole list (minus the empty subset) is one
    // contiguous range.
    let all = open == geo.subsets - 1;
    let mut pieces = inp.pieces & ((1u32 << spark_index) - 1);
    while pieces != 0 {
        let piece = pieces.trailing_zeros() as usize;
        pieces &= pieces - 1;
        let i = c * geo.pieces + piece;
        let start = geo.ent_off[i] as usize;
        let grp = &geo.grp_off[i * gs..(i + 1) * gs];
        let mut sub = open;
        while sub != 0 {
            let (a, b) = if all {
                (start + grp[1] as usize, start + grp[geo.subsets] as usize)
            } else {
                (start + grp[sub] as usize, start + grp[sub + 1] as usize)
            };
            sub = if all { 0 } else { (sub - 1) & open };
            for k in a..b {
                if geo.ent_mask[k] & win != 0 {
                    continue;
                }
                if gravity && (geo.ent_need[k] & awin != 0 || (c_air && geo.ent_cneed[k])) {
                    continue;
                }
                let pid = geo.ent_pid[k] as usize;
                if DEDUPE {
                    if stamp[pid] == epoch {
                        continue;
                    }
                    stamp[pid] = epoch;
                }
                out.push(Move {
                    pid: pid as u32,
                    leap: inp.leap,
                });
                if first_only {
                    return true;
                }
            }
        }
    }
    false
}

/// Per-seat bitboards computed from scratch for one generation call: own
/// cells, light (own plus allies under shared light), occupied cells into
/// `forb`, and under gravity the padded `air` rows.
pub fn seat_rows(ctx: &Ctx, cells: &[u8], seat: usize, sc: &mut Scratch) {
    let geo = &ctx.geo;
    let rows = geo.rows;
    let w = geo.w;
    sc.own.clear();
    sc.own.resize(rows, 0);
    sc.light.clear();
    sc.light.resize(rows, 0);
    sc.forb.clear();
    sc.forb.resize(rows, 0);
    let gravity = ctx.config.gravity;
    if gravity {
        sc.solid.clear();
        sc.solid.resize(rows, 0);
    }
    let own = seat as u8 + 1;
    let shared = ctx.config.shared_light;
    let team = ctx.config.team_of(seat);
    for ri in 0..rows {
        let base = ri * w;
        let (mut o, mut l, mut occ, mut solid) = (0u64, 0u64, 0u64, 0u64);
        for (x, &v) in cells[base..base + w].iter().enumerate() {
            if v != EMPTY {
                occ |= 1 << x;
                if is_seat(v) || v == SCAR {
                    solid |= 1 << x;
                }
                if v == own {
                    o |= 1 << x;
                    l |= 1 << x;
                } else if shared && is_seat(v) && ctx.config.team_of(v as usize - 1) == team {
                    l |= 1 << x;
                }
            }
        }
        sc.own[ri] = o;
        sc.light[ri] = l;
        sc.forb[ri] = occ;
        if gravity {
            sc.solid[ri] = solid;
        }
    }
    if gravity {
        air_rows(ctx, &sc.solid, &mut sc.tmp, &mut sc.air);
    }
}

/// Padded rows of cells above the floor with nothing solid directly below.
fn air_rows(ctx: &Ctx, solid: &[u64], tmp: &mut Vec<u64>, out: &mut Vec<u64>) {
    let geo = &ctx.geo;
    tmp.clear();
    tmp.resize(geo.rows, 0);
    for ri in 0..geo.rows {
        let z = ri / geo.h;
        tmp[ri] = if z == 0 {
            0
        } else {
            !solid[ri - geo.h] & geo.wmask
        };
    }
    out.clear();
    out.resize(geo.prows, 0);
    geo.pad(tmp, out);
}

/// Fill `sc.fp` (padded forbidden) and `sc.cand` (candidate anchors) for a
/// seat and mode from the rows built by [`seat_rows`].
pub fn prepare(ctx: &Ctx, leap: bool, sc: &mut Scratch) {
    let geo = &ctx.geo;
    let rows = geo.rows;
    sc.tmp.clear();
    sc.tmp.resize(rows, 0);
    sc.cand.clear();
    sc.cand.resize(rows, 0);
    geo.face(&sc.own, &mut sc.tmp);
    for ri in 0..rows {
        sc.forb[ri] |= sc.tmp[ri];
    }
    sc.fp.clear();
    sc.fp.resize(geo.prows, 0);
    geo.pad(&sc.forb, &mut sc.fp);
    if leap {
        sc.tmp2.clear();
        sc.tmp2.resize(rows, 0);
        geo.ball2(&sc.light, &mut sc.cand, &mut sc.tmp2);
    } else {
        geo.link(&sc.light, &mut sc.cand);
    }
    for ri in 0..rows {
        sc.cand[ri] &= !sc.forb[ri] & geo.playable[ri];
    }
}

/// Incrementally maintained bitboards for every seat: own cells, padded
/// forbidden rows and attach points. Bots keep one beside each simulated
/// `State` and update both with [`Board::place`]. Anything that removes
/// cells (a shatter, the storm) needs a fresh [`Board::from_cells`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    seats: usize,
    rows: usize,
    prows: usize,
    /// Own cells per seat (canonical rows, seat-major).
    pub own: Vec<u64>,
    /// Occupied cells (anything but empty).
    pub occ: Vec<u64>,
    /// Padded forbidden rows per seat.
    pub fp: Vec<u64>,
    /// Attach points per seat: empty, not forbidden, link-adjacent to light.
    pub attach: Vec<u64>,
    /// Gravity only: padded rows of unsupported cells.
    pub air: Vec<u64>,
}

impl Board {
    pub fn from_cells(ctx: &Ctx, cells: &[u8]) -> Board {
        let geo = &ctx.geo;
        let seats = ctx.config.seats as usize;
        let (rows, prows) = (geo.rows, geo.prows);
        let mut b = Board {
            seats,
            rows,
            prows,
            own: vec![0; rows * seats],
            occ: vec![0; rows],
            fp: vec![0; prows * seats],
            attach: vec![0; rows * seats],
            air: Vec::new(),
        };
        let mut sc = Scratch::default();
        for s in 0..seats {
            seat_rows(ctx, cells, s, &mut sc);
            if s == 0 {
                b.occ.copy_from_slice(&sc.forb);
                if ctx.config.gravity {
                    b.air = sc.air.clone();
                }
            }
            b.own[s * rows..(s + 1) * rows].copy_from_slice(&sc.own);
            prepare(ctx, false, &mut sc);
            b.fp[s * prows..(s + 1) * prows].copy_from_slice(&sc.fp);
            b.attach[s * rows..(s + 1) * rows].copy_from_slice(&sc.cand);
        }
        b
    }

    /// Become a copy of `o`, reusing allocations.
    pub fn copy_from(&mut self, o: &Board) {
        self.seats = o.seats;
        self.rows = o.rows;
        self.prows = o.prows;
        self.own.clone_from(&o.own);
        self.occ.clone_from(&o.occ);
        self.fp.clone_from(&o.fp);
        self.attach.clone_from(&o.attach);
        self.air.clone_from(&o.air);
    }

    #[inline]
    pub fn own(&self, seat: usize) -> &[u64] {
        &self.own[seat * self.rows..(seat + 1) * self.rows]
    }

    #[inline]
    pub fn fp(&self, seat: usize) -> &[u64] {
        &self.fp[seat * self.prows..(seat + 1) * self.prows]
    }

    #[inline]
    pub fn attach(&self, seat: usize) -> &[u64] {
        &self.attach[seat * self.rows..(seat + 1) * self.rows]
    }

    #[inline]
    pub fn forbidden(&self, ctx: &Ctx, seat: usize, cell: usize) -> bool {
        ctx.geo.pad_test(self.fp(seat), cell)
    }

    /// Canonical forbidden rows of a seat.
    pub fn forbidden_rows(&self, ctx: &Ctx, seat: usize, out: &mut Vec<u64>) {
        let geo = &ctx.geo;
        let fp = self.fp(seat);
        out.clear();
        out.extend((0..self.rows).map(|ri| geo.unpad_row(fp, ri)));
    }

    /// `seat` places `cells` (all previously empty).
    pub fn place(&mut self, ctx: &Ctx, seat: usize, cells: &[u32]) {
        let geo = &ctx.geo;
        let lat = &ctx.lat;
        let (rows, prows, w) = (self.rows, self.prows, geo.w);
        let shared = ctx.config.shared_light;
        for &c in cells {
            let c = c as usize;
            let (ri, bit) = (c / w, 1u64 << (c % w));
            self.occ[ri] |= bit;
            self.own[seat * rows + ri] |= bit;
            for t in 0..self.seats {
                geo.pad_set(&mut self.fp[t * prows..(t + 1) * prows], c);
                self.attach[t * rows + ri] &= !bit;
            }
            if !self.air.is_empty() {
                if let Some(a) = lat.above(c) {
                    geo.pad_clear(&mut self.air, a);
                }
            }
        }
        for &c in cells {
            for &f in lat.face.get(c as usize) {
                let f = f as usize;
                geo.pad_set(&mut self.fp[seat * prows..(seat + 1) * prows], f);
                self.attach[seat * rows + f / w] &= !(1 << (f % w));
            }
        }
        for t in 0..self.seats {
            let lights = t == seat || (shared && ctx.config.allies(seat, t));
            if !lights {
                continue;
            }
            for &c in cells {
                for &l in lat.link.get(c as usize) {
                    let l = l as usize;
                    if !geo.pad_test(&self.fp[t * prows..(t + 1) * prows], l) {
                        self.attach[t * rows + l / w] |= 1 << (l % w);
                    }
                }
            }
        }
    }

    /// Generate moves for `seat` straight from the incremental boards. The
    /// caller checks that the seat can afford the mode.
    pub fn gen_moves(
        &self,
        ctx: &Ctx,
        seat: usize,
        pieces: u32,
        mode: GenMode,
        sc: &mut Scratch,
        out: &mut Vec<Move>,
        first_only: bool,
    ) -> bool {
        let spark = matches!(mode, GenMode::Spark | GenMode::SparkLeap);
        let leap = matches!(mode, GenMode::Leap | GenMode::SparkLeap);
        if !spark && pieces == 0 {
            return false;
        }
        sc.prepare(ctx);
        if leap {
            let geo = &ctx.geo;
            let rows = self.rows;
            sc.light.clear();
            sc.light.resize(rows, 0);
            for t in 0..self.seats {
                if t == seat || (ctx.config.shared_light && ctx.config.allies(seat, t)) {
                    for ri in 0..rows {
                        sc.light[ri] |= self.own[t * rows + ri];
                    }
                }
            }
            sc.cand.clear();
            sc.cand.resize(rows, 0);
            sc.tmp2.clear();
            sc.tmp2.resize(rows, 0);
            geo.ball2(&sc.light, &mut sc.cand, &mut sc.tmp2);
            let fp = self.fp(seat);
            for ri in 0..rows {
                sc.cand[ri] &= geo.playable[ri] & !geo.unpad_row(fp, ri);
            }
        }
        let inp = GenInput {
            fp: self.fp(seat),
            cand: if leap { &sc.cand } else { self.attach(seat) },
            air: &self.air,
            pieces,
            spark,
            leap,
        };
        generate(ctx, &inp, &mut sc.stamp, sc.epoch, out, first_only)
    }

    /// Kit placements through one attach point (no surges). Used by
    /// playouts, which sample anchors instead of enumerating every move.
    pub fn moves_at(&self, ctx: &Ctx, seat: usize, cell: usize, pieces: u32, out: &mut Vec<Move>) {
        let inp = GenInput {
            fp: self.fp(seat),
            cand: &[],
            air: &self.air,
            pieces,
            spark: false,
            leap: false,
        };
        anchor_moves::<false>(ctx, &inp, cell, &mut [], 0, out, false);
    }

    /// Window status around attach point `cell` for `seat`.
    pub fn anchor_win(&self, ctx: &Ctx, seat: usize, cell: usize) -> AnchorWin {
        let geo = &ctx.geo;
        let win = geo.window(self.fp(seat), cell);
        let gravity = geo.gravity;
        let awin = if gravity {
            geo.window(&self.air, cell)
        } else {
            0
        };
        let c_air = gravity && geo.pad_test(&self.air, cell);
        let mut open = 0usize;
        for (i, &b) in geo.face_bits.iter().enumerate() {
            if win >> b & 1 == 0 {
                open |= 1 << i;
            }
        }
        AnchorWin {
            cell,
            win,
            awin,
            c_air,
            open,
        }
    }

    /// Is `cell` a legal spot for a Spark (clear, and supported under
    /// gravity)? The caller passes an attach point.
    #[inline]
    pub fn spark_ok(&self, ctx: &Ctx, cell: usize) -> bool {
        self.air.is_empty() || !ctx.geo.pad_test(&self.air, cell)
    }

    /// The spark placement id at `cell`.
    #[inline]
    pub fn spark_pid(ctx: &Ctx, cell: usize) -> u32 {
        ctx.geo.entries(cell, ctx.kit.spark_index).0[0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GameConfig;
    use crate::game::{Event, Phase, State};
    use crate::geometry::BoardShape;
    use crate::rng::Rng;
    use std::sync::Arc;

    const MODES: [GenMode; 4] = [
        GenMode::Normal,
        GenMode::Spark,
        GenMode::Leap,
        GenMode::SparkLeap,
    ];

    fn sorted(v: Vec<Move>) -> Vec<(u32, bool)> {
        let mut out: Vec<(u32, bool)> = v.into_iter().map(|m| (m.pid, m.leap)).collect();
        out.sort_unstable();
        out
    }

    fn configs() -> Vec<(GameConfig, u64)> {
        let mut out = Vec::new();
        for name in GameConfig::PRESETS {
            for seats in [2u8, 3, 4] {
                let games = if matches!(name, "stack" | "orbit") {
                    1
                } else {
                    2
                };
                out.push((GameConfig::preset(name, seats).unwrap(), games));
            }
        }
        for shape in [BoardShape::Octagon, BoardShape::Cross, BoardShape::Diamond] {
            let mut c = GameConfig::preset("plane", 4).unwrap();
            c.shape = shape;
            out.push((c, 1));
            let mut c = GameConfig::preset("torus", 2).unwrap();
            c.shape = shape;
            out.push((c, 1));
        }
        let mut c = GameConfig::preset("storm", 2).unwrap();
        c.storm = Some(crate::config::StormConfig {
            start: 2,
            every: 2,
            min_span: 8,
        });
        out.push((c, 2));
        out
    }

    /// Compare the bitboard generator, the incremental board and the naive
    /// reference on every seat and mode, with charge topped up so every
    /// surge mode is exercised.
    fn check_position(ctx: &Ctx, st: &State, board: &Board, sc: &mut Scratch, tag: &str) {
        let fresh = Board::from_cells(ctx, &st.cells);
        assert_eq!(board, &fresh, "{tag}: incremental board drifted");
        for seat in 0..st.seats.len() {
            let mut rich = st.clone();
            rich.seats[seat].charge = 9;
            for mode in MODES {
                let mut a = Vec::new();
                rich.gen_moves(ctx, seat, mode, sc, &mut a, false);
                let mut b = Vec::new();
                rich.gen_moves_naive(ctx, seat, mode, sc, &mut b, false);
                let n = a.len();
                assert_eq!(sorted(a), sorted(b), "{tag}: seat {seat} {mode:?}");
                let mut d = Vec::new();
                rich.gen_moves(ctx, seat, mode, sc, &mut d, true);
                assert_eq!(d.len(), n.min(1), "{tag}: first_only {mode:?}");
                if ctx.config.arena || mode == GenMode::Normal {
                    let mut c = Vec::new();
                    board.gen_moves(
                        ctx,
                        seat,
                        kit_mask(&rich.seats[seat].pieces),
                        mode,
                        sc,
                        &mut c,
                        false,
                    );
                    assert_eq!(sorted(c), sorted(d_all(ctx, &rich, seat, mode, sc)));
                }
            }
        }
    }

    fn d_all(ctx: &Ctx, st: &State, seat: usize, mode: GenMode, sc: &mut Scratch) -> Vec<Move> {
        let mut v = Vec::new();
        st.gen_moves(ctx, seat, mode, sc, &mut v, false);
        v
    }

    /// Property test: over random games on every preset and seat count (plus
    /// shaped boards and a fast storm), the bitboard generator equals the
    /// naive reference and the incremental board equals one built from
    /// scratch, after every kind of event.
    #[test]
    fn incremental_and_bitboard_match_naive_over_random_games() {
        for (ci, (cfg, games)) in configs().into_iter().enumerate() {
            let ctx: Arc<Ctx> = Ctx::new(cfg.clone()).unwrap();
            for game in 0..games {
                let seed = ci as u64 * 100 + game;
                let mut rng = Rng::new(seed);
                let mut st = State::new(&ctx, seed);
                let mut board = Board::from_cells(&ctx, &st.cells);
                let mut sc = Scratch::default();
                let mut plies = 0;
                while st.phase == Phase::Playing && plies < 400 {
                    plies += 1;
                    let tag = format!("cfg {ci} ({cfg:?}) game {game} ply {plies}");
                    if plies % 4 == 1 {
                        check_position(&ctx, &st, &board, &mut sc, &tag);
                    }
                    let seat = st.turn as usize;
                    if cfg.arena && rng.below(6) == 0 {
                        st.seats[seat].charge = st.seats[seat].charge.max(3);
                        let targets: Vec<usize> = (0..st.cells.len())
                            .filter(|&i| st.check_shatter(&ctx, seat, i).is_ok())
                            .collect();
                        if !targets.is_empty() {
                            let t = targets[rng.below(targets.len() as u32) as usize];
                            let victim = st.check_shatter(&ctx, seat, t).unwrap();
                            let mut ev = Vec::new();
                            st.commit_shatter(seat, t, victim, &mut ev);
                            assert_eq!(st.cells[t], SCAR);
                            board = Board::from_cells(&ctx, &st.cells);
                        }
                    }
                    if cfg.arena && rng.below(4) == 0 {
                        st.seats[seat].charge = (st.seats[seat].charge + 2).min(9);
                    }
                    let moves = st.all_moves(&ctx, seat, &mut sc);
                    let mut ev = Vec::new();
                    if moves.is_empty() {
                        st.resign(&ctx, seat, &mut sc, &mut ev).unwrap();
                        continue;
                    }
                    let m = moves[rng.below(moves.len() as u32) as usize];
                    let p = m.pid as usize;
                    let cells: Vec<usize> =
                        ctx.table.cells(p).iter().map(|&c| c as usize).collect();
                    let piece = ctx.table.piece[p] as usize;
                    st.commit_place(&ctx, seat, piece, &cells, m.leap, &mut sc, &mut ev);
                    if ev.iter().any(|e| matches!(e, Event::Storm { .. })) {
                        board = Board::from_cells(&ctx, &st.cells);
                    } else {
                        board.place(&ctx, seat, ctx.table.cells(p));
                    }
                }
            }
        }
    }

    #[test]
    fn window_masks_cover_the_rest_of_the_shard() {
        for (name, seats) in [("plane", 4), ("torus", 2), ("stack", 2)] {
            let ctx = Ctx::new(GameConfig::preset(name, seats).unwrap()).unwrap();
            let geo = &ctx.geo;
            let bits: usize = geo.runs.iter().map(|r| r.3 as usize).sum();
            assert_eq!(bits, if geo.three_d { 128 } else { 40 });
            for c in 0..ctx.lat.len() {
                for piece in 0..geo.pieces {
                    let (pids, masks) = geo.entries(c, piece);
                    for (k, &pid) in pids.iter().enumerate() {
                        let cells = ctx.table.cells(pid as usize);
                        assert!(cells.contains(&(c as u32)));
                        assert_eq!(masks[k].count_ones() as usize, cells.len() - 1);
                    }
                    // Groups partition the list in subset order.
                    let gs = geo.subsets + 1;
                    let i = c * geo.pieces + piece;
                    let grp = &geo.grp_off[i * gs..(i + 1) * gs];
                    assert_eq!(grp[0], 0);
                    assert_eq!(grp[geo.subsets] as usize, pids.len());
                    for sub in 0..geo.subsets {
                        for k in grp[sub] as usize..grp[sub + 1] as usize {
                            let mut got = 0;
                            for (j, &b) in geo.face_bits.iter().enumerate() {
                                if masks[k] >> b & 1 != 0 {
                                    got |= 1 << j;
                                }
                            }
                            assert_eq!(got, sub);
                        }
                    }
                }
            }
        }
    }
}
