use super::*;
use cubes_engine::game::{is_seat, F_VISIBLE};
use serde_json::{json, Value};
use std::time::Instant;

const T0: u64 = 1_800_000_000_000;

fn clock() -> f64 {
    thread_local!(static START: Instant = Instant::now());
    START.with(|s| s.elapsed().as_secs_f64() * 1000.0)
}

fn thinker() -> Thinker<'static> {
    Thinker {
        clock: &clock,
        nova_budget_ms: 15.0,
        frozen_clock: false,
    }
}

/// A room plus a fake clock and helpers to read what each connection got.
struct Room {
    core: RoomCore,
    now: u64,
    inbox: BTreeMap<ConnId, Vec<ServerMsg>>,
}

impl Room {
    fn new() -> Room {
        Room {
            core: RoomCore::new("ABCDE", T0, 42),
            now: T0,
            inbox: BTreeMap::new(),
        }
    }

    fn deliver(&mut self, out: Vec<Outbound>) {
        for o in out {
            for c in self.core.resolve(o.to) {
                self.inbox.entry(c).or_default().push(o.msg.clone());
            }
        }
    }

    fn connect(&mut self) -> ConnId {
        self.core.connect(self.now)
    }

    fn send(&mut self, conn: ConnId, v: Value) {
        let out = self.core.on_text(conn, &v.to_string(), self.now);
        self.deliver(out);
    }

    fn join(&mut self, pid: &str, name: &str) -> (ConnId, String) {
        let c = self.connect();
        self.send(c, json!({"t":"hello","pid":pid,"name":name}));
        let token = self
            .take(c)
            .into_iter()
            .find_map(|m| match m {
                ServerMsg::Welcome { token, .. } => Some(token),
                _ => None,
            })
            .expect("welcome");
        (c, token)
    }

    fn disconnect(&mut self, conn: ConnId) {
        let out = self.core.disconnect(conn, self.now);
        self.deliver(out);
    }

    fn take(&mut self, conn: ConnId) -> Vec<ServerMsg> {
        self.inbox.remove(&conn).unwrap_or_default()
    }

    fn errors(&mut self, conn: ConnId) -> Vec<ErrorCode> {
        self.take(conn)
            .into_iter()
            .filter_map(|m| match m {
                ServerMsg::Error { code, .. } => Some(code),
                _ => None,
            })
            .collect()
    }

    fn last_view(&mut self, conn: ConnId) -> Option<View> {
        self.take(conn).into_iter().rev().find_map(|m| match m {
            ServerMsg::View { view } => Some(*view),
            _ => None,
        })
    }

    fn advance(&mut self, ms: u64) {
        self.now += ms;
        let out = self.core.tick(self.now, &thinker());
        self.deliver(out);
    }

    /// Jump to the next deadline and tick, like the alarm would.
    fn wake(&mut self) {
        let d = self.core.next_deadline().expect("a deadline");
        assert!(d >= self.now, "deadline in the past: {d} < {}", self.now);
        self.now = d;
        let out = self.core.tick(self.now, &thinker());
        self.deliver(out);
        if let Some(n) = self.core.next_deadline() {
            assert!(n > self.now, "tick left a stale deadline");
        }
    }

    fn turn(&self) -> (u32, u8) {
        let st = self.core.game().unwrap().state();
        (st.ply, st.turn)
    }

    /// The largest legal placement for the seat on turn (with leap fallback).
    fn legal_move(&self) -> Action {
        let mut g = Game::from_data(self.core.game().unwrap().data.clone()).unwrap();
        let seat = g.state().turn as usize;
        for leap in [false, true] {
            if let Some(p) = g
                .legal(seat, leap)
                .into_iter()
                .max_by_key(|p| p.cells.len())
            {
                return Action::Place {
                    piece: p.piece,
                    orient: p.orient,
                    at: p.at,
                    leap,
                };
            }
        }
        Action::Resign
    }

    fn lobby(&self) -> Lobby {
        self.core.lobby()
    }
}

fn plane_with_bots(room: &mut Room, host: ConnId, bots: &[(u8, &str)]) {
    for (seat, level) in bots {
        room.send(host, json!({"t":"setBot","seat":seat,"level":level}));
    }
}

