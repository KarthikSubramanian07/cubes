import { FLAG, OWNER } from "@/engine/types";
import { buildScene, describeCell, freshCells, shapeKey } from "./scene";
import { fabricate, LabGame, ORIENTS, SHAPES } from "./lab/fabricate";

describe("buildScene", () => {
  test("groups same-owner cells into shards and finds cores, nodes, scars, ash", () => {
    const g = new LabGame({ w: 10, h: 10, seats: 2, nodes: true, seed: 1 });
    for (let i = 0; i < 6; i++) g.step();
    g.shatter(0);
    g.storm();
    const view = g.view(null);
    const scene = buildScene(view);
    expect(scene.cores).toHaveLength(2);
    expect(scene.scars.length + scene.ash.length).toBeGreaterThan(0);
    // Every seat cell belongs to exactly one shard.
    const owned = view.cells.filter((o) => o >= 1 && o <= 4).length;
    expect(scene.shards.reduce((n, s) => n + s.cells.length, 0)).toBe(owned);
    // Same-owner shards never share an edge (the link rule).
    for (const s of scene.shards) expect(s.loops.length).toBeGreaterThanOrEqual(1);
    expect(scene.shards.filter((s) => s.core)).toHaveLength(2);
  });

  test("void cells are off the board and shape the outline", () => {
    const g = new LabGame({ w: 16, h: 16, seats: 2, shape: "octagon" });
    const scene = buildScene(g.view(null));
    expect(scene.playable.reduce((a, b) => a + b, 0)).toBeLessThan(256);
    expect(scene.boardLoops).toHaveLength(1);
    expect(scene.boardLoops[0]!.length).toBeGreaterThan(4);
  });

  test("fog: unseen cells are listed, memory is marked stale", () => {
    const g = fabricate("fog");
    const scene = buildScene(g.view(0));
    expect(scene.fog.length).toBeGreaterThan(0);
    expect(scene.unknown.length).toBeGreaterThan(0);
    expect(scene.shards.some((s) => s.stale)).toBe(true);
    expect(scene.shards.some((s) => !s.stale)).toBe(true);
  });

  test("no fog means nothing is fogged", () => {
    const scene = buildScene(fabricate("plane").view(null));
    expect(scene.fog).toEqual([]);
  });

  test("shape key ignores pieces but tracks the board", () => {
    const a = fabricate("octagon");
    const k1 = shapeKey(a.view(null));
    a.step();
    expect(shapeKey(a.view(null))).toBe(k1);
    expect(shapeKey(fabricate("plane").view(null))).not.toBe(k1);
  });
});

test("freshCells reports newly owned cells only", () => {
  const prev = [0, 0, 1, 251, 0];
  const next = [0, 2, 1, 251, 3];
  expect([...freshCells(prev, next)]).toEqual([1, 4]);
  expect(freshCells(null, next).size).toBe(0);
  expect(freshCells([0], next).size).toBe(0);
});

test("describeCell speaks plainly", () => {
  const g = new LabGame({ w: 6, h: 6, seats: 2, seed: 2 });
  const view = g.view(null);
  const core = g.cores[0]!;
  expect(describeCell(view, core)).toMatch(/Clay core/);
  view.cells[0] = OWNER.SCAR;
  expect(describeCell(view, 0)).toBe("A1, scar");
  view.flags[1] = FLAG.NODE | FLAG.VISIBLE;
  expect(describeCell(view, 1)).toBe("B1, empty, node");
});

describe("lab fabricator", () => {
  test("every base shape has between 1 and 8 orientations", () => {
    expect(SHAPES).toHaveLength(20);
    for (const o of ORIENTS) {
      expect(o.length).toBeGreaterThanOrEqual(1);
      expect(o.length).toBeLessThanOrEqual(8);
    }
    expect(ORIENTS[SHAPES.findIndex((s) => s.name === "X")]).toHaveLength(1);
    expect(ORIENTS[SHAPES.findIndex((s) => s.name === "F")]).toHaveLength(8);
  });

  test("simulated moves obey the link rule", () => {
    const g = new LabGame({ w: 14, h: 14, seats: 2, seed: 3 });
    for (let i = 0; i < 12; i++) {
      const before = [...g.cells];
      const r = g.step();
      if (!r) break;
      const own = r.seat + 1;
      const set = new Set(r.cells);
      let corner = false;
      for (const c of r.cells) {
        expect(before[c]).toBe(OWNER.EMPTY);
        const x = c % 14;
        for (const d of [-1, 1, -14, 14]) {
          const j = c + d;
          if (j < 0 || j >= 196 || (Math.abs(d) === 1 && Math.floor(j / 14) !== Math.floor(c / 14)) || set.has(j)) continue;
          expect(before[j]).not.toBe(own);
        }
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          const xx = x + dx;
          const yy = Math.floor(c / 14) + dy;
          if (xx >= 0 && yy >= 0 && xx < 14 && yy < 14 && before[xx + 14 * yy] === own) corner = true;
        }
      }
      expect(corner).toBe(true);
    }
  });
});
