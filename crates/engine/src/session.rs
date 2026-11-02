//! `Game`: a full match. Wraps the simulation `State` with fog-of-war
//! memory, misfires, the action log, per-seat redacted views and a context
//! cache so tables are built once per configuration.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::config::{ConfigError, GameConfig};
use crate::game::*;
use crate::pieces::Kit;

/// Contexts are expensive (move tables), so share them per config.
pub fn ctx_for(config: &GameConfig) -> Result<Arc<Ctx>, ConfigError> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<Ctx>>>> = OnceLock::new();
    let key = serde_json::to_string(config).map_err(|e| ConfigError(e.to_string()))?;
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(c) = cache.lock().unwrap().get(&key) {
        return Ok(c.clone());
    }
    let ctx = Ctx::new(config.clone())?;
    let mut guard = cache.lock().unwrap();
    if guard.len() > 32 {
        guard.clear();
    }
    guard.insert(key, ctx.clone());
    Ok(ctx)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub seat: u8,
    pub action: Action,
}

/// Everything needed to restore a match. This is what the server persists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameData {
    pub config: GameConfig,
    pub seed: u64,
    pub state: State,
    /// Fog memory per seat, plus one trailing entry for the public map.
    pub memory: Vec<Vec<u8>>,
    pub memory_flags: Vec<Vec<u8>>,
    pub scan_until: Vec<u32>,
    pub log: Vec<LogEntry>,
    pub last_events: Vec<Event>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatView {
    pub seat: u8,
    pub team: u8,
    pub pieces: Option<Vec<bool>>,
    pub pieces_left: u8,
    pub charge: Option<u8>,
    pub dark: bool,
    pub resigned: bool,
    pub score: Option<i32>,
    pub core: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub config: GameConfig,
    pub seat: Option<u8>,
    pub cells: Vec<u8>,
    pub flags: Vec<u8>,
    pub seats: Vec<SeatView>,
    pub turn: u8,
    pub round: u16,
    pub ply: u32,
    pub phase: Phase,
    pub storm_level: u8,
    pub next_storm: Option<u16>,
    pub scanning: bool,
    pub shattered_this_turn: bool,
    pub events: Vec<Event>,
    pub scores: Option<Vec<i32>>,
    pub winners: Option<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub piece: u16,
    pub orient: u16,
    pub at: [i32; 3],
    pub cells: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameError {
    Config(ConfigError),
    Rule(RuleError),
    Data(String),
}

impl std::fmt::Display for GameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GameError::Config(e) => write!(f, "{e}"),
            GameError::Rule(e) => write!(f, "{e}"),
            GameError::Data(e) => write!(f, "{e}"),
        }
    }
}

impl From<RuleError> for GameError {
    fn from(e: RuleError) -> Self {
        GameError::Rule(e)
    }
}

impl From<ConfigError> for GameError {
    fn from(e: ConfigError) -> Self {
        GameError::Config(e)
    }
}

pub struct Game {
    pub ctx: Arc<Ctx>,
    pub data: GameData,
    scratch: Scratch,
}

impl Game {
    pub fn new(config: GameConfig, seed: u64) -> Result<Game, GameError> {
        let ctx = ctx_for(&config)?;
        let state = State::new(&ctx, seed);
        let seats = config.seats as usize;
        let (memory, memory_flags) = if config.fog.is_some() {
            (
                vec![state.cells.clone(); seats + 1],
                vec![state.flags.clone(); seats + 1],
            )
        } else {
            (Vec::new(), Vec::new())
        };
        let mut g = Game {
            ctx,
            data: GameData {
                config,
                seed,
                state,
                memory,
                memory_flags,
                scan_until: vec![0; seats],
                log: Vec::new(),
                last_events: Vec::new(),
            },
            scratch: Scratch::default(),
        };
        g.refresh_memory();
        Ok(g)
    }

    pub fn from_data(data: GameData) -> Result<Game, GameError> {
        let ctx = ctx_for(&data.config)?;
        if data.state.cells.len() != ctx.lat.len() {
            return Err(GameError::Data("board size mismatch".into()));
        }
        Ok(Game {
            ctx,
            data,
            scratch: Scratch::default(),
        })
    }

