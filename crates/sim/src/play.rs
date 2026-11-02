//! Playing one self-play game and recording what happened in it.

use std::time::Instant;

use cubes_engine::game::{is_seat, Scratch, F_CORE, SWEEP_BONUS};
use cubes_engine::{Action, BotOptions, Event, Game, GameConfig, Phase};

use crate::args::Args;

/// Everything the report needs from one finished game.
#[derive(Clone, Debug, Default)]
pub struct GameRecord {
    /// Bot index (into `--bots`) per seat.
    pub bots: Vec<usize>,
    pub scores: Vec<i32>,
    pub winners: Vec<u8>,
    pub plies: u32,
    pub rounds: u16,
    pub seats: Vec<SeatRecord>,
    pub storms: u32,
    pub ash: u32,
    pub lead_changes: u32,
    /// Lead changes in the round right after a storm collapse.
    pub storm_lead_changes: u32,
    /// Would the winner set differ if crowns didn't score?
    pub crowns_decided: bool,
    pub illegal: u32,
    pub movegen_us: Vec<f64>,
    /// (bot index, microseconds) for every bot decision.
    pub decisions: Vec<(usize, f64)>,
}

#[derive(Clone, Debug, Default)]
pub struct SeatRecord {
    pub charge_earned: u32,
    pub sparks: u32,
    pub leaps: u32,
    pub shatters: u32,
    pub shattered: u32,
    pub scans: u32,
    pub misfires: u32,
    pub placed_shards: u32,
    /// Round the seat went dark before the game ended, if it did.
    pub dark_round: Option<u16>,
    /// Shards still unplaced when the seat went dark (or at the end).
    pub pieces_left: u32,
    pub crowns: i32,
}

pub fn now_ms() -> f64 {
    thread_local!(static T0: Instant = Instant::now());
    T0.with(|t| t.elapsed().as_secs_f64() * 1000.0)
}

/// Bot level for each seat in game `g`: seats cycle through the list and the
/// assignment rotates one step every game.
pub fn bots_for(args: &Args, seats: usize, g: usize) -> Vec<usize> {
    let k = args.bots.len();
    (0..seats).map(|s| (s + g) % k).collect()
}

