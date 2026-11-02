import { components, loopArea, loopsToPath, traceLoops, type Loop } from "./outline";
import { mulberry32 } from "./ink";

const W = 8;
const at = (x: number, y: number, w = W) => x + w * y;
const areaSum = (loops: Loop[]) => loops.reduce((s, l) => s + loopArea(l), 0);

function axisAligned(loop: Loop) {
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    if (p[0] !== q[0] && p[1] !== q[1]) return false;
  }
  return true;
}

describe("traceLoops", () => {
  test("empty set has no loops", () => {
    expect(traceLoops([], W)).toEqual([]);
  });

  test("single cell is a clockwise unit square", () => {
    const loops = traceLoops([at(2, 3)], W);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toEqual([
      [2, 3],
      [3, 3],
      [3, 4],
      [2, 4],
    ]);
    expect(loopArea(loops[0]!)).toBe(1);
  });

  test("domino merges into one rectangle", () => {
    const loops = traceLoops([at(0, 0), at(1, 0)], W);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(loopArea(loops[0]!)).toBe(2);
  });

  test("L shape has six corners", () => {
    const loops = traceLoops([at(0, 0), at(0, 1), at(0, 2), at(1, 2)], W);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(loopArea(loops[0]!)).toBe(4);
    expect(axisAligned(loops[0]!)).toBe(true);
  });

  test("plus shape has twelve corners", () => {
    const loops = traceLoops([at(1, 0), at(0, 1), at(1, 1), at(2, 1), at(1, 2)], W);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(12);
  });

  test("ring has an outer loop and a hole", () => {
    const ring: number[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (!(x === 1 && y === 1)) ring.push(at(x, y));
    const loops = traceLoops(ring, W);
    expect(loops).toHaveLength(2);
    const areas = loops.map(loopArea).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);
  });

  test("diagonal touch stays two separate loops", () => {
    const loops = traceLoops([at(0, 0), at(1, 1)], W);
    expect(loops).toHaveLength(2);
    for (const l of loops) {
      expect(l).toHaveLength(4);
      expect(loopArea(l)).toBe(1);
    }
  });

  test("anti-diagonal touch stays two separate loops", () => {
    const loops = traceLoops([at(1, 0), at(0, 1)], W);
    expect(loops).toHaveLength(2);
    expect(loops.map(loopArea)).toEqual([1, 1]);
  });

  test("checkerboard is one loop per cell", () => {
    const cells: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) cells.push(at(x, y));
    const loops = traceLoops(cells, W);
    expect(loops).toHaveLength(8);
    expect(loops.every((l) => l.length === 4 && loopArea(l) === 1)).toBe(true);
  });

  test("holes touching diagonally inside a block", () => {
    const cells: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (!((x === 1 && y === 1) || (x === 2 && y === 2))) cells.push(at(x, y));
    const loops = traceLoops(cells, W);
    expect(areaSum(loops)).toBe(14);
    expect(loops.filter((l) => loopArea(l) > 0)).toHaveLength(1);
  });

  test("cells on the right edge do not bleed into the next row", () => {
    // (7,0) and (0,1) are adjacent in index space but not on the board.
    const loops = traceLoops([at(7, 0), at(0, 1)], W);
    expect(loops).toHaveLength(2);
  });

  test("is deterministic regardless of input order", () => {
    const a = [at(0, 0), at(1, 0), at(1, 1), at(3, 3)];
    expect(traceLoops(a, W)).toEqual(traceLoops([...a].reverse(), W));
  });

  test("random sets: areas add up and loops are closed and axis-aligned", () => {
    const rand = mulberry32(1234);
    for (let trial = 0; trial < 200; trial++) {
      const cells = new Set<number>();
      const density = 0.2 + rand() * 0.6;
      for (let i = 0; i < W * W; i++) if (rand() < density) cells.add(i);
      const loops = traceLoops(cells, W);
      expect(areaSum(loops)).toBe(cells.size);
      for (const l of loops) {
        expect(l.length).toBeGreaterThanOrEqual(4);
        expect(l.length % 2).toBe(0);
        expect(axisAligned(l)).toBe(true);
      }
    }
  });

  test("each 4-connected component traces to exactly one outer loop", () => {
    const rand = mulberry32(99);
    for (let trial = 0; trial < 100; trial++) {
      const cells: number[] = [];
      for (let i = 0; i < W * W; i++) if (rand() < 0.45) cells.push(i);
      for (const comp of components(cells, W)) {
        const outer = traceLoops(comp, W).filter((l) => loopArea(l) > 0);
        expect(outer).toHaveLength(1);
      }
    }
  });
});

describe("components", () => {
  test("splits diagonal neighbours and keeps edge neighbours", () => {
    const comps = components([at(0, 0), at(1, 0), at(2, 1), at(5, 5)], W);
    expect(comps).toEqual([[at(0, 0), at(1, 0)], [at(2, 1)], [at(5, 5)]]);
  });

  test("does not wrap across row ends", () => {
    expect(components([at(7, 0), at(0, 1)], W)).toHaveLength(2);
  });
});

test("loopsToPath scales to user units", () => {
  expect(loopsToPath(traceLoops([0], W), 40)).toBe("M0 0L40 0L40 40L0 40Z");
});