#[test]
fn first_hello_becomes_host_and_gets_a_token() {
    let mut r = Room::new();
    let a = r.connect();
    r.send(
        a,
        json!({"t":"hello","pid":"alice-0001","name":"  Alice\u{0007} "}),
    );
    let msgs = r.take(a);
    let ServerMsg::Welcome { pid, token, host } = &msgs[0] else {
        panic!("expected welcome first, got {msgs:?}");
    };
    assert_eq!(pid, "alice-0001");
    assert_eq!(token.len(), 32);
    assert!(*host);
    let lobby = msgs
        .iter()
        .find_map(|m| match m {
            ServerMsg::Lobby(l) => Some(l.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(lobby.code, "ABCDE");
    assert_eq!(lobby.host_pid.as_deref(), Some("alice-0001"));
    assert_eq!(lobby.seats.len(), 4);
    assert_eq!(lobby.spectators[0].name, "Alice");

    let (b, _) = r.join("bob-000001", "Bob");
    assert!(r.take(b).is_empty());
    assert_eq!(r.core.host_pid(), Some("alice-0001"));
    // Tokens differ per player.
    let (_, t2) = r.join("carol-0001", "Carol");
    assert_ne!(&t2, token);
}

#[test]
fn messages_before_hello_are_refused_except_ping() {
    let mut r = Room::new();
    let a = r.connect();
    r.send(a, json!({"t":"sit","seat":0}));
    assert_eq!(r.errors(a), vec![ErrorCode::NoHello]);
    r.send(a, json!({"t":"ping","ts":12.5}));
    assert_eq!(r.take(a), vec![ServerMsg::Pong { ts: 12.5 }]);
    r.send(a, json!({"t":"hello","pid":"bad id!","name":"x"}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadMessage]);
}

#[test]
fn token_reclaims_a_seat_and_a_wrong_token_cannot_hijack() {
    let mut r = Room::new();
    let (a, token) = r.join("alice-0001", "Alice");
    r.send(a, json!({"t":"sit","seat":2}));
    r.disconnect(a);
    let lobby = r.lobby();
    assert_eq!(lobby.seats[2].kind, SeatKind::Human);
    assert!(!lobby.seats[2].connected);

    // No token: rejected.
    let x = r.connect();
    r.send(x, json!({"t":"hello","pid":"alice-0001","name":"Mallory"}));
    assert_eq!(r.errors(x), vec![ErrorCode::BadToken]);
    // Wrong token: rejected, and the name did not change.
    r.send(
        x,
        json!({"t":"hello","pid":"alice-0001","name":"Mallory","token":"0".repeat(32)}),
    );
    assert_eq!(r.errors(x), vec![ErrorCode::BadToken]);
    assert_eq!(r.lobby().seats[2].name, "Alice");
    // The impostor's socket still can't act.
    r.send(x, json!({"t":"stand"}));
    assert_eq!(r.errors(x), vec![ErrorCode::NoHello]);

    // The right token reclaims the seat.
    let a2 = r.connect();
    r.send(
        a2,
        json!({"t":"hello","pid":"alice-0001","name":"Alice","token":token}),
    );
    let msgs = r.take(a2);
    assert!(matches!(&msgs[0], ServerMsg::Welcome { token: t, host: true, .. } if *t == token));
    let lobby = r.lobby();
    assert!(lobby.seats[2].connected);
    assert_eq!(lobby.seats[2].pid.as_deref(), Some("alice-0001"));
}

#[test]
fn seats_sit_stand_and_move() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    r.send(a, json!({"t":"sit","seat":0}));
    r.send(b, json!({"t":"sit","seat":0}));
    assert_eq!(r.errors(b), vec![ErrorCode::BadSeat]);
    r.send(b, json!({"t":"sit","seat":4}));
    assert_eq!(r.errors(b), vec![ErrorCode::BadSeat]);
    r.send(b, json!({"t":"sit","seat":1}));
    r.send(b, json!({"t":"sit","seat":3}));
    let l = r.lobby();
    assert_eq!(l.seats[1].kind, SeatKind::Empty);
    assert_eq!(l.seats[3].name, "Bob");
    assert!(l.spectators.is_empty());
    r.send(b, json!({"t":"stand"}));
    let l = r.lobby();
    assert_eq!(l.seats[3].kind, SeatKind::Empty);
    assert_eq!(l.spectators[0].name, "Bob");
    r.send(b, json!({"t":"rename","name":"  Robert   the\tBold  "}));
    assert_eq!(r.lobby().spectators[0].name, "Robert the Bold");
}

#[test]
fn only_the_host_runs_the_lobby() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    r.take(a);
    for m in [
        json!({"t":"setBot","seat":1,"level":"ember"}),
        json!({"t":"kick","seat":0}),
        json!({"t":"start"}),
        json!({"t":"rematch"}),
        json!({"t":"configure","preset":"duel","config":GameConfig::preset("duel",2).unwrap()}),
    ] {
        r.send(b, m);
        assert_eq!(r.errors(b), vec![ErrorCode::NotHost]);
    }
    // The host can seat a bot, but not over a human.
    r.send(b, json!({"t":"sit","seat":1}));
    r.send(a, json!({"t":"setBot","seat":1,"level":"nova"}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadSeat]);
    r.send(a, json!({"t":"setBot","seat":2,"level":"nova"}));
    assert_eq!(r.lobby().seats[2].level, Some(Level::Nova));
    r.send(a, json!({"t":"setBot","seat":2,"level":null}));
    assert_eq!(r.lobby().seats[2].kind, SeatKind::Empty);
    // Kicking in the lobby empties the seat; the player stays as a spectator.
    r.send(a, json!({"t":"kick","seat":1}));
    let l = r.lobby();
    assert_eq!(l.seats[1].kind, SeatKind::Empty);
    assert_eq!(l.spectators.len(), 2);
}

#[test]
fn configure_is_validated() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.take(a);
    let mut cfg = GameConfig::preset("fog", 2).unwrap();
    r.send(a, json!({"t":"configure","preset":"nonsense","config":cfg}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadConfig]);
    cfg.fog = Some(9);
    r.send(a, json!({"t":"configure","preset":"custom","config":cfg}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadConfig]);
    cfg.fog = Some(2);
    cfg.turn_seconds = Some(1);
    r.send(a, json!({"t":"configure","preset":"custom","config":cfg}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadConfig]);
    // A malformed config is a bad message, not a crash.
    r.send(
        a,
        json!({"t":"configure","preset":"plane","config":{"dims":[1]}}),
    );
    assert_eq!(r.errors(a), vec![ErrorCode::BadMessage]);
    cfg.turn_seconds = Some(30);
    r.send(a, json!({"t":"configure","preset":"custom","config":cfg}));
    assert!(r.errors(a).is_empty());
    let l = r.lobby();
    assert_eq!(l.preset, "custom");
    assert_eq!(l.config.turn_seconds, Some(30));
}

