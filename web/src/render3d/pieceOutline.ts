/**
 * Piece outlines for the 2D Night board. The glass tiles are drawn one per
 * square with a gap between them, so on their own a placed piece reads as a
 * scatter of squares. This groups each seat's squares into pieces and traces
 * a border around each one, the way the Paper board inks them.
 *
 * A seat's own pieces may never share a side, so every side-connected group
 * of one seat's squares is exactly one piece. Cores stand alone as pillars
 * and are left out.
 */
import { FLAG, type View } from "@/engine/types";
import { components, traceLoops, type Loop, type Vertex } from "@/render2d/outline";

export interface PieceGroup {
  seat: number;
  /** Every square is remembered through fog rather than seen now. */
  stale: boolean;
  cells: number[];
  /** Boundary loops in board units (a square spans [x, x+1] × [y, y+1]). */
  loops: Loop[];
}

/** The pieces on a flat board, one group per piece. */
export function pieceGroups(view: View): PieceGroup[] {
  const [w, h] = view.config.dims;
  const bySeat: number[][] = [[], [], [], []];
  for (let i = 0; i < w * h; i++) {
    const o = view.cells[i]!;
    if (o < 1 || o > 4) continue;
    if (view.flags[i]! & FLAG.CORE) continue;
    bySeat[o - 1]!.push(i);
  }
  const out: PieceGroup[] = [];
  bySeat.forEach((cells, seat) => {
    for (const comp of components(cells, w)) {
      out.push({
        seat,
        stale: comp.every((i) => (view.flags[i]! & FLAG.STALE) !== 0),
        cells: comp,
        loops: traceLoops(comp, w),
      });
    }
  });
  return out;
}

/** Signed area in board units: outer loops are positive, holes negative. */
export function loopArea(loop: Loop): number {
  let a = 0;
  for (let k = 0; k < loop.length; k++) {
    const [x0, y0] = loop[k]!;
    const [x1, y1] = loop[(k + 1) % loop.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * Pull a loop towards its inside by `d`. Loops from traceLoops keep their
 * interior on the right of travel and only turn by right angles, so each
 * corner moves by `d` along both of its edges' inward normals.
 */
export function insetLoop(loop: Loop, d: number): Loop {
  const n = loop.length;
  const inward = (a: Vertex, b: Vertex): Vertex => {
    const dx = Math.sign(b[0] - a[0]);
    const dy = Math.sign(b[1] - a[1]);
    // Interior on the right of travel, with y growing downward.
    return [-dy, dx];
  };
  return loop.map((v, k) => {
    const prev = loop[(k - 1 + n) % n]!;
    const next = loop[(k + 1) % n]!;
    const a = inward(prev, v);
    const b = inward(v, next);
    return [v[0] + d * (a[0] + b[0]), v[1] + d * (a[1] + b[1])];
  });
}

/**
 * Flat ribbon quads tracing each loop, as triangle positions in board units
 * (x, y) at the given height. Each edge is extended by half the width at both
 * ends so corners close cleanly.
 */
export function ribbon(loops: readonly Loop[], width: number): number[] {
  const out: number[] = [];
  const hw = width / 2;
  for (const loop of loops) {
    for (let k = 0; k < loop.length; k++) {
      const [x0, y0] = loop[k]!;
      const [x1, y1] = loop[(k + 1) % loop.length]!;
      const dx = Math.sign(x1 - x0);
      const dy = Math.sign(y1 - y0);
      // Along the edge, extended; across it, ±half width.
      const ax = x0 - dx * hw;
      const ay = y0 - dy * hw;
      const bx = x1 + dx * hw;
      const by = y1 + dy * hw;
      const nx = -dy * hw;
      const ny = dx * hw;
      const p1 = [ax + nx, ay + ny];
      const p2 = [bx + nx, by + ny];
      const p3 = [bx - nx, by - ny];
      const p4 = [ax - nx, ay - ny];
      out.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
    }
  }
  return out;
}
