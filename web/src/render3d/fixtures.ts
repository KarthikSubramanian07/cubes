/**
 * Fabricated Views for the lab, tests and screenshots. Nothing here is the
 * real rules engine: growth only approximates the corner-link rule so boards
 * look like games in progress.
 */
import { FLAG, OWNER, type BoardShape, type GameConfig, type GameEvent, type SeatView, type Vec3, type View } from "@/engine/types";

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

export function baseConfig(dims: Vec3, patch: Partial<GameConfig> = {}): GameConfig {
  return {
    dims,
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
    kit: dims[2] > 1 ? "cubes" : "shards",
    ...patch,
  };
}

/** Mutable working state for fabricating boards. */
export interface Board {
  config: GameConfig;
  cells: Int16Array;
  flags: Uint8Array;
  cores: number[];
}

function idx(dims: Vec3, x: number, y: number, z: number): number {
  return x + dims[0] * (y + dims[1] * z);
}
function xyz(dims: Vec3, i: number): Vec3 {
  return [i % dims[0], Math.floor(i / dims[0]) % dims[1], Math.floor(i / (dims[0] * dims[1]))];
}
function inside(dims: Vec3, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2];
}

export function isVoidColumn(shape: BoardShape, w: number, h: number, x: number, y: number): boolean {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  switch (shape) {
    case "square":
      return false;
    case "octagon": {
      const cut = Math.floor(Math.min(w, h) * 0.22);
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(y, h - 1 - y);
      return dx + dy < cut;
    }
    case "cross": {
      const arm = Math.floor(Math.min(w, h) * 0.3);
      const inX = x >= arm && x < w - arm;
      const inY = y >= arm && y < h - arm;
      return !inX && !inY;
    }
    case "diamond":
      return Math.abs(x - cx) / (w / 2) + Math.abs(y - cy) / (h / 2) > 1.08;
  }
}

export function newBoard(config: GameConfig, cores: Vec3[]): Board {
  const [w, h, d] = config.dims;
  const n = w * h * d;
  const cells = new Int16Array(n);
  const flags = new Uint8Array(n);
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (isVoidColumn(config.shape, w, h, x, y)) cells[idx(config.dims, x, y, z)] = OWNER.VOID;
  const coreCells: number[] = [];
  cores.slice(0, config.seats).forEach(([x0, y0, z], seat) => {
    // Shaped boards: walk the core towards the centre until it sits two cells inside the outline.
    let x = x0;
    let y = y0;
    const inset = (px: number, py: number) =>
      [0, 1, 2].every((k) => {
        const qx = px + Math.sign(px - (w - 1) / 2) * k;
        const qy = py + Math.sign(py - (h - 1) / 2) * k;
        return qx >= 0 && qy >= 0 && qx < w && qy < h && !isVoidColumn(config.shape, w, h, qx, qy);
      });
    while (!inset(x, y) && Math.abs(x - (w - 1) / 2) > 1) {
      x -= Math.sign(x - (w - 1) / 2);
      y -= Math.sign(y - (h - 1) / 2);
    }
    const c = idx(config.dims, x, y, z);
    cells[c] = seat + 1;
    flags[c]! |= FLAG.CORE;
    coreCells.push(c);
  });
  return { config, cells, flags, cores: coreCells };
}

function neighbours(dims: Vec3, i: number, kind: "face" | "corner"): number[] {
  const [x, y, z] = xyz(dims, i);
  const out: number[] = [];
  const zr = dims[2] > 1 ? 1 : 0;
  for (let dz = -zr; dz <= zr; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (m === 0) continue;
        if ((kind === "face") !== (m === 1)) continue;
        if (inside(dims, x + dx, y + dy, z + dz)) out.push(idx(dims, x + dx, y + dy, z + dz));
      }
  return out;
}

function supported(b: Board, i: number, piece: Set<number>): boolean {
  if (!b.config.gravity) return true;
  const [x, y, z] = xyz(b.config.dims, i);
  if (z === 0) return true;
  const below = idx(b.config.dims, x, y, z - 1);
  const o = b.cells[below]!;
  return piece.has(below) || (o !== OWNER.EMPTY && o !== OWNER.VOID && o !== OWNER.ASH);
}