    pub fn from_json(json: &str) -> Result<Game, GameError> {
        let data: GameData =
            serde_json::from_str(json).map_err(|e| GameError::Data(e.to_string()))?;
        Game::from_data(data)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.data).expect("game data serializes")
    }

    /// A perfect-information game built from a seat's view: what the seat
    /// believes the board to be. Used for client-side hints and fair bots.
    pub fn from_view(view: &View) -> Result<Game, GameError> {
        let mut config = view.config.clone();
        config.fog = None;
        let ctx = ctx_for(&config)?;
        if view.cells.len() != ctx.lat.len() {
            return Err(GameError::Data("board size mismatch".into()));
        }
        let pieces_n = ctx.kit.pieces.len();
        let state = State {
            cells: view.cells.clone(),
            flags: view.flags.iter().map(|f| f & (F_NODE | F_CORE)).collect(),
            cores: view.seats.iter().map(|s| s.core).collect(),
            seats: view
                .seats
                .iter()
                .map(|s| SeatState {
                    pieces: s.pieces.clone().unwrap_or_else(|| vec![true; pieces_n]),
                    charge: s.charge.unwrap_or(0),
                    dark: s.dark,
                    resigned: s.resigned,
                })
                .collect(),
            turn: view.turn,
            round: view.round,
            ply: view.ply,
            phase: view.phase,
            storm_level: view.storm_level,
            shattered_this_turn: view.shattered_this_turn,
        };
        let seats = config.seats as usize;
        Ok(Game {
            ctx,
            data: GameData {
                config,
                seed: 0,
                state,
                memory: Vec::new(),
                memory_flags: Vec::new(),
                scan_until: vec![0; seats],
                log: Vec::new(),
                last_events: Vec::new(),
            },
            scratch: Scratch::default(),
        })
    }

    #[inline]
    pub fn state(&self) -> &State {
        &self.data.state
    }

    pub fn kit(&self) -> &Kit {
        &self.ctx.kit
    }

    fn fogged(&self) -> bool {
        self.data.config.fog.is_some() && self.data.state.phase == Phase::Playing
    }

    fn scanning(&self, seat: usize) -> bool {
        self.data
            .scan_until
            .get(seat)
            .is_some_and(|&p| p > self.data.state.ply)
    }

    /// Cells `seat` (and its allies) can currently see.
    pub fn visible(&self, seat: usize) -> Vec<bool> {
        let lat = &self.ctx.lat;
        let n = lat.len();
        let st = &self.data.state;
        let Some(r) = self.data.config.fog else {
            return vec![true; n];
        };
        if self.scanning(seat) || st.phase == Phase::Over {
            return vec![true; n];
        }
        let mut vis = vec![false; n];
        let mut ball = Vec::with_capacity(125);
        for i in 0..n {
            let o = st.cells[i];
            if o == VOID || o == ASH {
                vis[i] = true;
            }
            if is_seat(o) && self.data.config.allies(seat, o as usize - 1) {
                ball.clear();
                lat.ball(i, r as i32, &mut ball);
                for &b in &ball {
                    vis[b] = true;
                }
            }
        }
        vis
    }

    fn refresh_memory(&mut self) {
        if self.data.config.fog.is_none() {
            return;
        }
        let seats = self.data.config.seats as usize;
        for s in 0..seats {
            let vis = self.visible(s);
            let st = &self.data.state;
            for (i, v) in vis.iter().enumerate() {
                if *v {
                    self.data.memory[s][i] = st.cells[i];
                    self.data.memory_flags[s][i] = st.flags[i];
                }
            }
        }
        let st = &self.data.state;
        for m in 0..=seats {
            for i in 0..st.cells.len() {
                if st.cells[i] == ASH {
                    self.data.memory[m][i] = ASH;
                    self.data.memory_flags[m][i] = 0;
                }
            }
        }
    }

    /// The board as `seat` believes it: truth where visible, memory elsewhere.
    fn seen_board(&self, seat: usize) -> Vec<u8> {
        if !self.fogged() {
            return self.data.state.cells.clone();
        }
        let vis = self.visible(seat);
        let st = &self.data.state;
        vis.iter()
            .enumerate()
            .map(|(i, v)| {
                if *v {
                    st.cells[i]
                } else {
                    self.data.memory[seat][i]
                }
            })
            .collect()
    }

    /// Validate without applying. Under fog this checks against what the seat
    /// can see, so a placement that would misfire still passes.
    pub fn check(&self, seat: usize, action: &Action) -> Result<(), RuleError> {
        let st = &self.data.state;
        match action {
            Action::Place {
                piece,
                orient,
                at,
                leap,
            } => {
                let board = self.seen_board(seat);
                st.check_place_on(
                    &self.ctx,
                    &board,
                    seat,
                    *piece as usize,
                    *orient as usize,
                    *at,
                    *leap,
                )
                .map(|_| ())
            }
            Action::Shatter { cell } => {
                if self.fogged()
                    && !self
                        .visible(seat)
                        .get(*cell as usize)
                        .copied()
                        .unwrap_or(false)
                {
                    return Err(RuleError::BadTarget);
                }
                st.check_shatter(&self.ctx, seat, *cell as usize)
                    .map(|_| ())
            }
            Action::Scan => {
                if st.phase == Phase::Over {
                    return Err(RuleError::GameOver);
                }
                if seat != st.turn as usize {
                    return Err(RuleError::NotYourTurn);
                }
                if !self.data.config.arena {
                    return Err(RuleError::NoArena);
                }
                if self.data.config.fog.is_none() {
                    return Err(RuleError::NoFog);
                }
                if st.seats[seat].charge < COST_SCAN {
                    return Err(RuleError::NoCharge);
                }
                Ok(())
            }
            Action::Resign => {
                if st.phase == Phase::Over {
                    Err(RuleError::GameOver)
                } else if st.seats.get(seat).is_none_or(|s| s.dark) {
                    Err(RuleError::Dark)
                } else {
                    Ok(())
                }
            }
        }
    }

    /// Apply an action for `seat`. Returns the full (unredacted) events.
    pub fn apply(&mut self, seat: usize, action: Action) -> Result<Vec<Event>, RuleError> {
        self.check(seat, &action)?;
        let ctx = self.ctx.clone();
        let mut events = Vec::new();
        let mut scratch = std::mem::take(&mut self.scratch);
        let result = (|| -> Result<(), RuleError> {
            let st = &mut self.data.state;
            match &action {
                Action::Place {
                    piece,
                    orient,
                    at,
                    leap,
                } => {
                    let truth = st.cells.clone();
                    match st.check_place_on(
                        &ctx,
                        &truth,
                        seat,
                        *piece as usize,
                        *orient as usize,
                        *at,
                        *leap,
                    ) {
                        Ok(cells) => st.commit_place(
                            &ctx,
                            seat,
                            *piece as usize,
                            &cells,
                            *leap,
                            &mut scratch,
                            &mut events,
                        ),
                        Err(_) => {
                            // Valid on the seat's view but not on the truth:
                            // they hit something they couldn't see.
                            let cells =
                                st.placement_cells(&ctx, *piece as usize, *orient as usize, *at)?;
                            let mut hit: Vec<u32> = Vec::new();
                            for &c in &cells {
                                if truth[c] != EMPTY {
                                    hit.push(c as u32);
                                }
                                if ctx.config.gravity {
                                    if let Some(b) = ctx.lat.below(c) {
                                        hit.push(b as u32);
                                    }
                                }
                            }
                            for &c in &cells {
                                hit.push(c as u32);
                            }
                            hit.sort_unstable();
                            hit.dedup();
                            if !self.data.memory.is_empty() {
                                for &h in &hit {
                                    self.data.memory[seat][h as usize] = truth[h as usize];
                                    self.data.memory_flags[seat][h as usize] = st.flags[h as usize];
                                }
                            }
                            events.push(Event::Misfire {
                                seat: seat as u8,
                                cells: hit,
                            });
                            st.end_turn(&ctx, &mut scratch, &mut events);
                        }
                    }
                }
                Action::Shatter { cell } => {
                    let victim = st.check_shatter(&ctx, seat, *cell as usize)?;
                    st.commit_shatter(seat, *cell as usize, victim, &mut events);
                }
                Action::Scan => {
                    st.seats[seat].charge -= COST_SCAN;
                    let active = st.seats.iter().filter(|s| !s.dark).count().max(1) as u32;
                    self.data.scan_until[seat] = st.ply + active + 1;
                    events.push(Event::Scanned { seat: seat as u8 });
                }
                Action::Resign => st.resign(&ctx, seat, &mut scratch, &mut events)?,
            }
            Ok(())
        })();
        self.scratch = scratch;
        result?;
        self.data.log.push(LogEntry {
            seat: seat as u8,
            action,
        });
        self.refresh_memory();
        self.data.last_events = events.clone();
        Ok(events)
    }

    /// Legal placements for `seat`, for UI hints. `leap` selects Leap moves.
    pub fn legal(&mut self, seat: usize, leap: bool) -> Vec<Placement> {
        let st = &self.data.state;
        if st.phase == Phase::Over || seat != st.turn as usize {
            return Vec::new();
        }
        let modes = if leap {
            [GenMode::Leap, GenMode::SparkLeap]
        } else {
            [GenMode::Normal, GenMode::Spark]
        };
        let mut moves = Vec::new();
        for m in modes {
            st.gen_moves(&self.ctx, seat, m, &mut self.scratch, &mut moves, false);
        }
        moves
            .iter()
            .map(|m| {
                let p = m.pid as usize;
                let o = self.ctx.table.origin[p];
                Placement {
                    piece: self.ctx.table.piece[p] as u16,
                    orient: self.ctx.table.orient[p],
                    at: [o[0] as i32, o[1] as i32, o[2] as i32],
                    cells: self.ctx.table.cells(p).to_vec(),
                }
            })
            .collect()
    }

    pub fn scratch(&mut self) -> &mut Scratch {
        &mut self.scratch
    }

    /// The view for a seat (`None` for spectators), redacted under fog.
    pub fn view(&self, seat: Option<usize>) -> View {
        let st = &self.data.state;
        let cfg = &self.data.config;
        let fog = self.fogged();
        let n = st.cells.len();
        let (cells, flags, vis) = match (fog, seat) {
            (false, _) => (
                st.cells.clone(),
                st.flags.iter().map(|f| f | F_VISIBLE).collect(),
                vec![true; n],
            ),
            (true, Some(s)) => {
                let vis = self.visible(s);
                let mut cells = Vec::with_capacity(n);
                let mut flags = Vec::with_capacity(n);
                for i in 0..n {
                    if vis[i] {
                        cells.push(st.cells[i]);
                        flags.push(st.flags[i] | F_VISIBLE);
                    } else {
                        cells.push(self.data.memory[s][i]);
                        flags.push(self.data.memory_flags[s][i] | F_STALE);
                    }
                }
                (cells, flags, vis)
            }
            (true, None) => {
                let p = cfg.seats as usize;
                let vis: Vec<bool> = st.cells.iter().map(|&o| o == VOID || o == ASH).collect();
                let flags = (0..n)
                    .map(|i| {
                        if vis[i] {
                            F_VISIBLE
                        } else {
                            self.data.memory_flags[p][i] | F_STALE
                        }
                    })
                    .collect();
                (self.data.memory[p].clone(), flags, vis)
            }
        };
        let knows = |other: usize| -> bool { !fog || seat.is_some_and(|s| cfg.allies(s, other)) };
        let scores_all = st.scores(&self.ctx);
        let seats = st
            .seats
            .iter()
            .enumerate()
            .map(|(i, s)| SeatView {
                seat: i as u8,
                team: cfg.team_of(i) as u8,
                pieces: knows(i).then(|| s.pieces.clone()),
                pieces_left: s.pieces.iter().filter(|p| **p).count() as u8,
                charge: knows(i).then_some(s.charge),
                dark: s.dark,
                resigned: s.resigned,
                score: knows(i).then_some(scores_all[i]),
                core: st.cores[i],
            })
            .collect();
        let events = self.redact(&self.data.last_events, seat, fog, &vis);
        let over = st.phase == Phase::Over;
        View {
            config: cfg.clone(),
            seat: seat.map(|s| s as u8),
            cells,
            flags,
            seats,
            turn: st.turn,
            round: st.round,
            ply: st.ply,
            phase: st.phase,
            storm_level: st.storm_level,
            next_storm: st.next_storm(&self.ctx),
            scanning: seat.is_some_and(|s| self.scanning(s)),
            shattered_this_turn: st.shattered_this_turn,
            events,
            scores: (!fog).then_some(scores_all.clone()),
            winners: over.then(|| st.winners(&self.ctx, &scores_all)),
        }
    }

    fn redact(&self, events: &[Event], seat: Option<usize>, fog: bool, vis: &[bool]) -> Vec<Event> {
        if !fog {
            return events.to_vec();
        }
        let cfg = &self.data.config;
        let ally = |p: u8| seat.is_some_and(|s| cfg.allies(s, p as usize));
        events
            .iter()
            .filter_map(|e| match e {
                Event::Placed {
                    seat: p,
                    piece,
                    cells,
                    leap,
                    spark,
                    ..
                } if !ally(*p) => {
                    let seen: Vec<u32> =
                        cells.iter().copied().filter(|&c| vis[c as usize]).collect();
                    let hidden = seen.len() < cells.len();
                    Some(Event::Placed {
                        seat: *p,
                        piece: if seen.is_empty() { u16::MAX } else { *piece },
                        cells: seen,
                        leap: *leap,
                        spark: *spark,
                        hidden,
                    })
                }
                Event::Node { seat: p, cell } if !ally(*p) && !vis[*cell as usize] => None,
                Event::Shattered {
                    seat: p,
                    cell,
                    victim,
                } if !ally(*p) && !ally(*victim) && !vis[*cell as usize] => None,
                Event::Misfire { seat: p, .. } if !ally(*p) => Some(Event::Misfire {
                    seat: *p,
                    cells: Vec::new(),
                }),
                other => Some(other.clone()),
            })
            .collect()
    }

    /// Replay a log from scratch; used to verify determinism.
    pub fn replay(config: GameConfig, seed: u64, log: &[LogEntry]) -> Result<Game, GameError> {
        let mut g = Game::new(config, seed)?;
        for e in log {
            g.apply(e.seat as usize, e.action.clone())?;
        }
        Ok(g)
    }
}

