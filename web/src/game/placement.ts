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

/**
 * Among legal placements of `piece` covering `target`, the one closest to
 * where the player is aiming: same orientation first, then smallest anchor
 * displacement. Returns null when nothing legal covers the cell.
 */
export function snapPlacement(
  legal: Placement[],
  piece: number,
  orient: number,
  target: number,
  preferredAt: Vec3 | null,
  allowOrientChange = false,
): Placement | null {
  let best: Placement | null = null;
  let bestScore = Infinity;
  for (const p of legal) {
    if (p.piece !== piece || !p.cells.includes(target)) continue;
    const sameOrient = p.orient === orient;
    if (!sameOrient && !allowOrientChange) continue;
    let d = 0;
    if (preferredAt) d = Math.abs(p.at[0] - preferredAt[0]) + Math.abs(p.at[1] - preferredAt[1]) + Math.abs(p.at[2] - preferredAt[2]);
    const score = (sameOrient ? 0 : 100) + d;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Pieces that have at least one legal placement right now. */
export function playablePieces(legal: Placement[]): Set<number> {
  return new Set(legal.map((p) => p.piece));
}
