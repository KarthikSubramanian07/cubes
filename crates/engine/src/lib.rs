//! # cubes-engine
//!
//! The rules of cubes, a territory game of light and corners: lattices,
//! kits of shards, precomputed move tables, the link rule, surges, storm,
//! fog of war, scoring and bots. Pure Rust, no platform dependencies, so the
//! same code runs in the browser (WebAssembly), on Cloudflare (workers-rs)
//! and natively in the self-play simulator.

#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

pub mod ai;
pub mod config;
pub mod game;
pub mod geometry;
pub mod pieces;
pub mod rng;
pub mod session;
pub mod table;

pub use ai::{Bot, Level};
pub use config::{GameConfig, StormConfig};
pub use game::{Action, Event, Phase, RuleError};
pub use geometry::{BoardShape, Topology};
pub use pieces::{Kit, KitKind, PieceDef};
pub use session::{Game, GameData, GameError, LogEntry, Placement, SeatView, View};
