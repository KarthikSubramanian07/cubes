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
  duel: { ...base, dims: [14, 14, 1], seats: 2, nodes: 6 },
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
    flavor: "The standard game. Up to four players on one board, with power-ups.",
    blurb: "20×20 for three or four players, 14×14 for two. Power-ups on.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "duel",
    label: "Duel",
    flavor: "Two players on a small board. Quick, tight, and the best place to start.",
    blurb: "14×14, one against one. About ten minutes.",
    dimension: "2d",
    seats: [2],
    defaultSeats: 2,
  },
  {
    name: "pure",
    label: "Pure",
    flavor: "Just the three rules: no nodes and no power-ups.",
    blurb: "The standard board with power-ups turned off.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "fog",
    label: "Fog",
    flavor: "You can only see the board near your own pieces.",
    blurb: "18×18 (14×14 for two). You see two squares around your pieces and remember the rest. Scan reveals everything for a turn.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "storm",
    label: "Storm",
    flavor: "The edge of the board crumbles away as the game goes on.",
    blurb: "20×20. From round six, the outer ring is destroyed every three rounds, along with anything on it.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "torus",
    label: "Torus",
    flavor: "The board wraps around: off the right edge means back on the left.",
    blurb: "18×18 (14×14 for two). Wraps left to right and top to bottom.",
    dimension: "2d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "teams",
    label: "Teams",
    flavor: "Two teams of two. Teammates can build off each other's pieces.",
    blurb: "20×20. Players 1 and 3 against 2 and 4; scores add up per team.",
    dimension: "2d",
    seats: [4],
    defaultSeats: 4,
  },
  {
    name: "stack",
    label: "Stack",
    flavor: "3D with gravity. Pieces must rest on something, and you build on top of other players.",
    blurb: "8×8×8 (8×8×6 for two). The top cube of each column scores a bonus point.",
    dimension: "3d",
    seats: [2, 3, 4],
    defaultSeats: 4,
  },
  {
    name: "orbit",
    label: "Orbit",
    flavor: "3D without gravity: build anywhere inside a floating cube.",
    blurb: "7×7×7 (6×6×6 for two). Drag to turn the cube and use the slice slider to see inside.",
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
 * small-table sizes (Plane 14×14 and Stack 8×8×6 for two players).
 */
export function presetConfig(name: PresetName, seats?: number): GameConfig {
  const info = PRESET_BY_NAME[name];
  const config = clone(PRESET_CONFIGS[name]);
  const n = seats && info.seats.includes(seats) ? seats : info.defaultSeats;
  config.seats = n;
  // Mirrors GameConfig::preset in crates/engine/src/config.rs; a test keeps them equal.
  if (n === 2) {
    if (config.arena) config.nodes = config.kit === "cubes" ? 4 : 6;
    if (name === "plane" || name === "pure" || name === "storm") config.dims = [14, 14, 1];
    if (name === "fog" || name === "torus") config.dims = [14, 14, 1];
    if (name === "stack") config.dims = [8, 8, 6];
    if (name === "orbit") config.dims = [6, 6, 6];
  }
  return config;
}
