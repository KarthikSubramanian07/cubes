//! Bots. Three levels that share one evaluation:
//!
//! - **Ember**: a lively, beatable pick among the better-looking moves.
//! - **Flare**: a one-ply search that evaluates every promising move.
//! - **Nova**: Monte Carlo tree search with progressive widening and RAVE,
//!   seeded by Flare's ranking, with fast size-first playouts that answer
//!   the opponent's last move locally.
//!
//! All three work on [`Pos`], a simulation position built on the
//! incremental [`Board`], so evaluation and playouts never rescan the board.
//!
//! Bots return one action at a time; a turn may be Shatter/Scan followed by
//! a placement. Under fog the caller hands the bot its *believed* state
//! (`Game::from_view`) so it never sees through the fog.

use serde::{Deserialize, Serialize};

use crate::bits::{kit_mask, Board, Geo};
use crate::game::*;
use crate::rng::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Ember,
    Flare,
    Nova,
}

impl Level {
    pub fn parse(s: &str) -> Option<Level> {
        match s {
            "ember" => Some(Level::Ember),
            "flare" => Some(Level::Flare),
            "nova" => Some(Level::Nova),
            _ => None,
        }
    }
}

/// Every tunable number the bots use. The defaults come from self-play
/// (see `docs/BALANCE.md`); `cubes-sim` can override any of them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Weights {
    // Evaluation, per seat. Potential terms fade from the first value
    // (full kit) to the `End` value (empty kit).
    pub attach: f64,
    pub attach_end: f64,
    pub reach: f64,
    pub reach_end: f64,
    pub charge: f64,
    pub charge_end: f64,
    /// 0 compares against the strongest rival, 1 against the rivals' mean.
    pub rival_mean: f64,
    // Move ordering.
    pub q_size: f64,
    pub q_block: f64,
    pub q_corner: f64,
    pub q_node: f64,
    pub q_centre: f64,
    pub q_surge: f64,
    // Search.
    pub flare_width: usize,
    /// Flare re-scores its best `flare_reply` moves against the next
    /// rival's best answer (0 turns the second ply off).
    pub flare_reply: usize,
    pub nova_root: usize,
    pub nova_c: f64,
    pub nova_pw: f64,
    pub nova_rave: f64,
    pub nova_prior: f64,
    pub nova_local: f64,
    pub nova_width: usize,
    // Surges.
    pub shatter_margin: f64,
    pub scan_charge: u8,
}

impl Default for Weights {
    fn default() -> Self {
        Weights {
            attach: 0.8,
            attach_end: 0.4,
            reach: 0.28,
            reach_end: 0.08,
            charge: 0.9,
            charge_end: 1.0,
            rival_mean: 0.0,
            q_size: 1.6,
            q_block: 0.9,
            q_corner: 0.35,
            q_node: 2.6,
            q_centre: 0.6,
            q_surge: 1.4,
            flare_width: 48,
            flare_reply: 8,
            nova_root: 24,
            nova_c: 0.5,
            nova_pw: 1.5,
            nova_rave: 300.0,
            nova_prior: 4.0,
            nova_local: 0.5,
            nova_width: 24,
            shatter_margin: 3.0,
            scan_charge: 4,
        }
    }
}

const NONE: u32 = u32::MAX;

/// Index of the `n`-th set bit of `m`.
#[inline]
fn nth_bit(mut m: u32, n: u32) -> usize {
    for _ in 0..n {
        m &= m - 1;
    }
    m.trailing_zeros() as usize
}

/// Optional knobs for a bot decision, used by the simulator and tests.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BotOptions {
    /// Cap Nova's search at this many iterations.
    pub max_iters: Option<u32>,
    /// Replace the default weights.
    pub weights: Option<Weights>,
}

/// A simulation position: incremental bitboards plus the per-seat facts
/// the rules need (kit, charge, dark) and uncovered nodes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pos {
    pub board: Board,
    pub kit: Vec<u32>,
    pub charge: Vec<u8>,
    pub dark: Vec<bool>,
    /// Uncovered nodes, canonical rows.
    pub nodes: Vec<u64>,
    pub turn: usize,
    pub round: u16,
    /// Cells of the most recent placement (for local responses).
    pub last: [u32; 5],
    pub last_len: u8,
    pub last_seat: u8,
}

impl Pos {
    pub fn from_state(ctx: &Ctx, st: &State) -> Pos {
        let geo = &ctx.geo;
        let mut nodes = vec![0u64; geo.rows];
        for (i, &f) in st.flags.iter().enumerate() {
            if f & F_NODE != 0 && st.cells[i] == EMPTY {
                nodes[i / geo.w] |= 1 << (i % geo.w);
            }
        }
        Pos {
            board: Board::from_cells(ctx, &st.cells),
            kit: st.seats.iter().map(|s| kit_mask(&s.pieces)).collect(),
            charge: st.seats.iter().map(|s| s.charge).collect(),
            dark: st.seats.iter().map(|s| s.dark).collect(),
            nodes,
            turn: st.turn as usize,
            round: st.round,
            last: [0; 5],
            last_len: 0,
            last_seat: u8::MAX,
        }
    }

    /// Apply a placement for `seat` (no turn bookkeeping).
    pub fn play(&mut self, ctx: &Ctx, seat: usize, m: Move) {
        let p = m.pid as usize;
        let piece = ctx.table.piece[p] as usize;
        if piece == ctx.kit.spark_index {
            self.charge[seat] = self.charge[seat].saturating_sub(COST_SPARK);
        } else {
            self.kit[seat] &= !(1 << piece);
        }
        if m.leap {
            self.charge[seat] = self.charge[seat].saturating_sub(COST_LEAP);
        }
        let cells = ctx.table.cells(p);
        self.board.place(ctx, seat, cells);
        let w = ctx.geo.w;
        for (k, &c) in cells.iter().enumerate() {
            let (ri, bit) = (c as usize / w, 1u64 << (c as usize % w));
            if self.nodes[ri] & bit != 0 {
                self.nodes[ri] &= !bit;
                self.charge[seat] = (self.charge[seat] + 1).min(MAX_CHARGE);
            }
            self.last[k] = c;
        }
        self.last_len = cells.len() as u8;
        self.last_seat = seat as u8;
    }