#[test]
fn start_needs_two_seats_and_compacts_them() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.send(a, json!({"t":"sit","seat":3}));
    r.take(a);
    r.send(a, json!({"t":"start"}));
    assert_eq!(r.errors(a), vec![ErrorCode::NotEnoughPlayers]);
    plane_with_bots(&mut r, a, &[(1, "ember")]);
    r.send(a, json!({"t":"start"}));
    assert_eq!(r.core.phase(), RoomPhase::Playing);
    let l = r.lobby();
    assert_eq!(l.seats[0].kind, SeatKind::Bot);
    assert_eq!(l.seats[1].name, "Alice");
    assert_eq!(l.seats[2].kind, SeatKind::Empty);
    let g = r.core.game().unwrap();
    assert_eq!(g.data.config.seats, 2);
    // An untouched 4-seat Plane preset is re-derived for two: 14x14.
    assert_eq!(g.data.config.dims, [14, 14, 1]);
    let v = r.last_view(a).expect("seated player gets a view");
    assert_eq!(v.seat, Some(1));
    // Seats are locked once playing.
    r.send(a, json!({"t":"stand"}));
    assert_eq!(r.errors(a), vec![ErrorCode::WrongPhase]);
}

#[test]
fn fixed_size_presets_need_the_right_seat_count() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.send(
        a,
        json!({"t":"configure","preset":"duel","config":GameConfig::preset("duel",2).unwrap()}),
    );
    plane_with_bots(&mut r, a, &[(0, "ember"), (1, "ember"), (2, "ember")]);
    r.take(a);
    r.send(a, json!({"t":"start"}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadConfig]);
    r.send(
        a,
        json!({"t":"configure","preset":"teams","config":GameConfig::preset("teams",4).unwrap()}),
    );
    r.send(a, json!({"t":"start"}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadConfig]);
    r.send(a, json!({"t":"setBot","seat":3,"level":"ember"}));
    r.send(a, json!({"t":"start"}));
    assert!(r.errors(a).is_empty());
    assert!(r.core.game().unwrap().data.config.teams);
}