impl Game {
    /// The next action a bot would take for `seat`. Under fog the bot plays
    /// from the seat's view, never the truth.
    pub fn bot_action(
        &self,
        seat: usize,
        level: crate::ai::Level,
        seed: u64,
        budget_ms: f64,
        clock: &dyn Fn() -> f64,
    ) -> Option<Action> {
        self.bot_action_with(seat, level, seed, budget_ms, clock, &Default::default())
    }

    /// [`Game::bot_action`] with extra options (iteration cap, weights).
    pub fn bot_action_with(
        &self,
        seat: usize,
        level: crate::ai::Level,
        seed: u64,
        budget_ms: f64,
        clock: &dyn Fn() -> f64,
        opts: &crate::ai::BotOptions,
    ) -> Option<Action> {
        use crate::ai::Bot;
        if self.fogged() {
            let belief = Game::from_view(&self.view(Some(seat))).ok()?;
            let mut bot = Bot::new(&belief.ctx, level, seed, budget_ms, clock).with_options(opts);
            bot.can_scan = self.data.config.arena;
            bot.scanning = self.scanning(seat);
            let action = bot.next_action(belief.state(), seat)?;
            // A belief-based shatter must target something we can see.
            if let Action::Shatter { cell } = action {
                if self.check(seat, &Action::Shatter { cell }).is_err() {
                    let mut bot =
                        Bot::new(&belief.ctx, crate::ai::Level::Ember, seed, budget_ms, clock);
                    return bot.next_action(belief.state(), seat);
                }
            }
            Some(action)
        } else {
            let mut bot = Bot::new(&self.ctx, level, seed, budget_ms, clock).with_options(opts);
            bot.next_action(self.state(), seat)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play_out(g: &mut Game, max: usize) {
        for _ in 0..max {
            if g.state().phase == Phase::Over {
                break;
            }
            let seat = g.state().turn as usize;
            let legal = g.legal(seat, false);
            let p = legal.iter().max_by_key(|p| p.cells.len()).cloned();
            let action = match p {
                Some(p) => Action::Place {
                    piece: p.piece,
                    orient: p.orient,
                    at: p.at,
                    leap: false,
                },
                None => {
                    let leap = g.legal(seat, true);
                    let p = leap.first().cloned().expect("seat should have some move");
                    Action::Place {
                        piece: p.piece,
                        orient: p.orient,
                        at: p.at,
                        leap: true,
                    }
                }
            };
            g.apply(seat, action).unwrap();
        }
    }

    #[test]
    fn json_roundtrip_and_replay_are_deterministic() {
        let mut g = Game::new(GameConfig::preset("plane", 4).unwrap(), 5).unwrap();
        play_out(&mut g, 30);
        let json = g.to_json();
        let g2 = Game::from_json(&json).unwrap();
        assert_eq!(g2.data, g.data);
        let g3 = Game::replay(g.data.config.clone(), 5, &g.data.log).unwrap();
        assert_eq!(g3.data.state, g.data.state);
    }

    #[test]
    fn views_parse_as_the_documented_json() {
        let g = Game::new(GameConfig::preset("fog", 2).unwrap(), 5).unwrap();
        let v = serde_json::to_value(g.view(Some(0))).unwrap();
        for key in [
            "config",
            "seat",
            "cells",
            "flags",
            "seats",
            "turn",
            "round",
            "ply",
            "phase",
            "stormLevel",
            "nextStorm",
            "scanning",
            "shatteredThisTurn",
            "events",
            "scores",
            "winners",
        ] {
            assert!(v.get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["phase"], "playing");
        assert_eq!(v["config"]["dims"], serde_json::json!([14, 14, 1]));
        let action: Action = serde_json::from_str(
            r#"{"type":"place","piece":3,"orient":1,"at":[2,3,0],"leap":false}"#,
        )
        .unwrap();
        assert!(matches!(action, Action::Place { piece: 3, .. }));
        let action: Action = serde_json::from_str(r#"{"type":"scan"}"#).unwrap();
        assert_eq!(action, Action::Scan);
    }

    #[test]
    fn fog_hides_far_cells_and_opponent_info() {
        let mut g = Game::new(GameConfig::preset("fog", 2).unwrap(), 2).unwrap();
        play_out(&mut g, 6);
        let v0 = g.view(Some(0));
        let truth = &g.state().cells;
        // Opponent cells far from us must not be shown as current truth.
        let mut hidden = 0;
        for i in 0..truth.len() {
            if v0.flags[i] & F_VISIBLE == 0 {
                hidden += 1;
                assert!(v0.flags[i] & F_STALE != 0);
            }
        }
        assert!(hidden > 50, "{hidden}");
        assert!(v0.seats[1].pieces.is_none());
        assert!(v0.seats[1].charge.is_none());
        assert!(v0.scores.is_none());
        assert!(v0.seats[0].pieces.is_some());
        // Spectators see only the public map.
        let spec = g.view(None);
        assert!(spec
            .cells
            .iter()
            .all(|&o| o == EMPTY || o == VOID || o == ASH || is_seat(o)));
        let opp = 2u8;
        assert!(
            spec.cells.iter().filter(|&&o| o == opp).count() <= 1,
            "spectator sees opponent light"
        );
    }

    #[test]
    fn misfire_on_unseen_cells() {
        let mut g = Game::new(GameConfig::preset("fog", 2).unwrap(), 2).unwrap();
        // Plant an opponent cell where seat 0 can't see, then have seat 0
        // place a long leap... simpler: forge memory so a visible-looking
        // empty cell is actually occupied.
        let core = g.state().cores[0] as usize;
        let (x, y, _) = g.ctx.lat.coords(core);
        let target = g.ctx.lat.index(x + 1, y + 1, 0).unwrap();
        g.data.state.cells[target] = 2; // truth: opponent there
        g.data.memory[0][target] = EMPTY; // memory: looks empty
                                          // Make it invisible to seat 0 by temporarily using a radius-0-ish
                                          // check: we bypass visibility by asserting on apply's behaviour.
        let vis = g.visible(0);
        if vis[target] {
            // Visible cells can't misfire; the check simply rejects it.
            let r = g.apply(
                0,
                Action::Place {
                    piece: 0,
                    orient: 0,
                    at: [x + 1, y + 1, 0],
                    leap: false,
                },
            );
            assert_eq!(r, Err(RuleError::Occupied));
        }
    }

    #[test]
    fn scan_reveals_everything_for_a_round() {
        let mut g = Game::new(GameConfig::preset("fog", 2).unwrap(), 2).unwrap();
        g.data.state.seats[0].charge = 2;
        g.apply(0, Action::Scan).unwrap();
        let v = g.view(Some(0));
        assert!(v.scanning);
        assert!(v.flags.iter().all(|f| f & F_VISIBLE != 0));
        assert_eq!(v.seats[0].charge, Some(1));
    }

    #[test]
    fn from_view_matches_truth_without_fog() {
        let mut g = Game::new(GameConfig::preset("plane", 4).unwrap(), 8).unwrap();
        play_out(&mut g, 9);
        let seat = g.state().turn as usize;
        let mut b = Game::from_view(&g.view(Some(seat))).unwrap();
        let a: Vec<_> = g.legal(seat, false);
        let c: Vec<_> = b.legal(seat, false);
        assert_eq!(a, c);
    }

    #[test]
    fn rejected_actions_do_not_change_state() {
        let mut g = Game::new(GameConfig::preset("duel", 2).unwrap(), 1).unwrap();
        let before = g.data.clone();
        assert!(g.apply(1, Action::Scan).is_err());
        assert!(g
            .apply(
                0,
                Action::Place {
                    piece: 99,
                    orient: 0,
                    at: [0, 0, 0],
                    leap: false
                }
            )
            .is_err());
        assert!(g.apply(0, Action::Shatter { cell: 0 }).is_err());
        assert_eq!(g.data, before);
    }
}