pub fn play(args: &Args, cfg: &GameConfig, g: usize) -> GameRecord {
    let seed = args.seed.wrapping_add(g as u64);
    let mut game = Game::new(cfg.clone(), seed).expect("valid config");
    let seats = cfg.seats as usize;
    let bots = bots_for(args, seats, g);
    let opts: Vec<BotOptions> = (0..args.bots.len())
        .map(|k| BotOptions {
            max_iters: args.iters,
            weights: crate::args::weights_for(args, k).expect("weights validated"),
        })
        .collect();
    let plain = BotOptions::default();
    let mut rec = GameRecord {
        bots: bots.clone(),
        seats: vec![SeatRecord::default(); seats],
        ..Default::default()
    };
    let mut scratch = Scratch::default();
    let mut leader: Option<usize> = None;
    let mut round = game.state().round;
    let mut storm_round: Option<u16> = None;
    let mut calls = 0u64;
    let budget = if args.iters.is_some() {
        1.0e9
    } else {
        args.budget_ms
    };
    while game.state().phase == Phase::Playing {
        calls += 1;
        if calls > 20_000 {
            panic!("game {g} (seed {seed}) did not finish");
        }
        let seat = game.state().turn as usize;
        if args.timing {
            let t0 = Instant::now();
            let moves = game.state().all_moves(&game.ctx, seat, &mut scratch);
            rec.movegen_us.push(t0.elapsed().as_secs_f64() * 1e6);
            std::hint::black_box(moves);
        }
        let bot_seed = seed
            .wrapping_mul(0x9e37_79b9)
            .wrapping_add(calls)
            .wrapping_add(seat as u64 * 7919);
        let t0 = Instant::now();
        let b = bots[seat];
        // Randomised opening: Ember plays the first `--opening` plies for
        // everyone, so near-deterministic bots don't replay one game.
        let (level, opt) = if game.state().ply < args.opening {
            (cubes_engine::Level::Ember, &plain)
        } else {
            (args.bots[b], &opts[b])
        };
        let action = game.bot_action_with(seat, level, bot_seed, budget, &now_ms, opt);
        rec.decisions.push((b, t0.elapsed().as_secs_f64() * 1e6));
        let action = action.unwrap_or(Action::Resign);
        let events = match game.apply(seat, action) {
            Ok(ev) => ev,
            Err(_) => {
                rec.illegal += 1;
                game.apply(seat, Action::Resign).expect("resign is legal")
            }
        };
        for e in &events {
            record_event(&mut rec, &game, e);
            if let Event::Storm { .. } = e {
                storm_round = Some(game.state().round);
            }
        }
        if game.state().round != round {
            round = game.state().round;
            let scores = game.state().scores(&game.ctx);
            let best = *scores.iter().max().unwrap_or(&0);
            let top: Vec<usize> = (0..seats).filter(|&s| scores[s] == best).collect();
            if top.len() == 1 {
                if leader.is_some_and(|l| l != top[0]) {
                    rec.lead_changes += 1;
                    if storm_round.is_some_and(|r| round <= r + 1) {
                        rec.storm_lead_changes += 1;
                    }
                }
                leader = Some(top[0]);
            }
        }
    }
    let st = game.state();
    rec.plies = st.ply;
    rec.rounds = st.round;
    rec.scores = st.scores(&game.ctx);
    rec.winners = st.winners(&game.ctx, &rec.scores);
    for (s, seat) in st.seats.iter().enumerate() {
        let left = seat.pieces.iter().filter(|p| **p).count() as u32;
        if rec.seats[s].dark_round.is_none() {
            rec.seats[s].pieces_left = left;
        }
    }
    if cfg.crowns {
        let mut base = vec![0i32; seats];
        for (i, &o) in st.cells.iter().enumerate() {
            if is_seat(o) && st.flags[i] & F_CORE == 0 {
                base[o as usize - 1] += 1;
            }
        }
        for (s, seat) in st.seats.iter().enumerate() {
            if seat.pieces.iter().all(|p| !p) {
                base[s] += SWEEP_BONUS;
            }
            rec.seats[s].crowns = rec.scores[s] - base[s];
        }
        rec.crowns_decided = st.winners(&game.ctx, &base) != rec.winners;
    }
    rec
}

fn record_event(rec: &mut GameRecord, game: &Game, e: &Event) {
    match e {
        Event::Placed {
            seat, leap, spark, ..
        } => {
            let s = &mut rec.seats[*seat as usize];
            if *spark {
                s.sparks += 1;
            } else {
                s.placed_shards += 1;
            }
            if *leap {
                s.leaps += 1;
            }
        }
        Event::Node { seat, .. } => rec.seats[*seat as usize].charge_earned += 1,
        Event::Shattered { seat, victim, .. } => {
            rec.seats[*seat as usize].shatters += 1;
            rec.seats[*victim as usize].shattered += 1;
        }
        Event::Scanned { seat } => rec.seats[*seat as usize].scans += 1,
        Event::Misfire { seat, .. } => rec.seats[*seat as usize].misfires += 1,
        Event::Dark { seat } => {
            let st = game.state();
            let s = *seat as usize;
            let left = st.seats[s].pieces.iter().filter(|p| **p).count() as u32;
            if left > 0 && st.phase == Phase::Playing && rec.seats[s].dark_round.is_none() {
                rec.seats[s].dark_round = Some(st.round);
                rec.seats[s].pieces_left = left;
            }
        }
        Event::Storm { cells, .. } => {
            rec.storms += 1;
            rec.ash += cells.len() as u32;
        }
        Event::GameOver { .. } => {}
    }
}