#[test]
fn a_bot_game_runs_to_completion_by_ticking_time() {
    let mut r = Room::new();
    let (host, _) = r.join("alice-0001", "Alice");
    plane_with_bots(&mut r, host, &[(0, "flare"), (1, "ember"), (2, "nova")]);
    r.send(host, json!({"t":"start"}));
    r.take(host);
    let mut views = 0;
    let mut wakes = 0;
    let mut last_ply = 0;
    while r.core.phase() == RoomPhase::Playing {
        let before = r.now;
        r.wake();
        wakes += 1;
        // Bots wait a natural beat (or a short follow-up within a turn).
        assert!(r.now - before >= BOT_FOLLOWUP_MS, "bot moved too fast");
        assert!(r.now - before <= BOT_DELAY_MAX_MS);
        let msgs = r.take(host);
        views += msgs
            .iter()
            .filter(|m| matches!(m, ServerMsg::View { .. }))
            .count();
        let ply = r.turn().0;
        assert!(ply >= last_ply);
        last_ply = ply;
        assert!(wakes < 2000, "game did not finish");
    }
    assert_eq!(r.core.phase(), RoomPhase::Over);
    assert!(views >= wakes, "spectator saw every action");
    let g = r.core.game().unwrap();
    let v = g.view(None);
    let scores = v.scores.expect("final scores");
    assert_eq!(scores.len(), 3);
    assert!(scores.iter().any(|&s| s > 0));
    assert!(v.winners.is_some());
    assert_eq!(r.lobby().phase, RoomPhase::Over);
    // Nothing left to do but the idle timer.
    assert_eq!(r.core.next_deadline(), Some(r.core.last_activity + IDLE_MS));
}

#[test]
fn humans_play_with_ply_checks() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    let (s, _) = r.join("sam-000001", "Sam");
    r.send(a, json!({"t":"sit","seat":0}));
    r.send(b, json!({"t":"sit","seat":1}));
    r.send(
        a,
        json!({"t":"configure","preset":"duel","config":GameConfig::preset("duel",2).unwrap()}),
    );
    r.send(a, json!({"t":"start"}));
    for c in [a, b, s] {
        r.take(c);
    }
    let mv = r.legal_move();
    // Wrong seat.
    r.send(b, json!({"t":"action","action":mv,"ply":0}));
    assert_eq!(r.errors(b), vec![ErrorCode::Stale]);
    // Spectators can't play.
    r.send(s, json!({"t":"action","action":mv,"ply":0}));
    assert_eq!(r.errors(s), vec![ErrorCode::BadSeat]);
    // Stale ply.
    r.send(a, json!({"t":"action","action":mv,"ply":7}));
    assert_eq!(r.errors(a), vec![ErrorCode::Stale]);
    // Illegal placement.
    let bad = json!({"type":"place","piece":0,"orient":0,"at":[0,0,0],"leap":false});
    r.send(a, json!({"t":"action","action":bad,"ply":0}));
    assert_eq!(r.errors(a), vec![ErrorCode::Illegal]);
    // A real move.
    r.send(a, json!({"t":"action","action":mv,"ply":0}));
    assert!(r.errors(a).is_empty());
    assert_eq!(r.turn(), (1, 1));
    // Replaying the same ply is stale now.
    r.send(a, json!({"t":"action","action":mv,"ply":0}));
    assert_eq!(r.errors(a), vec![ErrorCode::Stale]);
    let vb = r.last_view(b).unwrap();
    assert_eq!(vb.seat, Some(1));
    assert_eq!(vb.ply, 1);
    let vs = r.last_view(s).unwrap();
    assert_eq!(vs.seat, None);

    // Play it out with both humans.
    let mut guard = 0;
    while r.core.phase() == RoomPhase::Playing {
        let (ply, turn) = r.turn();
        r.now += 100;
        let conn = if turn == 0 { a } else { b };
        let mv = r.legal_move();
        r.send(conn, json!({"t":"action","action":mv,"ply":ply}));
        assert!(r.errors(conn).is_empty());
        guard += 1;
        assert!(guard < 500);
    }
    let v = r.last_view(s).unwrap();
    assert_eq!(v.phase, Phase::Over);
    assert!(v.scores.is_some());

    // Rematch: same seats, new seed, back to playing.
    let seed = r.core.game().unwrap().data.seed;
    r.send(b, json!({"t":"rematch"}));
    assert_eq!(r.errors(b), vec![ErrorCode::NotHost]);
    r.send(a, json!({"t":"rematch"}));
    assert_eq!(r.core.phase(), RoomPhase::Playing);
    let g = r.core.game().unwrap();
    assert_ne!(g.data.seed, seed);
    assert_eq!(g.state().ply, 0);
    assert_eq!(r.lobby().seats[1].name, "Bob");
    assert_eq!(r.last_view(b).unwrap().ply, 0);
}

