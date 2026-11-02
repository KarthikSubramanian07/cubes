//! The room wire protocol. JSON messages tagged by `t`, camelCase fields.
//! Mirrored exactly in `web/src/net/protocol.ts`; keep both in sync.

use cubes_engine::{Action, GameConfig, Level, View};
use serde::{Deserialize, Serialize};

/// Largest client frame the server will look at, in bytes.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
/// Longest chat line, in characters.
pub const MAX_CHAT_CHARS: usize = 200;
/// Longest display name, in characters.
pub const MAX_NAME_CHARS: usize = 24;
/// Seats in a room. The engine plays 2 to 4.
pub const MAX_SEATS: usize = 4;

/// Client to server.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ClientMsg {
    /// First message on every connection. `token` reclaims a known `pid`.
    Hello {
        pid: String,
        name: String,
        #[serde(default)]
        token: Option<String>,
    },
    Rename {
        name: String,
    },
    Sit {
        seat: u8,
    },
    Stand,
    /// Host only, in the lobby (or after a game, which returns to the lobby).
    Configure {
        preset: String,
        config: GameConfig,
    },
    /// Host only: put a bot in an empty seat, or clear a bot with `null`.
    SetBot {
        seat: u8,
        level: Option<Level>,
    },
    /// Host only. In the lobby the seat empties; mid-game a bot takes over.
    Kick {
        seat: u8,
    },
    /// Host only: needs at least two filled seats.
    Start,
    /// Play for your own seat. `ply` must be the current ply.
    Action {
        action: Action,
        ply: u32,
    },
    /// Host only, after a game: same seats, new seed.
    Rematch,
    Chat {
        text: String,
    },
    Emote {
        kind: EmoteKind,
    },
    Ping {
        ts: f64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmoteKind {
    Nice,
    Oof,
    Gg,
    Hmm,
    Wow,
    Zap,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoomPhase {
    Lobby,
    Playing,
    Over,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SeatKind {
    Empty,
    Human,
    Bot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbySeat {
    pub seat: u8,
    pub kind: SeatKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<String>,
    pub connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<Level>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autopilot: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spectator {
    pub pid: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lobby {
    pub code: String,
    pub phase: RoomPhase,
    pub host_pid: Option<String>,
    pub preset: String,
    pub config: GameConfig,
    pub seats: Vec<LobbySeat>,
    pub spectators: Vec<Spectator>,
}

/// Server to client.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ServerMsg {
    /// Reply to `hello`. Keep `token` to reclaim this `pid` later.
    Welcome {
        pid: String,
        token: String,
        host: bool,
    },
    Lobby(Lobby),
    /// The engine's per-seat redacted view. Spectators get the public view.
    View {
        view: Box<View>,
    },
    /// Turn timer. `endsAt` is epoch milliseconds, `null` when no clock runs.
    #[serde(rename_all = "camelCase")]
    Clock {
        seat: u8,
        ends_at: Option<u64>,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
    Chat {
        name: String,
        seat: Option<u8>,
        text: String,
        at: u64,
    },
    Emote {
        name: String,
        seat: Option<u8>,
        kind: EmoteKind,
    },
    Pong {
        ts: f64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// The frame was not a valid message.
    BadMessage,
    /// The frame was larger than 16 KB.
    TooLarge,
    /// Too many messages; this one was dropped.
    RateLimited,
    /// Send `hello` first.
    NoHello,
    /// This pid belongs to someone else (wrong or missing token).
    BadToken,
    /// Host-only command.
    NotHost,
    /// Not allowed in the current phase.
    WrongPhase,
    /// Seat number out of range, taken, or not yours.
    BadSeat,
    /// The game config was rejected.
    BadConfig,
    /// Not enough filled seats to start.
    NotEnoughPlayers,
    /// It isn't your seat's turn, or `ply` is out of date.
    Stale,
    /// The engine rejected the action.
    Illegal,
}

impl ServerMsg {
    pub fn error(code: ErrorCode, message: impl Into<String>) -> ServerMsg {
        ServerMsg::Error {
            code,
            message: message.into(),
        }
    }
}

/// Trim, drop control characters, collapse whitespace runs and cap the length.
pub fn sanitize_text(raw: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut last_space = true;
    for c in raw.chars() {
        let c = if c.is_whitespace() { ' ' } else { c };
        if c.is_control() || is_invisible(c) {
            continue;
        }
        if c == ' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        out.push(c);
    }
    let trimmed: String = out.trim().chars().take(max_chars).collect();
    trimmed.trim_end().to_string()
}

/// Zero-width and bidi-control characters that could spoof names.
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

pub fn sanitize_name(raw: &str) -> String {
    sanitize_text(raw, MAX_NAME_CHARS)
}

/// Room codes: five characters from an alphabet without I, O, 0 or 1.
pub fn valid_code(code: &str) -> bool {
    code.len() == 5
        && code
            .bytes()
            .all(|b| matches!(b, b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'2'..=b'9'))
}

/// Player ids are opaque client-chosen strings: 8 to 64 of `[A-Za-z0-9_-]`.
pub fn valid_pid(pid: &str) -> bool {
    (8..=64).contains(&pid.len())
        && pid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn client_messages_parse_from_documented_json() {
        let m: ClientMsg =
            serde_json::from_str(r#"{"t":"hello","pid":"abcdefgh","name":"Ada"}"#).unwrap();
        assert_eq!(
            m,
            ClientMsg::Hello {
                pid: "abcdefgh".into(),
                name: "Ada".into(),
                token: None
            }
        );
        let m: ClientMsg = serde_json::from_str(r#"{"t":"setBot","seat":2,"level":null}"#).unwrap();
        assert_eq!(m, ClientMsg::SetBot { seat: 2, level: None });
        let m: ClientMsg =
            serde_json::from_str(r#"{"t":"setBot","seat":1,"level":"nova"}"#).unwrap();
        assert_eq!(
            m,
            ClientMsg::SetBot {
                seat: 1,
                level: Some(Level::Nova)
            }
        );
        let m: ClientMsg = serde_json::from_str(
            r#"{"t":"action","ply":4,"action":{"type":"place","piece":3,"orient":1,"at":[2,3,0],"leap":false}}"#,
        )
        .unwrap();
        assert!(matches!(m, ClientMsg::Action { ply: 4, .. }));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"emote","kind":"gg"}"#).unwrap();
        assert_eq!(m, ClientMsg::Emote { kind: EmoteKind::Gg });
        assert!(serde_json::from_str::<ClientMsg>(r#"{"t":"emote","kind":"rude"}"#).is_err());
        let cfg = GameConfig::preset("duel", 2).unwrap();
        let m: ClientMsg = serde_json::from_value(json!({"t":"configure","preset":"duel","config":cfg}))
            .unwrap();
        assert!(matches!(m, ClientMsg::Configure { .. }));
    }

    #[test]
    fn server_messages_serialize_as_documented() {
        let v = serde_json::to_value(ServerMsg::Clock {
            seat: 1,
            ends_at: Some(5),
        })
        .unwrap();
        assert_eq!(v, json!({"t":"clock","seat":1,"endsAt":5}));
        let v = serde_json::to_value(ServerMsg::error(ErrorCode::BadToken, "no")).unwrap();
        assert_eq!(v, json!({"t":"error","code":"badToken","message":"no"}));
        let lobby = Lobby {
            code: "ABCDE".into(),
            phase: RoomPhase::Lobby,
            host_pid: Some("p".into()),
            preset: "plane".into(),
            config: GameConfig::preset("plane", 4).unwrap(),
            seats: vec![LobbySeat {
                seat: 0,
                kind: SeatKind::Bot,
                name: "Flare".into(),
                pid: None,
                connected: true,
                level: Some(Level::Flare),
                autopilot: None,
            }],
            spectators: vec![],
        };
        let v = serde_json::to_value(ServerMsg::Lobby(lobby)).unwrap();
        assert_eq!(v["t"], "lobby");
        assert_eq!(v["hostPid"], "p");
        assert_eq!(v["seats"][0]["level"], "flare");
        assert!(v["seats"][0].get("pid").is_none());
        assert_eq!(v["config"]["turnSeconds"], serde_json::Value::Null);
    }

    #[test]
    fn names_and_codes_are_sanitized() {
        assert_eq!(sanitize_name("  Ada \u{0007}Love\u{200B}lace  "), "Ada Lovelace");
        assert_eq!(sanitize_name("a\n\n\tb"), "a b");
        assert_eq!(sanitize_name(&"x".repeat(40)).chars().count(), 24);
        assert_eq!(sanitize_name("\u{202E}\u{0000}"), "");
        assert!(valid_code("K7QXM"));
        assert!(valid_code("ABCDE"));
        assert!(!valid_code("ABCD"));
        assert!(!valid_code("ABCDI"));
        assert!(!valid_code("abcde"));
        assert!(!valid_code("ABC0E"));
        assert!(valid_pid("p_1234-abcd"));
        assert!(!valid_pid("short"));
        assert!(!valid_pid("has space in it"));
    }
}
