//! # cubes-engine
//!
//! The rules of cubes, a territory game of light and corners: lattices,
//! kits of shards, precomputed move tables, the link rule, surges, storm,
//! fog of war, scoring and bots. Pure Rust, no platform dependencies, so the
//! same code runs in the browser (WebAssembly), on Cloudflare (workers-rs)
//! and natively in the self-play simulator.

#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

pub mod geometry;
pub mod rng;
