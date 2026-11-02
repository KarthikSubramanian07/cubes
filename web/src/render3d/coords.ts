import type { Vec3 } from "@/engine/types";

/** World units per cell. */
export const CELL = 1;
/** Height of a 2D glass tile. */
export const TILE_H = 0.4;
/** Edge length of a 3D glass cube (leaves a hairline gap between cubes). */
export const CUBE = 0.9;
/** Footprint of a 2D tile. */
export const TILE_W = 0.88;

export interface BoardLayout {
  w: number;
  h: number;
  d: number;
  is2D: boolean;
  /** Half-extents used to centre the board on the origin. */
  ox: number;
  oz: number;
}

export function layoutOf(dims: Vec3): BoardLayout {
  const [w, h, d] = dims;
  return { w, h, d, is2D: d <= 1, ox: (w - 1) / 2, oz: (h - 1) / 2 };
}

export function inBounds(L: BoardLayout, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < L.w && y < L.h && z < L.d;
}

export function indexOf(L: BoardLayout, x: number, y: number, z: number): number {
  return x + L.w * (y + L.h * z);
}

export function coordsOf(L: BoardLayout, i: number): Vec3 {
  return [i % L.w, Math.floor(i / L.w) % L.h, Math.floor(i / (L.w * L.h))];
}

/**
 * World-space centre of the piece that sits in cell `i`.
 * Board x maps to world +X, board y to world +Z (towards the default camera),
 * board z (height) to world +Y. The floor top is at Y = 0.
 */
export function cellToWorld(L: BoardLayout, i: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const [x, y, z] = coordsOf(L, i);
  out[0] = (x - L.ox) * CELL;
  out[1] = L.is2D ? TILE_H / 2 : (z + 0.5) * CELL;
  out[2] = (y - L.oz) * CELL;
  return out;
}

/** World X/Z of a board column (x, y). */
export function columnToWorld(L: BoardLayout, x: number, y: number): [number, number] {
  return [(x - L.ox) * CELL, (y - L.oz) * CELL];
}

/** Board column (x, y) under a world X/Z point. May be out of bounds. */
export function worldToColumn(L: BoardLayout, wx: number, wz: number): [number, number] {
  return [Math.floor(wx / CELL + L.w / 2), Math.floor(wz / CELL + L.h / 2)];
}

/** Board layer under a world height (3D only; 2D is always layer 0). */
export function worldToLevel(L: BoardLayout, wy: number): number {
  return L.is2D ? 0 : Math.floor(wy / CELL);
}

/** Cell index under a world point, or -1 when it is outside the lattice. */
export function worldToCell(L: BoardLayout, p: Vec3, level?: number): number {
  const [x, y] = worldToColumn(L, p[0], p[2]);
  const z = level ?? worldToLevel(L, p[1]);
  if (!inBounds(L, x, y, z)) return -1;
  return indexOf(L, x, y, z);
}

/** Radius of a sphere that encloses the whole lattice (used to frame the camera). */
export function boardRadius(L: BoardLayout): number {
  const hy = L.is2D ? 0.5 : L.d / 2;
  return Math.hypot(L.w / 2, L.h / 2, hy) * CELL;
}

/** Point the camera orbits around. */
export function boardCenter(L: BoardLayout): Vec3 {
  return [0, L.is2D ? 0 : (L.d * CELL) / 2 - 0.5, 0];
}
