//! cubes-sim: self-play for bot ladders and balance tuning, plus a micro
//! benchmark of the engine's hot paths. See `--help`.
//!
//! Games are spread over plain std threads with an atomic work counter.
//! Game `i` always uses seed `seed + i` and records are reassembled in game
//! order, so every statistic except wall-clock timing is reproducible for a
//! given seed (Nova needs `--iters` for that, since a clock budget depends on
//! machine speed).

mod args;
mod bench;
mod play;
mod report;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

fn main() {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let args = match args::parse(&raw) {
        Ok(a) => a,
        Err(e) => {
            if !e.is_empty() {
                eprintln!("error: {e}\n");
            }
            eprint!("{}", args::USAGE);
            std::process::exit(if e.is_empty() { 0 } else { 2 });
        }
    };
    if args.bench {
        let rows = bench::run(args.bench_reps);
        if args.json {
            println!("{}", serde_json::to_string_pretty(&rows).unwrap());
        } else {
            bench::print_text(&rows);
        }
        return;
    }
    let cfg = match args::config(&args) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    };
    for k in 0..args.bots.len() {
        if let Err(e) = args::weights_for(&args, k) {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    }
    let started = Instant::now();
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<play::GameRecord>>> = Mutex::new(vec![None; args.games]);
    std::thread::scope(|scope| {
        for _ in 0..args.threads.min(args.games.max(1)) {
            scope.spawn(|| loop {
                let g = next.fetch_add(1, Ordering::Relaxed);
                if g >= args.games {
                    break;
                }
                let rec = play::play(&args, &cfg, g);
                results.lock().unwrap()[g] = Some(rec);
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                if !args.quiet && !args.json && (d.is_multiple_of(50) || d == args.games) {
                    eprint!("\r  {d}/{} games", args.games);
                }
            });
        }
    });
    if !args.quiet && !args.json {
        eprintln!();
    }
    let recs: Vec<play::GameRecord> = results
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.expect("every game finished"))
        .collect();
    if let Some(path) = &args.dump {
        let mut out = String::new();
        for r in &recs {
            let line = serde_json::json!({
                "seed": r.seed,
                "bots": r.bots,
                "scores": r.scores,
                "winners": r.winners,
                "plies": r.plies,
            });
            out.push_str(&line.to_string());
            out.push('\n');
        }
        if let Err(e) = std::fs::write(path, out) {
            eprintln!("error: --dump {path}: {e}");
            std::process::exit(1);
        }
    }
    let rep = report::build(&args, &cfg, &recs, started.elapsed().as_secs_f64());
    if args.json {
        println!("{}", serde_json::to_string_pretty(&rep).unwrap());
    } else {
        report::print_text(&rep);
    }
}
