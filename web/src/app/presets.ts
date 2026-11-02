import type { BoardShape, GameConfig, PresetName } from "@/engine/types";

/**
 * Preset game configurations, mirroring the table in docs/DESIGN.md section 3.
 * The Rust engine (crates/engine) becomes the source of truth once it lands;
 * keep these values identical to it.
 */

export interface PresetInfo {
  name: PresetName;
  label: string;
  /** One dry line of flavour for cards. */
  flavor: string;
  /** Longer description for the play hub. */
  blurb: string;
  dimension: "2d" | "3d";
  /** Allowed seat counts. */
  seats: readonly number[];
  defaultSeats: number;
}

const base: GameConfig = {
  dims: [20, 20, 1],
  shape: "square",
  topology: "flat",
  gravity: false,
  seats: 4,
  teams: false,
  sharedLight: false,
  arena: true,
  nodes: 12,
  fog: null,
  storm: null,
  crowns: false,
  turnSeconds: null,
  kit: "shards",
};

/** Default config for each preset at its default seat count. */
export const PRESET_CONFIGS: Record<PresetName, GameConfig> = {
  plane: { ...base },
  duel: { ...base, dims: [14, 14, 1], seats: 2, nodes: 8 },
  pure: { ...base, arena: false, nodes: 0 },
  fog: { ...base, dims: [18, 18, 1], fog: 2 },
  storm: { ...base, storm: { start: 6, every: 3, minSpan: 8 } },
  torus: { ...base, dims: [18, 18, 1], topology: "torus" },
  teams: { ...base, teams: true, sharedLight: true },
  stack: { ...base, dims: [8, 8, 8], gravity: true, crowns: true, nodes: 8, kit: "cubes" },
  orbit: { ...base, dims: [7, 7, 7], nodes: 8, kit: "cubes" },
};

export const PRESETS: readonly PresetInfo[] = [
  {
    name: "plane",
    label: "Plane",
    flavor: "The classic board. Four corners, four colours, one argument.",
    blurb: "20×20 for four, 14×14 for two. Nodes and surges on.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "duel",
    label: "Duel",
    flavor: "Two players, a small board, nowhere to hide.",
    blurb: "14×14, head to head. Short and sharp.",
    dimension: "2d",
    seats: [2],
    defaultSeats: 2,
  },
  {
    name: "pure",
    label: "Pure",
    flavor: "No nodes, no surges. Just geometry and your conscience.",
    blurb: "20×20 with the arena layer switched off.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "fog",
    label: "Fog",
    flavor: "You only see two cells past your own light.",
    blurb: "18×18. Vision radius 2, memory for the rest. Scan to peek.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "storm",
    label: "Storm",
    flavor: "From round six the edge of the world starts falling off.",
    blurb: "20×20. The outer ring turns to ash every three rounds.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "torus",
    label: "Torus",
    flavor: "The edges wrap. There is no corner to hide in, only corners.",
    blurb: "18×18, wraps on both axes.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "teams",
    label: "Teams",
    flavor: "Two against two, sharing light and occasionally blame.",
    blurb: "20×20. Seats 1+3 against 2+4, shared light.",
    dimension: "2d",
    seats: [4],
    defaultSeats: 4,
  },
  {
    name: "stack",
    label: "Stack",
    flavor: "Gravity is on. You climb on other people.",
    blurb: "8×8×8 (6×6×6 for two). Crown columns for points.",
    dimension: "3d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "orbit",
    label: "Orbit",
    flavor: "A floating cube of space. Corners in every direction.",
    blurb: "7×7×7, no gravity. Turn it around a lot.",
    dimension: "3d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
];

export const PRESET_BY_NAME: Record<PresetName, PresetInfo> = Object.fromEntries(
  PRESETS.map((p) => [p.name, p]),
) as Record<PresetName, PresetInfo>;

export const BOARD_SHAPES: readonly BoardShape[] = ["square", "octagon", "cross", "diamond"];

function clone(config: GameConfig): GameConfig {
  return { ...config, dims: [...config.dims], storm: config.storm ? { ...config.storm } : null };
}

/**
 * The preset's config at a given seat count, applying the documented
 * small-table sizes (Plane 14×14 and Stack 6×6×6 for two players).
 */
export function presetConfig(name: PresetName, seats?: number): GameConfig {
  const info = PRESET_BY_NAME[name];
  const config = clone(PRESET_CONFIGS[name]);
  const n = seats && info.seats.includes(seats) ? seats : info.defaultSeats;
  config.seats = n;
  if (n === 2 && name === "plane") config.dims = [14, 14, 1];
  if (n === 2 && name === "stack") config.dims = [6, 6, 6];
  return config;
}
