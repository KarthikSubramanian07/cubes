//! WebAssembly bindings for the cubes engine.
//!
//! Every value crosses the boundary as JSON matching
//! `web/src/engine/types.ts`, which keeps the bindings tiny and the contract
//! readable. Boards are at most a few thousand cells, so this is cheap.

use cubes_engine::{Action, Game, GameConfig, Kit, KitKind, Level, View};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn now_ms() -> f64 {
    js_sys::Date::now()
}

#[wasm_bindgen]
pub struct Engine {
    game: Game,
}

#[wasm_bindgen]
impl Engine {
    /// Start a new match from a `GameConfig` JSON and a seed.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str, seed: f64) -> Result<Engine, JsError> {
        let config: GameConfig = serde_json::from_str(config_json).map_err(js_err)?;
        let game = Game::new(config, seed as u64).map_err(js_err)?;
        Ok(Engine { game })
    }

    /// Restore a match saved with `toJSON`.
    #[wasm_bindgen(js_name = fromJSON)]
    pub fn from_json(json: &str) -> Result<Engine, JsError> {
        Ok(Engine {
            game: Game::from_json(json).map_err(js_err)?,
        })
    }

    /// Build a perfect-information game from a (possibly fogged) view, for
    /// hints and bots in online games.
    #[wasm_bindgen(js_name = fromView)]
    pub fn from_view(view_json: &str) -> Result<Engine, JsError> {
        let view: View = serde_json::from_str(view_json).map_err(js_err)?;
        Ok(Engine {
            game: Game::from_view(&view).map_err(js_err)?,
        })
    }

    /// The view for `seat`; pass -1 for a spectator.
    pub fn view(&self, seat: i32) -> String {
        let seat = (seat >= 0).then_some(seat as usize);
        serde_json::to_string(&self.game.view(seat)).expect("view serializes")
    }

    /// Legal placements for `seat` as JSON `Placement[]`.
    pub fn legal(&mut self, seat: u32, leap: bool) -> String {
        serde_json::to_string(&self.game.legal(seat as usize, leap)).expect("placements serialize")
    }

    /// `{ ok: true }` or `{ ok: false, reason }`.
    pub fn check(&self, seat: u32, action_json: &str) -> String {
        let result = serde_json::from_str::<Action>(action_json)
            .map_err(|e| e.to_string())
            .and_then(|a| {
                self.game
                    .check(seat as usize, &a)
                    .map_err(|e| e.to_string())
            });
        match result {
            Ok(()) => r#"{"ok":true}"#.to_string(),
            Err(reason) => serde_json::json!({ "ok": false, "reason": reason }).to_string(),
        }
    }

    /// Apply an action; returns the unredacted `GameEvent[]` JSON.
    pub fn apply(&mut self, seat: u32, action_json: &str) -> Result<String, JsError> {
        let action: Action = serde_json::from_str(action_json).map_err(js_err)?;
        let events = self.game.apply(seat as usize, action).map_err(js_err)?;
        Ok(serde_json::to_string(&events).expect("events serialize"))
    }

    /// The next action a bot would take, as `Action` JSON, or undefined.
    #[wasm_bindgen(js_name = botAction)]
    pub fn bot_action(&self, seat: u32, level: &str, seed: f64, budget_ms: f64) -> Option<String> {
        let level = Level::parse(level)?;
        let action = self
            .game
            .bot_action(seat as usize, level, seed as u64, budget_ms, &now_ms)?;
        Some(serde_json::to_string(&action).expect("action serializes"))
    }

    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json(&self) -> String {
        self.game.to_json()
    }

    /// The action log as `{ seat, action }[]` JSON, for replays.
    pub fn log(&self) -> String {
        serde_json::to_string(&self.game.data.log).expect("log serializes")
    }
}

/// The kit for `"shards"` or `"cubes"` as `Kit` JSON.
#[wasm_bindgen]
pub fn kit(kind: &str) -> Result<String, JsError> {
    let kind = match kind {
        "shards" => KitKind::Shards,
        "cubes" => KitKind::Cubes,
        other => return Err(JsError::new(&format!("unknown kit {other}"))),
    };
    Ok(serde_json::to_string(&Kit::new(kind)).expect("kit serializes"))
}

/// A preset `GameConfig` JSON, or undefined for an unknown name.
#[wasm_bindgen]
pub fn preset(name: &str, seats: u8) -> Option<String> {
    GameConfig::preset(name, seats).map(|c| serde_json::to_string(&c).expect("config serializes"))
}

/// Validate a `GameConfig` JSON; returns an error message or undefined.
#[wasm_bindgen(js_name = validateConfig)]
pub fn validate_config(config_json: &str) -> Option<String> {
    match serde_json::from_str::<GameConfig>(config_json) {
        Ok(c) => c.validate().err().map(|e| e.to_string()),
        Err(e) => Some(e.to_string()),
    }
}
