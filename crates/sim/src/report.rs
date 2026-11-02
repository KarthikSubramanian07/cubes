//! Aggregating game records into a report, printed as text or JSON.

use serde::Serialize;

use cubes_engine::{GameConfig, Level};

use crate::args::Args;
use crate::play::GameRecord;

/// A sample mean with a 95% confidence interval (normal approximation).
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct Est {
    pub mean: f64,
    pub lo: f64,
    pub hi: f64,
    pub n: usize,
}

impl Est {
    pub fn of(xs: &[f64]) -> Est {
        let n = xs.len();
        if n == 0 {
            return Est::default();
        }
        let mean = xs.iter().sum::<f64>() / n as f64;
        let var = if n > 1 {
            xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1) as f64
        } else {
            0.0
        };
        let h = 1.96 * (var / n as f64).sqrt();
        Est {
            mean,
            lo: mean - h,
            hi: mean + h,
            n,
        }
    }

    fn pct(&self) -> String {
        format!(
            "{:5.1}% [{:5.1}, {:5.1}]",
            self.mean * 100.0,
            self.lo * 100.0,
            self.hi * 100.0
        )
    }

    fn num(&self) -> String {
        format!("{:6.2} [{:6.2}, {:6.2}]", self.mean, self.lo, self.hi)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Timing {
    pub mean: f64,
    pub p50: f64,
    pub p95: f64,
    pub max: f64,
    pub n: usize,
}

impl Timing {
    pub fn of(xs: &mut [f64]) -> Timing {
        if xs.is_empty() {
            return Timing::default();
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = xs.len();
        let at = |q: f64| xs[((n as f64 - 1.0) * q).round() as usize];
        Timing {
            mean: xs.iter().sum::<f64>() / n as f64,
            p50: at(0.5),
            p95: at(0.95),
            max: xs[n - 1],
            n,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotRow {
    pub index: usize,
    pub label: String,
    pub level: Level,
    pub seats_per_game: f64,
    /// Share of wins (ties split), per game.
    pub win_share: Est,
    pub expected_share: f64,
    pub avg_score: Est,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatRow {
    pub seat: usize,
    pub win_share: Est,
    pub avg_score: Est,
    pub charge_earned: f64,
    pub sparks: f64,
    pub leaps: f64,
    pub shatters: f64,
    pub scans: f64,
    pub misfires: f64,
    pub dark_early: f64,
    pub pieces_left: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub preset: String,
    pub config: GameConfig,
    pub games: usize,
    pub bots: Vec<Level>,
    pub budget_ms: f64,
    pub iters: Option<u32>,
    pub opening: u32,
    pub seed: u64,
    pub wall_seconds: f64,
    pub by_bot: Vec<BotRow>,
    pub by_seat: Vec<SeatRow>,
    /// Seat 0's win share minus the fair share `1 / seats`.
    pub first_player_edge: Est,
    /// Seat 0's score minus the mean of the other seats.
    pub first_player_margin: Est,
    pub plies: Est,
    pub rounds: Est,
    pub ties: f64,
    /// Per seat per game.
    pub charge_earned: f64,
    pub surges: Surges,
    /// Seat-games that went dark before the end of the game.
    pub dark_before_end: f64,
    /// Seat-games that went dark with at least half their kit unplaced.
    pub dark_early: f64,
    pub avg_dark_round: f64,
    pub pieces_left: f64,
    pub storm: StormStats,
    pub crowns: CrownStats,
    pub illegal_actions: u32,
    pub movegen_us: Timing,
    pub decision_us: Vec<(String, Timing)>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Surges {
    pub spark: f64,
    pub leap: f64,
    pub shatter: f64,
    pub scan: f64,
    pub misfires: f64,
    /// Win share of seat-games that shattered at least once, and that never did.
    pub win_share_with_shatter: Est,
    pub win_share_without_shatter: Est,
    pub win_share_with_spark_or_leap: Est,
    pub win_share_without_spark_or_leap: Est,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StormStats {
    pub storms: f64,
    pub ash: f64,
    pub lead_changes: f64,
    pub lead_changes_after_storm: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrownStats {
    pub per_seat: f64,
    pub decided_games: f64,
}

fn share(rec: &GameRecord, seat: usize) -> f64 {
    if rec.winners.contains(&(seat as u8)) {
        1.0 / rec.winners.len() as f64
    } else {
        0.0
    }
}

pub fn build(args: &Args, cfg: &GameConfig, recs: &[GameRecord], wall_seconds: f64) -> Report {
    let seats = cfg.seats as usize;
    let games = recs.len().max(1) as f64;
    let seat_games = games * seats as f64;
    let labels = labels(&args.bots);
    let by_bot = (0..args.bots.len())
        .map(|k| {
            let mut shares = Vec::new();
            let mut scores = Vec::new();
            let mut seat_count = 0usize;
            for r in recs.iter() {
                let mine: Vec<usize> = (0..seats).filter(|&s| r.bots[s] == k).collect();
                seat_count += mine.len();
                shares.push(mine.iter().map(|&s| share(r, s)).sum());
                for &s in &mine {
                    scores.push(r.scores[s] as f64);
                }
            }
            let per_game = seat_count as f64 / games;
            BotRow {
                index: k,
                label: labels[k].clone(),
                level: args.bots[k],
                seats_per_game: per_game,
                win_share: Est::of(&shares),
                expected_share: per_game / seats as f64,
                avg_score: Est::of(&scores),
            }
        })
        .collect();
    let avg = |f: &dyn Fn(&GameRecord, usize) -> f64, s: usize| -> f64 {
        recs.iter().map(|r| f(r, s)).sum::<f64>() / games
    };
    let by_seat: Vec<SeatRow> = (0..seats)
        .map(|s| SeatRow {
            seat: s,
            win_share: Est::of(&recs.iter().map(|r| share(r, s)).collect::<Vec<_>>()),
            avg_score: Est::of(&recs.iter().map(|r| r.scores[s] as f64).collect::<Vec<_>>()),
            charge_earned: avg(&|r, s| r.seats[s].charge_earned as f64, s),
            sparks: avg(&|r, s| r.seats[s].sparks as f64, s),
            leaps: avg(&|r, s| r.seats[s].leaps as f64, s),
            shatters: avg(&|r, s| r.seats[s].shatters as f64, s),
            scans: avg(&|r, s| r.seats[s].scans as f64, s),
            misfires: avg(&|r, s| r.seats[s].misfires as f64, s),
            dark_early: avg(&|r, s| early(r, s) as u8 as f64, s),
            pieces_left: avg(&|r, s| r.seats[s].pieces_left as f64, s),
        })
        .collect();
    let fair = 1.0 / seats as f64;
    let first_edge: Vec<f64> = recs.iter().map(|r| share(r, 0) - fair).collect();
    let first_margin: Vec<f64> = recs
        .iter()
        .map(|r| {
            let others: f64 =
                r.scores[1..].iter().map(|&x| x as f64).sum::<f64>() / (seats - 1) as f64;
            r.scores[0] as f64 - others
        })
        .collect();
    let all_seats = |f: &dyn Fn(&GameRecord, usize) -> f64| -> f64 {
        recs.iter()
            .map(|r| (0..seats).map(|s| f(r, s)).sum::<f64>())
            .sum::<f64>()
            / seat_games
    };
    let split = |pred: &dyn Fn(&GameRecord, usize) -> bool| -> (Est, Est) {
        let mut yes = Vec::new();
        let mut no = Vec::new();
        for r in recs.iter() {
            for s in 0..seats {
                if pred(r, s) {
                    yes.push(share(r, s));
                } else {
                    no.push(share(r, s));
                }
            }
        }
        (Est::of(&yes), Est::of(&no))
    };
    let (with_shatter, without_shatter) = split(&|r, s| r.seats[s].shatters > 0);
    let (with_sl, without_sl) = split(&|r, s| r.seats[s].sparks + r.seats[s].leaps > 0);
    let dark_rounds: Vec<f64> = recs
        .iter()
        .flat_map(|r| {
            r.seats
                .iter()
                .filter_map(|s| s.dark_round.map(|d| d as f64))
        })
        .collect();
    let mut movegen: Vec<f64> = recs
        .iter()
        .flat_map(|r| r.movegen_us.iter().copied())
        .collect();
    let decision_us = (0..args.bots.len())
        .map(|k| {
            let mut xs: Vec<f64> = recs
                .iter()
                .flat_map(|r| r.decisions.iter().filter(|d| d.0 == k).map(|d| d.1))
                .collect();
            (labels[k].clone(), Timing::of(&mut xs))
        })
        .collect();
    Report {
        preset: args.preset.clone(),
        config: cfg.clone(),
        games: recs.len(),
        bots: args.bots.clone(),
        budget_ms: args.budget_ms,
        iters: args.iters,
        opening: args.opening,
        seed: args.seed,
        wall_seconds,
        by_bot,
        by_seat,
        first_player_edge: Est::of(&first_edge),
        first_player_margin: Est::of(&first_margin),
        plies: Est::of(&recs.iter().map(|r| r.plies as f64).collect::<Vec<_>>()),
        rounds: Est::of(&recs.iter().map(|r| r.rounds as f64).collect::<Vec<_>>()),
        ties: recs.iter().filter(|r| r.winners.len() > 1).count() as f64 / games,
        charge_earned: all_seats(&|r, s| r.seats[s].charge_earned as f64),
        surges: Surges {
            spark: all_seats(&|r, s| r.seats[s].sparks as f64),
            leap: all_seats(&|r, s| r.seats[s].leaps as f64),
            shatter: all_seats(&|r, s| r.seats[s].shatters as f64),
            scan: all_seats(&|r, s| r.seats[s].scans as f64),
            misfires: all_seats(&|r, s| r.seats[s].misfires as f64),
            win_share_with_shatter: with_shatter,
            win_share_without_shatter: without_shatter,
            win_share_with_spark_or_leap: with_sl,
            win_share_without_spark_or_leap: without_sl,
        },
        dark_before_end: all_seats(&|r, s| r.seats[s].dark_round.is_some() as u8 as f64),
        dark_early: all_seats(&|r, s| early(r, s) as u8 as f64),
        avg_dark_round: if dark_rounds.is_empty() {
            0.0
        } else {
            dark_rounds.iter().sum::<f64>() / dark_rounds.len() as f64
        },
        pieces_left: all_seats(&|r, s| r.seats[s].pieces_left as f64),
        storm: StormStats {
            storms: recs.iter().map(|r| r.storms as f64).sum::<f64>() / games,
            ash: recs.iter().map(|r| r.ash as f64).sum::<f64>() / games,
            lead_changes: recs.iter().map(|r| r.lead_changes as f64).sum::<f64>() / games,
            lead_changes_after_storm: recs
                .iter()
                .map(|r| r.storm_lead_changes as f64)
                .sum::<f64>()
                / games,
        },
        crowns: CrownStats {
            per_seat: all_seats(&|r, s| r.seats[s].crowns as f64),
            decided_games: recs.iter().filter(|r| r.crowns_decided).count() as f64 / games,
        },
        illegal_actions: recs.iter().map(|r| r.illegal).sum(),
        movegen_us: Timing::of(&mut movegen),
        decision_us,
    }
}

/// Went dark with at least half the kit unplaced.
fn early(r: &GameRecord, s: usize) -> bool {
    let kit = r.seats[s].placed_shards + r.seats[s].pieces_left;
    r.seats[s].dark_round.is_some() && r.seats[s].pieces_left * 2 >= kit.max(1)
}

/// Bot labels: the level name, with `#index` when a level appears twice.
fn labels(bots: &[Level]) -> Vec<String> {
    bots.iter()
        .enumerate()
        .map(|(i, &l)| {
            if bots.iter().filter(|&&b| b == l).count() > 1 {
                format!("{}#{i}", level_name(l))
            } else {
                level_name(l).to_string()
            }
        })
        .collect()
}

fn level_name(l: Level) -> &'static str {
    match l {
        Level::Ember => "ember",
        Level::Flare => "flare",
        Level::Nova => "nova",
    }
}

pub fn print_text(r: &Report) {
    let c = &r.config;
    println!(
        "cubes-sim  {}  {} seats  {}x{}x{}  {} games  seed {}  ({:.1}s)",
        r.preset, c.seats, c.dims[0], c.dims[1], c.dims[2], r.games, r.seed, r.wall_seconds
    );
    let bots: Vec<&str> = r.bots.iter().map(|&l| level_name(l)).collect();
    let budget = match r.iters {
        Some(n) => format!("{n} iterations"),
        None => format!("{} ms", r.budget_ms),
    };
    println!("bots {}  nova budget {}", bots.join(","), budget);
    println!();
    println!("WIN SHARE BY BOT (ties split, 95% CI)");
    for b in &r.by_bot {
        println!(
            "  {:<8} {}   fair {:4.1}%   seats/game {:.1}   avg score {}",
            b.label,
            b.win_share.pct(),
            b.expected_share * 100.0,
            b.seats_per_game,
            b.avg_score.num()
        );
    }
    println!();
    println!("BY SEAT");
    println!("  seat  win share                 avg score                  charge spark  leap shat  scan  dark-early left");
    for s in &r.by_seat {
        println!(
            "  {:<4}  {}  {}  {:5.2} {:5.2} {:5.2} {:4.2} {:5.2} {:5.1}% {:5.2}",
            s.seat,
            s.win_share.pct(),
            s.avg_score.num(),
            s.charge_earned,
            s.sparks,
            s.leaps,
            s.shatters,
            s.scans,
            s.dark_early * 100.0,
            s.pieces_left
        );
    }
    println!(
        "  first player edge {}   margin {} points",
        r.first_player_edge.pct(),
        r.first_player_margin.num()
    );
    println!();
    println!(
        "GAME  plies {}  rounds {}  ties {:.1}%",
        r.plies.num(),
        r.rounds.num(),
        r.ties * 100.0
    );
    let s = &r.surges;
    println!(
        "ARENA per seat-game: charge {:.2}  spark {:.2}  leap {:.2}  shatter {:.2}  scan {:.2}  misfire {:.2}",
        r.charge_earned, s.spark, s.leap, s.shatter, s.scan, s.misfires
    );
    println!(
        "  win share with shatter {}  without {}",
        s.win_share_with_shatter.pct(),
        s.win_share_without_shatter.pct()
    );
    println!(
        "  win share with spark/leap {}  without {}",
        s.win_share_with_spark_or_leap.pct(),
        s.win_share_without_spark_or_leap.pct()
    );
    println!(
        "DARK  before end {:.1}%  early (half kit left) {:.1}%  avg round {:.1}  shards left {:.2}",
        r.dark_before_end * 100.0,
        r.dark_early * 100.0,
        r.avg_dark_round,
        r.pieces_left
    );
    if r.config.storm.is_some() {
        println!(
            "STORM  collapses {:.2}  ash {:.1}  lead changes {:.2} ({:.2} right after a storm)",
            r.storm.storms, r.storm.ash, r.storm.lead_changes, r.storm.lead_changes_after_storm
        );
    } else {
        println!("LEAD  changes per game {:.2}", r.storm.lead_changes);
    }
    if r.config.crowns {
        println!(
            "CROWNS  per seat {:.2}  decided {:.1}% of games",
            r.crowns.per_seat,
            r.crowns.decided_games * 100.0
        );
    }
    if r.illegal_actions > 0 {
        println!("ILLEGAL bot actions: {}", r.illegal_actions);
    }
    println!();
    let t = &r.movegen_us;
    if t.n > 0 {
        println!(
            "TIMING  movegen (all modes)  mean {:8.1} us  p95 {:8.1} us  ({} samples)",
            t.mean, t.p95, t.n
        );
    }
    for (l, t) in &r.decision_us {
        println!(
            "        {:<8} decision    mean {:8.1} us  p95 {:8.1} us  ({} samples)",
            l, t.mean, t.p95, t.n
        );
    }
}