function touchesOwnFace(b: Board, i: number, seat: number): boolean {
  return neighbours(b.config.dims, i, "face").some((j) => b.cells[j] === seat + 1);
}

/** Grow one corner-linked piece for `seat`. Returns its cells, or [] when stuck. */
export function growPiece(b: Board, seat: number, r: Rng, size?: number): number[] {
  const dims = b.config.dims;
  const own = seat + 1;
  const anchors: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i] !== OWNER.EMPTY) continue;
    if (touchesOwnFace(b, i, seat)) continue;
    if (!neighbours(dims, i, "corner").some((j) => b.cells[j] === own)) continue;
    if (!supported(b, i, new Set())) continue;
    anchors.push(i);
  }
  if (!anchors.length) return [];
  const target = size ?? 2 + Math.floor(r() * 4);
  for (let attempt = 0; attempt < 6; attempt++) {
    const piece = new Set<number>([pick(r, anchors)]);
    while (piece.size < target) {
      const frontier: number[] = [];
      for (const c of piece)
        for (const j of neighbours(dims, c, "face"))
          if (!piece.has(j) && b.cells[j] === OWNER.EMPTY && !touchesOwnFace(b, j, seat) && supported(b, j, piece)) frontier.push(j);
      if (!frontier.length) break;
      piece.add(pick(r, frontier));
    }
    if (piece.size >= Math.min(2, target)) {
      for (const c of piece) {
        b.cells[c] = own;
        b.flags[c]! &= ~FLAG.NODE;
      }
      return [...piece];
    }
  }
  return [];
}

function scatterNodes(b: Board, base: Vec3[]): void {
  const [w] = b.config.dims;
  for (const [x, y, z] of base) {
    // four-fold rotational symmetry so every seat gets the same map
    let px = x;
    let py = y;
    for (let k = 0; k < 4; k++) {
      if (inside(b.config.dims, px, py, z)) {
        const c = idx(b.config.dims, px, py, z);
        if (b.cells[c] === OWNER.EMPTY) b.flags[c]! |= FLAG.NODE;
      }
      // rotate 90 degrees about the board centre (boards with nodes are square)
      const nx = w - 1 - py;
      const ny = px;
      px = nx;
      py = ny;
    }
  }
}

export function stormRing(b: Board, level: number): number[] {
  const [w, h, d] = b.config.dims;
  const out: number[] = [];
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const ring = Math.min(x, y, w - 1 - x, h - 1 - y);
        const c = idx(b.config.dims, x, y, z);
        if (ring === level && b.cells[c] !== OWNER.VOID && b.cells[c] !== OWNER.ASH) out.push(c);
      }
  return out;
}

/** Last-seen memory for fog: -1 = never seen. */
export type FogMemory = Int16Array;

export function newMemory(b: Board): FogMemory {
  return new Int16Array(b.cells.length).fill(-1);
}

