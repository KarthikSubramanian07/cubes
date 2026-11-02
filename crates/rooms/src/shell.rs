//! The Cloudflare side: a workers-rs Durable Object per room plus the Worker
//! entry that routes `/api/room/:code` WebSockets to it.
//!
//! This layer is deliberately thin. It maps sockets to connection ids via
//! hibernation-safe attachments, restores `RoomCore` from storage when the
//! object wakes, feeds it events, sends what it returns, persists it after
//! every event and keeps the single alarm pointed at the next deadline.

use std::cell::{Cell, RefCell};
use std::panic::AssertUnwindSafe;

use serde::{Deserialize, Serialize};
use worker::{
    console_error, durable_object, event, wasm_bindgen, Context, Date, DurableObject, Env, Request,
    Response, Result, ScheduledTime, State, WebSocket, WebSocketIncomingMessage, WebSocketPair,
};

use crate::core::{ConnId, Outbound, RoomCore, Thinker};
use crate::protocol::{valid_code, ErrorCode, ServerMsg, MAX_MESSAGE_BYTES};

/// Storage key for the serialized `RoomCore`.
const KEY: &str = "room";
/// Nova's thinking budget per move, in (estimated) CPU milliseconds.
const NOVA_BUDGET_MS: f64 = 350.0;

#[derive(Serialize, Deserialize)]
struct Attachment {
    conn: ConnId,
}

fn now_ms() -> u64 {
    Date::now().as_millis()
}

fn random_u64() -> u64 {
    getrandom::u64().unwrap_or_else(|_| now_ms().wrapping_mul(0x9e37_79b9_7f4a_7c15))
}

fn is_websocket(req: &Request) -> bool {
    req.headers()
        .get("Upgrade")
        .ok()
        .flatten()
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
}

fn room_code(req: &Request) -> Option<String> {
    let path = req.path();
    let code = path.trim_end_matches('/').rsplit('/').next()?;
    valid_code(code).then(|| code.to_string())
}

#[durable_object]
pub struct Room {
    state: State,
    core: AssertUnwindSafe<RefCell<Option<RoomCore>>>,
    /// The alarm we last set, so we only touch it when it changes.
    alarm_at: AssertUnwindSafe<Cell<Option<u64>>>,
}

impl Room {
    /// Restore the room after a cold start or hibernation.
    async fn load(&self) -> Result<()> {
        if self.core.borrow().is_some() {
            return Ok(());
        }
        let stored: Option<String> = self.state.storage().get(KEY).await?;
        if self.core.borrow().is_some() {
            return Ok(());
        }
        let Some(json) = stored else {
            return Ok(());
        };
        let mut core = match RoomCore::from_json(&json) {
            Ok(c) => c,
            Err(e) => {
                console_error!("dropping unreadable room state: {e}");
                return Ok(());
            }
        };
        // Sockets may have closed while we were away; reconcile.
        let live: Vec<ConnId> = self
            .state
            .get_websockets()
            .iter()
            .filter_map(|ws| ws.deserialize_attachment::<Attachment>().ok().flatten())
            .map(|a| a.conn)
            .collect();
        let out = core.retain_conns(&live, now_ms());
        *self.core.borrow_mut() = Some(core);
        // The alarm on record may predate the eviction; re-arm on commit.
        self.alarm_at.set(None);
        self.send(out);
        Ok(())
    }

    /// Run `f` against the core (with fresh entropy), send what it returns
    /// and persist. Does nothing if the room has no state.
    async fn step<F>(&self, f: F) -> Result<()>
    where
        F: FnOnce(&mut RoomCore, u64) -> Vec<Outbound>,
    {
        self.load().await?;
        let out = {
            let mut guard = self.core.borrow_mut();
            let Some(core) = guard.as_mut() else {
                return Ok(());
            };
            core.reseed(random_u64());
            f(core, now_ms())
        };
        self.send(out);
        self.commit().await
    }

    fn sockets(&self) -> Vec<(ConnId, WebSocket)> {
        self.state
            .get_websockets()
            .into_iter()
            .filter_map(|ws| {
                let a = ws.deserialize_attachment::<Attachment>().ok().flatten()?;
                Some((a.conn, ws))
            })
            .collect()
    }

    fn send(&self, out: Vec<Outbound>) {
        if out.is_empty() {
            return;
        }
        let guard = self.core.borrow();
        let Some(core) = guard.as_ref() else {
            return;
        };
        let sockets = self.sockets();
        for o in out {
            let targets = core.resolve(o.to);
            if targets.is_empty() {
                continue;
            }
            let Ok(text) = serde_json::to_string(&o.msg) else {
                continue;
            };
            for (id, ws) in &sockets {
                if targets.contains(id) {
                    // A socket mid-close may refuse; its close event follows.
                    let _ = ws.send_with_str(&text);
                }
            }
        }
    }

