import { FLAG } from "@/engine/types";
import { insetLoop, loopArea, pieceGroups, ribbon } from "./pieceOutline";

function flatView(w: number, h: number, owned: Record<number, number>, flags: Record<number, number> = {}) {
  const cells = new Array(w * h).fill(0);
  const fl = new Array(w * h).fill(0);
  for (const [i, o] of Object.entries(owned)) cells[Number(i)] = o;
  for (const [i, f] of Object.entries(flags)) fl[Number(i)] = f;
  return { config: { dims: [w, h, 1] }, cells, flags: fl } as never;
}

describe("piece outlines", () => {
  it("groups side-touching squares into one piece and keeps corner-touching pieces apart", () => {
    // 4x4: seat 1 has an L (0,1,4) and a single square at 9 touching it by a corner;
    // seat 2 has a domino at 2,3.
    const v = flatView(4, 4, { 0: 1, 1: 1, 4: 1, 9: 1, 2: 2, 3: 2 });
    const g = pieceGroups(v);
    expect(g.map((p) => [p.seat, p.cells])).toEqual([
      [0, [0, 1, 4]],
      [0, [9]],
      [1, [2, 3]],
    ]);
    for (const p of g) expect(p.loops).toHaveLength(1);
  });

  it("leaves Cores out and marks fully remembered pieces as stale", () => {
    const v = flatView(3, 1, { 0: 1, 2: 1 }, { 0: FLAG.CORE, 2: FLAG.STALE });
    const g = pieceGroups(v);
    expect(g).toHaveLength(1);
    expect(g[0]!.cells).toEqual([2]);
    expect(g[0]!.stale).toBe(true);
  });

  it("insets a loop evenly on every side", () => {
    const square = pieceGroups(flatView(2, 2, { 0: 1, 1: 1, 2: 1, 3: 1 }))[0]!.loops[0]!;
    const inset = insetLoop(square, 0.1);
    expect(loopArea(square)).toBeCloseTo(4);
    expect(loopArea(inset)).toBeCloseTo(1.8 * 1.8);
    for (const [x, y] of inset) {
      expect(x).toBeGreaterThan(0);
      expect(y).toBeLessThan(2);
    }
  });

  it("insets an L-shape into the same L, a little smaller", () => {
    const l = pieceGroups(flatView(2, 2, { 0: 1, 1: 1, 2: 1 }))[0]!.loops[0]!;
    expect(loopArea(insetLoop(l, 0.05))).toBeLessThan(loopArea(l));
    expect(loopArea(insetLoop(l, 0.05))).toBeGreaterThan(2.5);
  });

  it("draws two triangles per border edge", () => {
    const loop = pieceGroups(flatView(1, 1, { 0: 1 }))[0]!.loops[0]!;
    expect(ribbon([loop], 0.05)).toHaveLength(4 * 6 * 2);
  });
});