/** Produce a seat's View from the truth board, applying fog and updating memory. */
export function viewOf(
  b: Board,
  seat: number | null,
  opts: { ply?: number; round?: number; stormLevel?: number; events?: GameEvent[]; memory?: FogMemory } = {},
): View {
  const { config } = b;
  const n = b.cells.length;
  const cells = Array.from(b.cells);
  const flags = Array.from(b.flags, (f) => f & (FLAG.NODE | FLAG.CORE));
  const radius = config.fog;
  if (radius === null || seat === null) {
    for (let i = 0; i < n; i++) flags[i]! |= FLAG.VISIBLE;
  } else {
    const dims = config.dims;
    const seen = new Uint8Array(n);
    const zr = dims[2] > 1 ? radius : 0;
    for (let i = 0; i < n; i++) {
      if (b.cells[i] !== seat + 1) continue;
      const [x, y, z] = xyz(dims, i);
      for (let dz = -zr; dz <= zr; dz++)
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++)
            if (inside(dims, x + dx, y + dy, z + dz)) seen[idx(dims, x + dx, y + dy, z + dz)] = 1;
    }
    const mem = opts.memory;
    for (let i = 0; i < n; i++) {
      const truth = b.cells[i]!;
      if (truth === OWNER.VOID || truth === OWNER.ASH) {
        flags[i]! |= FLAG.VISIBLE; // board outline and storm ash are public
        continue;
      }
      if (seen[i]) {
        flags[i]! |= FLAG.VISIBLE;
        if (mem) mem[i] = truth;
      } else {
        const remembered = mem ? mem[i]! : -1;
        const shown = remembered < 0 ? OWNER.EMPTY : remembered;
        cells[i] = shown;
        if (shown !== OWNER.EMPTY) flags[i]! |= FLAG.STALE;
        // other seats' cores are always known
        if (b.flags[i]! & FLAG.CORE) {
          cells[i] = truth;
          flags[i]! |= FLAG.STALE;
        }
      }
    }
  }

  const seats: SeatView[] = [];
  for (let s = 0; s < config.seats; s++) {
    let score = 0;
    for (let i = 0; i < n; i++) if (b.cells[i] === s + 1 && !(b.flags[i]! & FLAG.CORE)) score++;
    seats.push({
      seat: s,
      team: config.teams ? s % 2 : s,
      pieces: null,
      piecesLeft: 12,
      charge: 2,
      dark: false,
      resigned: false,
      score: radius === null ? score : null,
      core: b.cores[s] ?? 0,
    });
  }
  const ply = opts.ply ?? 0;
  return {
    config,
    seat,
    cells,
    flags,
    seats,
    turn: ply % config.seats,
    round: opts.round ?? Math.floor(ply / config.seats) + 1,
    ply,
    phase: "playing",
    stormLevel: opts.stormLevel ?? 0,
    nextStorm: config.storm ? (opts.round ?? 1) + config.storm.every : null,
    scanning: false,
    shatteredThisTurn: false,
    events: opts.events ?? [],
    scores: radius === null ? seats.map((s) => s.score ?? 0) : null,
    winners: null,
  };
}

function scar(b: Board, r: Rng, count: number): void {
  for (let k = 0; k < count; k++) {
    const cand: number[] = [];
    for (let i = 0; i < b.cells.length; i++) {
      const o = b.cells[i]!;
      if (o < 1 || o > 4 || b.flags[i]! & FLAG.CORE) continue;
      if (b.config.dims[2] > 1) {
        const [x, y, z] = xyz(b.config.dims, i);
        if (z + 1 < b.config.dims[2] && b.cells[idx(b.config.dims, x, y, z + 1)] !== OWNER.EMPTY) continue;
      }
      cand.push(i);
    }
    if (cand.length) b.cells[pick(r, cand)] = OWNER.SCAR;
  }
}

export interface Scenario {
  board: Board;
  seat: number | null;
  ply: number;
  stormLevel: number;
  memory: FogMemory;
}

export interface PlaneOptions {
  seed?: number;
  shape?: BoardShape;
  fog?: boolean;
  storm?: boolean;
  rounds?: number;
}

/** A 20×20 four-seat game mid-play with nodes, cores, scars, storm ash and optional fog. */
export function planeScenario(opts: PlaneOptions = {}): Scenario {
  const r = rng(opts.seed ?? 7);
  const config = baseConfig([20, 20, 1], {
    shape: opts.shape ?? "square",
    fog: opts.fog ? 2 : null,
    storm: opts.storm === false ? null : { start: 6, every: 3, minSpan: 8 },
  });
  const b = newBoard(config, [
    [3, 3, 0],
    [16, 3, 0],
    [16, 16, 0],
    [3, 16, 0],
  ]);
  scatterNodes(b, [
    [7, 7, 0],
    [5, 10, 0],
    [9, 4, 0],
  ]);
  const rounds = opts.rounds ?? 7;
  for (let k = 0; k < rounds; k++) for (let s = 0; s < 4; s++) growPiece(b, s, r);
  scar(b, r, 3);
  let stormLevel = 0;
  if (opts.storm !== false) {
    for (const c of stormRing(b, 0)) b.cells[c] = OWNER.ASH;
    stormLevel = 1;
  }
  const memory = newMemory(b);
  if (opts.fog) {
    // Pretend we glimpsed parts of the board earlier: stale memories to render.
    for (let i = 0; i < b.cells.length; i++) {
      const o = b.cells[i]!;
      if (o >= 1 && o <= 4 && o !== 1 && r() < 0.45) memory[i] = o;
    }
  }
  return { board: b, seat: 0, ply: rounds * 4, stormLevel, memory };
}

