/**
 * Cells → closed boundary loops.
 *
 * Cells live on a w-wide grid (index = x + w*y). A cell (x, y) covers the unit
 * square [x, x+1] × [y, y+1] in screen space (y grows downward).
 *
 * Every loop is returned as its corner vertices only (collinear points are
 * merged), without repeating the first vertex. Outer boundaries run clockwise
 * on screen and have positive area; holes run counter-clockwise and have
 * negative area, so a path built from all loops renders correctly with either
 * fill rule.
 *
 * Cells that only touch diagonally always end up in separate loops (the
 * tracer turns toward the inside at pinch vertices), matching the game's
 * 4-connected notion of a shard.
 */

export type Vertex = [x: number, y: number];
export type Loop = Vertex[];

interface Edge {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  used: boolean;
}

/** Trace every boundary loop of a set of cells. */
export function traceLoops(cells: Iterable<number>, w: number): Loop[] {
  const set = cells instanceof Set ? (cells as Set<number>) : new Set(cells);
  if (set.size === 0) return [];
  const has = (x: number, y: number) => x >= 0 && x < w && y >= 0 && set.has(x + w * y);
  const W = w + 1;
  const key = (x: number, y: number) => x + W * y;
  const out = new Map<number, Edge[]>();
  const edges: Edge[] = [];
  const add = (fx: number, fy: number, tx: number, ty: number) => {
    const e: Edge = { fx, fy, tx, ty, used: false };
    edges.push(e);
    const k = key(fx, fy);
    const list = out.get(k);
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  for (const i of set) {
    if (i < 0) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    // Clockwise on screen: interior on the right of travel.
    if (!has(x, y - 1)) add(x, y, x + 1, y);
    if (!has(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) add(x, y + 1, x, y);
  }
  // Deterministic order: start loops from the top-left-most unused edge.
  edges.sort((a, b) => a.fy - b.fy || a.fx - b.fx || a.ty - b.ty || a.tx - b.tx);

  const loops: Loop[] = [];
  for (const start of edges) {
    if (start.used) continue;
    const raw: Vertex[] = [];
    let e: Edge = start;
    for (;;) {
      e.used = true;
      raw.push([e.fx, e.fy]);
      if (e.tx === start.fx && e.ty === start.fy) break;
      const cands = out.get(key(e.tx, e.ty))!.filter((c) => !c.used);
      if (cands.length === 0) break; // cannot happen for a valid cell set
      const dx = e.tx - e.fx;
      const dy = e.ty - e.fy;
      let best = cands[0]!;
      let bestTurn = -Infinity;
      for (const c of cands) {
        const cx = c.tx - c.fx;
        const cy = c.ty - c.fy;
        // In y-down space, cross > 0 is a clockwise (right) turn. Prefer right,
        // then straight, then left, so diagonal neighbours stay apart.
        const cross = dx * cy - dy * cx;
        const dot = dx * cx + dy * cy;
        const turn = cross > 0 ? 2 : dot > 0 ? 1 : 0;
        if (turn > bestTurn) {
          bestTurn = turn;
          best = c;
        }
      }
      e = best;
    }
    loops.push(simplify(raw));
  }
  return loops;
}

/** Drop vertices that sit on a straight run. */
function simplify(raw: Vertex[]): Loop {
  const n = raw.length;
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const p = raw[(i - 1 + n) % n]!;
    const c = raw[i]!;
    const q = raw[(i + 1) % n]!;
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross !== 0) out.push(c);
  }
  return out;
}

/** Signed area (shoelace). Positive for clockwise-on-screen outer loops. */
export function loopArea(loop: readonly Vertex[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** 4-connected components of a cell set (no wrapping). Each component is sorted ascending. */
export function components(cells: Iterable<number>, w: number): number[][] {
  const set = new Set(cells);
  const seen = new Set<number>();
  const result: number[][] = [];
  const sorted = [...set].sort((a, b) => a - b);
  for (const s of sorted) {
    if (seen.has(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j >= 0 && set.has(j) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    comp.sort((a, b) => a - b);
    result.push(comp);
  }
  return result;
}

/** Scale loops to user units and emit a single SVG path (straight edges). */
export function loopsToPath(loops: readonly Loop[], unit: number): string {
  let d = "";
  for (const loop of loops) {
    if (loop.length === 0) continue;
    d += "M" + loop.map(([x, y]) => `${x * unit} ${y * unit}`).join("L") + "Z";
  }
  return d;
}
