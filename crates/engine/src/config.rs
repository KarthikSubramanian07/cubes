//! Game configuration, presets, and the symmetric layout of Cores and Nodes.

use crate::geometry::{BoardShape, Lattice, Topology};
use crate::pieces::KitKind;
use crate::rng::Rng;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StormConfig {
    pub start: u16,
    pub every: u16,
    pub min_span: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub dims: [u8; 3],
    pub shape: BoardShape,
    pub topology: Topology,
    pub gravity: bool,
    pub seats: u8,
    pub teams: bool,
    pub shared_light: bool,
    pub arena: bool,
    pub nodes: u8,
    pub fog: Option<u8>,
    pub storm: Option<StormConfig>,
    pub crowns: bool,
    pub turn_seconds: Option<u16>,
    pub kit: KitKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub String);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl GameConfig {
    pub fn preset(name: &str, seats: u8) -> Option<GameConfig> {
        let seats = seats.clamp(2, 4);
        let side2d = |big: u8, small: u8| if seats == 2 { small } else { big };
        let base = GameConfig {
            dims: [side2d(20, 14), side2d(20, 14), 1],
            shape: BoardShape::Square,
            topology: Topology::Flat,
            gravity: false,
            seats,
            teams: false,
            shared_light: false,
            arena: true,
            nodes: if seats == 2 { 6 } else { 12 },
            fog: None,
            storm: None,
            crowns: false,
            turn_seconds: None,
            kit: KitKind::Shards,
        };
        let cfg = match name {
            "plane" => base,
            "duel" => GameConfig {
                dims: [14, 14, 1],
                seats: 2,
                nodes: 6,
                ..base
            },
            "pure" => GameConfig {
                arena: false,
                nodes: 0,
                ..base
            },
            "fog" => GameConfig {
                dims: [side2d(18, 14), side2d(18, 14), 1],
                fog: Some(2),
                ..base
            },
            "storm" => GameConfig {
                storm: Some(StormConfig {
                    start: 6,
                    every: 3,
                    min_span: 8,
                }),
                ..base
            },
            "torus" => GameConfig {
                dims: [side2d(18, 14), side2d(18, 14), 1],
                topology: Topology::Torus,
                ..base
            },
            "teams" => GameConfig {
                dims: [20, 20, 1],
                seats: 4,
                teams: true,
                shared_light: true,
                nodes: 12,
                ..base
            },
            "stack" => GameConfig {
                // 6x6x6 jammed for two: a third of the kit went unplayed (see docs/BALANCE.md).
                dims: if seats == 2 { [8, 8, 6] } else { [8, 8, 8] },
                gravity: true,
                crowns: true,
                kit: KitKind::Cubes,
                nodes: if seats == 2 { 4 } else { 8 },
                ..base
            },
            "orbit" => GameConfig {
                // Two players never meet on 7x7x7, which turns it into a node race.
                dims: if seats == 2 { [6, 6, 6] } else { [7, 7, 7] },
                kit: KitKind::Cubes,
                nodes: if seats == 2 { 4 } else { 8 },
                ..base
            },
            _ => return None,
        };
        Some(cfg)
    }

    pub const PRESETS: [&'static str; 9] = [
        "plane", "duel", "pure", "fog", "storm", "torus", "teams", "stack", "orbit",
    ];

    pub fn validate(&self) -> Result<(), ConfigError> {
        let [w, h, d] = self.dims;
        let err = |m: &str| Err(ConfigError(m.to_string()));
        if !(2..=4).contains(&self.seats) {
            return err("seats must be 2 to 4");
        }
        if w != h {
            return err("boards must be square in x and y");
        }
        let three_d = d > 1;
        if three_d {
            if !(5..=10).contains(&w) || !(3..=10).contains(&d) {
                return err("3D boards must be 5 to 10 wide and 3 to 10 tall");
            }
            if self.kit != KitKind::Cubes {
                return err("3D boards use the cubes kit");
            }
            if self.topology == Topology::Torus {
                return err("torus is 2D only");
            }
        } else {
            if !(8..=30).contains(&w) {
                return err("2D boards must be 8 to 30 wide");
            }
            if self.kit != KitKind::Shards {
                return err("2D boards use the shards kit");
            }
            if self.gravity {
                return err("gravity needs a 3D board");
            }
        }
        if self.teams && self.seats != 4 {
            return err("teams need 4 seats");
        }
        if self.shared_light && !self.teams {
            return err("shared light needs teams");
        }
        if !self.arena && self.nodes > 0 {
            return err("nodes need the arena layer");
        }
        if self.nodes > 32 {
            return err("at most 32 nodes");
        }
        if let Some(r) = self.fog {
            if !(1..=6).contains(&r) {
                return err("fog radius must be 1 to 6");
            }
        }
        if let Some(s) = self.storm {
            if s.every == 0 || s.start == 0 {
                return err("storm start and interval must be positive");
            }
        }
        if let Some(t) = self.turn_seconds {
            if !(5..=600).contains(&t) {
                return err("turn timer must be 5 to 600 seconds");
            }
        }
        Ok(())
    }

    #[inline]
    pub fn team_of(&self, seat: usize) -> usize {
        if self.teams {
            seat % 2
        } else {
            seat
        }
    }

    #[inline]
    pub fn allies(&self, a: usize, b: usize) -> bool {
        a == b || (self.teams && a % 2 == b % 2)
    }
}