    /// Persist the core and point the alarm at its next deadline. Rooms idle
    /// past their expiry delete everything instead.
    async fn commit(&self) -> Result<()> {
        let now = now_ms();
        let (json, deadline, expired) = {
            let guard = self.core.borrow();
            let Some(core) = guard.as_ref() else {
                return Ok(());
            };
            (core.to_json(), core.next_deadline(), core.is_expired(now))
        };
        let storage = self.state.storage();
        if expired {
            *self.core.borrow_mut() = None;
            for ws in self.state.get_websockets() {
                let _ = ws.close(Some(1001), Some("room expired"));
            }
            storage.delete_alarm().await?;
            storage.delete_all().await?;
            self.alarm_at.set(None);
            return Ok(());
        }
        storage.put(KEY, json).await?;
        if deadline != self.alarm_at.get() {
            match deadline {
                Some(t) => {
                    let date = worker::js_sys::Date::new(&(t as f64).into());
                    storage.set_alarm(ScheduledTime::new(date)).await?;
                }
                None => storage.delete_alarm().await?,
            }
            self.alarm_at.set(deadline);
        }
        Ok(())
    }
}

impl DurableObject for Room {
    fn new(state: State, _env: Env) -> Self {
        Room {
            state,
            core: AssertUnwindSafe(RefCell::new(None)),
            alarm_at: AssertUnwindSafe(Cell::new(None)),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        if !is_websocket(&req) {
            return Response::error("expected a websocket upgrade", 426);
        }
        let Some(code) = room_code(&req) else {
            return Response::error("bad room code", 400);
        };
        self.load().await?;
        {
            let mut guard = self.core.borrow_mut();
            if guard.is_none() {
                *guard = Some(RoomCore::new(&code, now_ms(), random_u64()));
            }
        }
        let pair = WebSocketPair::new()?;
        self.state.accept_web_socket(&pair.server);
        let conn = {
            let mut guard = self.core.borrow_mut();
            let core = guard.as_mut().expect("room state");
            core.reseed(random_u64());
            core.connect(now_ms())
        };
        pair.server.serialize_attachment(Attachment { conn })?;
        self.commit().await?;
        Response::from_websocket(pair.client)
    }

    async fn websocket_message(
        &self,
        ws: WebSocket,
        message: WebSocketIncomingMessage,
    ) -> Result<()> {
        let Some(Attachment { conn }) = ws.deserialize_attachment()? else {
            let _ = ws.close(Some(1011), Some("unknown connection"));
            return Ok(());
        };
        self.load().await?;
        if self.core.borrow().is_none() {
            // The room expired or its state was lost; start over cleanly.
            let _ = ws.close(Some(1001), Some("room closed"));
            return Ok(());
        }
        match message {
            WebSocketIncomingMessage::String(text) => {
                self.step(|core, now| core.on_text(conn, &text, now)).await
            }
            WebSocketIncomingMessage::Binary(bytes) => {
                let msg = if bytes.len() > MAX_MESSAGE_BYTES {
                    ServerMsg::error(ErrorCode::TooLarge, "messages are capped at 16 KB")
                } else {
                    ServerMsg::error(ErrorCode::BadMessage, "send text frames")
                };
                if let Ok(text) = serde_json::to_string(&msg) {
                    let _ = ws.send_with_str(text);
                }
                Ok(())
            }
        }
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _clean: bool,
    ) -> Result<()> {
        let _ = ws.close(Some(1000), Some("bye"));
        self.drop_socket(&ws).await
    }

    async fn websocket_error(&self, ws: WebSocket, _error: worker::Error) -> Result<()> {
        self.drop_socket(&ws).await
    }

    async fn alarm(&self) -> Result<Response> {
        self.alarm_at.set(None);
        self.step(|core, now| {
            // Date.now() stands still during synchronous work here, so the
            // core charges Nova an estimated cost per playout instead.
            let clock = || now_ms() as f64;
            core.tick(
                now,
                &Thinker {
                    clock: &clock,
                    nova_budget_ms: NOVA_BUDGET_MS,
                    frozen_clock: true,
                },
            )
        })
        .await?;
        Response::ok("")
    }
}

impl Room {
    async fn drop_socket(&self, ws: &WebSocket) -> Result<()> {
        let Some(Attachment { conn }) = ws.deserialize_attachment().ok().flatten() else {
            return Ok(());
        };
        self.step(|core, now| core.disconnect(conn, now)).await
    }
}

/// Worker entry. In production the Pages Function forwards straight to the
/// Durable Object; this route serves local dev and direct Worker access.
#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    if path == "/api/health" {
        return Response::ok("ok");
    }
    if path.starts_with("/api/room/") {
        let Some(code) = room_code(&req) else {
            return Response::error("bad room code", 400);
        };
        if !is_websocket(&req) {
            return Response::error("expected a websocket upgrade", 426);
        }
        let stub = env
            .durable_object("ROOMS")?
            .id_from_name(&code)?
            .get_stub()?;
        return stub.fetch_with_request(req).await;
    }
    Response::error("not found", 404)
}
