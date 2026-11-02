//! Command-line parsing. Hand-rolled to keep the workspace dependency-light.

use cubes_engine::{GameConfig, Level, Weights};

#[derive(Clone, Debug)]
pub struct Args {
    pub preset: String,
    pub seats: u8,
    pub games: usize,
    pub bots: Vec<Level>,
    /// Weight overrides per bot index (JSON merged over the defaults).
    pub weights: Vec<Option<serde_json::Value>>,
    pub budget_ms: f64,
    pub iters: Option<u32>,
    pub opening: u32,
    pub threads: usize,
    pub seed: u64,
    pub json: bool,
    pub bench: bool,
    pub bench_reps: usize,
    pub patch: Option<serde_json::Value>,
    pub timing: bool,
    pub quiet: bool,
}

pub const USAGE: &str = "\
cubes-sim: self-play for balance tuning and bot ladders

USAGE:
  cubes-sim [--preset duel] [--seats 2] [--games 400] [--bots flare,ember]
            [--budget 50] [--iters N] [--threads 8] [--seed 1] [--json]
            [--patch '{\"nodes\":8}'] [--w0 '{\"attach\":1.2}'] [--no-timing]
  cubes-sim --bench [--reps 200] [--json]

OPTIONS:
  --preset NAME   plane, duel, pure, fog, storm, torus, teams, stack, orbit
  --seats N       2 to 4 (some presets force a count)
  --games N       games to play
  --bots LIST     comma-separated levels (ember, flare, nova). Seats cycle
                  through the list, and the assignment rotates every game so
                  each bot sits in each seat equally often.
  --budget MS     Nova thinking time per decision, in milliseconds
  --iters N       cap Nova at N search iterations instead of a clock budget
                  (makes Nova games reproducible per seed)
  --opening N     Ember plays the first N plies for every seat, to spread
                  self-play over many openings (balance runs use 2 rounds)
  --threads N     worker threads (default: all cores)
  --seed S        base seed; game i uses seed S + i
  --patch JSON    merge these fields over the preset's GameConfig
  --weights JSON  merge these fields over every bot's default Weights
  --w0..--w3 JSON weight overrides for the bot at that index in --bots
                  (so --bots flare,flare --w1 '{...}' is an A/B test)
  --no-timing     skip the per-move movegen timing sample (faster)
  --json          print the report as JSON
  --bench         run the move generation micro benchmark suite
  --reps N        repetitions per position in --bench
";