/** An 8×8×8 gravity stack, four seats climbing on each other. */
export function stackScenario(seed = 11, rounds = 9): Scenario {
  const r = rng(seed);
  const config = baseConfig([8, 8, 8], { gravity: true, crowns: true, nodes: 8 });
  const b = newBoard(config, [
    [1, 1, 0],
    [6, 1, 0],
    [6, 6, 0],
    [1, 6, 0],
  ]);
  scatterNodes(b, [
    [3, 2, 0],
    [2, 2, 2],
  ]);
  for (let k = 0; k < rounds; k++) for (let s = 0; s < 4; s++) growPiece(b, s, r, 1 + Math.floor(r() * 5));
  scar(b, r, 2);
  return { board: b, seat: 0, ply: rounds * 4, stormLevel: 0, memory: newMemory(b) };
}

/** A 7×7×7 free-floating orbit lattice. */
export function orbitScenario(seed = 5, rounds = 7): Scenario {
  const r = rng(seed);
  const config = baseConfig([7, 7, 7], { gravity: false, nodes: 8 });
  const b = newBoard(config, [
    [1, 1, 1],
    [5, 1, 5],
    [5, 5, 1],
    [1, 5, 5],
  ]);
  scatterNodes(b, [
    [3, 1, 3],
    [2, 2, 5],
  ]);
  b.flags[idx(config.dims, 3, 3, 3)]! |= FLAG.NODE;
  for (let k = 0; k < rounds; k++) for (let s = 0; s < 4; s++) growPiece(b, s, r, 1 + Math.floor(r() * 5));
  scar(b, r, 2);
  return { board: b, seat: 0, ply: rounds * 4, stormLevel: 0, memory: newMemory(b) };
}

export function scenarioView(s: Scenario, events: GameEvent[] = []): View {
  return viewOf(s.board, s.seat, { ply: s.ply, stormLevel: s.stormLevel, events, memory: s.memory });
}

/* ------------------------------------------------------------------ */
/* Lab simulations: mutate a scenario and return the events to show.   */
/* ------------------------------------------------------------------ */

export function simulatePlace(s: Scenario, r: Rng, seat?: number): GameEvent[] {
  const who = seat ?? s.ply % s.board.config.seats;
  const before = new Uint8Array(s.board.flags);
  const cells = growPiece(s.board, who, r);
  s.ply++;
  if (!cells.length) return [];
  const events: GameEvent[] = [{ type: "placed", seat: who, piece: 0, cells, leap: false, spark: cells.length === 1, hidden: false }];
  for (const c of cells) if (before[c]! & FLAG.NODE) events.push({ type: "node", seat: who, cell: c });
  return events;
}

/** Place a piece for `seat` that deliberately covers a node, when one is reachable. */
export function simulateNodeGrab(s: Scenario, r: Rng, seat = 0): GameEvent[] {
  const b = s.board;
  const nodes: number[] = [];
  for (let i = 0; i < b.cells.length; i++) if (b.flags[i]! & FLAG.NODE && b.cells[i] === OWNER.EMPTY && supported(b, i, new Set())) nodes.push(i);
  if (!nodes.length) return simulatePlace(s, r, seat);
  const c = pick(r, nodes);
  b.cells[c] = seat + 1;
  b.flags[c]! &= ~FLAG.NODE;
  s.ply++;
  return [
    { type: "placed", seat, piece: 0, cells: [c], leap: true, spark: true, hidden: false },
    { type: "node", seat, cell: c },
  ];
}