#[test]
fn turn_timer_expiry_plays_a_flare_move() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    r.send(a, json!({"t":"sit","seat":0}));
    r.send(b, json!({"t":"sit","seat":1}));
    let mut cfg = GameConfig::preset("duel", 2).unwrap();
    cfg.turn_seconds = Some(10);
    r.send(a, json!({"t":"configure","preset":"duel","config":cfg}));
    r.send(a, json!({"t":"start"}));
    let clock = r.take(b).into_iter().find_map(|m| match m {
        ServerMsg::Clock { seat, ends_at } => Some((seat, ends_at)),
        _ => None,
    });
    assert_eq!(clock, Some((0, Some(T0 + 10_000))));
    assert_eq!(r.core.next_deadline(), Some(T0 + 10_000));
    r.advance(9_999);
    assert_eq!(r.turn(), (0, 0));
    r.advance(1);
    // The server moved for seat 0; seat 1's clock starts now.
    assert_eq!(r.turn().1, 1);
    let msgs = r.take(b);
    assert!(msgs.iter().any(|m| matches!(m, ServerMsg::View { .. })));
    assert!(msgs
        .iter()
        .any(|m| matches!(m, ServerMsg::Clock { seat: 1, ends_at: Some(e) } if *e == T0 + 20_000)));
    // Seat 1 moves in time; the clock passes back.
    r.advance(3_000);
    let (ply, _) = r.turn();
    let mv = r.legal_move();
    r.send(b, json!({"t":"action","action":mv,"ply":ply}));
    assert_eq!(r.turn().1, 0);
    assert_eq!(r.core.next_deadline(), Some(r.now + 10_000));
}

#[test]
fn autopilot_takes_over_after_the_grace_period_and_hands_back() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, tb) = r.join("bob-000001", "Bob");
    r.send(a, json!({"t":"sit","seat":0}));
    r.send(b, json!({"t":"sit","seat":1}));
    r.send(
        a,
        json!({"t":"configure","preset":"duel","config":GameConfig::preset("duel",2).unwrap()}),
    );
    r.send(a, json!({"t":"start"}));
    // Alice moves, then Bob drops.
    let mv = r.legal_move();
    r.send(a, json!({"t":"action","action":mv,"ply":0}));
    r.disconnect(b);
    let l = r.lobby();
    assert!(!l.seats[1].connected);
    assert_eq!(l.seats[1].autopilot, None);
    assert_eq!(r.core.next_deadline(), Some(r.now + GRACE_MS));
    r.advance(GRACE_MS - 1);
    assert_eq!(r.turn(), (1, 1));
    r.advance(1);
    assert_eq!(r.lobby().seats[1].autopilot, Some(true));
    // Autopilot moves after a natural delay.
    r.wake();
    assert_eq!(r.turn(), (2, 0));
    // Alice moves; autopilot answers again.
    let mv = r.legal_move();
    r.send(a, json!({"t":"action","action":mv,"ply":2}));
    assert!(r.core.bot_due.is_some());
    // Bob comes back before it fires: the seat is his again.
    let b2 = r.connect();
    r.send(
        b2,
        json!({"t":"hello","pid":"bob-000001","name":"Bob","token":tb}),
    );
    assert!(r.core.bot_due.is_none());
    assert_eq!(r.lobby().seats[1].autopilot, None);
    assert!(r.lobby().seats[1].connected);
    let v = r.last_view(b2).expect("rejoin gets the current view");
    assert_eq!(v.seat, Some(1));
    assert_eq!(v.ply, 3);
    let mv = r.legal_move();
    r.send(b2, json!({"t":"action","action":mv,"ply":3}));
    assert!(r.errors(b2).is_empty());
    assert_eq!(r.turn(), (4, 0));
}