pub fn parse(raw: &[String]) -> Result<Args, String> {
    let mut a = Args {
        preset: "duel".into(),
        seats: 0,
        games: 100,
        bots: vec![Level::Flare, Level::Ember],
        weights: vec![None; 4],
        budget_ms: 50.0,
        iters: None,
        opening: 0,
        threads: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4),
        seed: 1,
        json: false,
        bench: false,
        bench_reps: 200,
        patch: None,
        timing: true,
        quiet: false,
    };
    let mut i = 0;
    let need = |i: usize, name: &str| -> Result<String, String> {
        raw.get(i + 1)
            .cloned()
            .ok_or_else(|| format!("{name} needs a value"))
    };
    while i < raw.len() {
        let flag = raw[i].as_str();
        let num = |v: &str| -> Result<u64, String> {
            v.parse::<u64>()
                .map_err(|_| format!("{flag}: expected a number, got {v}"))
        };
        match flag {
            "--preset" => {
                a.preset = need(i, flag)?;
                i += 1;
            }
            "--seats" => {
                a.seats = num(&need(i, flag)?)? as u8;
                i += 1;
            }
            "--games" => {
                a.games = num(&need(i, flag)?)? as usize;
                i += 1;
            }
            "--bots" => {
                let v = need(i, flag)?;
                a.bots = v
                    .split(',')
                    .map(|s| Level::parse(s.trim()).ok_or(format!("unknown bot {s}")))
                    .collect::<Result<_, _>>()?;
                if a.bots.is_empty() {
                    return Err("--bots needs at least one level".into());
                }
                i += 1;
            }
            "--budget" => {
                let v = need(i, flag)?;
                a.budget_ms = v
                    .parse()
                    .map_err(|_| format!("--budget: expected milliseconds, got {v}"))?;
                i += 1;
            }
            "--iters" => {
                a.iters = Some(num(&need(i, flag)?)? as u32);
                i += 1;
            }
            "--opening" => {
                a.opening = num(&need(i, flag)?)? as u32;
                i += 1;
            }
            "--threads" => {
                a.threads = (num(&need(i, flag)?)? as usize).max(1);
                i += 1;
            }
            "--seed" => {
                a.seed = num(&need(i, flag)?)?;
                i += 1;
            }
            "--reps" => {
                a.bench_reps = (num(&need(i, flag)?)? as usize).max(1);
                i += 1;
            }
            "--patch" => {
                let v = need(i, flag)?;
                a.patch =
                    Some(serde_json::from_str(&v).map_err(|e| format!("--patch: bad JSON: {e}"))?);
                i += 1;
            }
            "--weights" | "--w0" | "--w1" | "--w2" | "--w3" => {
                let v = need(i, flag)?;
                let json: serde_json::Value =
                    serde_json::from_str(&v).map_err(|e| format!("{flag}: bad JSON: {e}"))?;
                if flag == "--weights" {
                    for w in a.weights.iter_mut() {
                        *w = Some(merge(w.take(), &json));
                    }
                } else {
                    let k = flag[3..].parse::<usize>().unwrap();
                    a.weights[k] = Some(merge(a.weights[k].take(), &json));
                }
                i += 1;
            }
            "--json" => a.json = true,
            "--bench" => a.bench = true,
            "--no-timing" => a.timing = false,
            "--quiet" => a.quiet = true,
            "-h" | "--help" => return Err(String::new()),
            other => return Err(format!("unknown option {other}")),
        }
        i += 1;
    }
    if !GameConfig::PRESETS.contains(&a.preset.as_str()) {
        return Err(format!("unknown preset {}", a.preset));
    }
    Ok(a)
}

/// The preset's config with `--seats` and `--patch` applied.
pub fn config(a: &Args) -> Result<GameConfig, String> {
    let seats = if a.seats == 0 {
        match a.preset.as_str() {
            "duel" => 2,
            "teams" => 4,
            _ => 2,
        }
    } else {
        a.seats
    };
    let cfg = GameConfig::preset(&a.preset, seats).ok_or("bad preset")?;
    let Some(patch) = &a.patch else {
        return Ok(cfg);
    };
    let mut v = serde_json::to_value(&cfg).map_err(|e| e.to_string())?;
    if let (Some(obj), Some(p)) = (v.as_object_mut(), patch.as_object()) {
        for (k, val) in p {
            obj.insert(k.clone(), val.clone());
        }
    }
    let cfg: GameConfig = serde_json::from_value(v).map_err(|e| format!("--patch: {e}"))?;
    cfg.validate().map_err(|e| format!("--patch: {e}"))?;
    Ok(cfg)
}

fn merge(base: Option<serde_json::Value>, over: &serde_json::Value) -> serde_json::Value {
    let mut v = base.unwrap_or_else(|| serde_json::json!({}));
    if let (Some(obj), Some(o)) = (v.as_object_mut(), over.as_object()) {
        for (k, val) in o {
            obj.insert(k.clone(), val.clone());
        }
    }
    v
}

/// The effective weights for bot index `k`.
pub fn weights_for(a: &Args, k: usize) -> Result<Option<Weights>, String> {
    let Some(over) = a.weights.get(k).cloned().flatten() else {
        return Ok(None);
    };
    let mut v = serde_json::to_value(Weights::default()).map_err(|e| e.to_string())?;
    if let (Some(obj), Some(o)) = (v.as_object_mut(), over.as_object()) {
        for (key, val) in o {
            if !obj.contains_key(key) {
                return Err(format!("unknown weight {key}"));
            }
            obj.insert(key.clone(), val.clone());
        }
    }
    serde_json::from_value(v)
        .map(Some)
        .map_err(|e| format!("bad weights: {e}"))
}
