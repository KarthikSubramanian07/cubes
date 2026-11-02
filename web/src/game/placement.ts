/**
 * Placement maths for the controller: rotating and flipping a shard maps to
 * another orientation index of the same piece; a hovered cell plus a "grab"
 * offset gives an anchor; legal placements are snapped to when close.
 */
import type { Kit, Placement, Vec3 } from "@/engine/types";
import { cellCoords, cellIndex } from "@/engine/types";

export type Transform = "rotate" | "rotateBack" | "flip" | "pitch" | "roll";

function normalize(cells: Vec3[]): Vec3[] {
  let mx = Infinity;
  let my = Infinity;
  let mz = Infinity;
  for (const [x, y, z] of cells) {
    mx = Math.min(mx, x);
    my = Math.min(my, y);
    mz = Math.min(mz, z);
  }
  return cells
    .map(([x, y, z]) => [x - mx, y - my, z - mz] as Vec3)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

function key(cells: Vec3[]): string {
  return cells.map((c) => c.join(",")).join(";");
}

const MAPS: Record<Transform, (c: Vec3) => Vec3> = {
  rotate: ([x, y, z]) => [-y, x, z],
  rotateBack: ([x, y, z]) => [y, -x, z],
  flip: ([x, y, z]) => [-x, y, z],
  pitch: ([x, y, z]) => [x, -z, y],
  roll: ([x, y, z]) => [z, y, -x],
};

/**
 * The orientation index reached by applying `t` to orientation `orient` of
 * `piece`. In 3D kits `flip` is a mirror, which isn't allowed, so it maps to
 * a half turn instead.
 */
export function transformOrient(kit: Kit, piece: number, orient: number, t: Transform): number {
  const orients = piece === kit.sparkIndex ? [[[0, 0, 0] as Vec3]] : kit.pieces[piece]!.orients;
  const cells = orients[orient];
  if (!cells) return 0;
  let f = MAPS[t];
  if (kit.kind === "cubes" && t === "flip") f = ([x, y, z]) => [-x, -y, z];
  const target = key(normalize(cells.map(f)));
  const idx = orients.findIndex((o) => key(normalize(o)) === target);
  return idx < 0 ? orient : idx;
}

/** The cell of an orientation that sits under the cursor: the one nearest its centroid. */
export function grabOffset(cells: Vec3[]): Vec3 {
  const n = cells.length;
  const c = cells.reduce<Vec3>((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n], [0, 0, 0]);
  let best = cells[0]!;
  let bd = Infinity;
  for (const p of cells) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd - 1e-9) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Anchor so that the grab cell lands on `target`. For gravity boards, sit the shard's lowest layer on the target. */
export function anchorFor(dims: Vec3, cells: Vec3[], target: number): Vec3 {
  const [tx, ty, tz] = cellCoords(dims, target);
  const g = grabOffset(cells);
  return [tx - g[0], ty - g[1], dims[2] > 1 ? tz : tz - g[2]];
}

/**
 * Cells covered by an orientation anchored at `at`, or null if any cell
 * leaves the lattice (torus wraps x and y).
 */
export function cellsAt(dims: Vec3, cells: Vec3[], at: Vec3, torus = false): number[] | null {
  const out: number[] = [];
  for (const [dx, dy, dz] of cells) {
    let x = at[0] + dx;
    let y = at[1] + dy;
    const z = at[2] + dz;
    if (torus) {
      x = ((x % dims[0]) + dims[0]) % dims[0];
      y = ((y % dims[1]) + dims[1]) % dims[1];
    }
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return null;
    out.push(cellIndex(dims, x, y, z));
  }
  return out;
}

export interface SnapOptions {
  /** Let the snap pick another orientation of the shard (touch, and the last resort in 3D). */
  allowOrientChange?: boolean;
  /**
   * Lattice size. With `radius`, a target that no legal placement covers
   * snaps to the closest placement touching a cell within `radius`
   * (Chebyshev) of it. Used in 3D, where the cell under the pointer is often
   * face-adjacent to your own light and so can never be covered.
   */
  dims?: Vec3;
  radius?: number;
}

function chebyshev(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/**
 * Among legal placements of `piece` covering `target`, the one closest to
 * where the player is aiming: same orientation first, then smallest anchor
 * displacement. With `radius`, falls back to placements near the target.
 * Returns null when nothing qualifies.
 */
export function snapPlacement(
  legal: Placement[],
  piece: number,
  orient: number,
  target: number,
  preferredAt: Vec3 | null,
  opts: boolean | SnapOptions = false,
): Placement | null {
  const o: SnapOptions = typeof opts === "boolean" ? { allowOrientChange: opts } : opts;
  const allowOrientChange = o.allowOrientChange ?? false;
  const disp = (p: Placement) =>
    preferredAt ? Math.abs(p.at[0] - preferredAt[0]) + Math.abs(p.at[1] - preferredAt[1]) + Math.abs(p.at[2] - preferredAt[2]) : 0;
  let best: Placement | null = null;
  let bestScore = Infinity;
  for (const p of legal) {
    if (p.piece !== piece || !p.cells.includes(target)) continue;
    const sameOrient = p.orient === orient;
    if (!sameOrient && !allowOrientChange) continue;
    const score = (sameOrient ? 0 : 100) + disp(p);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  const radius = o.radius ?? 0;
  if (best || radius <= 0 || !o.dims) return best;

  // Nothing covers the target: look around it, same orientation first.
  const dims = o.dims;
  const t = cellCoords(dims, target);
  for (const any of allowOrientChange ? [false, true] : [false]) {
    for (const p of legal) {
      if (p.piece !== piece || (!any && p.orient !== orient)) continue;
      let d = Infinity;
      for (const c of p.cells) d = Math.min(d, chebyshev(cellCoords(dims, c), t));
      if (d > radius) continue;
      const score = d * 50 + disp(p);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Legal placements of `piece`, nearest first to `from` (the cell the player
 * is aiming at), for stepping through every spot a shard fits with a key.
 * Ties keep the engine's order so the sequence is stable.
 */
export function fitsNear(legal: Placement[], piece: number, dims: Vec3, from: number | null): Placement[] {
  const mine = legal.filter((p) => p.piece === piece);
  if (from === null) return mine;
  const t = cellCoords(dims, from);
  const dist = (p: Placement) => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const c of p.cells) {
      const [x, y, z] = cellCoords(dims, c);
      sx += x;
      sy += y;
      sz += z;
    }
    const n = p.cells.length;
    return Math.hypot(sx / n - t[0], sy / n - t[1], sz / n - t[2]);
  };
  return mine
    .map((p, i) => ({ p, i, d: dist(p) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.p);
}

/** Pieces that have at least one legal placement right now. */
export function playablePieces(legal: Placement[]): Set<number> {
  return new Set(legal.map((p) => p.piece));
}