export function simulateShatter(s: Scenario, r: Rng, seat = 0): GameEvent[] {
  const b = s.board;
  const cand: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const o = b.cells[i]!;
    if (o < 1 || o > 4 || o === seat + 1 || b.flags[i]! & FLAG.CORE) continue;
    if (b.config.dims[2] > 1) {
      const [x, y, z] = xyz(b.config.dims, i);
      if (z + 1 < b.config.dims[2] && b.cells[idx(b.config.dims, x, y, z + 1)] !== OWNER.EMPTY) continue;
    }
    cand.push(i);
  }
  if (!cand.length) return [];
  const c = pick(r, cand);
  const victim = b.cells[c]! - 1;
  b.cells[c] = OWNER.SCAR;
  return [{ type: "shattered", seat, cell: c, victim }];
}

export function simulateStorm(s: Scenario): GameEvent[] {
  const cells = stormRing(s.board, s.stormLevel);
  if (!cells.length) return [];
  for (const c of cells) {
    s.board.cells[c] = OWNER.ASH;
    s.board.flags[c] = 0;
  }
  s.stormLevel++;
  s.ply++;
  return [{ type: "storm", level: s.stormLevel, cells }];
}

export function simulateMisfire(s: Scenario, r: Rng, seat = 0): GameEvent[] {
  const b = s.board;
  const cand: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const o = b.cells[i]!;
    if (o >= 1 && o <= 4 && o !== seat + 1) cand.push(i);
  }
  if (!cand.length) return [];
  const first = pick(r, cand);
  const cells = [first, ...neighbours(b.config.dims, first, "face").filter((j) => cand.includes(j)).slice(0, 2)];
  s.ply++;
  return [{ type: "misfire", seat, cells }];
}

/** Cells covered by a shape (offsets) anchored at `anchor`, and whether the lab considers it placeable. */
export function ghostAt(view: View, anchor: number, shape: Vec3[]): { cells: number[]; valid: boolean } {
  const dims = view.config.dims;
  const [ax, ay, az] = xyz(dims, anchor);
  const cells: number[] = [];
  let valid = true;
  const set = new Set<number>();
  for (const [dx, dy, dz] of shape) {
    const x = ax + dx;
    const y = ay + dy;
    const z = az + dz;
    if (!inside(dims, x, y, z)) {
      valid = false;
      continue;
    }
    const c = idx(dims, x, y, z);
    cells.push(c);
    set.add(c);
    if (view.cells[c] !== OWNER.EMPTY) valid = false;
  }
  if (valid && view.config.gravity) {
    for (const c of cells) {
      const [x, y, z] = xyz(dims, c);
      if (z === 0) continue;
      const below = idx(dims, x, y, z - 1);
      const o = view.cells[below]!;
      if (!set.has(below) && (o === OWNER.EMPTY || o === OWNER.ASH)) valid = false;
    }
  }
  return { cells, valid };
}

/** Attach points: empty cells diagonal to `seat`'s light and not face-touching it. */
export function attachPoints(view: View, seat: number): number[] {
  const dims = view.config.dims;
  const out: number[] = [];
  const own = seat + 1;
  for (let i = 0; i < view.cells.length; i++) {
    if (view.cells[i] !== OWNER.EMPTY) continue;
    if (neighbours(dims, i, "face").some((j) => view.cells[j] === own)) continue;
    if (!neighbours(dims, i, "corner").some((j) => view.cells[j] === own)) continue;
    if (view.config.gravity) {
      const [x, y, z] = xyz(dims, i);
      if (z > 0) {
        const o = view.cells[idx(dims, x, y, z - 1)]!;
        if (o === OWNER.EMPTY || o === OWNER.ASH) continue;
      }
    }
    out.push(i);
  }
  return out;
}

