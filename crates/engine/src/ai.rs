//! Bots. Three levels that share one evaluation:
//!
//! - **Ember**: a lively, beatable pick among decent moves.
//! - **Flare**: one-ply search over the best candidates with a full evaluation.
//! - **Nova**: Flare's shortlist refined by UCB-allocated truncated playouts.
//!
//! Bots return one action at a time; a turn may be Shatter/Scan followed by
//! a placement. Under fog the caller hands the bot its *believed* state
//! (`Game::from_view`) so it never sees through the fog.

use serde::{Deserialize, Serialize};

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
    scratch: Scratch,
}

/// Per-seat features of a position.
struct Features {
    placed: f64,
    attach: f64,
    reach: f64,
    charge: f64,
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
            scratch: Scratch::default(),
        }
    }

    /// Choose the next action for `seat`. Returns `None` if the seat cannot act.
    pub fn next_action(&mut self, st: &State, seat: usize) -> Option<Action> {
        if st.phase == Phase::Over || st.turn as usize != seat || st.seats[seat].dark {
            return None;
        }
        let charge = st.seats[seat].charge;
        if self.can_scan
            && !self.scanning
            && self.level != Level::Ember
            && charge >= 4
            && st.round.is_multiple_of(3)
        {
            return Some(Action::Scan);
        }
        if self.level != Level::Ember
            && self.ctx.config.arena
            && !st.shattered_this_turn
            && charge >= COST_SHATTER
        {
            if let Some(cell) = self.pick_shatter(st, seat) {
                return Some(Action::Shatter { cell: cell as u32 });
            }
        }
        let moves = self.candidates(st, seat);
        if moves.is_empty() {
            return Some(Action::Resign);
        }
        let m = match self.level {
            Level::Ember => self.pick_ember(st, seat, &moves),
            Level::Flare => self.pick_flare(st, seat, &moves, 48).0,
            Level::Nova => self.pick_nova(st, seat, &moves),
        };
        Some(st.move_action(self.ctx, m))
    }

    /// Moves worth considering. Surge moves only when they're needed or cheap.
    fn candidates(&mut self, st: &State, seat: usize) -> Vec<Move> {
        let mut out = Vec::new();
        st.gen_moves(
            self.ctx,
            seat,
            GenMode::Normal,
            &mut self.scratch,
            &mut out,
            false,
        );
        let kit_left = st.seats[seat].pieces.iter().any(|p| *p);
        if out.len() < 6 || !kit_left {
            st.gen_moves(
                self.ctx,
                seat,
                GenMode::Spark,
                &mut self.scratch,
                &mut out,
                false,
            );
        }
        if out.len() < 3 {
            st.gen_moves(
                self.ctx,
                seat,
                GenMode::Leap,
                &mut self.scratch,
                &mut out,
                false,
            );
            if out.is_empty() {
                st.gen_moves(
                    self.ctx,
                    seat,
                    GenMode::SparkLeap,
                    &mut self.scratch,
                    &mut out,
                    false,
                );
            }
        }
        // Early game: big shards first, like a sensible human.
        let ply_round = st.round;
        let min_size = match ply_round {
            1..=2 => 5,
            3 => 4,
            4..=5 => 3,
            _ => 0,
        };
        let has_big = out.iter().any(|m| self.size(m) >= min_size && !m.leap);
        if min_size > 0 && has_big {
            out.retain(|m| self.size(m) >= min_size && !m.leap);
        }
        out
    }

    #[inline]
    fn size(&self, m: &Move) -> usize {
        self.ctx.table.cells(m.pid as usize).len()
    }

    /// Fast static score of a move, before applying it.
    fn quick_score(&self, st: &State, seat: usize, m: &Move, opp_attach: &[u8]) -> f64 {
        let ctx = self.ctx;
        let cells = ctx.table.cells(m.pid as usize);
        let lat = &ctx.lat;
        let own = seat as u8 + 1;
        let size = cells.len() as f64;
        let mut s = size * 1.6;
        let piece = ctx.table.piece[m.pid as usize] as usize;
        if piece == ctx.kit.spark_index {
            s -= 1.4 * COST_SPARK as f64;
        }
        if m.leap {
            s -= 1.4 * COST_LEAP as f64;
        }
        for &c in cells {
            let c = c as usize;
            if st.flags[c] & F_NODE != 0 {
                s += 2.6;
            }
            s += 0.9 * opp_attach[c] as f64;
            // New corners we open up.
            for &n in lat.link.get(c) {
                let n = n as usize;
                if st.cells[n] != EMPTY || cells.contains(&(n as u32)) {
                    continue;
                }
                let blocked = lat
                    .face
                    .get(n)
                    .iter()
                    .any(|&f| st.cells[f as usize] == own || cells.contains(&f));
                if !blocked {
                    s += 0.35;
                }
            }
        }
        // Drift toward the middle early on to claim space.
        if st.round <= 6 {
            let (cx, cy) = ((lat.w - 1) as f64 / 2.0, (lat.h - 1) as f64 / 2.0);
            let mut d = 0.0;
            for &c in cells {
                let (x, y, _) = lat.coords(c as usize);
                d += ((x as f64 - cx).abs() + (y as f64 - cy).abs()) / (lat.w as f64);
            }
            s -= 0.6 * d / size;
        }
        s
    }

    fn opp_attach_map(&self, st: &State, seat: usize) -> Vec<u8> {
        let ctx = self.ctx;
        let lat = &ctx.lat;
        let mut map = vec![0u8; lat.len()];
        for t in 0..st.seats.len() {
            if ctx.config.allies(seat, t) || st.seats[t].dark {
                continue;
            }
            let own = t as u8 + 1;
            for i in 0..lat.len() {
                if st.cells[i] != EMPTY {
                    continue;
                }
                if lat.face.get(i).iter().any(|&f| st.cells[f as usize] == own) {
                    continue;
                }
                if lat.link.get(i).iter().any(|&l| st.cells[l as usize] == own) {
                    map[i] = map[i].saturating_add(1);
                }
            }
        }
        map
    }

    fn ranked(&mut self, st: &State, seat: usize, moves: &[Move]) -> Vec<(f64, Move)> {
        let opp = self.opp_attach_map(st, seat);
        let mut v: Vec<(f64, Move)> = moves
            .iter()
            .map(|m| (self.quick_score(st, seat, m, &opp), *m))
            .collect();
        v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    fn pick_ember(&mut self, st: &State, seat: usize, moves: &[Move]) -> Move {
        let ranked = self.ranked(st, seat, moves);
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

    /// One-ply search over the `k` best quick-scored moves.
    fn pick_flare(
        &mut self,
        st: &State,
        seat: usize,
        moves: &[Move],
        k: usize,
    ) -> (Move, Vec<(f64, Move)>) {
        let ranked = self.ranked(st, seat, moves);
        let k = k.min(ranked.len());
        let mut scored: Vec<(f64, Move)> = Vec::with_capacity(k);
        for &(q, m) in &ranked[..k] {
            let mut child = st.clone();
            self.play(&mut child, seat, m);
            let e = self.evaluate(&child, seat) + 0.05 * q + 0.001 * self.rng.unit();
            scored.push((e, m));
        }
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        (scored[0].1, scored)
    }

    fn pick_nova(&mut self, st: &State, seat: usize, moves: &[Move]) -> Move {
        let start = (self.clock)();
        let (best, scored) = self.pick_flare(st, seat, moves, 64);
        let k = scored.len().min(12);
        if k <= 1 {
            return best;
        }
        let shortlist = &scored[..k];
        // Normalise priors so playout values and priors are comparable.
        let mut sum = vec![0.0f64; k];
        let mut n = vec![0u32; k];
        let prior_w = 2.0;
        let depth = (st.seats.len() * 2).max(4);
        let mut total = 0u32;
        while (self.clock)() - start < self.budget_ms && total < 4000 {
            // UCB1 over the shortlist.
            let mut pick = 0;
            let mut best_u = f64::MIN;
            for i in 0..k {
                let mean = if n[i] == 0 {
                    shortlist[i].0
                } else {
                    (sum[i] + prior_w * shortlist[i].0) / (n[i] as f64 + prior_w)
                };
                let u = mean + 6.0 * (((total + 1) as f64).ln() / (n[i] as f64 + 1.0)).sqrt();
                if u > best_u {
                    best_u = u;
                    pick = i;
                }
            }
            let mut sim = st.clone();
            self.play(&mut sim, seat, shortlist[pick].1);
            self.rollout(&mut sim, seat, depth);
            let v = self.evaluate(&sim, seat);
            sum[pick] += v;
            n[pick] += 1;
            total += 1;
        }
        let mut best_i = 0;
        let mut best_v = f64::MIN;
        for i in 0..k {
            let v = (sum[i] + prior_w * shortlist[i].0) / (n[i] as f64 + prior_w);
            if v > best_v {
                best_v = v;
                best_i = i;
            }
        }
        shortlist[best_i].1
    }

    /// Fast playout policy: weighted by size cubed and blocking value.
    fn rollout(&mut self, sim: &mut State, me: usize, plies: usize) {
        let seats = sim.seats.len();
        let mut turn = (me + 1) % seats;
        let mut moves = Vec::new();
        for _ in 0..plies {
            let mut tries = 0;
            while sim.seats[turn].dark && tries < seats {
                turn = (turn + 1) % seats;
                tries += 1;
            }
            if tries >= seats {
                return;
            }
            moves.clear();
            sim.gen_moves(
                self.ctx,
                turn,
                GenMode::Normal,
                &mut self.scratch,
                &mut moves,
                false,
            );
            if moves.is_empty() {
                sim.seats[turn].dark = true;
                turn = (turn + 1) % seats;
                continue;
            }
            let mut total = 0.0;
            let weights: Vec<f64> = moves
                .iter()
                .map(|m| {
                    let s = self.size(m) as f64;
                    let w = s * s * s;
                    total += w;
                    w
                })
                .collect();
            let mut r = self.rng.unit() * total;
            let mut chosen = moves[moves.len() - 1];
            for (i, w) in weights.iter().enumerate() {
                r -= w;
                if r <= 0.0 {
                    chosen = moves[i];
                    break;
                }
            }
            self.play(sim, turn, chosen);
            turn = (turn + 1) % seats;
        }
    }

    /// Apply a move to a simulation state without turn bookkeeping.
    fn play(&self, st: &mut State, seat: usize, m: Move) {
        let ctx = self.ctx;
        let p = m.pid as usize;
        let piece = ctx.table.piece[p] as usize;
        let s = &mut st.seats[seat];
        if piece == ctx.kit.spark_index {
            s.charge = s.charge.saturating_sub(COST_SPARK);
        } else {
            s.pieces[piece] = false;
        }
        if m.leap {
            s.charge = s.charge.saturating_sub(COST_LEAP);
        }
        for &c in ctx.table.cells(p) {
            let c = c as usize;
            st.cells[c] = seat as u8 + 1;
            if st.flags[c] & F_NODE != 0 {
                st.flags[c] &= !F_NODE;
                st.seats[seat].charge = (st.seats[seat].charge + 1).min(MAX_CHARGE);
            }
        }
    }

    fn features(&self, st: &State, seat: usize) -> Features {
        let ctx = self.ctx;
        let lat = &ctx.lat;
        let n = lat.len();
        let own = seat as u8 + 1;
        let mut placed = 0.0;
        let mut forbidden = vec![false; n];
        for i in 0..n {
            let o = st.cells[i];
            if o == own && st.flags[i] & F_CORE == 0 {
                placed += 1.0;
            }
            forbidden[i] =
                o != EMPTY || lat.face.get(i).iter().any(|&f| st.cells[f as usize] == own);
        }
        let mut attach = 0.0;
        let mut frontier: Vec<usize> = Vec::new();
        let mut seen = vec![false; n];
        for i in 0..n {
            if !forbidden[i] && lat.link.get(i).iter().any(|&l| st.cells[l as usize] == own) {
                attach += 1.0;
                frontier.push(i);
                seen[i] = true;
            }
        }
        // Reach: empty, non-forbidden cells within 2 face-steps of an attach point.
        let mut reach = 0.0;
        for _ in 0..2 {
            let mut next = Vec::new();
            for &c in &frontier {
                for &f in lat.face.get(c) {
                    let f = f as usize;
                    if !seen[f] && !forbidden[f] {
                        seen[f] = true;
                        reach += 1.0;
                        next.push(f);
                    }
                }
            }
            frontier = next;
        }
        if st.seats[seat].dark {
            attach = 0.0;
            reach = 0.0;
        }
        Features {
            placed,
            attach,
            reach,
            charge: st.seats[seat].charge as f64,
        }
    }

    /// Position value for `seat`: its team's value minus the strongest rival's.
    pub fn evaluate(&self, st: &State, seat: usize) -> f64 {
        let ctx = self.ctx;
        let seats = st.seats.len();
        let mut team_val = vec![0.0f64; seats];
        // Late game, potential matters less than what's on the board.
        let left: f64 = st.seats[seat].pieces.iter().filter(|p| **p).count() as f64
            / ctx.kit.pieces.len().max(1) as f64;
        let w_attach = 0.5 + 0.9 * left;
        let w_reach = 0.08 + 0.2 * left;
        for t in 0..seats {
            let f = self.features(st, t);
            let v = f.placed
                + w_attach * f.attach.min(40.0)
                + w_reach * f.reach.min(120.0)
                + 0.55 * f.charge;
            team_val[ctx.config.team_of(t)] += v;
        }
        let mine = ctx.config.team_of(seat);
        let rival = (0..seats)
            .filter(|&t| t != mine && (ctx.config.teams && t < 2 || !ctx.config.teams))
            .map(|t| team_val[t])
            .fold(f64::MIN, f64::max);
        let rival = if rival == f64::MIN { 0.0 } else { rival };
        team_val[mine] - rival
    }

    /// A shatter that meaningfully opens space for us, if any.
    fn pick_shatter(&mut self, st: &State, seat: usize) -> Option<usize> {
        let ctx = self.ctx;
        let lat = &ctx.lat;
        let own = seat as u8 + 1;
        let mut base = Vec::new();
        st.gen_moves(
            ctx,
            seat,
            GenMode::Normal,
            &mut self.scratch,
            &mut base,
            false,
        );
        let base_n = base.len();
        // Only bother when we're getting squeezed.
        if base_n > 40 && st.seats[seat].charge < 6 {
            return None;
        }
        // Opponent cells touching our light.
        let mut targets: Vec<usize> = Vec::new();
        for i in 0..lat.len() {
            let o = st.cells[i];
            if !is_seat(o)
                || o == own
                || st.flags[i] & F_CORE != 0
                || ctx.config.allies(seat, o as usize - 1)
            {
                continue;
            }
            let near = lat
                .link
                .get(i)
                .iter()
                .chain(lat.face.get(i))
                .any(|&n| st.cells[n as usize] == own);
            if near && st.check_shatter(ctx, seat, i).is_ok() {
                targets.push(i);
            }
        }
        if targets.is_empty() {
            return None;
        }
        targets.truncate(16);
        let mut best = None;
        let mut best_gain = 0usize;
        for t in targets {
            let mut sim = st.clone();
            sim.cells[t] = SCAR;
            let mut out = Vec::new();
            sim.gen_moves(
                ctx,
                seat,
                GenMode::Normal,
                &mut self.scratch,
                &mut out,
                false,
            );
            let gain = out.len().saturating_sub(base_n);
            if gain > best_gain {
                best_gain = gain;
                best = Some(t);
            }
        }
        let worth = if base_n == 0 {
            best_gain > 0
        } else {
            best_gain * 3 >= base_n.max(12)
        };
        if worth {
            best
        } else {
            None
        }
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
            let mut bot = Bot::new(&ctx, levels[seat], seed + guard, 25.0, &now);
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
}
