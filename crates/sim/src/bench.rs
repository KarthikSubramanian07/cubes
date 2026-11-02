//! A criterion-free micro benchmark for the engine's hot paths.
//!
//! Positions come from a fixed policy that only depends on the *set* of
//! legal moves (biggest shard first, ties broken by a seeded pick over moves
//! sorted by placement id), so the same positions are produced before and
//! after any change to how moves are generated or ordered.

use std::time::Instant;

extern "C" {
    fn clock() -> std::os::raw::c_ulong;
}

/// Process CPU time in seconds (`CLOCKS_PER_SEC` is 1e6 on macOS and on
/// glibc). Unlike wall time it doesn't count time spent waiting for a busy
/// machine, so single-thread measurements stay comparable under load.
pub fn cpu_seconds() -> f64 {
    unsafe { clock() as f64 / 1_000_000.0 }
}

use serde::Serialize;

use cubes_engine::game::{Ctx, GenMode, Move, Scratch, State};
use cubes_engine::rng::Rng;
use cubes_engine::session::ctx_for;
use cubes_engine::{Board, Bot, GameConfig, Level, Phase};

use crate::play::now_ms;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchRow {
    pub name: String,
    pub positions: usize,
    pub avg_moves: f64,
    /// Nanoseconds per call.
    pub gen_normal_ns: f64,
    /// The reference (pre-bitboard) generator on the same positions.
    pub gen_naive_ns: f64,
    pub speedup: f64,
    /// Generation from an incrementally maintained `Board`.
    pub gen_board_ns: f64,
    pub all_moves_ns: f64,
    pub has_any_move_ns: f64,
    pub evaluate_ns: f64,
    /// CPU microseconds per Nova search iteration, and per Flare decision.
    pub nova_iter_us: f64,
    pub flare_decision_us: f64,
    /// A whole game with the fixed policy (move generation, commit, end of
    /// turn bookkeeping), in microseconds.
    pub game_us: f64,
}

struct Case {
    name: &'static str,
    preset: &'static str,
    seats: u8,
    /// Plies at which positions are sampled.
    window: (u32, u32),
}

const CASES: [Case; 4] = [
    Case {
        name: "plane 20x20 4p mid-game",
        preset: "plane",
        seats: 4,
        window: (24, 44),
    },
    Case {
        name: "duel 14x14 2p mid-game",
        preset: "duel",
        seats: 2,
        window: (12, 24),
    },
    Case {
        name: "torus 18x18 4p mid-game",
        preset: "torus",
        seats: 4,
        window: (24, 44),
    },
    Case {
        name: "stack 8x8x8 4p mid-game",
        preset: "stack",
        seats: 4,
        window: (16, 36),
    },
];

/// Pick the next move with the fixed policy. Returns false when the seat has
/// no normal move (the game state is then advanced by `end_turn`).
fn policy_step(ctx: &Ctx, st: &mut State, rng: &mut Rng, scratch: &mut Scratch) {
    let seat = st.turn as usize;
    let mut moves: Vec<Move> = Vec::new();
    st.gen_moves(ctx, seat, GenMode::Normal, scratch, &mut moves, false);
    if moves.is_empty() {
        st.all_moves(ctx, seat, scratch)
            .into_iter()
            .for_each(|m| moves.push(m));
    }
    let mut ev = Vec::new();
    if moves.is_empty() {
        st.resign(ctx, seat, scratch, &mut ev).ok();
        return;
    }
    moves.sort_by_key(|m| (m.pid, m.leap));
    let size = |m: &Move| ctx.table.cells(m.pid as usize).len();
    let big = moves.iter().map(size).max().unwrap();
    let pool: Vec<Move> = moves.into_iter().filter(|m| size(m) == big).collect();
    let m = pool[rng.below(pool.len() as u32) as usize];
    let piece = ctx.table.piece[m.pid as usize] as usize;
    let cells: Vec<usize> = ctx
        .table
        .cells(m.pid as usize)
        .iter()
        .map(|&c| c as usize)
        .collect();
    st.commit_place(ctx, seat, piece, &cells, m.leap, scratch, &mut ev);
}

fn positions(ctx: &Ctx, case: &Case, games: u64) -> (Vec<State>, f64) {
    let mut out = Vec::new();
    let mut scratch = Scratch::default();
    let mut game_us = 0.0;
    for seed in 0..games {
        let mut st = State::new(ctx, seed + 1);
        let mut rng = Rng::new(seed * 31 + 7);
        let t0 = Instant::now();
        while st.phase == Phase::Playing {
            if st.ply >= case.window.0 && st.ply < case.window.1 && st.ply.is_multiple_of(2) {
                out.push(st.clone());
            }
            policy_step(ctx, &mut st, &mut rng, &mut scratch);
        }
        game_us += t0.elapsed().as_secs_f64() * 1e6;
    }
    (out, game_us / games as f64)
}

/// Nanoseconds per call: the fastest of several trials, which is the most
/// stable estimate on a machine that is busy with other work.
fn time_ns(reps: usize, positions: &[State], mut f: impl FnMut(&State)) -> f64 {
    for st in positions.iter().take(4) {
        f(st);
    }
    const TRIALS: usize = 5;
    let per = reps.div_ceil(TRIALS).max(1);
    let mut best = f64::MAX;
    for _ in 0..TRIALS {
        let t0 = cpu_seconds();
        for _ in 0..per {
            for st in positions {
                f(st);
            }
        }
        let ns = (cpu_seconds() - t0) * 1e9 / (per * positions.len()) as f64;
        best = best.min(ns);
    }
    best
}

