//! `RoomCore`: the whole room as a pure, platform-free state machine.
//!
//! Inputs are connections opening and closing, client frames, and the
//! passage of time (`tick`). Outputs are addressed messages plus the next
//! instant the room wants to be woken. The Durable Object shell in `lib.rs`
//! only moves bytes, persists this struct and sets one alarm, so everything
//! interesting here is unit-tested natively.

use std::collections::{BTreeMap, VecDeque};

use cubes_engine::{Action, Game, GameConfig, GameData, Level, Phase, View};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::protocol::*;

pub type ConnId = u32;

/// Disconnected humans keep their seat this long before autopilot plays.
pub const GRACE_MS: u64 = 30_000;
/// A host gone this long hands the room to the next connected human.
pub const HOST_MIGRATE_MS: u64 = 60_000;
/// Rooms with no activity for this long delete themselves.
pub const IDLE_MS: u64 = 24 * 60 * 60 * 1000;
/// Bots wait a natural-looking beat before moving.
pub const BOT_DELAY_MIN_MS: u64 = 500;
pub const BOT_DELAY_MAX_MS: u64 = 1100;
/// Pause between actions within one bot turn (Shatter, then place).
pub const BOT_FOLLOWUP_MS: u64 = 450;
/// Per-connection frame budget: a bucket of 20 refilled at 20 per second.
pub const RATE_BURST: f64 = 20.0;
pub const RATE_PER_SEC: f64 = 20.0;
/// Per-player chat budget: 5 lines, refilled at one every 2 seconds.
pub const CHAT_BURST: f64 = 5.0;
pub const CHAT_PER_SEC: f64 = 0.5;
/// Per-player emote budget: 3, refilled at one per second.
pub const EMOTE_BURST: f64 = 3.0;
pub const EMOTE_PER_SEC: f64 = 1.0;
/// Players remembered per room (seated or not). Oldest idle ones go first.
pub const MAX_PLAYERS: usize = 64;
/// Chat lines replayed to newcomers.
pub const CHAT_HISTORY: usize = 30;

/// Who an outbound message is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Conn(ConnId),
    /// Every connection that has said hello.
    All,
    /// Every connection of the human sitting in this seat.
    Seat(u8),
    /// Every connection that has said hello and is not seated.
    Spectators,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Outbound {
    pub to: Target,
    pub msg: ServerMsg,
}

/// Estimated CPU cost of one Nova playout in wasm, per board cell per
/// playout ply. Measured natively at about 0.0036 ms (11.5 ms per playout on
/// a 4-seat 20x20 board, 2.8 ms on a 14x14 duel) and scaled by 1.5 for wasm.
pub const PLAYOUT_MS_PER_CELL_PLY: f64 = 0.0054;

/// How bots think: a monotonic millisecond clock and Nova's budget.
pub struct Thinker<'a> {
    pub clock: &'a dyn Fn() -> f64,
    pub nova_budget_ms: f64,
    /// True where the clock stands still during synchronous work (Workers
    /// only advance `Date.now()` on I/O). Nova then charges each clock read
    /// the estimated cost of one playout, so the budget still means CPU time.
    pub frozen_clock: bool,
}

