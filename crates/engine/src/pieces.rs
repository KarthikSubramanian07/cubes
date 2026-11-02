//! Kits of shards and their orientations.
//!
//! 2D shards may rotate and flip (8 symmetries). 3D shards may only rotate
//! (24 proper rotations), so chiral pairs are distinct shards.

use serde::{Deserialize, Serialize};

pub type Cell3 = [i32; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KitKind {
    Shards,
    Cubes,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceDef {
    pub id: String,
    pub name: String,
    pub size: usize,
    /// Distinct normalized orientations (min corner at the origin, cells sorted).
    pub orients: Vec<Vec<Cell3>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kit {
    pub kind: KitKind,
    pub pieces: Vec<PieceDef>,
    /// Piece index used for a Spark placement. Equals `pieces.len()`.
    pub spark_index: usize,
}

impl Kit {
    pub fn new(kind: KitKind) -> Self {
        let defs: Vec<(&str, &str, Vec<Cell3>)> = match kind {
            KitKind::Shards => shards_2d(),
            KitKind::Cubes => cubes_3d(),
        };
        let three_d = kind == KitKind::Cubes;
        let pieces: Vec<PieceDef> = defs
            .into_iter()
            .map(|(id, name, cells)| PieceDef {
                id: id.to_string(),
                name: name.to_string(),
                size: cells.len(),
                orients: orientations(&cells, three_d),
            })
            .collect();
        let spark_index = pieces.len();
        Kit {
            kind,
            pieces,
            spark_index,
        }
    }

    /// Orientations for a piece index, including the Spark (a single cell).
    pub fn orients(&self, piece: usize) -> &[Vec<Cell3>] {
        if piece == self.spark_index {
            &SPARK
        } else {
            &self.pieces[piece].orients
        }
    }

    pub fn size(&self, piece: usize) -> usize {
        if piece == self.spark_index {
            1
        } else {
            self.pieces[piece].size
        }
    }

    pub fn total_cells(&self) -> usize {
        self.pieces.iter().map(|p| p.size).sum()
    }
}

static SPARK: std::sync::LazyLock<Vec<Vec<Cell3>>> =
    std::sync::LazyLock::new(|| vec![vec![[0, 0, 0]]]);

fn flat(cells: &[(i32, i32)]) -> Vec<Cell3> {
    cells.iter().map(|&(x, y)| [x, y, 0]).collect()
}

/// The 2D kit: every free polyomino of size 2 to 5 (20 shards, 88 cells).
fn shards_2d() -> Vec<(&'static str, &'static str, Vec<Cell3>)> {
    vec![
        ("p2-i", "Bar", flat(&[(0, 0), (1, 0)])),
        ("p3-i", "Rod", flat(&[(0, 0), (1, 0), (2, 0)])),
        ("p3-v", "Elbow", flat(&[(0, 0), (1, 0), (0, 1)])),
        ("p4-i", "Beam", flat(&[(0, 0), (1, 0), (2, 0), (3, 0)])),
        ("p4-o", "Block", flat(&[(0, 0), (1, 0), (0, 1), (1, 1)])),
        ("p4-t", "Tee", flat(&[(0, 0), (1, 0), (2, 0), (1, 1)])),
        ("p4-l", "Hook", flat(&[(0, 0), (0, 1), (0, 2), (1, 2)])),
        ("p4-s", "Step", flat(&[(1, 0), (2, 0), (0, 1), (1, 1)])),
        ("p5-f", "F", flat(&[(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)])),
        ("p5-i", "I", flat(&[(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)])),
        ("p5-l", "L", flat(&[(0, 0), (0, 1), (0, 2), (0, 3), (1, 3)])),
        ("p5-n", "N", flat(&[(0, 0), (0, 1), (1, 1), (1, 2), (1, 3)])),
        ("p5-p", "P", flat(&[(0, 0), (1, 0), (0, 1), (1, 1), (0, 2)])),
        ("p5-t", "T", flat(&[(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)])),
        ("p5-u", "U", flat(&[(0, 0), (2, 0), (0, 1), (1, 1), (2, 1)])),
        ("p5-v", "V", flat(&[(0, 0), (0, 1), (0, 2), (1, 2), (2, 2)])),
        ("p5-w", "W", flat(&[(0, 0), (0, 1), (1, 1), (1, 2), (2, 2)])),
        ("p5-x", "X", flat(&[(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)])),
        ("p5-y", "Y", flat(&[(1, 0), (0, 1), (1, 1), (1, 2), (1, 3)])),
        ("p5-z", "Z", flat(&[(0, 0), (1, 0), (1, 1), (1, 2), (2, 2)])),
    ]
}

/// The 3D kit: domino, both tricubes, all 8 one-sided tetracubes and 6 planar
/// pentacubes (17 shards, 70 cubes).
fn cubes_3d() -> Vec<(&'static str, &'static str, Vec<Cell3>)> {
    vec![
        ("c2-i", "Bar", flat(&[(0, 0), (1, 0)])),
        ("c3-i", "Rod", flat(&[(0, 0), (1, 0), (2, 0)])),
        ("c3-v", "Elbow", flat(&[(0, 0), (1, 0), (0, 1)])),
        ("c4-i", "Beam", flat(&[(0, 0), (1, 0), (2, 0), (3, 0)])),
        ("c4-o", "Block", flat(&[(0, 0), (1, 0), (0, 1), (1, 1)])),
        ("c4-t", "Tee", flat(&[(0, 0), (1, 0), (2, 0), (1, 1)])),
        ("c4-l", "Hook", flat(&[(0, 0), (0, 1), (0, 2), (1, 2)])),
        ("c4-s", "Step", flat(&[(1, 0), (2, 0), (0, 1), (1, 1)])),
        (
            "c4-y",
            "Tripod",
            vec![[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
        ),
        (
            "c4-r",
            "Right screw",
            vec![[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
        ),
        (
            "c4-q",
            "Left screw",
            vec![[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]],
        ),
        ("c5-l", "L", flat(&[(0, 0), (0, 1), (0, 2), (0, 3), (1, 3)])),
        ("c5-p", "P", flat(&[(0, 0), (1, 0), (0, 1), (1, 1), (0, 2)])),
        ("c5-t", "T", flat(&[(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)])),
        ("c5-v", "V", flat(&[(0, 0), (0, 1), (0, 2), (1, 2), (2, 2)])),
        ("c5-y", "Y", flat(&[(1, 0), (0, 1), (1, 1), (1, 2), (1, 3)])),
        ("c5-n", "N", flat(&[(0, 0), (0, 1), (1, 1), (1, 2), (1, 3)])),
    ]
}

/// Translate so the minimum corner is the origin, then sort.
pub fn normalize(cells: &[Cell3]) -> Vec<Cell3> {
    let mut min = [i32::MAX; 3];
    for c in cells {
        for a in 0..3 {
            min[a] = min[a].min(c[a]);
        }
    }
    let mut out: Vec<Cell3> = cells
        .iter()
        .map(|c| [c[0] - min[0], c[1] - min[1], c[2] - min[2]])
        .collect();
    out.sort_unstable();
    out
}

/// The symmetry group used for orientations: 8 planar maps in 2D, or the 24
/// proper rotations in 3D.
pub fn symmetry_group(three_d: bool) -> Vec<[[i32; 3]; 3]> {
    let mut mats = Vec::new();
    let perms = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    for p in perms {
        for signs in 0..8 {
            let mut m = [[0i32; 3]; 3];
            for r in 0..3 {
                m[r][p[r]] = if signs & (1 << r) != 0 { -1 } else { 1 };
            }
            if three_d {
                if det(&m) == 1 {
                    mats.push(m);
                }
            } else if m[2][2] == 1 {
                // Planar maps: keep z fixed; allow reflections in the plane.
                mats.push(m);
            }
        }
    }
    mats
}

fn det(m: &[[i32; 3]; 3]) -> i32 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

fn apply(m: &[[i32; 3]; 3], c: &Cell3) -> Cell3 {
    [
        m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
        m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
        m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2],
    ]
}

pub fn orientations(cells: &[Cell3], three_d: bool) -> Vec<Vec<Cell3>> {
    let mut out: Vec<Vec<Cell3>> = Vec::new();
    for m in symmetry_group(three_d) {
        let img: Vec<Cell3> = cells.iter().map(|c| apply(&m, c)).collect();
        let n = normalize(&img);
        if !out.contains(&n) {
            out.push(n);
        }
    }
    out
}

/// Canonical form: the smallest normalized image under the group.
pub fn canonical(cells: &[Cell3], three_d: bool) -> Vec<Cell3> {
    orientations(cells, three_d)
        .into_iter()
        .min()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn connected(cells: &[Cell3]) -> bool {
        let set: HashSet<Cell3> = cells.iter().copied().collect();
        let mut seen = HashSet::new();
        let mut stack = vec![cells[0]];
        while let Some(c) = stack.pop() {
            if !seen.insert(c) {
                continue;
            }
            for d in [
                [1, 0, 0],
                [-1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [0, 0, 1],
                [0, 0, -1],
            ] {
                let n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
                if set.contains(&n) {
                    stack.push(n);
                }
            }
        }
        seen.len() == cells.len()
    }

    #[test]
    fn group_sizes() {
        assert_eq!(symmetry_group(false).len(), 8);
        assert_eq!(symmetry_group(true).len(), 24);
    }

    #[test]
    fn shards_kit_is_every_free_polyomino_2_to_5() {
        let kit = Kit::new(KitKind::Shards);
        assert_eq!(kit.pieces.len(), 20);
        assert_eq!(kit.total_cells(), 88);
        let mut canon = HashSet::new();
        for p in &kit.pieces {
            assert!(connected(&p.orients[0]), "{} disconnected", p.id);
            assert!(
                canon.insert(canonical(&p.orients[0], false)),
                "{} duplicated",
                p.id
            );
        }
        let by_size = |s| kit.pieces.iter().filter(|p| p.size == s).count();
        assert_eq!(
            (by_size(2), by_size(3), by_size(4), by_size(5)),
            (1, 2, 5, 12)
        );
        // 91 fixed orientations for sizes 1..=5, minus the single monomino.
        let total: usize = kit.pieces.iter().map(|p| p.orients.len()).sum();
        assert_eq!(total, 90);
    }

    #[test]
    fn cubes_kit_has_eight_one_sided_tetracubes() {
        let kit = Kit::new(KitKind::Cubes);
        assert_eq!(kit.pieces.len(), 17);
        assert_eq!(kit.total_cells(), 70);
        let mut canon = HashSet::new();
        for p in &kit.pieces {
            assert!(connected(&p.orients[0]), "{} disconnected", p.id);
            assert!(
                canon.insert(canonical(&p.orients[0], true)),
                "{} duplicated",
                p.id
            );
        }
        let tetra: Vec<_> = kit.pieces.iter().filter(|p| p.size == 4).collect();
        assert_eq!(tetra.len(), 8);
        // The two screws are mirror images, distinct under rotation alone.
        let r = &kit.pieces.iter().find(|p| p.id == "c4-r").unwrap().orients[0];
        let q = &kit.pieces.iter().find(|p| p.id == "c4-q").unwrap().orients[0];
        let mirror: Vec<Cell3> = r.iter().map(|c| [c[0], c[2], c[1]]).collect();
        assert_eq!(canonical(&mirror, true), canonical(q, true));
        assert_ne!(canonical(r, true), canonical(q, true));
    }

    #[test]
    fn orientation_counts() {
        let kit = Kit::new(KitKind::Shards);
        let get = |id: &str| {
            kit.pieces
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .orients
                .len()
        };
        assert_eq!(get("p5-x"), 1);
        assert_eq!(get("p4-o"), 1);
        assert_eq!(get("p5-i"), 2);
        assert_eq!(get("p5-f"), 8);
        assert_eq!(get("p5-t"), 4);
        let cubes = Kit::new(KitKind::Cubes);
        let get3 = |id: &str| {
            cubes
                .pieces
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .orients
                .len()
        };
        assert_eq!(get3("c2-i"), 3);
        assert_eq!(get3("c4-o"), 3);
        assert_eq!(get3("c3-v"), 12);
    }

    #[test]
    fn spark_is_a_single_cell() {
        let kit = Kit::new(KitKind::Shards);
        assert_eq!(kit.size(kit.spark_index), 1);
        assert_eq!(kit.orients(kit.spark_index), &[vec![[0, 0, 0]]]);
    }
}