pub fn run(reps: usize) -> Vec<BenchRow> {
    let mut rows = Vec::new();
    for case in &CASES {
        let cfg = GameConfig::preset(case.preset, case.seats).unwrap();
        let ctx = ctx_for(&cfg).unwrap();
        let (pos, game_us) = positions(&ctx, case, 12);
        let mut scratch = Scratch::default();
        let mut buf: Vec<Move> = Vec::new();
        let mut total_moves = 0usize;
        for st in &pos {
            buf.clear();
            st.gen_moves(
                &ctx,
                st.turn as usize,
                GenMode::Normal,
                &mut scratch,
                &mut buf,
                false,
            );
            total_moves += buf.len();
        }
        let gen_normal_ns = time_ns(reps, &pos, |st| {
            buf.clear();
            st.gen_moves(
                &ctx,
                st.turn as usize,
                GenMode::Normal,
                &mut scratch,
                &mut buf,
                false,
            );
            std::hint::black_box(&buf);
        });
        let gen_naive_ns = time_ns(reps.div_ceil(4), &pos, |st| {
            buf.clear();
            st.gen_moves_naive(
                &ctx,
                st.turn as usize,
                GenMode::Normal,
                &mut scratch,
                &mut buf,
                false,
            );
            std::hint::black_box(&buf);
        });
        let boards: Vec<Board> = pos
            .iter()
            .map(|st| Board::from_cells(&ctx, &st.cells))
            .collect();
        let mut bi = 0usize;
        let gen_board_ns = time_ns(reps, &pos, |st| {
            buf.clear();
            let seat = st.turn as usize;
            boards[bi % boards.len()].gen_moves(
                &ctx,
                seat,
                cubes_engine::bits::kit_mask(&st.seats[seat].pieces),
                GenMode::Normal,
                &mut scratch,
                &mut buf,
                false,
            );
            bi += 1;
            std::hint::black_box(&buf);
        });
        let all_moves_ns = time_ns(reps.div_ceil(4), &pos, |st| {
            std::hint::black_box(st.all_moves(&ctx, st.turn as usize, &mut scratch));
        });
        let has_any_move_ns = time_ns(reps, &pos, |st| {
            std::hint::black_box(st.has_any_move(&ctx, st.turn as usize, &mut scratch));
        });
        let bot = Bot::new(&ctx, Level::Flare, 1, 0.0, &now_ms);
        let evaluate_ns = time_ns(reps.div_ceil(4), &pos, |st| {
            std::hint::black_box(bot.evaluate(st, st.turn as usize));
        });
        // Bots: a handful of positions, CPU time.
        let few: Vec<&State> = pos.iter().step_by((pos.len() / 6).max(1)).take(6).collect();
        let iters = 200u32;
        let t0 = cpu_seconds();
        for (k, st) in few.iter().enumerate() {
            let mut b = Bot::new(&ctx, Level::Nova, k as u64, 1e12, &now_ms);
            b.max_iters = Some(iters);
            std::hint::black_box(b.next_action(st, st.turn as usize));
        }
        let nova_iter_us = (cpu_seconds() - t0) * 1e6 / (few.len() as f64 * iters as f64);
        let t0 = cpu_seconds();
        for (k, st) in few.iter().enumerate() {
            let mut b = Bot::new(&ctx, Level::Flare, k as u64, 0.0, &now_ms);
            std::hint::black_box(b.next_action(st, st.turn as usize));
        }
        let flare_decision_us = (cpu_seconds() - t0) * 1e6 / few.len() as f64;
        rows.push(BenchRow {
            name: case.name.to_string(),
            positions: pos.len(),
            avg_moves: total_moves as f64 / pos.len().max(1) as f64,
            gen_normal_ns,
            gen_naive_ns,
            speedup: gen_naive_ns / gen_normal_ns,
            gen_board_ns,
            all_moves_ns,
            has_any_move_ns,
            evaluate_ns,
            nova_iter_us,
            flare_decision_us,
            game_us,
        });
    }
    rows
}

pub fn print_text(rows: &[BenchRow]) {
    println!("cubes-sim --bench (CPU ns per call unless noted)");
    println!(
        "  {:<26} {:>4} {:>6} {:>10} {:>10} {:>7} {:>10} {:>10} {:>8} {:>9} {:>10} {:>10} {:>10}",
        "case",
        "pos",
        "moves",
        "gen naive",
        "gen new",
        "speedup",
        "gen board",
        "all_moves",
        "has_any",
        "evaluate",
        "nova it us",
        "flare us",
        "game us"
    );
    for r in rows {
        println!(
            "  {:<26} {:>4} {:>6.1} {:>10.0} {:>10.0} {:>6.1}x {:>10.0} {:>10.0} {:>8.0} {:>9.0} {:>10.1} {:>10.0} {:>10.0}",
            r.name,
            r.positions,
            r.avg_moves,
            r.gen_naive_ns,
            r.gen_normal_ns,
            r.speedup,
            r.gen_board_ns,
            r.all_moves_ns,
            r.has_any_move_ns,
            r.evaluate_ns,
            r.nova_iter_us,
            r.flare_decision_us,
            r.game_us
        );
    }
}
