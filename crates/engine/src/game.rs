//! Game state, rules, surges, storm, fog of war, views and scoring.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::bits::{generate, kit_mask, prepare, seat_rows, GenInput, Geo};
use crate::config::{core_cells, node_cells, ConfigError, GameConfig};
use crate::geometry::Lattice;
use crate::pieces::Kit;
use crate::table::{place_cells, Table};

pub const EMPTY: u8 = 0;
pub const VOID: u8 = 250;
pub const SCAR: u8 = 251;
pub const ASH: u8 = 252;

pub const F_NODE: u8 = 1;
pub const F_CORE: u8 = 2;
pub const F_STALE: u8 = 4;
pub const F_VISIBLE: u8 = 8;

pub const MAX_CHARGE: u8 = 9;
pub const COST_SPARK: u8 = 1;
pub const COST_LEAP: u8 = 2;
pub const COST_SHATTER: u8 = 3;
pub const COST_SCAN: u8 = 1;
pub const SWEEP_BONUS: i32 = 5;

#[inline]
pub fn is_seat(owner: u8) -> bool {
    (1..=4).contains(&owner)
}

/// Shared, immutable context derived from a config: lattice, kit, move table.
#[derive(Debug)]
pub struct Ctx {
    pub config: GameConfig,
    pub lat: Lattice,
    pub kit: Kit,
    pub table: Table,
    /// Bitboard geometry and per-cell placement windows.
    pub geo: Geo,
}

