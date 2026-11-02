import { describe, expect, it } from "vitest";
import { cellIndex } from "@/engine/types";
import { boardCenter, boardRadius, cellToWorld, coordsOf, indexOf, layoutOf, TILE_H, worldToCell, worldToColumn } from "./coords";

describe("cell <-> world mapping", () => {
  it("centres a 2D board on the origin with tiles resting on the slab", () => {
    const L = layoutOf([20, 20, 1]);
    expect(L.is2D).toBe(true);
    expect(cellToWorld(L, cellIndex([20, 20, 1], 0, 0, 0))).toEqual([-9.5, TILE_H / 2, -9.5]);
    expect(cellToWorld(L, cellIndex([20, 20, 1], 19, 19, 0))).toEqual([9.5, TILE_H / 2, 9.5]);
  });

  it("maps board y to world +Z and board z to world +Y in 3D", () => {
    const L = layoutOf([8, 8, 8]);
    const [x, y, z] = cellToWorld(L, cellIndex([8, 8, 8], 2, 5, 3));
    expect(x).toBeCloseTo(-1.5);
    expect(z).toBeCloseTo(1.5);
    expect(y).toBeCloseTo(3.5);
  });

  it("round-trips every cell of 2D and 3D lattices", () => {
    for (const dims of [
      [20, 20, 1],
      [14, 9, 1],
      [8, 8, 8],
      [7, 7, 7],
    ] as const) {
      const L = layoutOf([...dims]);
      for (let i = 0; i < dims[0] * dims[1] * dims[2]; i++) {
        expect(worldToCell(L, cellToWorld(L, i))).toBe(i);
      }
    }
  });

  it("agrees with the engine's index helpers", () => {
    const L = layoutOf([7, 5, 3]);
    for (let i = 0; i < 105; i++) {
      const [x, y, z] = coordsOf(L, i);
      expect(indexOf(L, x, y, z)).toBe(i);
      expect(cellIndex([7, 5, 3], x, y, z)).toBe(i);
    }
  });

  it("splits columns exactly on cell edges and rejects points off the lattice", () => {
    const L = layoutOf([4, 4, 1]);
    expect(worldToColumn(L, -2, -2)).toEqual([0, 0]);
    expect(worldToColumn(L, -1.001, 0)).toEqual([0, 2]);
    expect(worldToColumn(L, -0.999, 0)).toEqual([1, 2]);
    expect(worldToCell(L, [2.01, 0, 0])).toBe(-1);
    expect(worldToCell(L, [0, 0, -2.01])).toBe(-1);
  });

  it("frames 3D boards around their vertical middle", () => {
    expect(boardCenter(layoutOf([8, 8, 8]))[1]).toBeCloseTo(3.5);
    expect(boardCenter(layoutOf([20, 20, 1]))[1]).toBe(0);
    expect(boardRadius(layoutOf([8, 8, 8]))).toBeGreaterThan(boardRadius(layoutOf([7, 7, 7])));
  });
});
