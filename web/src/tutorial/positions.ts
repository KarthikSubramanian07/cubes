/**
 * Curated tutorial positions. A position is drawn as ASCII, one string per
 * row (one array of rows per layer in 3D), then written straight into the
 * engine's own save format so every rule after that is enforced for real.
 *
 *   .  empty           A B  Core of seat 0 / seat 1
 *   a b  seat 0 / 1    *    node
 *   #  scar            h    seat 1 light hidden in the fog (seat 0 remembers empty)
 */
import { LocalGame, getKit } from "@/engine/engine";
import { FLAG, OWNER, type GameConfig, type Vec3 } from "@/engine/types";

export interface PositionSpec {
  config: Partial<GameConfig> & { dims: Vec3 };
  /** Rows top to bottom. 3D: one array of rows per layer, floor first. */
  map: string[] | string[][];
  /** Piece ids each seat still holds; "all" for the full kit. */
  pieces?: [string[] | "all", string[] | "all"];
  charge?: [number, number];
  /** Seats that are already out (they never move). */
  dark?: [boolean, boolean];
  seed?: number;
}

export const BASE_CONFIG: GameConfig = {
  dims: [8, 8, 1],
  shape: "square",
  topology: "flat",
  gravity: false,
  seats: 2,
  teams: false,
  sharedLight: false,
  arena: true,
  nodes: 0,
  fog: null,
  storm: null,
  crowns: false,
  turnSeconds: null,
  kit: "shards",
};

interface SeatData {
  pieces: boolean[];
  charge: number;
  dark: boolean;
  resigned: boolean;
}

interface GameData {
  config: GameConfig;
  state: {
    cells: number[];
    flags: number[];
    cores: number[];
    seats: SeatData[];
    turn: number;
  };
  memory: number[][];
  memoryFlags: number[][];
}

export function configOf(spec: PositionSpec): GameConfig {
  return { ...BASE_CONFIG, ...spec.config };
}

function layers(spec: PositionSpec): string[][] {
  const m = spec.map;
  return typeof m[0] === "string" ? [m as string[]] : (m as string[][]);
}

/** Parse the map into owner codes, flags, cores and hidden cells. */
export function parseMap(spec: PositionSpec): { cells: number[]; flags: number[]; cores: number[]; hidden: number[] } {
  const [w, h, d] = spec.config.dims;
  const ls = layers(spec);
  if (ls.length !== d) throw new Error(`map has ${ls.length} layers, dims say ${d}`);
  const n = w * h * d;
  const cells = new Array<number>(n).fill(OWNER.EMPTY);
  const flags = new Array<number>(n).fill(0);
  const cores = [-1, -1];
  const hidden: number[] = [];
  ls.forEach((rows, z) => {
    if (rows.length !== h) throw new Error(`layer ${z} has ${rows.length} rows, expected ${h}`);
    rows.forEach((row, y) => {
      const chars = row.replace(/\s+/g, "");
      if (chars.length !== w) throw new Error(`row ${y} of layer ${z} is ${chars.length} wide, expected ${w}`);
      [...chars].forEach((ch, x) => {
        const i = x + w * (y + h * z);
        switch (ch) {
          case ".":
            break;
          case "A":
          case "B": {
            const s = ch === "A" ? 0 : 1;
            cells[i] = s + 1;
            flags[i] = FLAG.CORE;
            cores[s] = i;
            break;
          }
          case "a":
            cells[i] = 1;
            break;
          case "b":
            cells[i] = 2;
            break;
          case "h":
            cells[i] = 2;
            hidden.push(i);
            break;
          case "*":
            flags[i] = FLAG.NODE;
            break;
          case "#":
            cells[i] = OWNER.SCAR;
            break;
          default:
            throw new Error(`unknown map symbol "${ch}"`);
        }
      });
    });
  });
  if (cores.some((c) => c < 0)) throw new Error("both seats need a Core");
  return { cells, flags, cores, hidden };
}

/** Build a live engine game for a position. Seat 0 (the learner) moves first. */
export function buildGame(spec: PositionSpec): LocalGame {
  const config = configOf(spec);
  const seed = spec.seed ?? 7;
  const blank = LocalGame.create(config, seed);
  const data = JSON.parse(blank.toJSON()) as GameData;
  blank.free();

  const { cells, flags, cores, hidden } = parseMap(spec);
  const kit = getKit(config.kit);
  const holding = (ids: string[] | "all" | undefined) => kit.pieces.map((p) => ids === undefined || ids === "all" || ids.includes(p.id));
  for (const ids of spec.pieces ?? []) {
    if (ids === "all") continue;
    for (const id of ids) if (!kit.pieces.some((p) => p.id === id)) throw new Error(`unknown piece ${id}`);
  }

  data.state.cells = cells;
  data.state.flags = flags;
  data.state.cores = cores;
  data.state.turn = 0;
  data.state.seats = [0, 1].map((s) => ({
    pieces: holding(spec.pieces?.[s]),
    charge: spec.charge?.[s] ?? 0,
    dark: spec.dark?.[s] ?? false,
    resigned: false,
  }));

  if (config.fog !== null) {
    // Everyone starts out knowing the map except the hidden light.
    const remembered = cells.map((c, i) => (hidden.includes(i) ? OWNER.EMPTY : c));
    data.memory = [remembered.slice(), cells.slice(), remembered.slice()];
    data.memoryFlags = [flags.slice(), flags.slice(), flags.slice()];
  }

  return LocalGame.fromJSON(JSON.stringify(data));
}

/** Cell index from coordinates for a spec (handy in chapter definitions). */
export function at(dims: Vec3, x: number, y: number, z = 0): number {
  return x + dims[0] * (y + dims[1] * z);
}

/** Cells in a rectangle (inclusive), on layer z. */
export function rect(dims: Vec3, x0: number, y0: number, x1: number, y1: number, z = 0): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(at(dims, x, y, z));
  return out;
}