    /// Become a copy of `o`, reusing allocations.
    pub fn copy_from(&mut self, o: &Pos) {
        self.board.copy_from(&o.board);
        self.kit.clone_from(&o.kit);
        self.charge.clone_from(&o.charge);
        self.dark.clone_from(&o.dark);
        self.nodes.clone_from(&o.nodes);
        self.turn = o.turn;
        self.round = o.round;
        self.last = o.last;
        self.last_len = o.last_len;
        self.last_seat = o.last_seat;
    }

    /// Advance the turn to the next seat that isn't dark.
    pub fn next_turn(&mut self) {
        let n = self.dark.len();
        for _ in 0..n {
            let next = (self.turn + 1) % n;
            if next <= self.turn {
                self.round += 1;
            }
            self.turn = next;
            if !self.dark[next] {
                return;
            }
        }
    }

    #[inline]
    pub fn all_dark(&self) -> bool {
        self.dark.iter().all(|d| *d)
    }
}

/// Per-seat scratch rows for evaluation.
#[derive(Clone, Debug, Default)]
struct Rows {
    a: Vec<u64>,
    b: Vec<u64>,
    c: Vec<u64>,
    d: Vec<u64>,
}

/// Static, per-context facts the bots use repeatedly.
#[derive(Clone, Debug)]
struct Statics {
    /// Cores as canonical rows (they never score).
    cores: Vec<u64>,
    total_cells: f64,
    piece_size: Vec<u8>,
}

impl Statics {
    fn new(ctx: &Ctx, st: &State) -> Statics {
        let geo = &ctx.geo;
        let mut cores = vec![0u64; geo.rows];
        for &c in &st.cores {
            cores[c as usize / geo.w] |= 1 << (c as usize % geo.w);
        }
        let piece_size = ctx.kit.pieces.iter().map(|p| p.size as u8).collect();
        Statics {
            cores,
            total_cells: ctx.kit.total_cells().max(1) as f64,
            piece_size,
        }
    }

    fn kit_cells(&self, kit: u32) -> f64 {
        let mut k = kit;
        let mut n = 0u32;
        while k != 0 {
            let i = k.trailing_zeros() as usize;
            k &= k - 1;
            n += self.piece_size[i] as u32;
        }
        n as f64
    }
}

/// One node of Nova's search tree. Children are stored inline, ordered by
/// prior; progressive widening admits them one by one.
#[derive(Clone, Debug, Default)]
struct Node {
    seat: u8,
    visits: u32,
    moves: Vec<Move>,
    prior: Vec<f32>,
    n: Vec<u32>,
    w: Vec<f32>,
    rn: Vec<u32>,
    rw: Vec<f32>,
    child: Vec<u32>,
}

impl Node {
    fn with_moves(seat: usize, moves: Vec<Move>, prior: Vec<f32>) -> Node {
        let k = moves.len();
        Node {
            seat: seat as u8,
            visits: 0,
            moves,
            prior,
            n: vec![0; k],
            w: vec![0.0; k],
            rn: vec![0; k],
            rw: vec![0.0; k],
            child: vec![NONE; k],
        }
    }
}

pub struct Bot<'a> {
    pub ctx: &'a Ctx,
    pub level: Level,
    pub rng: Rng,
    /// Milliseconds of thinking time (Nova).
    pub budget_ms: f64,
    /// Monotonic clock in milliseconds.
    pub clock: &'a dyn Fn() -> f64,
    /// True when Scan is available (fog games).
    pub can_scan: bool,
    /// True when the bot is currently scanning.
    pub scanning: bool,
    /// Optional cap on Nova's search iterations. With a cap and a large
    /// budget, Nova is fully reproducible for a given seed.
    pub max_iters: Option<u32>,
    pub weights: Weights,
    /// Iterations Nova ran for its last decision.
    pub last_iters: u32,
    scratch: Scratch,
    rows: Rows,
    buf: Vec<Move>,
    anchors: Vec<u32>,
    amaf: Vec<(u32, u16, u8)>,
    /// Per placement id: (iteration stamp, first ply, seat) for RAVE.
    amaf_at: Vec<(u32, u16, u8)>,
    /// Kit masks by shard size: index `size - 2` (sizes 2 to 6; 3D kits top
    /// out at 5 like 2D).
    by_size: [u32; 5],
}

