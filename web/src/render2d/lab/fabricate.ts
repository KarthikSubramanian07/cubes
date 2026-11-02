/**
 * A tiny stand-in rules engine for the Paper lab. It knows just enough of the
 * link rule (corner touch, no edge contact with your own light) to fabricate
 * believable boards and simulate placements. The real rules live in Rust.
 */
import { FLAG, OWNER, type BoardShape, type GameConfig, type SeatView, type View } from "@/engine/types";
import { hashSeed, mulberry32 } from "../ink";

type Cell = [number, number];

/** Base shapes of sizes 2–5 (one of each free polyomino). */
export const SHAPES: { name: string; cells: Cell[] }[] = [
  { name: "I2", cells: [[0, 0], [1, 0]] },
  { name: "I3", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "V3", cells: [[0, 0], [0, 1], [1, 1]] },
  { name: "I4", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: "L4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "T4", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: "S4", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "O4", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "F", cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] },
  { name: "I5", cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { name: "L5", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] },
  { name: "N", cells: [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]] },
  { name: "P", cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { name: "T5", cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { name: "U", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "V5", cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  { name: "W", cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { name: "X", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { name: "Y", cells: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
  { name: "Z", cells: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]] },
];

function normalise(cells: Cell[]): Cell[] {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** All distinct rotations and reflections of a shape. */
export function orientations(cells: Cell[]): Cell[][] {
  const seen = new Set<string>();
  const out: Cell[][] = [];
  let cur = cells;
  for (let flip = 0; flip < 2; flip++) {
    for (let r = 0; r < 4; r++) {
      const n = normalise(cur);
      const k = JSON.stringify(n);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(n);
      }
      cur = cur.map(([x, y]) => [-y, x] as Cell);
    }
    cur = cur.map(([x, y]) => [-x, y] as Cell);
  }
  return out;
}

export const ORIENTS = SHAPES.map((s) => orientations(s.cells));

export function shapeMask(w: number, h: number, shape: BoardShape): Uint8Array {
  const m = new Uint8Array(w * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const cut = Math.round(Math.min(w, h) * 0.28);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = true;
      if (shape === "octagon") {
        ok = x + y >= cut && w - 1 - x + y >= cut && x + (h - 1 - y) >= cut && w - 1 - x + (h - 1 - y) >= cut;
      } else if (shape === "cross") {
        const band = Math.round(Math.min(w, h) * 0.3);
        ok = Math.abs(x - cx) <= band || Math.abs(y - cy) <= band;
      } else if (shape === "diamond") {
        ok = Math.abs(x - cx) + Math.abs(y - cy) <= Math.min(w, h) / 2 + 1;
      }
      m[x + w * y] = ok ? 1 : 0;
    }
  }
  return m;
}

export interface LabOptions {
  w: number;
  h: number;
  seats: number;
  shape?: BoardShape;
  torus?: boolean;
  nodes?: boolean;
  fog?: number | null;
  seed?: number;
}

export class LabGame {
  readonly w: number;
  readonly h: number;
  readonly seats: number;
  readonly shape: BoardShape;
  readonly torus: boolean;
  readonly fog: number | null;
  cells: number[];
  flags: number[];
  cores: number[];
  kits: boolean[][];
  turn = 0;
  ply = 0;
  round = 1;
  stormLevel = 0;
  /** Per-seat fog memory: last seen owner code, or -1 if never seen. */
  memory: number[][];
  private rand: () => number;

  constructor(o: LabOptions) {
    this.w = o.w;
    this.h = o.h;
    this.seats = o.seats;
    this.shape = o.shape ?? "square";
    this.torus = o.torus ?? false;
    this.fog = o.fog ?? null;
    this.rand = mulberry32(o.seed ?? 7);
    const n = o.w * o.h;
    const mask = shapeMask(o.w, o.h, this.shape);
    this.cells = Array.from({ length: n }, (_, i) => (mask[i] ? OWNER.EMPTY : OWNER.VOID));
    this.flags = new Array(n).fill(0);
    this.kits = Array.from({ length: o.seats }, () => SHAPES.map(() => true));
    this.memory = Array.from({ length: o.seats }, () => new Array(n).fill(-1));
    // Cores inset from the corners (pulled inward on cut-corner boards).
    const inset = this.shape === "square" ? Math.max(2, Math.round(o.w * 0.15)) : Math.round(o.w * 0.3);
    const spots: Cell[] = [
      [inset, inset],
      [o.w - 1 - inset, o.h - 1 - inset],
      [o.w - 1 - inset, inset],
      [inset, o.h - 1 - inset],
    ];
    const order = o.seats === 2 ? [0, 1] : [0, 2, 1, 3];
    this.cores = order.slice(0, o.seats).map((k) => {
      const [x, y] = spots[k]!;
      return x + o.w * y;
    });
    this.cores.forEach((i, s) => {
      this.cells[i] = s + 1;
      this.flags[i] = (this.flags[i] ?? 0) | FLAG.CORE;
    });
    if (o.nodes) this.placeNodes();
    this.refreshMemory();
  }

  private placeNodes() {
    const { w, h } = this;
    const quarter: Cell[] = [
      [Math.round(w * 0.32), Math.round(h * 0.12)],
      [Math.round(w * 0.45), Math.round(h * 0.3)],
      [Math.round(w * 0.2), Math.round(h * 0.4)],
      [Math.round(w * 0.12), Math.round(h * 0.22)],
    ];
    for (const [x0, y0] of quarter) {
      let x = x0;
      let y = y0;
      for (let r = 0; r < 4; r++) {
        const i = x + w * y;
        if (this.cells[i] === OWNER.EMPTY) this.flags[i] = (this.flags[i] ?? 0) | FLAG.NODE;
        [x, y] = [w - 1 - y, x];
      }
    }
  }

  idx(x: number, y: number): number | null {
    let xx = x;
    let yy = y;
    if (this.torus) {
      xx = ((x % this.w) + this.w) % this.w;
      yy = ((y % this.h) + this.h) % this.h;
    } else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return xx + this.w * yy;
  }

  /** Cells for shape/orient anchored so its first cell lands on `at`. */
  cellsFor(piece: number, orient: number, at: number): number[] | null {
    const o = ORIENTS[piece]![orient % ORIENTS[piece]!.length]!;
    const ax = at % this.w;
    const ay = Math.floor(at / this.w);
    const [fx, fy] = o[0]!;
    const out: number[] = [];
    for (const [cx, cy] of o) {
      const i = this.idx(ax + cx - fx, ay + cy - fy);
      if (i == null) return null;
      out.push(i);
    }
    return out;
  }

  isLegal(seat: number, cells: number[]): boolean {
    const own = seat + 1;
    let corner = false;
    const set = new Set(cells);
    for (const i of cells) {
      if (this.cells[i] !== OWNER.EMPTY) return false;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const j = this.idx(x + dx, y + dy);
        if (j != null && !set.has(j) && this.cells[j] === own) return false;
      }
      for (const [dx, dy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const j = this.idx(x + dx, y + dy);
        if (j != null && this.cells[j] === own) corner = true;
      }
    }
    return corner;
  }

  /** Empty cells diagonally touching the seat's light without edge contact. */
  attachCells(seat: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === OWNER.EMPTY && this.isLegal(seat, [i])) out.push(i);
    return out;
  }

  legal(seat: number): { piece: number; cells: number[] }[] {
    const out: { piece: number; cells: number[] }[] = [];
    const anchors = this.attachCells(seat);
    if (anchors.length === 0) return out;
    const seen = new Set<number>();
    const n = this.cells.length;
    this.kits[seat]!.forEach((left, piece) => {
      if (!left) return;
      ORIENTS[piece]!.forEach((o, oi) => {
        for (const a of anchors) {
          const ax = a % this.w;
          const ay = Math.floor(a / this.w);
          // Try every cell of the orientation on the anchor.
          for (const [px, py] of o) {
            const origin = this.idx(ax - px, ay - py);
            if (origin == null) continue;
            const k = (piece * 8 + oi) * n + origin;
            if (seen.has(k)) continue;
            seen.add(k);
            const cells: number[] = [];
            let ok = true;
            for (const [cx, cy] of o) {
              const i = this.idx(ax + cx - px, ay + cy - py);
              if (i == null || this.cells[i] !== OWNER.EMPTY) {
                ok = false;
                break;
              }
              cells.push(i);
            }
            if (ok && this.isLegal(seat, cells)) out.push({ piece, cells });
          }
        }
      });
    });
    return out;
  }

  /** Place for the current seat; returns the cells or null if the seat is stuck. */
  step(): { seat: number; cells: number[] } | null {
    for (let tries = 0; tries < this.seats; tries++) {
      const seat = this.turn;
      const moves = this.legal(seat);
      this.advance();
      if (moves.length === 0) continue;
      // Prefer big shards, spread out toward the middle, with some noise.
      const cx = (this.w - 1) / 2;
      const cy = (this.h - 1) / 2;
      let best = moves[0]!;
      let bestScore = -Infinity;
      for (const m of moves) {
        const size = m.cells.length;
        let spread = 0;
        for (const c of m.cells) spread -= Math.hypot((c % this.w) - cx, Math.floor(c / this.w) - cy);
        const score = size * 10 + spread * 0.35 + this.rand() * 9;
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
      this.place(seat, best.piece, best.cells);
      return { seat, cells: best.cells };
    }
    return null;
  }

  place(seat: number, piece: number, cells: number[]) {
    for (const c of cells) this.cells[c] = seat + 1;
    if (piece >= 0) this.kits[seat]![piece] = false;
    this.ply++;
    this.refreshMemory();
  }

  private advance() {
    this.turn = (this.turn + 1) % this.seats;
    if (this.turn === 0) this.round++;
  }

  /** Destroy a random opponent cell of `seat` (not a core). */
  shatter(bySeat: number): number | null {
    const victims: number[] = [];
    this.cells.forEach((o, i) => {
      if (o >= 1 && o <= 4 && o !== bySeat + 1 && !(this.flags[i]! & FLAG.CORE)) victims.push(i);
    });
    if (!victims.length) return null;
    const v = victims[Math.floor(this.rand() * victims.length)]!;
    this.cells[v] = OWNER.SCAR;
    this.refreshMemory();
    return v;
  }

  /** Collapse the outermost living ring into ash. */
  storm(): number[] {
    const out: number[] = [];
    const lvl = this.stormLevel;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = x + this.w * y;
        if (this.cells[i] === OWNER.VOID || this.cells[i] === OWNER.ASH) continue;
        // Ring = playable cells within `lvl` of a void cell or the edge.
        let edge = false;
        for (let dy = -lvl - 1; dy <= lvl + 1 && !edge; dy++)
          for (let dx = -lvl - 1; dx <= lvl + 1 && !edge; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h || this.cells[xx + this.w * yy] === OWNER.VOID) edge = true;
          }
        if (edge && !(this.flags[i]! & FLAG.CORE)) out.push(i);
      }
    }
    for (const i of out) this.cells[i] = OWNER.ASH;
    this.stormLevel++;
    this.refreshMemory();
    return out;
  }

  visibleTo(seat: number): Uint8Array {
    const n = this.cells.length;
    const vis = new Uint8Array(n);
    if (this.fog == null) return vis.fill(1);
    const r = this.fog;
    for (let i = 0; i < n; i++) {
      if (this.cells[i] !== seat + 1) continue;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const j = this.idx(x + dx, y + dy);
          if (j != null) vis[j] = 1;
        }
    }
    return vis;
  }

  private refreshMemory() {
    for (let s = 0; s < this.seats; s++) {
      const vis = this.visibleTo(s);
      const mem = this.memory[s]!;
      for (let i = 0; i < this.cells.length; i++) if (vis[i]) mem[i] = this.cells[i]!;
    }
  }

  /** A Scan surge: the seat sees (and remembers) the whole board for a moment. */
  scan(seat: number, where: (x: number, y: number) => boolean = () => true) {
    const mem = this.memory[seat]!;
    this.cells.forEach((o, i) => {
      if (where(i % this.w, Math.floor(i / this.w))) mem[i] = o;
    });
  }

  /** Cells occupied by others that `seat` cannot currently see (misfire candidates). */
  hiddenOccupied(seat: number): number[] {
    const vis = this.visibleTo(seat);
    const out: number[] = [];
    this.cells.forEach((o, i) => {
      if (!vis[i] && o >= 1 && o <= 4 && o !== seat + 1 && !(this.flags[i]! & FLAG.CORE)) out.push(i);
    });
    return out;
  }

  config(): GameConfig {
    return {
      dims: [this.w, this.h, 1],
      shape: this.shape,
      topology: this.torus ? "torus" : "flat",
      gravity: false,
      seats: this.seats,
      teams: false,
      sharedLight: false,
      arena: true,
      nodes: 16,
      fog: this.fog,
      storm: null,
      crowns: false,
      turnSeconds: null,
      kit: "shards",
    };
  }

  view(seat: number | null): View {
    const n = this.cells.length;
    const cells = new Array<number>(n);
    const flags = new Array<number>(n);
    const vis = seat != null ? this.visibleTo(seat) : new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      const o = this.cells[i]!;
      const base = this.flags[i]! & (FLAG.NODE | FLAG.CORE);
      if (o === OWNER.VOID || o === OWNER.ASH || vis[i]) {
        cells[i] = o;
        flags[i] = base | (o === OWNER.VOID ? 0 : FLAG.VISIBLE);
        continue;
      }
      const m = this.memory[seat!]![i]!;
      if (m >= 0) {
        cells[i] = m === OWNER.ASH ? OWNER.EMPTY : m;
        flags[i] = base | FLAG.STALE;
      } else {
        cells[i] = OWNER.EMPTY;
        flags[i] = base & FLAG.NODE;
      }
      if (this.flags[i]! & FLAG.CORE) {
        // Cores are public.
        cells[i] = o;
        flags[i] = base | FLAG.STALE;
      }
    }
    const seats: SeatView[] = Array.from({ length: this.seats }, (_, s) => ({
      seat: s,
      team: s,
      pieces: this.fog != null && s !== seat ? null : [...this.kits[s]!],
      piecesLeft: this.kits[s]!.filter(Boolean).length,
      charge: this.fog != null && s !== seat ? null : 2,
      dark: false,
      resigned: false,
      score: null,
      core: this.cores[s]!,
    }));
    return {
      config: this.config(),
      seat,
      cells,
      flags,
      seats,
      turn: this.turn,
      round: this.round,
      ply: this.ply,
      phase: "playing",
      stormLevel: this.stormLevel,
      nextStorm: null,
      scanning: false,
      shatteredThisTurn: false,
      events: [],
      scores: null,
      winners: null,
    };
  }
}

