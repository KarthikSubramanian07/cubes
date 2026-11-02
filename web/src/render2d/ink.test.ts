import {
  blobLoop,
  blobPath,
  circlePoints,
  clipSegment,
  hashSeed,
  hatchSegments,
  inkStroke,
  loopAsStroke,
  mulberry32,
  resample,
  sketchLine,
  splatPath,
  starPoints,
  valueNoise,
  wobble,
  zigzag,
  type Pt,
} from "./ink";

const square: Pt[] = [
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
];

describe("random", () => {
  test("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  test("hashSeed is stable, order-sensitive and spreads nearby inputs", () => {
    expect(hashSeed(3, 4)).toBe(hashSeed(3, 4));
    expect(hashSeed(3, 4)).not.toBe(hashSeed(4, 3));
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(hashSeed(i));
    expect(seen.size).toBe(400);
  });

  test("value noise is continuous and bounded", () => {
    const n = valueNoise(mulberry32(9), 200, 20);
    let prev = n(0);
    for (let s = 0; s <= 200; s += 0.5) {
      const v = n(s);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2);
      prev = v;
    }
  });
});

describe("strokes", () => {
  test("inkStroke is deterministic for a seed", () => {
    const opts = { seed: hashSeed(17), width: 2, amp: 1.2, overshoot: 3 };
    expect(inkStroke(square, opts)).toBe(inkStroke(square, opts));
    expect(sketchLine(square, opts)).toBe(sketchLine(square, opts));
  });

  test("seed changes the stroke", () => {
    expect(inkStroke(square, { seed: 1, width: 2 })).not.toBe(inkStroke(square, { seed: 2, width: 2 }));
  });

  test("inkStroke is a closed, filled outline with no NaN", () => {
    const d = inkStroke(loopAsStroke(square, 6), { seed: 5, width: 2, amp: 1, overshoot: 2 });
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  test("wobble stays close to the source line", () => {
    const line: Pt[] = [
      [0, 0],
      [400, 0],
    ];
    const pts = wobble(line, { seed: 3, amp: 2, step: 8 });
    expect(pts.length).toBeGreaterThan(40);
    for (const p of pts) expect(Math.abs(p[1])).toBeLessThanOrEqual(2 * 1.2 + 1e-9);
  });

  test("resample keeps original vertices", () => {
    const pts = resample(square, 7);
    for (const v of square) expect(pts.some((p) => p[0] === v[0] && p[1] === v[1])).toBe(true);
  });

  test("loopAsStroke returns past the start", () => {
    const pts = loopAsStroke(square, 5);
    expect(pts.length).toBe(6);
    expect(pts[4]).toEqual([0, 0]);
    expect(pts[5]).toEqual([5, 0]);
  });

  test("blobLoop pushes outward for positive offsets on clockwise loops", () => {
    // Inset of -4 means grow by 4: every number should fall outside [0, 40] at some point.
    const d = blobLoop(square, { seed: 1, amp: 0, step: 10, inset: -4 });
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeLessThan(0);
    expect(Math.max(...nums)).toBeGreaterThan(40);
  });

  test("degenerate inputs do not throw", () => {
    expect(inkStroke([], { seed: 1, width: 1 })).toBe("");
    expect(inkStroke([[1, 1]], { seed: 1, width: 1 })).toBe("");
    expect(sketchLine([[1, 1]], { seed: 1 })).toBe("M1 1");
  });
});

describe("hatching", () => {
  const rect = { x: 0, y: 0, w: 40, h: 40 };

  test("clipSegment clips to the rect", () => {
    expect(clipSegment([-10, 20], [50, 20], rect)).toEqual([
      [0, 20],
      [40, 20],
    ]);
    expect(clipSegment([-10, -10], [-1, -5], rect)).toBeNull();
  });

  test("hatch segments lie inside the rect", () => {
    const segs = hatchSegments(rect, Math.PI / 4, 6, 1);
    expect(segs.length).toBeGreaterThan(5);
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        expect(p[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(p[0]).toBeLessThanOrEqual(40 + 1e-9);
        expect(p[1]).toBeGreaterThanOrEqual(-1e-9);
        expect(p[1]).toBeLessThanOrEqual(40 + 1e-9);
      }
    }
  });

  test("hatch lines line up across neighbouring rects", () => {
    const a = hatchSegments({ x: 0, y: 0, w: 40, h: 40 }, 0, 10, 1);
    const b = hatchSegments({ x: 40, y: 0, w: 40, h: 40 }, 0, 10, 2);
    expect(a.map((s) => s[0][1])).toEqual(b.map((s) => s[0][1]));
  });

  test("zigzag alternates sides", () => {
    const z = zigzag(rect, 4, 6);
    expect(z.length).toBe(7);
    expect(z[0]![0]).toBeLessThan(20);
    expect(z[1]![0]).toBeGreaterThan(20);
  });
});

describe("glyphs", () => {
  test("star is a deterministic pentagram near its centre", () => {
    const s = starPoints(100, 100, 10, 7);
    expect(s).toEqual(starPoints(100, 100, 10, 7));
    expect(s.length).toBe(6);
    for (const p of s) expect(Math.hypot(p[0] - 100, p[1] - 100)).toBeLessThan(12);
  });

  test("circle wraps more than once around", () => {
    const c = circlePoints(0, 0, 10, 3);
    expect(c.length).toBeGreaterThan(20);
    for (const p of c) expect(Math.hypot(p[0], p[1])).toBeLessThan(13);
  });

  test("blob and splat are closed and deterministic", () => {
    expect(blobPath(0, 0, 10, 6, 1)).toBe(blobPath(0, 0, 10, 6, 1));
    const sp = splatPath(0, 0, 10, 2);
    expect(sp).toBe(splatPath(0, 0, 10, 2));
    expect((sp.match(/Z/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