#[test]
fn kicking_mid_game_hands_the_seat_to_a_bot() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    r.send(a, json!({"t":"sit","seat":0}));
    r.send(b, json!({"t":"sit","seat":1}));
    r.send(a, json!({"t":"start"}));
    let mv = r.legal_move();
    r.send(a, json!({"t":"action","action":mv,"ply":0}));
    r.send(a, json!({"t":"kick","seat":0}));
    assert_eq!(r.errors(a), vec![ErrorCode::BadSeat]);
    r.take(b);
    r.send(a, json!({"t":"kick","seat":1}));
    let l = r.lobby();
    assert_eq!(l.seats[1].kind, SeatKind::Bot);
    assert_eq!(l.spectators[0].name, "Bob");
    assert_eq!(r.last_view(b).unwrap().seat, None);
    r.wake();
    assert_eq!(r.turn(), (2, 0));
}

#[test]
fn fog_spectators_and_opponents_get_redacted_views() {
    let mut r = Room::new();
    let (host, _) = r.join("alice-0001", "Alice");
    let (s, _) = r.join("sam-000001", "Sam");
    r.send(host, json!({"t":"sit","seat":0}));
    r.send(
        host,
        json!({"t":"configure","preset":"fog","config":GameConfig::preset("fog",2).unwrap()}),
    );
    plane_with_bots(&mut r, host, &[(1, "flare")]);
    r.send(host, json!({"t":"start"}));
    for _ in 0..8 {
        let (ply, turn) = r.turn();
        if turn == 0 {
            let mv = r.legal_move();
            r.send(host, json!({"t":"action","action":mv,"ply":ply}));
        } else {
            r.wake();
        }
    }
    let truth = r.core.game().unwrap().state().cells.clone();
    let truth_opp = truth.iter().filter(|&&o| o == 2).count();
    assert!(truth_opp > 4, "opponent has placed shards");

    // Spectator: only the public map. At most each Core, no live light.
    let spec = r.last_view(s).expect("spectator view");
    assert_eq!(spec.seat, None);
    for seat in 1..=2u8 {
        assert!(spec.cells.iter().filter(|&&o| o == seat).count() <= 1);
    }
    assert!(spec.scores.is_none());
    assert!(spec
        .seats
        .iter()
        .all(|sv| sv.pieces.is_none() && sv.charge.is_none()));
    assert!(spec
        .events
        .iter()
        .all(|e| !matches!(e, cubes_engine::Event::Placed { cells, .. } if !cells.is_empty())));

    // Seat 0: never sees current truth outside its sight.
    let v0 = r.last_view(host).expect("player view");
    assert_eq!(v0.seat, Some(0));
    let mut hidden_opp = 0;
    for (i, &t) in truth.iter().enumerate() {
        if v0.flags[i] & F_VISIBLE != 0 {
            assert_eq!(v0.cells[i], t, "visible cell {i} must be true");
        } else if t == 2 && v0.cells[i] != 2 {
            hidden_opp += 1;
        }
    }
    assert!(hidden_opp > 0, "some opponent light is out of sight");
    assert!(v0.cells.iter().filter(|&&o| o == 2).count() < truth_opp);
    assert!(v0.seats[1].pieces.is_none());
    assert!(v0.seats[1].charge.is_none());
    assert!(v0.seats[0].pieces.is_some());
    assert!(v0.scores.is_none());
    assert!(v0.cells.iter().all(|&o| !(5..250).contains(&o)));
    assert!(spec.cells.iter().all(|&o| !is_seat(o) || o <= 2));
}