impl Ctx {
    pub fn new(config: GameConfig) -> Result<Arc<Ctx>, ConfigError> {
        config.validate()?;
        let lat = Lattice::new(config.dims, config.shape, config.topology);
        let kit = Kit::new(config.kit);
        let table = Table::build(&lat, &kit);
        let geo = Geo::build(&lat, &kit, &table, config.gravity);
        Ok(Arc::new(Ctx {
            config,
            lat,
            kit,
            table,
            geo,
        }))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Playing,
    Over,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatState {
    pub pieces: Vec<bool>,
    pub charge: u8,
    pub dark: bool,
    pub resigned: bool,
}

/// The cheap-to-clone simulation state. The AI clones this freely.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub cells: Vec<u8>,
    pub flags: Vec<u8>,
    pub cores: Vec<u32>,
    pub seats: Vec<SeatState>,
    pub turn: u8,
    pub round: u16,
    pub ply: u32,
    pub phase: Phase,
    pub storm_level: u8,
    pub shattered_this_turn: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    #[serde(rename_all = "camelCase")]
    Place {
        piece: u16,
        orient: u16,
        at: [i32; 3],
        #[serde(default)]
        leap: bool,
    },
    Shatter {
        cell: u32,
    },
    Scan,
    Resign,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Placed {
        seat: u8,
        piece: u16,
        cells: Vec<u32>,
        leap: bool,
        spark: bool,
        #[serde(default)]
        hidden: bool,
    },
    Node {
        seat: u8,
        cell: u32,
    },
    Shattered {
        seat: u8,
        cell: u32,
        victim: u8,
    },
    Misfire {
        seat: u8,
        cells: Vec<u32>,
    },
    Scanned {
        seat: u8,
    },
    Dark {
        seat: u8,
    },
    Storm {
        level: u8,
        cells: Vec<u32>,
    },
    GameOver {
        scores: Vec<i32>,
        winners: Vec<u8>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuleError {
    GameOver,
    NotYourTurn,
    Dark,
    NoArena,
    NoFog,
    NoCharge,
    PieceUsed,
    BadPiece,
    BadOrient,
    OffBoard,
    Occupied,
    Unsupported,
    TouchesOwnFace,
    NoLink,
    BadTarget,
    AlreadyShattered,
}

impl RuleError {
    pub fn message(&self) -> &'static str {
        match self {
            RuleError::GameOver => "the game is over",
            RuleError::NotYourTurn => "it isn't your turn",
            RuleError::Dark => "you've gone dark",
            RuleError::NoArena => "surges are off in this mode",
            RuleError::NoFog => "scan only works under fog",
            RuleError::NoCharge => "not enough charge",
            RuleError::PieceUsed => "you've already placed that shard",
            RuleError::BadPiece => "no such shard",
            RuleError::BadOrient => "no such orientation",
            RuleError::OffBoard => "that hangs off the board",
            RuleError::Occupied => "something is already there",
            RuleError::Unsupported => "every cube needs something underneath it",
            RuleError::TouchesOwnFace => "your light can't touch itself along a face",
            RuleError::NoLink => "it has to touch your light at a corner",
            RuleError::BadTarget => "you can't shatter that",
            RuleError::AlreadyShattered => "one shatter per turn",
        }
    }
}

impl std::fmt::Display for RuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// A move as the generator sees it: a placement id and whether it uses Leap.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Move {
    pub pid: u32,
    pub leap: bool,
}

/// Reusable buffers for move generation, so hot loops don't allocate.
#[derive(Clone, Debug, Default)]
pub struct Scratch {
    pub(crate) stamp: Vec<u32>,
    pub(crate) epoch: u32,
    // Bitboard rows (see `bits`).
    pub(crate) own: Vec<u64>,
    pub(crate) light: Vec<u64>,
    pub(crate) forb: Vec<u64>,
    pub(crate) fp: Vec<u64>,
    pub(crate) cand: Vec<u64>,
    pub(crate) tmp: Vec<u64>,
    pub(crate) tmp2: Vec<u64>,
    pub(crate) solid: Vec<u64>,
    pub(crate) air: Vec<u64>,
    // Reference generator.
    nforbidden: Vec<bool>,
    ncand: Vec<u32>,
    ball: Vec<usize>,
}

impl Scratch {
    pub(crate) fn prepare(&mut self, ctx: &Ctx) {
        if self.stamp.len() != ctx.table.len() {
            self.stamp = vec![0; ctx.table.len()];
            self.epoch = 0;
        }
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.stamp.iter_mut().for_each(|s| *s = 0);
            self.epoch = 1;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GenMode {
    /// Kit shards linked by a corner.
    Normal,
    /// Kit shards using Leap.
    Leap,
    /// Spark, linked by a corner.
    Spark,
    /// Spark with Leap.
    SparkLeap,
}

impl State {
    pub fn new(ctx: &Ctx, seed: u64) -> State {
        let cfg = &ctx.config;
        let lat = &ctx.lat;
        let n = lat.len();
        let mut cells = vec![EMPTY; n];
        let mut flags = vec![0u8; n];
        for i in 0..n {
            if !lat.playable[i] {
                cells[i] = VOID;
            }
        }
        let cores = core_cells(cfg, lat);
        for (s, &c) in cores.iter().enumerate() {
            cells[c] = s as u8 + 1;
            flags[c] |= F_CORE;
        }
        for c in node_cells(cfg, lat, &cores, seed) {
            flags[c] |= F_NODE;
        }
        let seats = (0..cfg.seats)
            .map(|s| SeatState {
                pieces: vec![true; ctx.kit.pieces.len()],
                charge: if s == 1 { second_seat_charge(cfg) } else { 0 },
                dark: false,
                resigned: false,
            })
            .collect();
        State {
            cells,
            flags,
            cores: cores.iter().map(|&c| c as u32).collect(),
            seats,
            turn: 0,
            round: 1,
            ply: 0,
            phase: Phase::Playing,
            storm_level: 0,
            shattered_this_turn: false,
        }
    }

    #[inline]
    fn lights_with(&self, ctx: &Ctx, seat: usize, owner: u8) -> bool {
        if !is_seat(owner) {
            return false;
        }
        let o = owner as usize - 1;
        o == seat || (ctx.config.shared_light && ctx.config.allies(seat, o))
    }

    /// Cells covered by an action's placement, validating shape and bounds.
    pub fn placement_cells(
        &self,
        ctx: &Ctx,
        piece: usize,
        orient: usize,
        at: [i32; 3],
    ) -> Result<Vec<usize>, RuleError> {
        if piece > ctx.kit.spark_index {
            return Err(RuleError::BadPiece);
        }
        let orients = ctx.kit.orients(piece);
        let cells = orients.get(orient).ok_or(RuleError::BadOrient)?;
        let mut out = Vec::with_capacity(5);
        if !place_cells(&ctx.lat, cells, at, &mut out) {
            return Err(RuleError::OffBoard);
        }
        Ok(out)
    }

    /// Full validation of a placement against `board` (the truth, or a
    /// seat's fogged view of it). Returns the covered cells.
    pub fn check_place_on(
        &self,
        ctx: &Ctx,
        board: &[u8],
        seat: usize,
        piece: usize,
        orient: usize,
        at: [i32; 3],
        leap: bool,
    ) -> Result<Vec<usize>, RuleError> {
        self.check_turn(seat)?;
        let cfg = &ctx.config;
        let st = &self.seats[seat];
        let spark = piece == ctx.kit.spark_index;
        let cost = if spark { COST_SPARK } else { 0 } + if leap { COST_LEAP } else { 0 };
        if (spark || leap) && !cfg.arena {
            return Err(RuleError::NoArena);
        }
        if st.charge < cost {
            return Err(RuleError::NoCharge);
        }
        if !spark && !*st.pieces.get(piece).ok_or(RuleError::BadPiece)? {
            return Err(RuleError::PieceUsed);
        }
        let cells = self.placement_cells(ctx, piece, orient, at)?;
        self.check_cells(ctx, board, seat, &cells, leap)?;
        Ok(cells)
    }

    fn check_turn(&self, seat: usize) -> Result<(), RuleError> {
        if self.phase == Phase::Over {
            return Err(RuleError::GameOver);
        }
        if seat >= self.seats.len() || self.seats[seat].dark {
            return Err(RuleError::Dark);
        }
        if seat != self.turn as usize {
            return Err(RuleError::NotYourTurn);
        }
        Ok(())
    }

    fn check_cells(
        &self,
        ctx: &Ctx,
        board: &[u8],
        seat: usize,
        cells: &[usize],
        leap: bool,
    ) -> Result<(), RuleError> {
        let lat = &ctx.lat;
        let own = seat as u8 + 1;
        for &c in cells {
            if board[c] != EMPTY {
                return Err(RuleError::Occupied);
            }
        }
        if ctx.config.gravity {
            for &c in cells {
                if let Some(b) = lat.below(c) {
                    let ob = board[b];
                    if !(is_seat(ob) || ob == SCAR || cells.contains(&b)) {
                        return Err(RuleError::Unsupported);
                    }
                }
            }
        }
        for &c in cells {
            for &n in lat.face.get(c) {
                if board[n as usize] == own {
                    return Err(RuleError::TouchesOwnFace);
                }
            }
        }
        let linked = if leap {
            let mut ball = Vec::with_capacity(125);
            cells.iter().any(|&c| {
                ball.clear();
                lat.ball(c, 2, &mut ball);
                ball.iter()
                    .any(|&b| !cells.contains(&b) && self.lights_with(ctx, seat, board[b]))
            })
        } else {
            cells.iter().any(|&c| {
                lat.link
                    .get(c)
                    .iter()
                    .any(|&n| self.lights_with(ctx, seat, board[n as usize]))
            })
        };
        if !linked {
            return Err(RuleError::NoLink);
        }
        Ok(())
    }

    /// Generate legal moves for `seat` in `mode`. Stops after the first
    /// move when `first_only` is set.
    pub fn gen_moves(
        &self,
        ctx: &Ctx,
        seat: usize,
        mode: GenMode,
        scratch: &mut Scratch,
        out: &mut Vec<Move>,
        first_only: bool,
    ) {
        let cfg = &ctx.config;
        let st = &self.seats[seat];
        let spark = matches!(mode, GenMode::Spark | GenMode::SparkLeap);
        let leap = matches!(mode, GenMode::Leap | GenMode::SparkLeap);
        if (spark || leap) && !cfg.arena {
            return;
        }
        let cost = if spark { COST_SPARK } else { 0 } + if leap { COST_LEAP } else { 0 };
        if st.charge < cost {
            return;
        }
        if !spark && !st.pieces.iter().any(|p| *p) {
            return;
        }
        seat_rows(ctx, &self.cells, seat, scratch);
        prepare(ctx, leap, scratch);
        scratch.prepare(ctx);
        let inp = GenInput {
            fp: &scratch.fp,
            cand: &scratch.cand,
            air: &scratch.air,
            pieces: kit_mask(&st.pieces),
            spark,
            leap,
        };
        generate(
            ctx,
            &inp,
            &mut scratch.stamp,
            scratch.epoch,
            out,
            first_only,
        );
    }

    /// The original, straightforward generator: recompute forbidden cells
    /// and anchors cell by cell, then test every placement through each
    /// anchor. Kept as the reference that the bitboard generator is tested
    /// against, and as the baseline in `cubes-sim --bench`.
    #[doc(hidden)]
    pub fn gen_moves_naive(
        &self,
        ctx: &Ctx,
        seat: usize,
        mode: GenMode,
        scratch: &mut Scratch,
        out: &mut Vec<Move>,
        first_only: bool,
    ) {
        let cfg = &ctx.config;
        let st = &self.seats[seat];
        let spark = matches!(mode, GenMode::Spark | GenMode::SparkLeap);
        let leap = matches!(mode, GenMode::Leap | GenMode::SparkLeap);
        if (spark || leap) && !cfg.arena {
            return;
        }
        let cost = if spark { COST_SPARK } else { 0 } + if leap { COST_LEAP } else { 0 };
        if st.charge < cost {
            return;
        }
        if !spark && !st.pieces.iter().any(|p| *p) {
            return;
        }
        let lat = &ctx.lat;
        let n = lat.len();
        let own = seat as u8 + 1;
        scratch.prepare(ctx);
        // Forbidden cells: not empty, or face-adjacent to our own colour.
        scratch.nforbidden.clear();
        scratch.nforbidden.resize(n, false);
        for i in 0..n {
            scratch.nforbidden[i] = self.cells[i] != EMPTY
                || lat
                    .face
                    .get(i)
                    .iter()
                    .any(|&f| self.cells[f as usize] == own);
        }
        // Candidate anchor cells.
        scratch.ncand.clear();
        if leap {
            let mut ball = std::mem::take(&mut scratch.ball);
            let mut mark = vec![false; n];
            for i in 0..n {
                if self.lights_with(ctx, seat, self.cells[i]) {
                    ball.clear();
                    lat.ball(i, 2, &mut ball);
                    for &b in &ball {
                        if !scratch.nforbidden[b] && !mark[b] {
                            mark[b] = true;
                            scratch.ncand.push(b as u32);
                        }
                    }
                }
            }
            scratch.ball = ball;
        } else {
            for i in 0..n {
                if !scratch.nforbidden[i]
                    && lat
                        .link
                        .get(i)
                        .iter()
                        .any(|&l| self.lights_with(ctx, seat, self.cells[l as usize]))
                {
                    scratch.ncand.push(i as u32);
                }
            }
        }
        let spark_index = ctx.kit.spark_index;
        let table = &ctx.table;
        for ci in 0..scratch.ncand.len() {
            let c = scratch.ncand[ci] as usize;
            for &pid in table.covering(c) {
                let p = pid as usize;
                if scratch.stamp[p] == scratch.epoch {
                    continue;
                }
                scratch.stamp[p] = scratch.epoch;
                let piece = table.piece[p] as usize;
                if spark {
                    if piece != spark_index {
                        continue;
                    }
                } else if piece == spark_index || !st.pieces[piece] {
                    continue;
                }
                let cells = table.cells(p);
                if cells.iter().any(|&x| scratch.nforbidden[x as usize]) {
                    continue;
                }
                if cfg.gravity && !supported(lat, &self.cells, cells) {
                    continue;
                }
                out.push(Move { pid, leap });
                if first_only {
                    return;
                }
            }
        }
    }

    /// Does `seat` have any legal placement it can afford?
    pub fn has_any_move(&self, ctx: &Ctx, seat: usize, scratch: &mut Scratch) -> bool {
        let mut out = Vec::new();
        for mode in [
            GenMode::Normal,
            GenMode::Spark,
            GenMode::Leap,
            GenMode::SparkLeap,
        ] {
            self.gen_moves(ctx, seat, mode, scratch, &mut out, true);
            if !out.is_empty() {
                return true;
            }
        }
        false
    }

    /// All moves the seat can afford, in every mode.
    pub fn all_moves(&self, ctx: &Ctx, seat: usize, scratch: &mut Scratch) -> Vec<Move> {
        let mut out = Vec::new();
        for mode in [
            GenMode::Normal,
            GenMode::Spark,
            GenMode::Leap,
            GenMode::SparkLeap,
        ] {
            self.gen_moves(ctx, seat, mode, scratch, &mut out, false);
        }
        out
    }

    pub fn move_action(&self, ctx: &Ctx, m: Move) -> Action {
        let p = m.pid as usize;
        let o = ctx.table.origin[p];
        Action::Place {
            piece: ctx.table.piece[p] as u16,
            orient: ctx.table.orient[p],
            at: [o[0] as i32, o[1] as i32, o[2] as i32],
            leap: m.leap,
        }
    }

    /// Commit a validated placement and end the turn.
    pub fn commit_place(
        &mut self,
        ctx: &Ctx,
        seat: usize,
        piece: usize,
        cells: &[usize],
        leap: bool,
        scratch: &mut Scratch,
        events: &mut Vec<Event>,
    ) {
        let spark = piece == ctx.kit.spark_index;
        let st = &mut self.seats[seat];
        if spark {
            st.charge -= COST_SPARK;
        } else {
            st.pieces[piece] = false;
        }
        if leap {
            st.charge -= COST_LEAP;
        }
        for &c in cells {
            self.cells[c] = seat as u8 + 1;
        }
        events.push(Event::Placed {
            seat: seat as u8,
            piece: piece as u16,
            cells: cells.iter().map(|&c| c as u32).collect(),
            leap,
            spark,
            hidden: false,
        });
        for &c in cells {
            if self.flags[c] & F_NODE != 0 {
                self.flags[c] &= !F_NODE;
                let st = &mut self.seats[seat];
                st.charge = (st.charge + 1).min(MAX_CHARGE);
                events.push(Event::Node {
                    seat: seat as u8,
                    cell: c as u32,
                });
            }
        }
        self.end_turn(ctx, scratch, events);
    }

    pub fn check_shatter(&self, ctx: &Ctx, seat: usize, cell: usize) -> Result<u8, RuleError> {
        self.check_turn(seat)?;
        if !ctx.config.arena {
            return Err(RuleError::NoArena);
        }
        if self.shattered_this_turn {
            return Err(RuleError::AlreadyShattered);
        }
        if self.seats[seat].charge < COST_SHATTER {
            return Err(RuleError::NoCharge);
        }
        let owner = *self.cells.get(cell).ok_or(RuleError::BadTarget)?;
        if !is_seat(owner) || self.flags[cell] & F_CORE != 0 {
            return Err(RuleError::BadTarget);
        }
        let victim = owner - 1;
        if ctx.config.allies(seat, victim as usize) {
            return Err(RuleError::BadTarget);
        }
        if ctx.config.gravity {
            if let Some(a) = ctx.lat.above(cell) {
                if self.cells[a] != EMPTY {
                    return Err(RuleError::BadTarget);
                }
            }
        }
        Ok(victim)
    }

    pub fn commit_shatter(
        &mut self,
        seat: usize,
        cell: usize,
        victim: u8,
        events: &mut Vec<Event>,
    ) {
        self.cells[cell] = SCAR;
        self.seats[seat].charge -= COST_SHATTER;
        self.shattered_this_turn = true;
        events.push(Event::Shattered {
            seat: seat as u8,
            cell: cell as u32,
            victim,
        });
    }

    pub fn resign(
        &mut self,
        ctx: &Ctx,
        seat: usize,
        scratch: &mut Scratch,
        events: &mut Vec<Event>,
    ) -> Result<(), RuleError> {
        if self.phase == Phase::Over {
            return Err(RuleError::GameOver);
        }
        let st = self.seats.get_mut(seat).ok_or(RuleError::Dark)?;
        if st.dark {
            return Err(RuleError::Dark);
        }
        st.dark = true;
        st.resigned = true;
        events.push(Event::Dark { seat: seat as u8 });
        if seat == self.turn as usize {
            self.end_turn(ctx, scratch, events);
        } else if self.seats.iter().all(|s| s.dark) {
            self.finish(ctx, events);
        }
        Ok(())
    }

    /// Advance to the next seat that can move, collapsing the storm at round
    /// boundaries and marking seats with no legal move as dark.
    pub fn end_turn(&mut self, ctx: &Ctx, scratch: &mut Scratch, events: &mut Vec<Event>) {
        self.shattered_this_turn = false;
        self.ply += 1;
        let seats = self.seats.len();
        let mut cur = self.turn as usize;
        for _ in 0..(seats * 2 + 2) {
            let next = (cur + 1) % seats;
            if next <= cur {
                self.round += 1;
                self.maybe_storm(ctx, events);
            }
            cur = next;
            if self.seats[cur].dark {
                if self.seats.iter().all(|s| s.dark) {
                    break;
                }
                continue;
            }
            if self.has_any_move(ctx, cur, scratch) {
                self.turn = cur as u8;
                return;
            }
            self.seats[cur].dark = true;
            events.push(Event::Dark { seat: cur as u8 });
            if self.seats.iter().all(|s| s.dark) {
                break;
            }
        }
        self.finish(ctx, events);
    }

    /// Round of the next storm collapse, if one is coming.
    pub fn next_storm(&self, ctx: &Ctx) -> Option<u16> {
        let s = ctx.config.storm?;
        let level = self.storm_level as i32;
        if ctx.lat.w - 2 * (level + 1) < s.min_span as i32 {
            return None;
        }
        let r = self.round;
        Some(if r < s.start {
            s.start
        } else {
            s.start + ((r - s.start) / s.every + 1) * s.every
        })
    }

    fn maybe_storm(&mut self, ctx: &Ctx, events: &mut Vec<Event>) {
        let Some(s) = ctx.config.storm else { return };
        if self.round < s.start || !(self.round - s.start).is_multiple_of(s.every) {
            return;
        }
        let level = self.storm_level as i32;
        if ctx.lat.w - 2 * (level + 1) < s.min_span as i32 {
            return;
        }
        let mut gone = Vec::new();
        for i in 0..ctx.lat.len() {
            if ctx.lat.playable[i] && ctx.lat.ring(i) == level && self.cells[i] != ASH {
                self.cells[i] = ASH;
                self.flags[i] = 0;
                gone.push(i as u32);
            }
        }
        // Rings on shaped boards: also take anything now exposed outside the
        // living square.
        self.storm_level += 1;
        events.push(Event::Storm {
            level: self.storm_level,
            cells: gone,
        });
    }

    fn finish(&mut self, ctx: &Ctx, events: &mut Vec<Event>) {
        if self.phase == Phase::Over {
            return;
        }
        self.phase = Phase::Over;
        for s in &mut self.seats {
            s.dark = true;
        }
        let scores = self.scores(ctx);
        let winners = self.winners(ctx, &scores);
        events.push(Event::GameOver { scores, winners });
    }

    /// Per-seat scores: owned cells (Cores excluded), clean sweep bonus and
    /// crowned columns.
    pub fn scores(&self, ctx: &Ctx) -> Vec<i32> {
        let mut scores = vec![0i32; self.seats.len()];
        for (i, &o) in self.cells.iter().enumerate() {
            if is_seat(o) && self.flags[i] & F_CORE == 0 {
                scores[o as usize - 1] += 1;
            }
        }
        for (s, st) in self.seats.iter().enumerate() {
            if st.pieces.iter().all(|p| !p) {
                scores[s] += SWEEP_BONUS;
            }
        }
        if ctx.config.crowns && ctx.lat.is_3d() {
            let lat = &ctx.lat;
            for y in 0..lat.h {
                for x in 0..lat.w {
                    for z in (0..lat.d).rev() {
                        let i = lat.index(x, y, z).unwrap();
                        let o = self.cells[i];
                        if o == EMPTY || o == VOID || o == ASH {
                            continue;
                        }
                        if is_seat(o) && self.flags[i] & F_CORE == 0 {
                            scores[o as usize - 1] += 1;
                        }
                        break;
                    }
                }
            }
        }
        scores
    }

    pub fn winners(&self, ctx: &Ctx, scores: &[i32]) -> Vec<u8> {
        let teams = if ctx.config.teams {
            2
        } else {
            self.seats.len()
        };
        let mut totals = vec![0i32; teams];
        for (s, &sc) in scores.iter().enumerate() {
            totals[ctx.config.team_of(s)] += sc;
        }
        let best = totals.iter().copied().max().unwrap_or(0);
        (0..self.seats.len())
            .filter(|&s| totals[ctx.config.team_of(s)] == best)
            .map(|s| s as u8)
            .collect()
    }
}

/// Moving second is a real disadvantage in two-seat 2D games: seat 0 reaches
/// the nodes first. Self-play put it at about 17 points of win share on
/// 14x14; charge in hand for the second seat brings it to zero within noise.
/// 3D boards were already fair, and the torus needs less. See docs/BALANCE.md.
pub const SECOND_SEAT_CHARGE: u8 = 2;
pub const SECOND_SEAT_CHARGE_TORUS: u8 = 1;

/// Charge the second seat starts with.
pub fn second_seat_charge(cfg: &GameConfig) -> u8 {
    if cfg.seats != 2 || !cfg.arena || cfg.dims[2] > 1 {
        0
    } else if cfg.topology == crate::geometry::Topology::Torus {
        SECOND_SEAT_CHARGE_TORUS
    } else {
        SECOND_SEAT_CHARGE
    }
}

fn supported(lat: &Lattice, board: &[u8], cells: &[u32]) -> bool {
    cells.iter().all(|&c| match lat.below(c as usize) {
        None => true,
        Some(b) => {
            let o = board[b];
            is_seat(o) || o == SCAR || cells.contains(&(b as u32))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(name: &str, seats: u8) -> Arc<Ctx> {
        Ctx::new(GameConfig::preset(name, seats).unwrap()).unwrap()
    }

    fn place_first(ctx: &Ctx, st: &mut State, scratch: &mut Scratch) -> Vec<Event> {
        let seat = st.turn as usize;
        let moves = st.all_moves(ctx, seat, scratch);
        let m = moves[0];
        let Action::Place {
            piece,
            orient,
            at,
            leap,
        } = st.move_action(ctx, m)
        else {
            unreachable!()
        };
        let cells = st
            .check_place_on(
                ctx,
                &st.cells.clone(),
                seat,
                piece as usize,
                orient as usize,
                at,
                leap,
            )
            .unwrap();
        let mut ev = Vec::new();
        st.commit_place(ctx, seat, piece as usize, &cells, leap, scratch, &mut ev);
        ev
    }

    #[test]
    fn opening_moves_touch_the_core_diagonally() {
        let c = ctx("plane", 4);
        let st = State::new(&c, 1);
        let mut scratch = Scratch::default();
        let mut moves = Vec::new();
        st.gen_moves(&c, 0, GenMode::Normal, &mut scratch, &mut moves, false);
        assert!(!moves.is_empty());
        let core = st.cores[0] as usize;
        for m in &moves {
            let cells = c.table.cells(m.pid as usize);
            assert!(cells
                .iter()
                .any(|&x| c.lat.link.get(x as usize).contains(&(core as u32))));
            assert!(cells
                .iter()
                .all(|&x| !c.lat.face.get(x as usize).contains(&(core as u32))));
        }
    }

    #[test]
    fn generated_moves_all_pass_validation() {
        let c = ctx("plane", 4);
        let mut st = State::new(&c, 3);
        let mut scratch = Scratch::default();
        for _ in 0..12 {
            let seat = st.turn as usize;
            let mut moves = Vec::new();
            st.gen_moves(&c, seat, GenMode::Normal, &mut scratch, &mut moves, false);
            for m in &moves {
                let Action::Place {
                    piece,
                    orient,
                    at,
                    leap,
                } = st.move_action(&c, *m)
                else {
                    unreachable!()
                };
                st.check_place_on(
                    &c,
                    &st.cells,
                    seat,
                    piece as usize,
                    orient as usize,
                    at,
                    leap,
                )
                .unwrap_or_else(|e| panic!("generated illegal move: {e}"));
            }
            place_first(&c, &mut st, &mut scratch);
        }
    }

    #[test]
    fn rejects_face_contact_and_unlinked() {
        let c = ctx("duel", 2);
        let st = State::new(&c, 1);
        let core = st.cores[0] as usize;
        let (x, y, _) = c.lat.coords(core);
        let bar = 0; // p2-i horizontal is orientation 0: (0,0),(1,0)
                     // Directly right of the core shares a face.
        let r = st.check_place_on(&c, &st.cells, 0, bar, 0, [x + 1, y, 0], false);
        assert_eq!(r, Err(RuleError::TouchesOwnFace));
        // Far away: no link.
        let r = st.check_place_on(&c, &st.cells, 0, bar, 0, [x + 5, y + 5, 0], false);
        assert!(matches!(
            r,
            Err(RuleError::NoLink) | Err(RuleError::Occupied)
        ));
        // Diagonal: fine.
        let r = st.check_place_on(&c, &st.cells, 0, bar, 0, [x + 1, y + 1, 0], false);
        assert!(r.is_ok(), "{r:?}");
        // Wrong seat.
        let r = st.check_place_on(&c, &st.cells, 1, bar, 0, [x + 1, y + 1, 0], false);
        assert_eq!(r, Err(RuleError::NotYourTurn));
    }

    #[test]
    fn spark_and_leap_cost_charge() {
        let c = ctx("duel", 2);
        let st = State::new(&c, 1);
        let core = st.cores[0] as usize;
        let (x, y, _) = c.lat.coords(core);
        let spark = c.kit.spark_index;
        assert_eq!(
            st.check_place_on(&c, &st.cells, 0, spark, 0, [x + 1, y + 1, 0], false),
            Err(RuleError::NoCharge)
        );
        let mut st2 = st.clone();
        st2.seats[0].charge = 3;
        assert!(st2
            .check_place_on(&c, &st2.cells, 0, spark, 0, [x + 1, y + 1, 0], false)
            .is_ok());
        // Leap reaches two cells away without a corner touch.
        assert!(st2
            .check_place_on(&c, &st2.cells, 0, spark, 0, [x + 2, y, 0], true)
            .is_ok());
        assert_eq!(
            st2.check_place_on(&c, &st2.cells, 0, spark, 0, [x + 2, y, 0], false),
            Err(RuleError::NoLink)
        );
        let mut ev = Vec::new();
        let mut scratch = Scratch::default();
        let cells = st2
            .check_place_on(&c, &st2.cells, 0, spark, 0, [x + 2, y, 0], true)
            .unwrap();
        st2.commit_place(&c, 0, spark, &cells, true, &mut scratch, &mut ev);
        assert_eq!(st2.seats[0].charge, 0);
        assert!(
            st2.seats[0].pieces.iter().all(|p| *p),
            "spark must not consume a kit shard"
        );
    }

    #[test]
    fn nodes_give_charge() {
        let c = ctx("plane", 4);
        let mut st = State::new(&c, 9);
        let node = (0..c.lat.len())
            .find(|&i| st.flags[i] & F_NODE != 0)
            .unwrap();
        // Make the node reachable for seat 0 by planting light diagonally to it.
        let (x, y, _) = c.lat.coords(node);
        let diag = c
            .lat
            .index(x - 1, y - 1, 0)
            .or(c.lat.index(x + 1, y + 1, 0))
            .unwrap();
        st.cells[diag] = 1;
        let spark = c.kit.spark_index;
        st.seats[0].charge = 1;
        let cells = st
            .check_place_on(&c, &st.cells.clone(), 0, spark, 0, [x, y, 0], false)
            .unwrap();
        let mut ev = Vec::new();
        st.commit_place(
            &c,
            0,
            spark,
            &cells,
            false,
            &mut Scratch::default(),
            &mut ev,
        );
        assert_eq!(st.seats[0].charge, 1);
        assert!(ev.iter().any(|e| matches!(e, Event::Node { .. })));
        assert_eq!(st.flags[node] & F_NODE, 0);
    }

    #[test]
    fn shatter_rules() {
        let c = ctx("duel", 2);
        let mut st = State::new(&c, 1);
        let target = c.lat.index(7, 7, 0).unwrap();
        st.cells[target] = 2;
        assert_eq!(st.check_shatter(&c, 0, target), Err(RuleError::NoCharge));
        st.seats[0].charge = 5;
        assert_eq!(st.check_shatter(&c, 0, target), Ok(1));
        assert_eq!(
            st.check_shatter(&c, 0, st.cores[1] as usize),
            Err(RuleError::BadTarget)
        );
        let mut ev = Vec::new();
        st.commit_shatter(0, target, 1, &mut ev);
        assert_eq!(st.cells[target], SCAR);
        assert_eq!(
            st.check_shatter(&c, 0, target),
            Err(RuleError::AlreadyShattered)
        );
    }

    #[test]
    fn second_seat_starts_with_charge_only_in_two_seat_2d_arena_games() {
        let charge = |name: &str, seats: u8| {
            let c = ctx(name, seats);
            let st = State::new(&c, 1);
            st.seats.iter().map(|s| s.charge).collect::<Vec<_>>()
        };
        assert_eq!(charge("duel", 2), vec![0, SECOND_SEAT_CHARGE]);
        assert_eq!(charge("torus", 2), vec![0, SECOND_SEAT_CHARGE_TORUS]);
        assert_eq!(charge("fog", 2), vec![0, SECOND_SEAT_CHARGE]);
        assert_eq!(charge("stack", 2), vec![0, 0]);
        assert_eq!(charge("orbit", 2), vec![0, 0]);
        assert_eq!(charge("pure", 2), vec![0, 0]);
        assert_eq!(charge("plane", 4), vec![0, 0, 0, 0]);
    }

    #[test]
    fn whole_games_terminate_with_scores() {
        for name in GameConfig::PRESETS {
            for seats in [2u8, 4] {
                let c = ctx(name, seats);
                let mut st = State::new(&c, 11);
                let mut scratch = Scratch::default();
                let mut guard = 0;
                let mut over = false;
                while st.phase == Phase::Playing {
                    guard += 1;
                    assert!(guard < 2000, "{name} did not terminate");
                    let ev = place_first(&c, &mut st, &mut scratch);
                    over |= ev.iter().any(|e| matches!(e, Event::GameOver { .. }));
                }
                assert!(over, "{name} ended without a GameOver event");
                let scores = st.scores(&c);
                assert!(scores.iter().all(|&s| s > 0), "{name}/{seats}: {scores:?}");
            }
        }
    }

    #[test]
    fn gravity_requires_support() {
        let c = ctx("stack", 2);
        let st = State::new(&c, 1);
        let core = st.cores[0] as usize;
        let (x, y, _) = c.lat.coords(core);
        // Floating one level up beside the core: unsupported.
        let r = st.check_place_on(&c, &st.cells, 0, 0, 0, [x + 1, y + 1, 1], false);
        assert_eq!(r, Err(RuleError::Unsupported));
    }

    #[test]
    fn storm_collapses_rings() {
        let mut cfg = GameConfig::preset("storm", 2).unwrap();
        cfg.storm = Some(crate::config::StormConfig {
            start: 2,
            every: 1,
            min_span: 8,
        });
        let c = Ctx::new(cfg).unwrap();
        let mut st = State::new(&c, 1);
        let mut scratch = Scratch::default();
        let mut storms = 0;
        while st.phase == Phase::Playing && st.round < 6 {
            let ev = place_first(&c, &mut st, &mut scratch);
            storms += ev
                .iter()
                .filter(|e| matches!(e, Event::Storm { .. }))
                .count();
        }
        assert!(storms >= 3, "{storms}");
        let corner = c.lat.index(0, 0, 0).unwrap();
        assert_eq!(st.cells[corner], ASH);
    }

    #[test]
    fn resign_ends_two_player_game() {
        let c = ctx("duel", 2);
        let mut st = State::new(&c, 1);
        let mut ev = Vec::new();
        st.resign(&c, 1, &mut Scratch::default(), &mut ev).unwrap();
        assert!(st.seats[1].dark);
        assert_eq!(st.phase, Phase::Playing);
    }

    #[test]
    fn torus_links_across_the_seam() {
        let c = ctx("torus", 2);
        let mut st = State::new(&c, 1);
        let w = c.lat.w;
        // Plant seat 0 light at the far right edge; a spark at x=0 diagonal links.
        let a = c.lat.index(w - 1, 5, 0).unwrap();
        st.cells[a] = 1;
        st.seats[0].charge = 1;
        let r = st.check_place_on(&c, &st.cells, 0, c.kit.spark_index, 0, [0, 6, 0], false);
        assert!(r.is_ok(), "{r:?}");
    }
}