/// Positions of each seat's Core.
///
/// 2D and gravity boards: walk from the centre toward the seat's corner (or
/// axis tip for cross/diamond boards), then step back in by an inset.
/// Free-floating 3D: alternate corners of the cube (a tetrahedron for 4).
pub fn core_cells(cfg: &GameConfig, lat: &Lattice) -> Vec<usize> {
    let seats = cfg.seats as usize;
    let w = lat.w;
    let inset = (w / 6).max(1);
    if lat.is_3d() && !cfg.gravity {
        let lo = inset;
        let hi = w - 1 - inset;
        let dhi = lat.d - 1 - inset;
        let all = [(lo, lo, lo), (hi, hi, dhi), (hi, lo, dhi), (lo, hi, lo)];
        let order: &[usize] = match seats {
            2 => &[0, 1],
            3 => &[0, 1, 2],
            _ => &[0, 2, 1, 3],
        };
        return order
            .iter()
            .map(|&k| {
                let (x, y, z) = all[k];
                lat.index(x, y, z).expect("core in bounds")
            })
            .collect();
    }
    let axial = matches!(lat.shape, BoardShape::Cross | BoardShape::Diamond);
    // Directions in seat order, clockwise from top-left.
    let dirs: [(i32, i32); 4] = if axial {
        [(0, -1), (1, 0), (0, 1), (-1, 0)]
    } else {
        [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    };
    let pick: &[usize] = match seats {
        2 => &[0, 2],
        3 => &[0, 1, 2],
        _ => &[0, 1, 2, 3],
    };
    let c = (w - 1) as f64 / 2.0;
    pick.iter()
        .map(|&k| {
            let (dx, dy) = dirs[k];
            // March outward from the centre until we leave the board.
            let mut t = 0.0f64;
            let mut last = (c.round() as i32, c.round() as i32);
            loop {
                t += 0.5;
                let x = (c + dx as f64 * t).round() as i32;
                let y = (c + dy as f64 * t).round() as i32;
                match lat.index(x, y, 0) {
                    Some(i) if lat.playable[i] && x >= 0 && y >= 0 && x < w && y < w => {
                        last = (x, y)
                    }
                    _ => break,
                }
                if t > w as f64 {
                    break;
                }
            }
            let (x, y) = (last.0 - dx * inset, last.1 - dy * inset);
            lat.index(x, y, 0).expect("core in bounds")
        })
        .collect()
}

/// Node cells, placed with rotational symmetry so every seat sees the same
/// map. Nodes keep two cells clear of every Core; on boards too small for
/// that (an 8×8 Stack floor with four Cores leaves no such cell), they keep
/// one cell clear instead.
pub fn node_cells(cfg: &GameConfig, lat: &Lattice, cores: &[usize], seed: u64) -> Vec<usize> {
    if !cfg.arena || cfg.nodes == 0 {
        return Vec::new();
    }
    let wide = place_nodes(cfg, lat, cores, seed, 2);
    if wide.len() >= cfg.nodes as usize {
        return wide;
    }
    let close = place_nodes(cfg, lat, cores, seed, 1);
    if close.len() > wide.len() {
        close
    } else {
        wide
    }
}

fn place_nodes(
    cfg: &GameConfig,
    lat: &Lattice,
    cores: &[usize],
    seed: u64,
    keep_off: i32,
) -> Vec<usize> {
    let mut rng = Rng::new(seed ^ 0x6e6f_6465_7321);
    let w = lat.w;
    let fold = if cfg.seats == 2 { 2 } else { 4 };
    let rotate = |x: i32, y: i32| (w - 1 - y, x);
    let target = cfg.nodes as usize;
    let mut out: Vec<usize> = Vec::new();
    let max_z = if cfg.gravity { 0 } else { lat.d - 1 };
    let mut attempts = 0;
    while out.len() + fold <= target.max(fold) && attempts < 4000 {
        attempts += 1;
        let x = rng.below(w as u32) as i32;
        let y = rng.below(w as u32) as i32;
        let z = if max_z == 0 {
            0
        } else {
            rng.below((max_z + 1) as u32) as i32
        };
        let mut orbit = Vec::with_capacity(fold);
        let (mut ox, mut oy) = (x, y);
        for k in 0..4 {
            if fold == 4 || k % 2 == 0 {
                orbit.push((ox, oy));
            }
            let (nx, ny) = rotate(ox, oy);
            ox = nx;
            oy = ny;
        }
        let mut cells = Vec::with_capacity(fold);
        let mut ok = true;
        for (x, y) in orbit {
            let Some(i) = lat.index(x, y, z) else {
                ok = false;
                break;
            };
            let near_core = cores.iter().any(|&c| lat.chebyshev(c, i) <= keep_off);
            if !lat.playable[i] || near_core || out.contains(&i) || cells.contains(&i) {
                ok = false;
                break;
            }
            // Keep nodes apart from each other a little.
            if out.iter().any(|&o| lat.chebyshev(o, i) <= 1) {
                ok = false;
                break;
            }
            cells.push(i);
        }
        if ok && cells.len() == fold {
            out.extend(cells);
        }
        if out.len() >= target {
            break;
        }
    }
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_validates_for_every_seat_count() {
        for name in GameConfig::PRESETS {
            for seats in 2..=4 {
                let cfg = GameConfig::preset(name, seats).unwrap();
                cfg.validate()
                    .unwrap_or_else(|e| panic!("{name}/{seats}: {e}"));
            }
        }
    }

    #[test]
    fn cores_are_distinct_playable_and_inset() {
        for name in GameConfig::PRESETS {
            for seats in 2..=4 {
                let mut cfg = GameConfig::preset(name, seats).unwrap();
                for shape in [
                    BoardShape::Square,
                    BoardShape::Octagon,
                    BoardShape::Cross,
                    BoardShape::Diamond,
                ] {
                    if cfg.dims[2] > 1 && shape != BoardShape::Square {
                        continue;
                    }
                    cfg.shape = shape;
                    let lat = Lattice::new(cfg.dims, cfg.shape, cfg.topology);
                    let cores = core_cells(&cfg, &lat);
                    assert_eq!(cores.len(), cfg.seats as usize);
                    for (i, &c) in cores.iter().enumerate() {
                        assert!(lat.playable[c], "{name} {shape:?} core {i} unplayable");
                        for &d in &cores[i + 1..] {
                            assert!(lat.chebyshev(c, d) >= 3, "{name} {shape:?} cores too close");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn nodes_are_symmetric_and_deterministic() {
        let cfg = GameConfig::preset("plane", 4).unwrap();
        let lat = Lattice::new(cfg.dims, cfg.shape, cfg.topology);
        let cores = core_cells(&cfg, &lat);
        let a = node_cells(&cfg, &lat, &cores, 42);
        let b = node_cells(&cfg, &lat, &cores, 42);
        assert_eq!(a, b);
        assert_eq!(a.len(), 12);
        for &n in &a {
            let (x, y, z) = lat.coords(n);
            let r = lat.index(lat.w - 1 - y, x, z).unwrap();
            assert!(a.contains(&r), "node {n} has no rotated twin");
        }
    }

    #[test]
    fn every_arena_preset_gets_its_nodes() {
        for name in GameConfig::PRESETS {
            for seats in 2..=4 {
                let cfg = GameConfig::preset(name, seats).unwrap();
                let lat = Lattice::new(cfg.dims, cfg.shape, cfg.topology);
                let n = node_cells(&cfg, &lat, &core_cells(&cfg, &lat), 7).len();
                assert_eq!(n, cfg.nodes as usize, "{name}/{seats}");
            }
        }
    }

    #[test]
    fn pure_has_no_nodes() {
        let cfg = GameConfig::preset("pure", 4).unwrap();
        let lat = Lattice::new(cfg.dims, cfg.shape, cfg.topology);
        assert!(node_cells(&cfg, &lat, &core_cells(&cfg, &lat), 1).is_empty());
    }

    #[test]
    fn rejects_bad_configs() {
        let mut cfg = GameConfig::preset("plane", 4).unwrap();
        cfg.seats = 5;
        assert!(cfg.validate().is_err());
        let mut cfg = GameConfig::preset("plane", 2).unwrap();
        cfg.teams = true;
        assert!(cfg.validate().is_err());
        let mut cfg = GameConfig::preset("plane", 4).unwrap();
        cfg.gravity = true;
        assert!(cfg.validate().is_err());
    }
}
