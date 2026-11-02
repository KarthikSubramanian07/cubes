/**
 * The JSON contract between the Rust engine (crates/engine) and the web client.
 * Mirrors docs/DESIGN.md section 4. Keep both sides in sync.
 */

export type Vec3 = [x: number, y: number, z: number];

export type BoardShape = "square" | "octagon" | "cross" | "diamond";
export type Topology = "flat" | "torus";
export type KitKind = "shards" | "cubes";
export type PresetName =
  | "plane"
  | "duel"
  | "pure"
  | "fog"
  | "storm"
  | "torus"
  | "teams"
  | "stack"
  | "orbit";

export interface StormConfig {
  start: number;
  every: number;
  minSpan: number;
}

export interface GameConfig {
  dims: Vec3;
  shape: BoardShape;
  topology: Topology;
  gravity: boolean;
  seats: number; // 2..=4
  teams: boolean;
  sharedLight: boolean;
  arena: boolean;
  nodes: number; // 0 = none
  fog: number | null; // vision radius
  storm: StormConfig | null;
  crowns: boolean;
  turnSeconds: number | null;
  kit: KitKind;
}

/** Cell owner codes. 1..=4 are seat + 1. */
export const OWNER = {
  EMPTY: 0,
  VOID: 250,
  SCAR: 251,
  ASH: 252,
} as const;

/** Per-cell flag bits in a View. */
export const FLAG = {
  NODE: 1,
  CORE: 2,
  STALE: 4, // fog: this is memory, not current sight
  VISIBLE: 8, // fog: currently in sight (always set without fog)
} as const;

export const SEAT_NAMES = ["Clay", "Tide", "Pollen", "Iris"] as const;

/** A piece in a kit. `orients` are normalized cell offsets (min corner at 0,0,0). */
export interface PieceDef {
  id: string; // e.g. "p5-f", "c4-screw-l"
  name: string; // display name, e.g. "F"
  size: number;
  orients: Vec3[][];
}

export interface Kit {
  kind: KitKind;
  pieces: PieceDef[];
  /** Index used for a Spark placement (single cell, costs charge). Equals pieces.length. */
  sparkIndex: number;
}

export type Action =
  | { type: "place"; piece: number; orient: number; at: Vec3; leap: boolean }
  | { type: "shatter"; cell: number }
  | { type: "scan" }
  | { type: "resign" };

export interface Placement {
  piece: number;
  orient: number;
  at: Vec3;
  cells: number[];
}

export type GameEvent =
  | { type: "placed"; seat: number; piece: number; cells: number[]; leap: boolean; spark: boolean; hidden: boolean }
  | { type: "node"; seat: number; cell: number }
  | { type: "shattered"; seat: number; cell: number; victim: number }
  | { type: "misfire"; seat: number; cells: number[] }
  | { type: "scanned"; seat: number }
  | { type: "dark"; seat: number }
  | { type: "storm"; level: number; cells: number[] }
  | { type: "gameOver"; scores: number[]; winners: number[] };

export interface SeatView {
  seat: number;
  team: number;
  /** Remaining pieces by kit index; null when hidden by fog. */
  pieces: boolean[] | null;
  piecesLeft: number;
  charge: number | null;
  dark: boolean;
  resigned: boolean;
  score: number | null;
  core: number; // cell index
}

export interface View {
  config: GameConfig;
  /** Whose perspective this is; null for spectators. */
  seat: number | null;
  cells: number[]; // owner code per cell, length w*h*d
  flags: number[]; // FLAG bits per cell
  seats: SeatView[];
  turn: number;
  round: number;
  ply: number;
  phase: "playing" | "over";
  stormLevel: number;
  nextStorm: number | null; // round of the next collapse
  scanning: boolean;
  shatteredThisTurn: boolean;
  events: GameEvent[]; // events from the most recent action, redacted
  scores: number[] | null; // per seat, null under fog until game over
  winners: number[] | null;
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Cell index helpers (index = x + w * (y + h * z)). */
export function cellIndex(dims: Vec3, x: number, y: number, z: number): number {
  return x + dims[0] * (y + dims[1] * z);
}

export function cellCoords(dims: Vec3, i: number): Vec3 {
  const w = dims[0];
  const h = dims[1];
  return [i % w, Math.floor(i / w) % h, Math.floor(i / (w * h))];
}

/** A live game handle exposed by the WASM engine (see web/src/engine/engine.ts). */
export interface EngineGame {
  view(seat: number | null): View;
  legal(seat: number, opts?: { leap?: boolean }): Placement[];
  check(seat: number, action: Action): CheckResult;
  apply(seat: number, action: Action): GameEvent[];
  aiTurn(seat: number, level: AiLevel, budgetMs: number): Action[];
  toJSON(): string;
  free(): void;
}

export type AiLevel = "ember" | "flare" | "nova";
