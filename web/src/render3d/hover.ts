import { OWNER, type Vec3 } from "@/engine/types";
import { coordsOf, inBounds, indexOf, worldToColumn, type BoardLayout } from "./coords";

/** What the pointer ray hit, in board terms. */
export type PickHit =
  /** A horizontal pick plane (2D board surface, 3D floor or slice plane) at board layer `level`. */
  | { kind: "plane"; point: Vec3; level: number }
  /** The face of an occupied 3D cell. `normal` is the world-space face normal. */
  | { kind: "cell"; cell: number; normal: Vec3 };

export interface HoverTarget {
  cell: number;
  /** Board-space unit step from the face that was hit to `cell` (z is up). 3D only. */
  normal?: [number, number, number];
}

export interface HoverOptions {
  layerCut?: number | null;
}

/**
 * World face normal (Y up) to a board-space step (z up), snapped to the
 * dominant axis so float noise never yields a diagonal step.
 */
export function boardStep(n: Vec3): [number, number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [Math.sign(n[0]) || 1, 0, 0];
  if (ay >= az) return [0, 0, Math.sign(n[1]) || 1];
  return [0, Math.sign(n[2]) || 1, 0];
}

/**
 * Resolve a raw pick into the cell the player is aiming at.
 *
 * - 2D: the board cell under the pointer (occupied or not), never void.
 * - 3D: voxel-painter style. A face hit targets the empty neighbour across
 *   that face; a floor or slice hit targets the empty cell on that layer.
 *   Cells above `layerCut` are hidden and therefore never targeted.
 */
export function resolveHover(
  L: BoardLayout,
  cells: ArrayLike<number>,
  hit: PickHit | null,
  opts: HoverOptions = {},
): HoverTarget | null {
  if (!hit) return null;
  const cut = opts.layerCut ?? null;

  if (hit.kind === "plane") {
    const [x, y] = worldToColumn(L, hit.point[0], hit.point[2]);
    const z = L.is2D ? 0 : hit.level;
    if (!inBounds(L, x, y, z)) return null;
    if (cut !== null && z > cut) return null;
    const cell = indexOf(L, x, y, z);
    const owner = cells[cell];
    if (owner === undefined || owner === OWNER.VOID) return null;
    if (L.is2D) return { cell };
    return owner === OWNER.EMPTY ? { cell, normal: [0, 0, 1] } : null;
  }

  if (L.is2D) {
    return cells[hit.cell] === OWNER.VOID ? null : { cell: hit.cell };
  }
  const n = boardStep(hit.normal);
  const [x, y, z] = coordsOf(L, hit.cell);
  const nx = x + n[0];
  const ny = y + n[1];
  const nz = z + n[2];
  if (!inBounds(L, nx, ny, nz)) return null;
  if (cut !== null && nz > cut) return null;
  const cell = indexOf(L, nx, ny, nz);
  return cells[cell] === OWNER.EMPTY ? { cell, normal: n } : null;
}

export function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.cell !== b.cell) return false;
  const an = a.normal;
  const bn = b.normal;
  if (!an || !bn) return an === bn;
  return an[0] === bn[0] && an[1] === bn[1] && an[2] === bn[2];
}
