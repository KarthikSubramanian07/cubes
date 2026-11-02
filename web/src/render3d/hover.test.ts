import { describe, expect, it } from "vitest";
import { cellIndex, OWNER, type Vec3 } from "@/engine/types";
import { cellToWorld, layoutOf } from "./coords";
import { columnTop, nudge, resolveHover, sameTarget } from "./hover";

const D2: Vec3 = [5, 5, 1];
const D3: Vec3 = [4, 4, 4];

function board(dims: Vec3, fill: Record<number, number> = {}): number[] {
  const cells = new Array(dims[0] * dims[1] * dims[2]).fill(OWNER.EMPTY);
  for (const [k, v] of Object.entries(fill)) cells[Number(k)] = v;
  return cells;
}

describe("2D hover", () => {
  const L = layoutOf(D2);
  it("targets the board cell under the pointer, occupied or not", () => {
    const c = cellIndex(D2, 3, 1, 0);
    const cells = board(D2, { [c]: 2 });
    const p = cellToWorld(L, c);
    expect(resolveHover(L, cells, { kind: "plane", point: [p[0] + 0.3, 0.2, p[2] - 0.4], level: 0 })).toEqual({ cell: c });
  });
  it("never targets void or points off the board", () => {
    const c = cellIndex(D2, 0, 0, 0);
    const cells = board(D2, { [c]: OWNER.VOID });
    const p = cellToWorld(L, c);
    expect(resolveHover(L, cells, { kind: "plane", point: p, level: 0 })).toBeNull();
    expect(resolveHover(L, cells, { kind: "plane", point: [9, 0, 0], level: 0 })).toBeNull();
    expect(resolveHover(L, cells, null)).toBeNull();
  });
});

describe("3D voxel-painter hover", () => {
  const L = layoutOf(D3);
  const base = cellIndex(D3, 1, 1, 0);

  it("targets the empty floor cell under the pointer", () => {
    const cells = board(D3);
    const p = cellToWorld(L, base);
    expect(resolveHover(L, cells, { kind: "plane", point: [p[0], 0, p[2]], level: 0 })).toEqual({ cell: base, normal: [0, 0, 1] });
  });

  it("targets the empty neighbour across the face under the pointer", () => {
    const cells = board(D3, { [base]: 1 });
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0, 1, 0] })).toEqual({ cell: cellIndex(D3, 1, 1, 1), normal: [0, 0, 1] });
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [1, 0, 0] })).toEqual({ cell: cellIndex(D3, 2, 1, 0), normal: [1, 0, 0] });
    // board +y is world +Z
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0, 0, -1] })).toEqual({ cell: cellIndex(D3, 1, 0, 0), normal: [0, -1, 0] });
  });

  it("snaps noisy normals to the dominant axis", () => {
    const cells = board(D3, { [base]: 1 });
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0.2, 0.95, -0.1] })?.normal).toEqual([0, 0, 1]);
  });

  it("rejects occupied neighbours, the outside, and the floor below", () => {
    const above = cellIndex(D3, 1, 1, 1);
    const cells = board(D3, { [base]: 1, [above]: 3 });
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0, 1, 0] })).toBeNull();
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0, -1, 0] })).toBeNull();
    const corner = cellIndex(D3, 0, 0, 0);
    expect(resolveHover(L, board(D3, { [corner]: 1 }), { kind: "cell", cell: corner, normal: [-1, 0, 0] })).toBeNull();
    const p = cellToWorld(L, base);
    expect(resolveHover(L, cells, { kind: "plane", point: [p[0], 0, p[2]], level: 0 })).toBeNull();
  });

  it("hides cells above the layer cut", () => {
    const cells = board(D3, { [base]: 1 });
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [0, 1, 0] }, { layerCut: 0 })).toBeNull();
    expect(resolveHover(L, cells, { kind: "cell", cell: base, normal: [1, 0, 0] }, { layerCut: 0 })).not.toBeNull();
    const p = cellToWorld(L, cellIndex(D3, 2, 2, 2));
    expect(resolveHover(L, cells, { kind: "plane", point: p, level: 2 }, { layerCut: 2 })?.cell).toBe(cellIndex(D3, 2, 2, 2));
    expect(resolveHover(L, cells, { kind: "plane", point: p, level: 3 }, { layerCut: 2 })).toBeNull();
  });
});

describe("sameTarget", () => {
  it("compares cell and normal", () => {
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget({ cell: 1 }, null)).toBe(false);
    expect(sameTarget({ cell: 1, normal: [0, 1, 0] }, { cell: 1, normal: [0, 1, 0] })).toBe(true);
    expect(sameTarget({ cell: 1, normal: [0, 1, 0] }, { cell: 1, normal: [1, 0, 0] })).toBe(false);
    expect(sameTarget({ cell: 1 }, { cell: 2 })).toBe(false);
  });
});

describe("keyboard nudge", () => {
  // Default camera: looking from +Z (board y large) towards -Z.
  const cam = { forward: [0, -1] as [number, number], right: [1, 0] as [number, number] };

  it("moves relative to the camera on a 2D board", () => {
    const L = layoutOf(D2);
    const from = cellIndex(D2, 2, 2, 0);
    expect(nudge(L, board(D2), from, "ArrowRight", { ...cam, gravity: false })).toEqual({ cell: cellIndex(D2, 3, 2, 0) });
    expect(nudge(L, board(D2), from, "ArrowUp", { ...cam, gravity: false })).toEqual({ cell: cellIndex(D2, 2, 1, 0) });
    // Camera swung round to look along +X: "up" now walks +x.
    expect(nudge(L, board(D2), from, "ArrowUp", { forward: [1, 0], right: [0, 1], gravity: false })).toEqual({ cell: cellIndex(D2, 3, 2, 0) });
    expect(nudge(L, board(D2), from, "PageUp", { ...cam, gravity: false })).toBeNull();
    expect(nudge(L, board(D2), cellIndex(D2, 4, 2, 0), "ArrowRight", { ...cam, gravity: false })).toBeNull();
  });

  it("lands on top of the next column under gravity", () => {
    const L = layoutOf(D3);
    const cells = board(D3, { [cellIndex(D3, 2, 1, 0)]: 2, [cellIndex(D3, 2, 1, 1)]: 1 });
    expect(columnTop(L, cells, 2, 1, null)).toBe(2);
    expect(columnTop(L, cells, 2, 1, 1)).toBeNull();
    expect(nudge(L, cells, cellIndex(D3, 1, 1, 0), "ArrowRight", { ...cam, gravity: true })).toEqual({ cell: cellIndex(D3, 2, 1, 2), normal: [0, 0, 1] });
    expect(nudge(L, cells, cellIndex(D3, 1, 1, 0), "PageUp", { ...cam, gravity: true })).toEqual({ cell: cellIndex(D3, 1, 1, 1), normal: [0, 0, 1] });
  });

  it("keeps the layer in free-floating boards and respects the slice", () => {
    const L = layoutOf(D3);
    const from = cellIndex(D3, 1, 1, 2);
    expect(nudge(L, board(D3), from, "ArrowLeft", { ...cam, gravity: false })).toEqual({ cell: cellIndex(D3, 0, 1, 2), normal: [0, 0, 1] });
    expect(nudge(L, board(D3), from, "PageUp", { ...cam, gravity: false, layerCut: 2 })).toBeNull();
    expect(nudge(L, board(D3), cellIndex(D3, 1, 1, 0), "PageDown", { ...cam, gravity: false })).toBeNull();
  });
});