#[test]
fn connections_are_rate_limited() {
    let mut r = Room::new();
    let a = r.connect();
    for i in 0..30 {
        r.send(a, json!({"t":"ping","ts":i}));
    }
    let msgs = r.take(a);
    let pongs = msgs
        .iter()
        .filter(|m| matches!(m, ServerMsg::Pong { .. }))
        .count();
    let limited = msgs
        .iter()
        .filter(|m| {
            matches!(
                m,
                ServerMsg::Error {
                    code: ErrorCode::RateLimited,
                    ..
                }
            )
        })
        .count();
    assert_eq!(pongs, 20);
    assert_eq!(limited, 1, "warn once, then drop silently");
    // Half a second refills ten.
    r.now += 500;
    for i in 0..15 {
        r.send(a, json!({"t":"ping","ts":i}));
    }
    let pongs = r
        .take(a)
        .iter()
        .filter(|m| matches!(m, ServerMsg::Pong { .. }))
        .count();
    assert_eq!(pongs, 10);
    // Another connection has its own budget.
    let b = r.connect();
    r.send(b, json!({"t":"ping","ts":1}));
    assert_eq!(r.take(b).len(), 1);
}

#[test]
fn oversized_and_malformed_frames_are_rejected() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let big = format!(
        r#"{{"t":"chat","text":"{}"}}"#,
        "x".repeat(MAX_MESSAGE_BYTES)
    );
    let out = r.core.on_text(a, &big, r.now);
    r.deliver(out);
    assert_eq!(r.errors(a), vec![ErrorCode::TooLarge]);
    for bad in [
        "not json",
        r#"{"t":"fly"}"#,
        r#"{"t":"sit","seat":"x"}"#,
        "[]",
    ] {
        let out = r.core.on_text(a, bad, r.now);
        r.deliver(out);
        assert_eq!(r.errors(a), vec![ErrorCode::BadMessage], "{bad}");
    }
}

#[test]
fn chat_is_sanitized_rate_limited_and_replayed() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.send(a, json!({"t":"sit","seat":1}));
    r.take(a);
    r.send(
        a,
        json!({"t":"chat","text":format!("  hi\u{0000} there {}", "y".repeat(300))}),
    );
    let msgs = r.take(a);
    let ServerMsg::Chat {
        name,
        seat,
        text,
        at,
    } = &msgs[0]
    else {
        panic!("{msgs:?}");
    };
    assert_eq!(name, "Alice");
    assert_eq!(*seat, Some(1));
    assert_eq!(*at, r.now);
    assert!(text.starts_with("hi there yyy"));
    assert_eq!(text.chars().count(), MAX_CHAT_CHARS);
    r.send(a, json!({"t":"chat","text":"   "}));
    assert!(r.take(a).is_empty());
    for _ in 0..4 {
        r.send(a, json!({"t":"chat","text":"spam"}));
    }
    r.send(a, json!({"t":"chat","text":"spam"}));
    assert_eq!(r.errors(a), vec![ErrorCode::RateLimited]);
    // Emotes broadcast with the seat.
    r.send(a, json!({"t":"emote","kind":"gg"}));
    assert!(r.take(a).contains(&ServerMsg::Emote {
        name: "Alice".into(),
        seat: Some(1),
        kind: EmoteKind::Gg
    }));
    // A newcomer gets the history.
    let (b, _) = r.join("bob-000001", "Bob");
    let _ = b;
    let c = r.connect();
    r.send(c, json!({"t":"hello","pid":"carol-0001","name":"Carol"}));
    let chats = r
        .take(c)
        .iter()
        .filter(|m| matches!(m, ServerMsg::Chat { .. }))
        .count();
    assert_eq!(chats, 5);
}

#[test]
fn host_migrates_after_a_minute_away() {
    let mut r = Room::new();
    let (a, ta) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    let (c, _) = r.join("carol-0001", "Carol");
    r.send(c, json!({"t":"sit","seat":2}));
    r.disconnect(a);
    let _ = b;
    assert_eq!(r.core.next_deadline(), Some(r.now + HOST_MIGRATE_MS));
    r.advance(HOST_MIGRATE_MS - 1);
    assert_eq!(r.core.host_pid(), Some("alice-0001"));
    r.advance(1);
    // Seated humans first.
    assert_eq!(r.core.host_pid(), Some("carol-0001"));
    assert_eq!(r.lobby().host_pid.as_deref(), Some("carol-0001"));
    // The old host returns as a guest.
    let a2 = r.connect();
    r.send(
        a2,
        json!({"t":"hello","pid":"alice-0001","name":"Alice","token":ta}),
    );
    assert!(matches!(
        r.take(a2)[0],
        ServerMsg::Welcome { host: false, .. }
    ));

    // Returning within the minute keeps the crown.
    let mut r = Room::new();
    let (a, ta) = r.join("alice-0001", "Alice");
    r.join("bob-000001", "Bob");
    r.disconnect(a);
    r.advance(30_000);
    let a2 = r.connect();
    r.send(
        a2,
        json!({"t":"hello","pid":"alice-0001","name":"Alice","token":ta}),
    );
    r.advance(HOST_MIGRATE_MS);
    assert_eq!(r.core.host_pid(), Some("alice-0001"));
}

