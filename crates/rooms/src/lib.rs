//! # cubes-rooms
//!
//! Realtime multiplayer rooms for cubes. One Cloudflare Durable Object per
//! room runs the Rust engine authoritatively.
//!
//! - [`protocol`]: the JSON wire format, mirrored in `web/src/net/protocol.ts`.
//! - [`core`]: `RoomCore`, a pure state machine holding all room logic. It is
//!   compiled and unit-tested natively.
//! - `shell` (wasm32 only): the workers-rs Durable Object and Worker entry,
//!   a thin layer that moves frames, persists `RoomCore` and sets the alarm.

pub mod core;
pub mod protocol;

#[cfg(target_arch = "wasm32")]
mod shell;