export type SceneName = "plane" | "fog" | "octagon" | "torus";

export const SCENES: { id: SceneName; title: string; note: string }[] = [
  { id: "plane", title: "Plane", note: "20 × 20, four seats, nodes, scars and a storm ring" },
  { id: "fog", title: "Fog", note: "the same page from Clay's side: memory in pencil" },
  { id: "octagon", title: "Octagon", note: "cut corners, two seats" },
  { id: "torus", title: "Torus", note: "18 × 18, every edge wraps" },
];

/** Build a believable mid-game for a scene. */
export function fabricate(scene: SceneName): LabGame {
  switch (scene) {
    case "plane":
    case "fog": {
      const g = new LabGame({ w: 20, h: 20, seats: 4, nodes: true, fog: scene === "fog" ? 2 : null, seed: 11 });
      for (let i = 0; i < 4 * 3; i++) g.step();
      g.scan(0, (x, y) => x + y < 26);
      for (let i = 0; i < 4; i++) g.step();
      g.storm();
      for (let i = 0; i < 4 * 2; i++) g.step();
      g.shatter(0);
      g.shatter(2);
      g.shatter(1);
      return g;
    }
    case "octagon": {
      const g = new LabGame({ w: 16, h: 16, seats: 2, shape: "octagon", nodes: true, seed: 5 });
      for (let i = 0; i < 2 * 7; i++) g.step();
      return g;
    }
    case "torus": {
      const g = new LabGame({ w: 18, h: 18, seats: 4, torus: true, nodes: true, seed: hashSeed(18) });
      for (let i = 0; i < 4 * 5; i++) g.step();
      return g;
    }
  }
}
