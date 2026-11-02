//! # cubes-rooms
//!
//! Realtime multiplayer rooms for cubes. One Cloudflare Durable Object per
//! room runs the Rust engine authoritatively.
//!
//! - [`protocol`]: the JSON wire format, mirrored in `web/src/net/protocol.ts`.

pub mod protocol;