#[test]
fn no_candidate_means_no_alarm_loop() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.disconnect(a);
    // Nobody to promote: only the idle deadline remains.
    assert_eq!(r.core.next_deadline(), Some(r.now + IDLE_MS));
}

#[test]
fn rooms_survive_a_persistence_roundtrip_mid_game() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.send(a, json!({"t":"sit","seat":0}));
    plane_with_bots(&mut r, a, &[(1, "flare"), (2, "ember")]);
    r.send(a, json!({"t":"start"}));
    let mv = r.legal_move();
    r.send(a, json!({"t":"action","action":mv,"ply":0}));
    r.wake();
    let json = r.core.to_json();
    let back = RoomCore::from_json(&json).unwrap();
    assert_eq!(back.to_json(), json);
    assert_eq!(back.game().unwrap().data, r.core.game().unwrap().data);
    assert_eq!(back.next_deadline(), r.core.next_deadline());
    assert_eq!(back.lobby(), r.core.lobby());
    // And it keeps playing.
    r.core = back;
    r.wake();
    assert!(r.turn().0 >= 2);
}

#[test]
fn shell_reconciles_dead_sockets_and_idle_rooms_expire() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    let (b, _) = r.join("bob-000001", "Bob");
    r.send(b, json!({"t":"sit","seat":1}));
    // After an eviction only `a`'s socket survived.
    let out = r.core.retain_conns(&[a], r.now);
    r.deliver(out);
    assert!(!r.lobby().seats[1].connected);
    assert_eq!(r.core.conn_ids(), vec![a]);
    assert!(!r.core.is_expired(r.now + IDLE_MS - 1));
    assert!(r.core.is_expired(r.now + IDLE_MS));
    // A message counts as activity.
    r.now += 1000;
    r.send(a, json!({"t":"ping","ts":0}));
    assert!(!r.core.is_expired(r.now + IDLE_MS - 1));
}

#[test]
fn reseeding_changes_tokens_and_seeds() {
    let mut a = RoomCore::new("ABCDE", T0, 1);
    let mut b = RoomCore::new("ABCDE", T0, 1);
    b.reseed(99);
    assert_ne!(a.new_token(), b.new_token());
}

#[test]
fn nova_budget_holds_with_a_frozen_clock() {
    let mut r = Room::new();
    let (a, _) = r.join("alice-0001", "Alice");
    r.send(
        a,
        json!({"t":"configure","preset":"duel","config":GameConfig::preset("duel",2).unwrap()}),
    );
    plane_with_bots(&mut r, a, &[(0, "nova"), (1, "nova")]);
    r.send(a, json!({"t":"start"}));
    let est = playout_cost_ms(&r.core.game().unwrap().data.config);
    assert!((4.0..4.5).contains(&est), "{est}");
    let reads = std::cell::Cell::new(0u32);
    // A clock that never moves, like Date.now() inside a Worker.
    let frozen = || {
        reads.set(reads.get() + 1);
        1234.0
    };
    let budget = 40.0;
    let t = Thinker {
        clock: &frozen,
        nova_budget_ms: budget,
        frozen_clock: true,
    };
    let d = r.core.next_deadline().unwrap();
    let out = r.core.tick(d, &t);
    assert!(out.iter().any(|o| matches!(o.msg, ServerMsg::View { .. })));
    assert_eq!(r.turn().0, 1, "nova moved");
    // About budget / cost playouts: each synthetic read costs one estimate.
    let max_reads = 2 * ((budget / est) as u32 + 3);
    assert!(reads.get() <= max_reads, "{} reads", reads.get());
    assert!(reads.get() >= 4, "{} reads", reads.get());
}