/// Estimated wasm CPU milliseconds for one Nova playout under `cfg`.
pub fn playout_cost_ms(cfg: &GameConfig) -> f64 {
    let cells: f64 = cfg.dims.iter().map(|&d| d as f64).product();
    let depth = (cfg.seats as f64 * 2.0).max(4.0);
    cells * depth * PLAYOUT_MS_PER_CELL_PLY
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Slot {
    Empty,
    Human {
        pid: String,
        #[serde(default)]
        autopilot: bool,
    },
    Bot {
        level: Level,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Bucket {
    tokens: f64,
    at: u64,
    #[serde(default)]
    primed: bool,
}

impl Bucket {
    fn take(&mut self, now: u64, burst: f64, per_sec: f64) -> bool {
        if !self.primed {
            self.primed = true;
            self.tokens = burst;
            self.at = now;
        }
        let dt = now.saturating_sub(self.at) as f64 / 1000.0;
        self.tokens = (self.tokens + dt * per_sec).min(burst);
        self.at = now.max(self.at);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Player {
    name: String,
    token: String,
    joined: u64,
    disconnected_at: Option<u64>,
    chat: Bucket,
    emote: Bucket,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Conn {
    pid: Option<String>,
    bucket: Bucket,
    warned_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ChatLine {
    name: String,
    seat: Option<u8>,
    text: String,
    at: u64,
}

/// A live match that persists as the engine's `GameData`.
pub struct LiveGame(pub Game);

impl Serialize for LiveGame {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.data.serialize(s)
    }
}

impl<'de> Deserialize<'de> for LiveGame {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let data = GameData::deserialize(d)?;
        Game::from_data(data)
            .map(LiveGame)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomCore {
    code: String,
    phase: RoomPhase,
    host_pid: Option<String>,
    host_gone_since: Option<u64>,
    preset: String,
    config: GameConfig,
    seats: Vec<Slot>,
    players: BTreeMap<String, Player>,
    conns: BTreeMap<ConnId, Conn>,
    next_conn: ConnId,
    next_join: u64,
    game: Option<LiveGame>,
    /// When the seat on turn (a bot or autopilot) should act next.
    bot_due: Option<u64>,
    /// `(ply, seat)` of the last bot action, to pace multi-action turns.
    bot_key: Option<(u32, u8)>,
    /// Turn clock for the human on turn, and the turn it belongs to.
    turn_deadline: Option<u64>,
    clock_key: Option<(u32, u8)>,
    last_activity: u64,
    rng: u64,
    chat: VecDeque<ChatLine>,
}

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn level_name(level: Level) -> &'static str {
    match level {
        Level::Ember => "Ember",
        Level::Flare => "Flare",
        Level::Nova => "Nova",
    }
}

enum Controller {
    Human,
    Bot(Level),
}

impl RoomCore {
    /// A fresh lobby. `seed` should come from a cryptographic source.
    pub fn new(code: &str, now: u64, seed: u64) -> RoomCore {
        RoomCore {
            code: code.to_string(),
            phase: RoomPhase::Lobby,
            host_pid: None,
            host_gone_since: None,
            preset: "plane".into(),
            config: GameConfig::preset("plane", 4).expect("plane preset"),
            seats: vec![Slot::Empty; MAX_SEATS],
            players: BTreeMap::new(),
            conns: BTreeMap::new(),
            next_conn: 1,
            next_join: 0,
            game: None,
            bot_due: None,
            bot_key: None,
            turn_deadline: None,
            clock_key: None,
            last_activity: now,
            rng: seed,
            chat: VecDeque::new(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("room serializes")
    }

    pub fn from_json(json: &str) -> Result<RoomCore, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }

    /// Fold fresh entropy into the room's generator (tokens, seeds, delays).
    pub fn reseed(&mut self, entropy: u64) {
        let mut s = self.rng ^ entropy.rotate_left(17);
        self.rng = splitmix(&mut s) ^ entropy;
    }

    fn rand(&mut self) -> u64 {
        splitmix(&mut self.rng)
    }

    fn new_token(&mut self) -> String {
        format!("{:016x}{:016x}", self.rand(), self.rand())
    }

    // ---- accessors -------------------------------------------------------

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn phase(&self) -> RoomPhase {
        self.phase
    }

    pub fn host_pid(&self) -> Option<&str> {
        self.host_pid.as_deref()
    }

    pub fn game(&self) -> Option<&Game> {
        self.game.as_ref().map(|g| &g.0)
    }

    pub fn conn_ids(&self) -> Vec<ConnId> {
        self.conns.keys().copied().collect()
    }

    pub fn has_conns(&self) -> bool {
        !self.conns.is_empty()
    }

    pub fn lobby(&self) -> Lobby {
        let seats = self
            .seats
            .iter()
            .enumerate()
            .map(|(i, s)| match s {
                Slot::Empty => LobbySeat {
                    seat: i as u8,
                    kind: SeatKind::Empty,
                    name: String::new(),
                    pid: None,
                    connected: false,
                    level: None,
                    autopilot: None,
                },
                Slot::Human { pid, autopilot } => LobbySeat {
                    seat: i as u8,
                    kind: SeatKind::Human,
                    name: self
                        .players
                        .get(pid)
                        .map(|p| p.name.clone())
                        .unwrap_or_default(),
                    pid: Some(pid.clone()),
                    connected: self.connected(pid),
                    level: None,
                    autopilot: autopilot.then_some(true),
                },
                Slot::Bot { level } => LobbySeat {
                    seat: i as u8,
                    kind: SeatKind::Bot,
                    name: level_name(*level).to_string(),
                    pid: None,
                    connected: true,
                    level: Some(*level),
                    autopilot: None,
                },
            })
            .collect();
        let mut spectators: Vec<(&u64, Spectator)> = self
            .players
            .iter()
            .filter(|(pid, _)| self.connected(pid) && self.seat_of(pid).is_none())
            .map(|(pid, p)| {
                (
                    &p.joined,
                    Spectator {
                        pid: pid.clone(),
                        name: p.name.clone(),
                    },
                )
            })
            .collect();
        spectators.sort_by_key(|(j, _)| **j);
        Lobby {
            code: self.code.clone(),
            phase: self.phase,
            host_pid: self.host_pid.clone(),
            preset: self.preset.clone(),
            config: self.config.clone(),
            seats,
            spectators: spectators.into_iter().map(|(_, s)| s).collect(),
        }
    }

    fn connected(&self, pid: &str) -> bool {
        self.conns.values().any(|c| c.pid.as_deref() == Some(pid))
    }

    fn seat_of(&self, pid: &str) -> Option<u8> {
        self.seats
            .iter()
            .position(|s| matches!(s, Slot::Human { pid: p, .. } if p == pid))
            .map(|i| i as u8)
    }

    fn conn_pid(&self, conn: ConnId) -> Option<String> {
        self.conns.get(&conn).and_then(|c| c.pid.clone())
    }

    /// Which connections a target reaches.
    pub fn resolve(&self, to: Target) -> Vec<ConnId> {
        match to {
            Target::Conn(c) => self
                .conns
                .contains_key(&c)
                .then_some(c)
                .into_iter()
                .collect(),
            Target::All => self
                .conns
                .iter()
                .filter(|(_, c)| c.pid.is_some())
                .map(|(id, _)| *id)
                .collect(),
            Target::Seat(s) => match self.seats.get(s as usize) {
                Some(Slot::Human { pid, .. }) => self
                    .conns
                    .iter()
                    .filter(|(_, c)| c.pid.as_deref() == Some(pid))
                    .map(|(id, _)| *id)
                    .collect(),
                _ => Vec::new(),
            },
            Target::Spectators => self
                .conns
                .iter()
                .filter(|(_, c)| c.pid.as_deref().is_some_and(|p| self.seat_of(p).is_none()))
                .map(|(id, _)| *id)
                .collect(),
        }
    }

    // ---- connections -----------------------------------------------------

    /// A socket opened. It must `hello` before anything but `ping`.
    pub fn connect(&mut self, now: u64) -> ConnId {
        let id = self.next_conn;
        self.next_conn = self.next_conn.wrapping_add(1).max(1);
        self.conns.insert(id, Conn::default());
        self.last_activity = now;
        id
    }

    /// Register a connection id that the shell already knows (for example,
    /// a socket that survived hibernation but whose state was lost).
    pub fn adopt(&mut self, conn: ConnId) {
        self.conns.entry(conn).or_default();
        if conn >= self.next_conn {
            self.next_conn = conn.wrapping_add(1).max(1);
        }
    }

    pub fn disconnect(&mut self, conn: ConnId, now: u64) -> Vec<Outbound> {
        let Some(c) = self.conns.remove(&conn) else {
            return Vec::new();
        };
        let Some(pid) = c.pid else {
            return Vec::new();
        };
        if self.connected(&pid) {
            return Vec::new();
        }
        if let Some(p) = self.players.get_mut(&pid) {
            p.disconnected_at = Some(now);
        }
        if self.host_pid.as_deref() == Some(pid.as_str()) {
            self.host_gone_since = Some(now);
        }
        vec![self.lobby_msg()]
    }

    /// Drop every connection the shell no longer has a socket for.
    pub fn retain_conns(&mut self, live: &[ConnId], now: u64) -> Vec<Outbound> {
        let dead: Vec<ConnId> = self
            .conns
            .keys()
            .copied()
            .filter(|c| !live.contains(c))
            .collect();
        for c in live {
            self.adopt(*c);
        }
        let mut out = Vec::new();
        for c in dead {
            out.extend(self.disconnect(c, now));
        }
        dedupe_lobby(out)
    }

    // ---- client frames ---------------------------------------------------

    /// A raw text frame: size cap, rate limit, parse, then `handle`.
    pub fn on_text(&mut self, conn: ConnId, text: &str, now: u64) -> Vec<Outbound> {
        let Some(c) = self.conns.get_mut(&conn) else {
            return Vec::new();
        };
        if !c.bucket.take(now, RATE_BURST, RATE_PER_SEC) {
            // Drop it; say so at most once a second.
            if c.warned_at.is_none_or(|w| now >= w + 1000) {
                c.warned_at = Some(now);
                return vec![to_conn(
                    conn,
                    ServerMsg::error(ErrorCode::RateLimited, "slow down"),
                )];
            }
            return Vec::new();
        }
        if text.len() > MAX_MESSAGE_BYTES {
            return vec![to_conn(
                conn,
                ServerMsg::error(ErrorCode::TooLarge, "messages are capped at 16 KB"),
            )];
        }
        match serde_json::from_str::<ClientMsg>(text) {
            Ok(msg) => self.handle(conn, msg, now),
            Err(e) => vec![to_conn(
                conn,
                ServerMsg::error(ErrorCode::BadMessage, e.to_string()),
            )],
        }
    }

    /// A parsed message from `conn`.
    pub fn handle(&mut self, conn: ConnId, msg: ClientMsg, now: u64) -> Vec<Outbound> {
        if !self.conns.contains_key(&conn) {
            return Vec::new();
        }
        self.last_activity = now;
        let err = |code: ErrorCode, m: &str| vec![to_conn(conn, ServerMsg::error(code, m))];
        if let ClientMsg::Ping { ts } = msg {
            return vec![to_conn(conn, ServerMsg::Pong { ts })];
        }
        if let ClientMsg::Hello { pid, name, token } = msg {
            return self.hello(conn, pid, name, token, now);
        }
        let Some(pid) = self.conn_pid(conn) else {
            return err(ErrorCode::NoHello, "say hello first");
        };
        let is_host = self.host_pid.as_deref() == Some(pid.as_str());
        let lobby_only = |phase: RoomPhase| phase == RoomPhase::Lobby;
        match msg {
            ClientMsg::Ping { .. } | ClientMsg::Hello { .. } => unreachable!(),
            ClientMsg::Rename { name } => {
                let name = sanitize_name(&name);
                if name.is_empty() {
                    return err(ErrorCode::BadMessage, "names can't be empty");
                }
                if let Some(p) = self.players.get_mut(&pid) {
                    p.name = name;
                }
                vec![self.lobby_msg()]
            }
            ClientMsg::Sit { seat } => {
                if !lobby_only(self.phase) {
                    return err(ErrorCode::WrongPhase, "seats are locked during a game");
                }
                let s = seat as usize;
                if s >= MAX_SEATS || self.seats[s] != Slot::Empty {
                    return err(ErrorCode::BadSeat, "that seat isn't free");
                }
                if let Some(old) = self.seat_of(&pid) {
                    self.seats[old as usize] = Slot::Empty;
                }
                self.seats[s] = Slot::Human {
                    pid,
                    autopilot: false,
                };
                vec![self.lobby_msg()]
            }
            ClientMsg::Stand => {
                if !lobby_only(self.phase) {
                    return err(ErrorCode::WrongPhase, "seats are locked during a game");
                }
                let Some(old) = self.seat_of(&pid) else {
                    return err(ErrorCode::BadSeat, "you aren't seated");
                };
                self.seats[old as usize] = Slot::Empty;
                vec![self.lobby_msg()]
            }
            ClientMsg::Configure { preset, config } => {
                if !is_host {
                    return err(ErrorCode::NotHost, "only the host can change the game");
                }
                if self.phase == RoomPhase::Playing {
                    return err(ErrorCode::WrongPhase, "the game is already running");
                }
                if preset != "custom" && !GameConfig::PRESETS.contains(&preset.as_str()) {
                    return err(ErrorCode::BadConfig, "unknown preset");
                }
                if let Err(e) = config.validate() {
                    return err(ErrorCode::BadConfig, &e.0);
                }
                self.preset = preset;
                self.config = config;
                if self.phase == RoomPhase::Over {
                    self.phase = RoomPhase::Lobby;
                    self.game = None;
                    self.clear_timers();
                }
                vec![self.lobby_msg()]
            }
            ClientMsg::SetBot { seat, level } => {
                if !is_host {
                    return err(ErrorCode::NotHost, "only the host can seat bots");
                }
                if !lobby_only(self.phase) {
                    return err(ErrorCode::WrongPhase, "seats are locked during a game");
                }
                let s = seat as usize;
                if s >= MAX_SEATS || matches!(self.seats[s], Slot::Human { .. }) {
                    return err(ErrorCode::BadSeat, "that seat isn't free");
                }
                self.seats[s] = match level {
                    Some(level) => Slot::Bot { level },
                    None => Slot::Empty,
                };
                vec![self.lobby_msg()]
            }
            ClientMsg::Kick { seat } => {
                if !is_host {
                    return err(ErrorCode::NotHost, "only the host can kick");
                }
                let s = seat as usize;
                if s >= MAX_SEATS || self.seats[s] == Slot::Empty {
                    return err(ErrorCode::BadSeat, "nobody is there");
                }
                match self.phase {
                    RoomPhase::Lobby => {
                        self.seats[s] = Slot::Empty;
                        vec![self.lobby_msg()]
                    }
                    _ => {
                        if self.seat_of(&pid) == Some(seat) {
                            return err(ErrorCode::BadSeat, "resign instead");
                        }
                        if !matches!(self.seats[s], Slot::Human { .. }) {
                            return err(ErrorCode::BadSeat, "that's already a bot");
                        }
                        self.seats[s] = Slot::Bot {
                            level: Level::Flare,
                        };
                        let mut out = vec![self.lobby_msg()];
                        if self.phase == RoomPhase::Playing {
                            // The kicked player is a spectator now.
                            out.push(self.spectator_view());
                            out.extend(self.schedule(now, false));
                        }
                        out
                    }
                }
            }
            ClientMsg::Start => {
                if !is_host {
                    return err(ErrorCode::NotHost, "only the host can start");
                }
                if !lobby_only(self.phase) {
                    return err(ErrorCode::WrongPhase, "already started");
                }
                self.start(conn, now)
            }
            ClientMsg::Rematch => {
                if !is_host {
                    return err(ErrorCode::NotHost, "only the host can call a rematch");
                }
                if self.phase != RoomPhase::Over {
                    return err(ErrorCode::WrongPhase, "finish this one first");
                }
                let Some(cfg) = self.game().map(|g| g.data.config.clone()) else {
                    return err(ErrorCode::WrongPhase, "no game to rematch");
                };
                for s in self.seats.iter_mut() {
                    if let Slot::Human { autopilot, .. } = s {
                        *autopilot = false;
                    }
                }
                self.begin(cfg, conn, now)
            }
            ClientMsg::Action { action, ply } => self.play(conn, &pid, action, ply, now),
            ClientMsg::Chat { text } => {
                let text = sanitize_text(&text, MAX_CHAT_CHARS);
                if text.is_empty() {
                    return Vec::new();
                }
                let seat = self.seat_of(&pid);
                let Some(p) = self.players.get_mut(&pid) else {
                    return Vec::new();
                };
                if !p.chat.take(now, CHAT_BURST, CHAT_PER_SEC) {
                    return err(ErrorCode::RateLimited, "chat is cooling down");
                }
                let line = ChatLine {
                    name: p.name.clone(),
                    seat,
                    text,
                    at: now,
                };
                self.chat.push_back(line.clone());
                while self.chat.len() > CHAT_HISTORY {
                    self.chat.pop_front();
                }
                vec![Outbound {
                    to: Target::All,
                    msg: chat_msg(&line),
                }]
            }
            ClientMsg::Emote { kind } => {
                let seat = self.seat_of(&pid);
                let Some(p) = self.players.get_mut(&pid) else {
                    return Vec::new();
                };
                if !p.emote.take(now, EMOTE_BURST, EMOTE_PER_SEC) {
                    return Vec::new();
                }
                vec![Outbound {
                    to: Target::All,
                    msg: ServerMsg::Emote {
                        name: p.name.clone(),
                        seat,
                        kind,
                    },
                }]
            }
        }
    }

    fn hello(
        &mut self,
        conn: ConnId,
        pid: String,
        name: String,
        token: Option<String>,
        now: u64,
    ) -> Vec<Outbound> {
        let err = |code: ErrorCode, m: &str| vec![to_conn(conn, ServerMsg::error(code, m))];
        if !valid_pid(&pid) {
            return err(
                ErrorCode::BadMessage,
                "pid must be 8 to 64 of [A-Za-z0-9_-]",
            );
        }
        if let Some(existing) = self.conn_pid(conn) {
            if existing != pid {
                return err(ErrorCode::BadMessage, "this connection already said hello");
            }
        }
        let mut name = sanitize_name(&name);
        if name.is_empty() {
            name = "Guest".into();
        }
        let token = match self.players.get_mut(&pid) {
            Some(p) => {
                if token.as_deref() != Some(p.token.as_str()) {
                    return err(
                        ErrorCode::BadToken,
                        "that player id belongs to someone else",
                    );
                }
                p.name = name;
                p.disconnected_at = None;
                p.token.clone()
            }
            None => {
                if self.players.len() >= MAX_PLAYERS && !self.evict_one() {
                    return err(ErrorCode::BadSeat, "this room is full");
                }
                let token = self.new_token();
                let joined = self.next_join;
                self.next_join += 1;
                self.players.insert(
                    pid.clone(),
                    Player {
                        name,
                        token: token.clone(),
                        joined,
                        disconnected_at: None,
                        chat: Bucket::default(),
                        emote: Bucket::default(),
                    },
                );
                token
            }
        };
        if let Some(c) = self.conns.get_mut(&conn) {
            c.pid = Some(pid.clone());
        }
        if self.host_pid.is_none() {
            self.host_pid = Some(pid.clone());
        }
        if self.host_pid.as_deref() == Some(pid.as_str()) {
            self.host_gone_since = None;
        }
        // Back from a disconnect: take the seat back from autopilot.
        if let Some(s) = self.seat_of(&pid) {
            if let Slot::Human { autopilot, .. } = &mut self.seats[s as usize] {
                *autopilot = false;
            }
        }
        let mut out = vec![to_conn(
            conn,
            ServerMsg::Welcome {
                pid: pid.clone(),
                token,
                host: self.host_pid.as_deref() == Some(pid.as_str()),
            },
        )];
        out.extend(self.migrate_host(now));
        out.push(self.lobby_msg());
        for line in &self.chat {
            out.push(to_conn(conn, chat_msg(line)));
        }
        if let Some(g) = self.game() {
            let seat = self.seat_of(&pid).map(|s| s as usize);
            out.push(to_conn(conn, view_msg(g.view(seat))));
        }
        out.extend(self.schedule(now, false));
        if let (Some(ends), Some((_, seat))) = (self.turn_deadline, self.clock_key) {
            out.push(to_conn(
                conn,
                ServerMsg::Clock {
                    seat,
                    ends_at: Some(ends),
                },
            ));
        }
        dedupe_lobby(out)
    }

    /// Forget the oldest player who is neither connected nor seated.
    fn evict_one(&mut self) -> bool {
        let victim = self
            .players
            .iter()
            .filter(|(pid, _)| {
                !self.connected(pid)
                    && self.seat_of(pid).is_none()
                    && self.host_pid.as_deref() != Some(pid.as_str())
            })
            .min_by_key(|(_, p)| p.joined)
            .map(|(pid, _)| pid.clone());
        match victim {
            Some(pid) => {
                self.players.remove(&pid);
                true
            }
            None => false,
        }
    }

    // ---- the game ----------------------------------------------------------

    fn start(&mut self, conn: ConnId, now: u64) -> Vec<Outbound> {
        let err = |code: ErrorCode, m: String| vec![to_conn(conn, ServerMsg::error(code, m))];
        let filled: Vec<Slot> = self
            .seats
            .iter()
            .filter(|s| **s != Slot::Empty)
            .cloned()
            .collect();
        let n = filled.len() as u8;
        if n < 2 {
            return err(
                ErrorCode::NotEnoughPlayers,
                "you need at least two players (bots count)".into(),
            );
        }
        let cfg = match self.config_for(n) {
            Ok(c) => c,
            Err(m) => return err(ErrorCode::BadConfig, m),
        };
        let mut seats = filled;
        seats.resize(MAX_SEATS, Slot::Empty);
        self.seats = seats;
        self.begin(cfg, conn, now)
    }

    /// The engine config for `n` filled seats. An untouched preset is
    /// re-derived for the real seat count (a 2-player Plane is 14x14).
    fn config_for(&self, n: u8) -> Result<GameConfig, String> {
        let mut cfg = self.config.clone();
        if self.preset != "custom" {
            let fitted =
                GameConfig::preset(&self.preset, n).ok_or_else(|| "unknown preset".to_string())?;
            if fitted.seats != n {
                return Err(format!(
                    "{} is for exactly {} players",
                    self.preset, fitted.seats
                ));
            }
            let mut as_preset = GameConfig::preset(&self.preset, cfg.seats)
                .ok_or_else(|| "unknown preset".to_string())?;
            as_preset.turn_seconds = cfg.turn_seconds;
            if as_preset == cfg {
                cfg = GameConfig {
                    turn_seconds: cfg.turn_seconds,
                    ..fitted
                };
            }
        }
        cfg.seats = n;
        cfg.validate().map_err(|e| e.0)?;
        Ok(cfg)
    }

    fn begin(&mut self, cfg: GameConfig, conn: ConnId, now: u64) -> Vec<Outbound> {
        let seed = self.rand();
        let game = match Game::new(cfg, seed) {
            Ok(g) => g,
            Err(e) => {
                return vec![to_conn(
                    conn,
                    ServerMsg::error(ErrorCode::BadConfig, e.to_string()),
                )]
            }
        };
        self.game = Some(LiveGame(game));
        self.phase = RoomPhase::Playing;
        self.clear_timers();
        let mut out = vec![self.lobby_msg()];
        out.extend(self.broadcast_views());
        out.extend(self.schedule(now, false));
        out
    }

    fn clear_timers(&mut self) {
        self.bot_due = None;
        self.bot_key = None;
        self.turn_deadline = None;
        self.clock_key = None;
    }

    fn play(
        &mut self,
        conn: ConnId,
        pid: &str,
        action: Action,
        ply: u32,
        now: u64,
    ) -> Vec<Outbound> {
        let err = |code: ErrorCode, m: &str| vec![to_conn(conn, ServerMsg::error(code, m))];
        if self.phase != RoomPhase::Playing {
            return err(ErrorCode::WrongPhase, "no game is running");
        }
        let Some(seat) = self.seat_of(pid) else {
            return err(ErrorCode::BadSeat, "spectators can't play");
        };
        let st = self.game().expect("playing has a game").state();
        if action != Action::Resign && (st.turn != seat || st.ply != ply) {
            return err(ErrorCode::Stale, "that move is out of date");
        }
        match self.apply(seat, action, now) {
            Ok(out) => out,
            Err(m) => err(ErrorCode::Illegal, &m),
        }
    }

    /// Apply an action for `seat`, then broadcast and reschedule.
    fn apply(&mut self, seat: u8, action: Action, now: u64) -> Result<Vec<Outbound>, String> {
        let g = &mut self.game.as_mut().ok_or("no game")?.0;
        let key = (g.state().ply, g.state().turn);
        g.apply(seat as usize, action).map_err(|e| e.to_string())?;
        let over = g.state().phase == Phase::Over;
        let same_turn = (g.state().ply, g.state().turn) == key;
        let mut out = self.broadcast_views();
        if over {
            self.phase = RoomPhase::Over;
            if let Some((_, s)) = self.clock_key {
                out.push(Outbound {
                    to: Target::All,
                    msg: ServerMsg::Clock {
                        seat: s,
                        ends_at: None,
                    },
                });
            }
            self.clear_timers();
            out.push(self.lobby_msg());
        } else {
            out.extend(self.schedule(now, same_turn));
        }
        Ok(out)
    }

    fn broadcast_views(&self) -> Vec<Outbound> {
        let Some(g) = self.game() else {
            return Vec::new();
        };
        let n = g.data.config.seats as usize;
        let mut out = Vec::new();
        for s in 0..n {
            if matches!(self.seats[s], Slot::Human { .. }) {
                out.push(Outbound {
                    to: Target::Seat(s as u8),
                    msg: view_msg(g.view(Some(s))),
                });
            }
        }
        out.push(self.spectator_view());
        out
    }

    fn spectator_view(&self) -> Outbound {
        let g = self.game().expect("game for spectator view");
        Outbound {
            to: Target::Spectators,
            msg: view_msg(g.view(None)),
        }
    }

    fn controller(&self, seat: u8) -> Controller {
        match &self.seats[seat as usize] {
            Slot::Bot { level } => Controller::Bot(*level),
            Slot::Human {
                autopilot: true, ..
            } => Controller::Bot(Level::Flare),
            _ => Controller::Human,
        }
    }

    /// Work out who acts next and when: bot timers and the turn clock.
    fn schedule(&mut self, now: u64, followup: bool) -> Vec<Outbound> {
        let mut out = Vec::new();
        if self.phase != RoomPhase::Playing {
            self.clear_timers();
            return out;
        }
        let Some(g) = self.game() else {
            return out;
        };
        let (ply, turn) = (g.state().ply, g.state().turn);
        let turn_seconds = g.data.config.turn_seconds;
        match self.controller(turn) {
            Controller::Bot(_) => {
                if self.turn_deadline.take().is_some() {
                    self.clock_key = None;
                    out.push(Outbound {
                        to: Target::All,
                        msg: ServerMsg::Clock {
                            seat: turn,
                            ends_at: None,
                        },
                    });
                }
                if self.bot_due.is_none() {
                    let delay = if followup && self.bot_key == Some((ply, turn)) {
                        BOT_FOLLOWUP_MS
                    } else {
                        BOT_DELAY_MIN_MS + self.rand() % (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS + 1)
                    };
                    self.bot_due = Some(now + delay);
                }
            }
            Controller::Human => {
                self.bot_due = None;
                match turn_seconds {
                    Some(secs) if self.clock_key != Some((ply, turn)) => {
                        let ends = now + secs as u64 * 1000;
                        self.clock_key = Some((ply, turn));
                        self.turn_deadline = Some(ends);
                        out.push(Outbound {
                            to: Target::All,
                            msg: ServerMsg::Clock {
                                seat: turn,
                                ends_at: Some(ends),
                            },
                        });
                    }
                    Some(_) => {}
                    None => {
                        self.turn_deadline = None;
                        self.clock_key = None;
                    }
                }
            }
        }
        out
    }

    /// Choose and apply one action for the seat on turn, as `level`.
    fn act_for_turn(&mut self, level: Level, now: u64, thinker: &Thinker) -> Vec<Outbound> {
        let seed = self.rand();
        let Some(g) = self.game() else {
            return Vec::new();
        };
        let seat = g.state().turn;
        let budget = if level == Level::Nova {
            thinker.nova_budget_ms
        } else {
            0.0
        };
        let est = playout_cost_ms(&g.data.config);
        let t0 = (thinker.clock)();
        let reads = std::cell::Cell::new(0u32);
        let synthetic = || {
            reads.set(reads.get() + 1);
            ((thinker.clock)() - t0).max(reads.get() as f64 * est)
        };
        let clock: &dyn Fn() -> f64 = if thinker.frozen_clock {
            &synthetic
        } else {
            thinker.clock
        };
        let action = g
            .bot_action(seat as usize, level, seed, budget, clock)
            .unwrap_or(Action::Resign);
        self.bot_key = Some((g.state().ply, seat));
        match self.apply(seat, action, now) {
            Ok(out) => out,
            // Should never happen; resigning keeps the game from stalling.
            Err(_) => self.apply(seat, Action::Resign, now).unwrap_or_default(),
        }
    }

    // ---- time --------------------------------------------------------------

    /// Advance the clock: bots move, turn clocks expire, autopilot engages,
    /// the host migrates. Call when `next_deadline` has passed.
    pub fn tick(&mut self, now: u64, thinker: &Thinker) -> Vec<Outbound> {
        let mut out = Vec::new();
        out.extend(self.migrate_host(now));
        if self.phase == RoomPhase::Playing {
            // Autopilot for humans who have been gone past the grace period.
            let mut changed = false;
            for i in 0..self.seats.len() {
                let gone = match &self.seats[i] {
                    Slot::Human {
                        pid,
                        autopilot: false,
                    } => {
                        !self.connected(pid)
                            && self
                                .players
                                .get(pid)
                                .and_then(|p| p.disconnected_at)
                                .is_some_and(|t| now >= t + GRACE_MS)
                    }
                    _ => false,
                };
                if gone {
                    if let Slot::Human { autopilot, .. } = &mut self.seats[i] {
                        *autopilot = true;
                        changed = true;
                    }
                }
            }
            if changed {
                out.push(self.lobby_msg());
                out.extend(self.schedule(now, false));
            }
            if self.turn_deadline.is_some_and(|d| now >= d) {
                // Out of time: play a Flare turn for the seat on turn.
                let key = self.clock_key;
                for _ in 0..4 {
                    if self.phase != RoomPhase::Playing {
                        break;
                    }
                    let g = self.game().expect("game");
                    if Some((g.state().ply, g.state().turn)) != key {
                        break;
                    }
                    out.extend(self.act_for_turn(Level::Flare, now, thinker));
                }
                if self.clock_key == key {
                    // Still the same turn somehow: never re-fire in the past.
                    self.turn_deadline = None;
                }
            } else if self.bot_due.is_some_and(|d| now >= d) {
                self.bot_due = None;
                if let Some(g) = self.game() {
                    if let Controller::Bot(level) = self.controller(g.state().turn) {
                        out.extend(self.act_for_turn(level, now, thinker));
                    } else {
                        out.extend(self.schedule(now, false));
                    }
                }
            }
        }
        dedupe_lobby(out)
    }

    fn migrate_host(&mut self, now: u64) -> Vec<Outbound> {
        let Some(since) = self.host_gone_since else {
            return Vec::new();
        };
        if now < since + HOST_MIGRATE_MS {
            return Vec::new();
        }
        if self.host_pid.as_deref().is_some_and(|h| self.connected(h)) {
            self.host_gone_since = None;
            return Vec::new();
        }
        let Some(next) = self.host_candidate() else {
            return Vec::new();
        };
        self.host_pid = Some(next);
        self.host_gone_since = None;
        vec![self.lobby_msg()]
    }

    /// The next connected human: seated players in seat order, then others
    /// in the order they joined.
    fn host_candidate(&self) -> Option<String> {
        let current = self.host_pid.as_deref();
        for s in &self.seats {
            if let Slot::Human { pid, .. } = s {
                if Some(pid.as_str()) != current && self.connected(pid) {
                    return Some(pid.clone());
                }
            }
        }
        self.players
            .iter()
            .filter(|(pid, _)| Some(pid.as_str()) != current && self.connected(pid))
            .min_by_key(|(_, p)| p.joined)
            .map(|(pid, _)| pid.clone())
    }

    /// The next instant `tick` has work to do (epoch milliseconds).
    pub fn next_deadline(&self) -> Option<u64> {
        let mut d = vec![self.last_activity + IDLE_MS];
        if let Some(t) = self.bot_due {
            d.push(t);
        }
        if let Some(t) = self.turn_deadline {
            d.push(t);
        }
        if let Some(t) = self.host_gone_since {
            if self.host_candidate().is_some() {
                d.push(t + HOST_MIGRATE_MS);
            }
        }
        if self.phase == RoomPhase::Playing {
            for s in &self.seats {
                if let Slot::Human {
                    pid,
                    autopilot: false,
                } = s
                {
                    if !self.connected(pid) {
                        if let Some(t) = self.players.get(pid).and_then(|p| p.disconnected_at) {
                            d.push(t + GRACE_MS);
                        }
                    }
                }
            }
        }
        d.into_iter().min()
    }

    /// True once the room has been idle long enough to delete itself.
    pub fn is_expired(&self, now: u64) -> bool {
        now >= self.last_activity + IDLE_MS
    }

    fn lobby_msg(&self) -> Outbound {
        Outbound {
            to: Target::All,
            msg: ServerMsg::Lobby(self.lobby()),
        }
    }
}

fn to_conn(conn: ConnId, msg: ServerMsg) -> Outbound {
    Outbound {
        to: Target::Conn(conn),
        msg,
    }
}

fn view_msg(view: View) -> ServerMsg {
    ServerMsg::View {
        view: Box::new(view),
    }
}

fn chat_msg(line: &ChatLine) -> ServerMsg {
    ServerMsg::Chat {
        name: line.name.clone(),
        seat: line.seat,
        text: line.text.clone(),
        at: line.at,
    }
}

/// Keep only the last broadcast lobby in a batch; earlier ones are stale.
fn dedupe_lobby(out: Vec<Outbound>) -> Vec<Outbound> {
    let last = out
        .iter()
        .rposition(|o| o.to == Target::All && matches!(o.msg, ServerMsg::Lobby(_)));
    out.into_iter()
        .enumerate()
        .filter(|(i, o)| {
            !(o.to == Target::All && matches!(o.msg, ServerMsg::Lobby(_))) || Some(*i) == last
        })
        .map(|(_, o)| o)
        .collect()
}

#[cfg(test)]
#[path = "core_tests.rs"]
mod tests;