impl<'a> Bot<'a> {
    pub fn new(
        ctx: &'a Ctx,
        level: Level,
        seed: u64,
        budget_ms: f64,
        clock: &'a dyn Fn() -> f64,
    ) -> Bot<'a> {
        Bot {
            ctx,
            level,
            rng: Rng::new(seed),
            budget_ms,
            clock,
            can_scan: false,
            scanning: false,
            max_iters: None,
            weights: Weights::default(),
            last_iters: 0,
            scratch: Scratch::default(),
            rows: Rows::default(),
            buf: Vec::new(),
            anchors: Vec::new(),
            amaf: Vec::new(),
            amaf_at: Vec::new(),
            by_size: {
                let mut b = [0u32; 5];
                for (i, p) in ctx.kit.pieces.iter().enumerate() {
                    b[p.size.clamp(2, 6) - 2] |= 1 << i;
                }
                b
            },
        }
    }

    /// Apply simulator/test options.
    pub fn with_options(mut self, opts: &BotOptions) -> Self {
        self.max_iters = opts.max_iters;
        if let Some(w) = &opts.weights {
            self.weights = w.clone();
        }
        self
    }

    /// Choose the next action for `seat`. Returns `None` if the seat cannot act.
    pub fn next_action(&mut self, st: &State, seat: usize) -> Option<Action> {
        if st.phase == Phase::Over || st.turn as usize != seat || st.seats[seat].dark {
            return None;
        }
        let stat = Statics::new(self.ctx, st);
        let pos = Pos::from_state(self.ctx, st);
        let charge = st.seats[seat].charge;
        if self.can_scan
            && !self.scanning
            && self.level != Level::Ember
            && charge >= self.weights.scan_charge
            && st.round.is_multiple_of(3)
        {
            return Some(Action::Scan);
        }
        if self.level != Level::Ember
            && self.ctx.config.arena
            && !st.shattered_this_turn
            && charge >= COST_SHATTER
        {
            if let Some(cell) = self.pick_shatter(st, &pos, &stat, seat) {
                return Some(Action::Shatter { cell: cell as u32 });
            }
        }
        let moves = self.candidates(st, &pos, seat);
        if moves.is_empty() {
            return Some(Action::Resign);
        }
        let m = match self.level {
            Level::Ember => self.pick_ember(&pos, &stat, seat, &moves),
            Level::Flare => {
                let k = self.weights.flare_width;
                let (best, scored) = self.pick_flare(&pos, &stat, seat, &moves, k);
                if self.weights.flare_reply > 1 {
                    self.flare_second_ply(&pos, &stat, seat, &scored)
                } else {
                    best
                }
            }
            Level::Nova => self.pick_nova(&pos, &stat, seat, &moves),
        };
        Some(st.move_action(self.ctx, m))
    }

    /// Moves worth considering. Surge moves only when they're needed or
    /// (for the stronger bots) when there's charge to spare.
    fn candidates(&mut self, st: &State, pos: &Pos, seat: usize) -> Vec<Move> {
        let ctx = self.ctx;
        let mut out = Vec::new();
        let kit = pos.kit[seat];
        let charge = pos.charge[seat];
        let sc = &mut self.scratch;
        pos.board
            .gen_moves(ctx, seat, kit, GenMode::Normal, sc, &mut out, false);
        if ctx.config.arena {
            let spare = self.level != Level::Ember && charge >= 1;
            if (out.len() < 6 || kit == 0 || spare) && charge >= COST_SPARK {
                pos.board
                    .gen_moves(ctx, seat, kit, GenMode::Spark, sc, &mut out, false);
            }
            if out.len() < 3 && charge >= COST_LEAP {
                pos.board
                    .gen_moves(ctx, seat, kit, GenMode::Leap, sc, &mut out, false);
                if out.is_empty() && charge >= COST_LEAP + COST_SPARK {
                    pos.board
                        .gen_moves(ctx, seat, kit, GenMode::SparkLeap, sc, &mut out, false);
                }
            }
        }
        // Early game: big shards first, like a sensible human.
        let min_size = match st.round {
            1..=2 => 5,
            3 => 4,
            4..=5 => 3,
            _ => 0,
        };
        let has_big = out.iter().any(|m| self.size(m) >= min_size && !m.leap);
        if min_size > 0 && has_big {
            out.retain(|m| self.size(m) >= min_size && !m.leap);
        }
        // Generation order is not part of the contract; keep choices stable.
        out.sort_unstable_by_key(|m| (m.pid, m.leap));
        out
    }

    #[inline]
    fn size(&self, m: &Move) -> usize {
        self.ctx.table.cells(m.pid as usize).len()
    }

    /// Union of the attach points of every rival of `seat`.
    fn rival_attach(&self, pos: &Pos, seat: usize, out: &mut Vec<u64>) {
        let ctx = self.ctx;
        let rows = ctx.geo.rows;
        out.clear();
        out.resize(rows, 0);
        for t in 0..pos.dark.len() {
            if ctx.config.allies(seat, t) || pos.dark[t] {
                continue;
            }
            for (o, a) in out.iter_mut().zip(pos.board.attach(t)) {
                *o |= a;
            }
        }
    }

    /// Fast static score of a move, before applying it.
    fn quick_score(&self, pos: &Pos, seat: usize, m: &Move, opp: &[u64]) -> f64 {
        let ctx = self.ctx;
        let w = &self.weights;
        let lat = &ctx.lat;
        let geo = &ctx.geo;
        let cells = ctx.table.cells(m.pid as usize);
        let size = cells.len() as f64;
        let mut s = size * w.q_size;
        let piece = ctx.table.piece[m.pid as usize] as usize;
        if piece == ctx.kit.spark_index {
            s -= w.q_surge * COST_SPARK as f64;
        }
        if m.leap {
            s -= w.q_surge * COST_LEAP as f64;
        }
        let fp = pos.board.fp(seat);
        let bit = |rows: &[u64], c: usize| rows[c / geo.w] >> (c % geo.w) & 1 != 0;
        for &c in cells {
            let c = c as usize;
            if bit(&pos.nodes, c) {
                s += w.q_node;
            }
            if bit(opp, c) {
                s += w.q_block;
            }
            // New corners we open up.
            for &n in lat.link.get(c) {
                let n = n as usize;
                if cells.contains(&(n as u32)) || geo.pad_test(fp, n) {
                    continue;
                }
                if !lat.face.get(n).iter().any(|f| cells.contains(f)) {
                    s += w.q_corner;
                }
            }
        }
        // Drift toward the middle early on to claim space.
        if pos.round <= 6 && !lat.torus {
            let (cx, cy) = ((lat.w - 1) as f64 / 2.0, (lat.h - 1) as f64 / 2.0);
            let mut d = 0.0;
            for &c in cells {
                let (x, y, _) = lat.coords(c as usize);
                d += ((x as f64 - cx).abs() + (y as f64 - cy).abs()) / (lat.w as f64);
            }
            s -= w.q_centre * d / size;
        }
        s
    }

    fn ranked(&mut self, pos: &Pos, seat: usize, moves: &[Move]) -> Vec<(f64, Move)> {
        let mut opp = std::mem::take(&mut self.rows.d);
        self.rival_attach(pos, seat, &mut opp);
        let mut v: Vec<(f64, Move)> = moves
            .iter()
            .map(|m| (self.quick_score(pos, seat, m, &opp), *m))
            .collect();
        self.rows.d = opp;
        v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    fn pick_ember(&mut self, pos: &Pos, _stat: &Statics, seat: usize, moves: &[Move]) -> Move {
        let ranked = self.ranked(pos, seat, moves);
        let keep = (ranked.len() * 2 / 5).max(1).min(ranked.len());
        let pool = &ranked[..keep];
        // Weighted by rank so it's lively but not random.
        let total: f64 = (0..pool.len()).map(|i| 1.0 / (i as f64 + 1.5)).sum();
        let mut r = self.rng.unit() * total;
        for (i, (_, m)) in pool.iter().enumerate() {
            r -= 1.0 / (i as f64 + 1.5);
            if r <= 0.0 {
                return *m;
            }
        }
        pool[0].1
    }

    /// One-ply search over the `k` best quick-scored moves. Returns the best
    /// move and the evaluated list, best first.
    fn pick_flare(
        &mut self,
        pos: &Pos,
        stat: &Statics,
        seat: usize,
        moves: &[Move],
        k: usize,
    ) -> (Move, Vec<(f64, Move)>) {
        let ranked = self.ranked(pos, seat, moves);
        let k = k.min(ranked.len()).max(1);
        let mut scored: Vec<(f64, Move)> = Vec::with_capacity(k);
        let mut child = pos.clone();
        for &(q, m) in &ranked[..k] {
            child.copy_from(pos);
            child.play(self.ctx, seat, m);
            let e = self.eval_pos(&child, stat, seat) + 0.05 * q + 0.001 * self.rng.unit();
            scored.push((e, m));
        }
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        (scored[0].1, scored)
    }

    /// Re-score the best few moves by letting the next rival answer with
    /// its own best (quick-ranked, then evaluated) reply.
    fn flare_second_ply(
        &mut self,
        pos: &Pos,
        stat: &Statics,
        seat: usize,
        scored: &[(f64, Move)],
    ) -> Move {
        const REPLIES: usize = 6;
        let ctx = self.ctx;
        let k = self.weights.flare_reply.min(scored.len());
        let mut best = scored[0].1;
        let mut best_v = f64::MIN;
        let mut child = pos.clone();
        let mut grand = pos.clone();
        for &(e1, m) in &scored[..k] {
            child.copy_from(pos);
            child.play(ctx, seat, m);
            child.next_turn();
            let t = child.turn;
            let v = if child.all_dark() || ctx.config.allies(seat, t) {
                e1
            } else {
                let mut replies = Vec::new();
                child.board.gen_moves(
                    ctx,
                    t,
                    child.kit[t],
                    GenMode::Normal,
                    &mut self.scratch,
                    &mut replies,
                    false,
                );
                if replies.is_empty() {
                    e1
                } else {
                    let ranked = self.ranked(&child, t, &replies);
                    let mut theirs = f64::MIN;
                    let mut mine = e1;
                    for &(_, r) in ranked.iter().take(REPLIES) {
                        grand.copy_from(&child);
                        grand.play(ctx, t, r);
                        let vt = self.eval_pos(&grand, stat, t);
                        if vt > theirs {
                            theirs = vt;
                            mine = self.eval_pos(&grand, stat, seat);
                        }
                    }
                    mine
                }
            };
            if v > best_v {
                best_v = v;
                best = m;
            }
        }
        best
    }

    // ----------------------------------------------------------------- Nova

    fn pick_nova(&mut self, pos: &Pos, stat: &Statics, seat: usize, moves: &[Move]) -> Move {
        let start = (self.clock)();
        let w = self.weights.clone();
        let (best, scored) =
            self.pick_flare(pos, stat, seat, moves, w.flare_width.max(w.nova_root));
        let k = scored.len().min(w.nova_root);
        if k <= 1 {
            self.last_iters = 0;
            return best;
        }
        let root_moves: Vec<Move> = scored[..k].iter().map(|s| s.1).collect();
        let root_prior: Vec<f32> = (0..k).map(|i| 1.0 - i as f32 / k as f32).collect();
        let mut nodes: Vec<Node> = vec![Node::with_moves(seat, root_moves, root_prior)];
        let mut sim = pos.clone();
        let mut path: Vec<(u32, u32, u16)> = Vec::new();
        let max_iters = self.max_iters.unwrap_or(u32::MAX);
        let mut iters = 0u32;
        let teams = if self.ctx.config.teams {
            2
        } else {
            pos.dark.len()
        };
        let mut reward = vec![0f32; teams];
        loop {
            if iters >= max_iters {
                break;
            }
            if iters.is_multiple_of(8) && (self.clock)() - start >= self.budget_ms {
                break;
            }
            iters += 1;
            sim.copy_from(pos);
            path.clear();
            self.amaf.clear();
            let mut ply: u16 = 0;
            let mut ni = 0u32;
            // Selection and expansion.
            loop {
                let node = &nodes[ni as usize];
                if node.moves.is_empty() {
                    break;
                }
                // Seats skipped on the way here had no move when the node
                // was expanded (same position), so they are dark.
                let mut hops = 0;
                while sim.turn != node.seat as usize && hops < 4 {
                    sim.dark[sim.turn] = true;
                    sim.next_turn();
                    hops += 1;
                }
                let i = self.select(node, ni == 0, &w);
                let m = node.moves[i];
                let s = node.seat as usize;
                path.push((ni, i as u32, ply));
                sim.play(self.ctx, s, m);
                self.amaf.push((m.pid, ply, s as u8));
                ply += 1;
                sim.next_turn();
                let child = nodes[ni as usize].child[i];
                if child != NONE {
                    ni = child;
                    continue;
                }
                let node = self.expand(&mut sim, &w);
                let idx = nodes.len() as u32;
                nodes.push(node);
                nodes[ni as usize].child[i] = idx;
                break;
            }
            // Playout.
            self.playout(&mut sim, &mut ply);
            self.reward(&sim, stat, &mut reward);
            // Backpropagation, with all-moves-as-first updates: a child also
            // learns from its placement being played later by the same seat.
            if self.amaf_at.len() != self.ctx.table.len() {
                self.amaf_at = vec![(0, 0, 0); self.ctx.table.len()];
            }
            for &(pid, p, s) in self.amaf.iter() {
                let e = &mut self.amaf_at[pid as usize];
                if e.0 != iters {
                    *e = (iters, p, s);
                }
            }
            for &(ni, i, at) in path.iter() {
                let node = &mut nodes[ni as usize];
                let r = reward[self.ctx.config.team_of(node.seat as usize)];
                node.visits += 1;
                node.n[i as usize] += 1;
                node.w[i as usize] += r;
                let allowed = Self::allowed(node, ni == 0, &w);
                for c in 0..allowed {
                    let (stamp, p, s) = self.amaf_at[node.moves[c].pid as usize];
                    if stamp == iters && s == node.seat && p >= at {
                        node.rn[c] += 1;
                        node.rw[c] += r;
                    }
                }
            }
        }
        self.last_iters = iters;
        let root = &nodes[0];
        let mut best_i = 0;
        for i in 1..root.moves.len() {
            let better = root.n[i] > root.n[best_i]
                || (root.n[i] == root.n[best_i]
                    && root.w[i] / (root.n[i].max(1) as f32)
                        > root.w[best_i] / (root.n[best_i].max(1) as f32));
            if better {
                best_i = i;
            }
        }
        root.moves[best_i]
    }

    /// Children admitted by progressive widening.
    #[inline]
    fn allowed(node: &Node, root: bool, w: &Weights) -> usize {
        let base = if root { 3.0 } else { 1.0 };
        let k = base + w.nova_pw * (node.visits as f64).sqrt();
        (k as usize).clamp(1, node.moves.len())
    }

    fn select(&self, node: &Node, root: bool, w: &Weights) -> usize {
        let allowed = Self::allowed(node, root, w);
        let ln = ((node.visits + 1) as f32).ln();
        let mut best = 0;
        let mut best_v = f32::MIN;
        let pv = w.nova_prior as f32;
        let k = w.nova_rave as f32;
        let c = w.nova_c as f32;
        for i in 0..allowed {
            let n = node.n[i] as f32;
            if node.n[i] == 0 && node.rn[i] == 0 {
                // First visit in prior order.
                return i;
            }
            let prior_q = 0.35 + 0.3 * node.prior[i];
            let q = (node.w[i] + pv * prior_q) / (n + pv);
            let v = if node.rn[i] > 0 && k > 0.0 {
                let rn = node.rn[i] as f32;
                let beta = rn / (rn + n + rn * n / k);
                (1.0 - beta) * q + beta * (node.rw[i] / rn)
            } else {
                q
            };
            let u = v + c * (ln / (n + 1.0)).sqrt();
            if u > best_v {
                best_v = u;
                best = i;
            }
        }
        best
    }

    /// Create the node for the position `sim` is in, marking seats that
    /// can't move as dark.
    fn expand(&mut self, sim: &mut Pos, w: &Weights) -> Node {
        let ctx = self.ctx;
        loop {
            if sim.all_dark() {
                return Node::default();
            }
            let s = sim.turn;
            let mut moves = std::mem::take(&mut self.buf);
            moves.clear();
            // Inner nodes consider the two biggest shard sizes left in the
            // kit (all sizes if those don't fit anywhere).
            let kit = sim.kit[s];
            let mut big = 0u32;
            let mut classes = 0;
            for k in (0..5).rev() {
                if self.by_size[k] & kit != 0 && classes < 2 {
                    big |= self.by_size[k] & kit;
                    classes += 1;
                }
            }
            sim.board.gen_moves(
                ctx,
                s,
                big,
                GenMode::Normal,
                &mut self.scratch,
                &mut moves,
                false,
            );
            if moves.is_empty() && big != kit {
                sim.board.gen_moves(
                    ctx,
                    s,
                    kit,
                    GenMode::Normal,
                    &mut self.scratch,
                    &mut moves,
                    false,
                );
            }
            if moves.is_empty() && ctx.config.arena && sim.charge[s] >= COST_SPARK {
                sim.board.gen_moves(
                    ctx,
                    s,
                    sim.kit[s],
                    GenMode::Spark,
                    &mut self.scratch,
                    &mut moves,
                    false,
                );
            }
            if moves.is_empty() {
                self.buf = moves;
                sim.dark[s] = true;
                sim.next_turn();
                continue;
            }
            // Cheap prior: size, then blocking and nodes.
            let mut opp = std::mem::take(&mut self.rows.d);
            self.rival_attach(sim, s, &mut opp);
            let geo = &ctx.geo;
            let salt = self.rng.next_u64() as u32;
            let mut scored: Vec<(u32, Move)> = moves
                .iter()
                .map(|m| {
                    let cells = ctx.table.cells(m.pid as usize);
                    let mut v = cells.len() as u32 * 20;
                    for &c in cells {
                        let (ri, b) = (c as usize / geo.w, c as usize % geo.w);
                        v += (opp[ri] >> b & 1) as u32 * 6 + (sim.nodes[ri] >> b & 1) as u32 * 10;
                    }
                    // Random tie-break in the low bits.
                    let tie = (m.pid ^ salt).wrapping_mul(0x9e37_79b9) >> 24;
                    ((v << 8) | tie, *m)
                })
                .collect();
            self.rows.d = opp;
            let width = w.nova_width.max(1);
            if scored.len() > width {
                scored.select_nth_unstable_by(width - 1, |a, b| b.0.cmp(&a.0));
                scored.truncate(width);
            }
            scored.sort_unstable_by_key(|x| std::cmp::Reverse(x.0));
            let k = scored.len();
            let prior = (0..k).map(|i| 1.0 - i as f32 / k as f32).collect();
            let mv = scored.into_iter().map(|x| x.1).collect();
            self.buf = moves;
            return Node::with_moves(s, mv, prior);
        }
    }

    /// Play to the end with the fast policy.
    fn playout(&mut self, sim: &mut Pos, ply: &mut u16) {
        let mut guard = 0;
        while !sim.all_dark() && guard < 600 {
            guard += 1;
            let s = sim.turn;
            match self.playout_move(sim, s) {
                Some(m) => {
                    sim.play(self.ctx, s, m);
                    self.amaf.push((m.pid, *ply, s as u8));
                    *ply = ply.saturating_add(1);
                }
                None => sim.dark[s] = true,
            }
            sim.next_turn();
        }
    }

    /// Playout policy: sample a few attach points at random (those near
    /// the previous player's last placement first, with probability
    /// `nova_local`) and play a random one of the biggest shards that fit
    /// at any of them. Falls back to a Spark when no shard fits anywhere.
    fn playout_move(&mut self, sim: &Pos, s: usize) -> Option<Move> {
        const SAMPLE: usize = 3;
        let ctx = self.ctx;
        let geo = &ctx.geo;
        let attach = sim.board.attach(s);
        let mut anchors = std::mem::take(&mut self.anchors);
        anchors.clear();
        // Local anchors first.
        let mut local = 0;
        if sim.last_len > 0
            && sim.last_seat as usize != s
            && sim.kit[s] != 0
            && self.rng.unit() < self.weights.nova_local
        {
            let r = &mut self.rows;
            r.a.clear();
            r.a.resize(geo.rows, 0);
            r.b.clear();
            r.b.resize(geo.rows, 0);
            r.c.clear();
            r.c.resize(geo.rows, 0);
            for &c in &sim.last[..sim.last_len as usize] {
                r.a[c as usize / geo.w] |= 1 << (c as usize % geo.w);
            }
            geo.ball2(&r.a, &mut r.b, &mut r.c);
            for ri in 0..geo.rows {
                r.b[ri] &= attach[ri];
            }
            geo.for_each_cell(&r.b, |c| {
                anchors.push(c as u32);
                true
            });
            local = anchors.len();
            geo.for_each_cell(attach, |c| {
                if r.b[c / geo.w] >> (c % geo.w) & 1 == 0 {
                    anchors.push(c as u32);
                }
                true
            });
        } else {
            geo.for_each_cell(attach, |c| {
                anchors.push(c as u32);
                true
            });
        }
        if anchors.is_empty() {
            self.anchors = anchors;
            return None;
        }
        let kit = sim.kit[s];
        let mut found = None;
        if kit != 0 {
            // Biggest size class still in the kit: finding one ends the search.
            let max_size = (0..5)
                .rev()
                .find(|&k| self.by_size[k] & kit != 0)
                .unwrap_or(0);
            let mut best: (usize, u32) = (0, 0);
            let mut sampled = 0;
            'anchors: for (lo, hi) in [(0, local), (local, anchors.len())] {
                let mut end = hi;
                while end > lo {
                    let j = lo + self.rng.below((end - lo) as u32) as usize;
                    anchors.swap(j, end - 1);
                    let a = anchors[end - 1] as usize;
                    end -= 1;
                    let aw = sim.board.anchor_win(ctx, s, a);
                    if aw.open == 0 {
                        continue;
                    }
                    // Size classes, biggest first, pieces in random order.
                    'sizes: for k in (0..5).rev() {
                        if k + 2 <= best.0 {
                            break;
                        }
                        let class = self.by_size[k] & kit;
                        if class == 0 {
                            continue;
                        }
                        let n = class.count_ones();
                        let skip = self.rng.below(n);
                        let start = self.rng.next_u64() as u32;
                        for t in 0..n {
                            let piece = nth_bit(class, (skip + t) % n);
                            if let Some(pid) = geo.first_fit(&aw, piece, start) {
                                best = (k + 2, pid);
                                break 'sizes;
                            }
                        }
                    }
                    if best.0 > 0 {
                        sampled += 1;
                        if best.0 == max_size + 2 || sampled >= SAMPLE {
                            break 'anchors;
                        }
                    }
                }
            }
            if best.0 > 0 {
                found = Some(Move {
                    pid: best.1,
                    leap: false,
                });
            }
        }
        if found.is_none() && ctx.config.arena && sim.charge[s] >= COST_SPARK {
            let start = self.rng.below(anchors.len() as u32) as usize;
            for k in 0..anchors.len() {
                let a = anchors[(start + k) % anchors.len()] as usize;
                if sim.board.spark_ok(ctx, a) {
                    found = Some(Move {
                        pid: Board::spark_pid(ctx, a),
                        leap: false,
                    });
                    break;
                }
            }
        }
        self.anchors = anchors;
        found
    }

    /// Final scores of a finished simulation, approximating the storm by
    /// the rings that will have collapsed by the final round.
    fn final_scores(&self, sim: &Pos, stat: &Statics, out: &mut [f32]) {
        let ctx = self.ctx;
        let geo = &ctx.geo;
        let seats = sim.dark.len();
        let level = match ctx.config.storm {
            Some(s) if sim.round >= s.start => {
                let k = (sim.round - s.start) / s.every + 1;
                let max = (geo.w as i32 - s.min_span as i32).max(0) / 2;
                (k as i32).min(max) as usize
            }
            _ => 0,
        };
        for s in 0..seats {
            let own = sim.board.own(s);
            let mut n = 0u32;
            for ri in 0..geo.rows {
                let mut v = own[ri] & !stat.cores[ri];
                if level > 0 {
                    let y = ri % geo.h;
                    if y < level || y + level >= geo.h {
                        v = 0;
                    } else {
                        v &= (geo.wmask >> level) & (geo.wmask << level);
                    }
                }
                n += v.count_ones();
            }
            out[s] = n as f32
                + if sim.kit[s] == 0 {
                    SWEEP_BONUS as f32
                } else {
                    0.0
                };
        }
        if ctx.config.crowns && geo.three_d {
            // The top cube of each column, if a seat's (and not a Core).
            for y in 0..geo.h {
                let mut covered = 0u64;
                for z in (0..geo.d).rev() {
                    let ri = y + geo.h * z;
                    let top = sim.board.occ[ri] & !covered;
                    covered |= sim.board.occ[ri];
                    if top == 0 {
                        continue;
                    }
                    for s in 0..seats {
                        out[s] +=
                            (sim.board.own(s)[ri] & top & !stat.cores[ri]).count_ones() as f32;
                    }
                }
            }
        }
    }

    /// Reward per team in [0, 1]: mostly the win (ties split), plus a
    /// little for the margin so playouts prefer clearer wins.
    fn reward(&self, sim: &Pos, stat: &Statics, out: &mut [f32]) {
        let ctx = self.ctx;
        let seats = sim.dark.len();
        let mut scores = [0f32; 4];
        self.final_scores(sim, stat, &mut scores[..seats]);
        let teams = out.len();
        let mut totals = [0f32; 4];
        for s in 0..seats {
            totals[ctx.config.team_of(s)] += scores[s];
        }
        let best = totals[..teams].iter().cloned().fold(f32::MIN, f32::max);
        let winners = totals[..teams].iter().filter(|&&t| t == best).count() as f32;
        for t in 0..teams {
            let other = (0..teams)
                .filter(|&u| u != t)
                .map(|u| totals[u])
                .fold(f32::MIN, f32::max);
            let share = if totals[t] == best {
                1.0 / winners
            } else {
                0.0
            };
            let margin = 0.5 + 0.5 * ((totals[t] - other) / 12.0).tanh();
            out[t] = 0.85 * share + 0.15 * margin;
        }
    }

    // ----------------------------------------------------------- Evaluation

    /// Heuristic value of `t`'s position: points on the board plus the
    /// potential of its attach points, the room behind them and its charge.
    fn seat_value(&mut self, pos: &Pos, stat: &Statics, t: usize) -> f64 {
        let ctx = self.ctx;
        let geo = &ctx.geo;
        let w = &self.weights;
        let rows = geo.rows;
        let own = pos.board.own(t);
        let mut placed = 0u32;
        for ri in 0..rows {
            placed += (own[ri] & !stat.cores[ri]).count_ones();
        }
        let mut v = placed as f64;
        if pos.kit[t] == 0 {
            v += SWEEP_BONUS as f64;
        }
        let left = stat.kit_cells(pos.kit[t]) / stat.total_cells;
        let wc = w.charge_end + (w.charge - w.charge_end) * left;
        v += wc * pos.charge[t] as f64;
        if pos.dark[t] || pos.kit[t] == 0 {
            return v;
        }
        let r = &mut self.rows;
        for buf in [&mut r.a, &mut r.b, &mut r.c] {
            buf.clear();
            buf.resize(rows, 0);
        }
        // a: forbidden (canonical), b: step one, c: step two.
        let fp = pos.board.fp(t);
        for ri in 0..rows {
            r.a[ri] = geo.unpad_row(fp, ri);
        }
        let attach = pos.board.attach(t);
        geo.face(attach, &mut r.b);
        for ri in 0..rows {
            r.b[ri] &= !r.a[ri] & !attach[ri] & geo.playable[ri];
        }
        geo.face(&r.b, &mut r.c);
        let mut reach = 0u32;
        for ri in 0..rows {
            r.c[ri] &= !r.a[ri] & !attach[ri] & !r.b[ri] & geo.playable[ri];
            reach += r.b[ri].count_ones() + r.c[ri].count_ones();
        }
        let na = Geo::count(attach) as f64;
        let wa = w.attach_end + (w.attach - w.attach_end) * left;
        let wr = w.reach_end + (w.reach - w.reach_end) * left;
        v + wa * na.min(40.0) + wr * (reach as f64).min(120.0)
    }

    fn eval_pos(&mut self, pos: &Pos, stat: &Statics, seat: usize) -> f64 {
        let ctx = self.ctx;
        let seats = pos.dark.len();
        let mut team_val = [0.0f64; 4];
        for t in 0..seats {
            team_val[ctx.config.team_of(t)] += self.seat_value(pos, stat, t);
        }
        let teams = if ctx.config.teams { 2 } else { seats };
        let mine = ctx.config.team_of(seat);
        let mut max = f64::MIN;
        let mut sum = 0.0;
        for t in (0..teams).filter(|&t| t != mine) {
            max = max.max(team_val[t]);
            sum += team_val[t];
        }
        let mean = sum / (teams - 1).max(1) as f64;
        let m = self.weights.rival_mean;
        team_val[mine] - ((1.0 - m) * max + m * mean)
    }

    /// Position value for `seat`: its team's value minus its rivals'.
    pub fn evaluate(&self, st: &State, seat: usize) -> f64 {
        let mut b = Bot::new(self.ctx, self.level, 0, 0.0, self.clock);
        b.weights = self.weights.clone();
        let stat = Statics::new(self.ctx, st);
        let pos = Pos::from_state(self.ctx, st);
        b.eval_pos(&pos, &stat, seat)
    }

    // --------------------------------------------------------------- Surges

    /// A shatter that's worth its charge by the evaluation, if any. Targets
    /// are rival cells next to our light or their attach points: cutting a
    /// rival's only corner into open space is the usual reason.
    fn pick_shatter(
        &mut self,
        st: &State,
        pos: &Pos,
        stat: &Statics,
        seat: usize,
    ) -> Option<usize> {
        let ctx = self.ctx;
        let lat = &ctx.lat;
        let base = self.eval_pos(pos, stat, seat);
        let mut targets: Vec<(u32, usize)> = Vec::new();
        for i in 0..lat.len() {
            let o = st.cells[i];
            if !is_seat(o) || ctx.config.allies(seat, o as usize - 1) {
                continue;
            }
            if st.check_shatter(ctx, seat, i).is_err() {
                continue;
            }
            // How many of the owner's attach points this cell feeds.
            let owner = o as usize - 1;
            let geo = &ctx.geo;
            let att = pos.board.attach(owner);
            let feeds = lat
                .link
                .get(i)
                .iter()
                .filter(|&&n| att[n as usize / geo.w] >> (n as usize % geo.w) & 1 != 0)
                .count() as u32;
            if feeds > 0 {
                targets.push((feeds, i));
            }
        }
        if targets.is_empty() {
            return None;
        }
        targets.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        targets.truncate(24);
        let mut best = None;
        let mut best_gain = self.weights.shatter_margin;
        let mut cells = st.cells.clone();
        for &(_, t) in &targets {
            let keep = cells[t];
            cells[t] = SCAR;
            let mut after = pos.clone();
            after.board = Board::from_cells(ctx, &cells);
            after.charge[seat] -= COST_SHATTER;
            let gain = self.eval_pos(&after, stat, seat) - base;
            cells[t] = keep;
            if gain > best_gain {
                best_gain = gain;
                best = Some(t);
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GameConfig;
    use crate::session::Game;

    fn now() -> f64 {
        use std::time::Instant;
        thread_local!(static T0: Instant = Instant::now());
        T0.with(|t| t.elapsed().as_secs_f64() * 1000.0)
    }

    fn play_game(name: &str, levels: &[Level], seed: u64) -> Vec<i32> {
        let seats = levels.len() as u8;
        let mut g = Game::new(GameConfig::preset(name, seats).unwrap(), seed).unwrap();
        let levels: Vec<Level> = (0..g.data.config.seats as usize)
            .map(|i| levels[i % levels.len()])
            .collect();
        let mut guard = 0;
        while g.state().phase == Phase::Playing {
            guard += 1;
            assert!(guard < 3000, "game did not end");
            let seat = g.state().turn as usize;
            let ctx = g.ctx.clone();
            let mut bot = Bot::new(&ctx, levels[seat], seed + guard, 1e9, &now);
            bot.max_iters = Some(60);
            let action = bot.next_action(g.state(), seat).expect("bot acts");
            g.apply(seat, action).expect("bot plays legal moves");
        }
        g.state().scores(&g.ctx)
    }

    #[test]
    fn bots_finish_every_preset() {
        for name in GameConfig::PRESETS {
            let scores = play_game(name, &[Level::Flare, Level::Ember], 3);
            assert!(scores.len() >= 2);
        }
        for name in ["duel", "stack", "storm"] {
            let scores = play_game(name, &[Level::Nova, Level::Flare], 5);
            assert!(scores.len() >= 2);
        }
    }

    #[test]
    fn flare_beats_ember_more_often_than_not() {
        let mut wins = 0;
        for seed in 0..8 {
            let a = play_game("duel", &[Level::Flare, Level::Ember], seed);
            let b = play_game("duel", &[Level::Ember, Level::Flare], seed + 100);
            if a[0] > a[1] {
                wins += 1;
            }
            if b[1] > b[0] {
                wins += 1;
            }
        }
        assert!(wins >= 11, "flare won only {wins}/16");
    }

    #[test]
    fn nova_with_an_iteration_cap_is_reproducible() {
        let g = Game::new(GameConfig::preset("duel", 2).unwrap(), 4).unwrap();
        let pick = |seed| {
            let mut bot = Bot::new(&g.ctx, Level::Nova, seed, 1e9, &now);
            bot.max_iters = Some(200);
            let a = bot.next_action(g.state(), 0);
            assert_eq!(bot.last_iters, 200);
            a
        };
        assert_eq!(pick(7), pick(7));
    }

    /// The simulation position tracks the real game exactly: kit, charge,
    /// nodes and bitboards after every placement.
    #[test]
    fn pos_tracks_the_rules() {
        for (name, seats) in [("plane", 4), ("stack", 2), ("teams", 4), ("torus", 2)] {
            let mut g = Game::new(GameConfig::preset(name, seats).unwrap(), 9).unwrap();
            let ctx = g.ctx.clone();
            let mut pos = Pos::from_state(&ctx, g.state());
            let mut guard = 0;
            while g.state().phase == Phase::Playing && guard < 200 {
                guard += 1;
                let seat = g.state().turn as usize;
                let mut bot = Bot::new(&ctx, Level::Ember, guard, 0.0, &now);
                let action = bot.next_action(g.state(), seat).unwrap();
                if let Action::Place {
                    piece,
                    orient,
                    at,
                    leap,
                } = action
                {
                    let cells = g
                        .state()
                        .placement_cells(&ctx, piece as usize, orient as usize, at)
                        .unwrap();
                    let pid = (0..ctx.table.len())
                        .find(|&p| {
                            ctx.table
                                .cells(p)
                                .iter()
                                .map(|&c| c as usize)
                                .eq(cells.iter().copied())
                                && ctx.table.piece[p] as u16 == piece
                        })
                        .unwrap();
                    pos.play(
                        &ctx,
                        seat,
                        Move {
                            pid: pid as u32,
                            leap,
                        },
                    );
                }
                let ev = g.apply(seat, action).unwrap();
                if ev
                    .iter()
                    .any(|e| matches!(e, Event::Storm { .. } | Event::Shattered { .. }))
                {
                    pos = Pos::from_state(&ctx, g.state());
                    continue;
                }
                let fresh = Pos::from_state(&ctx, g.state());
                assert_eq!(pos.board, fresh.board, "{name}: board");
                assert_eq!(pos.kit, fresh.kit, "{name}: kit");
                assert_eq!(pos.charge, fresh.charge, "{name}: charge");
                assert_eq!(pos.nodes, fresh.nodes, "{name}: nodes");
            }
        }
    }
}
