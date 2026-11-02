import { describe, expect, it } from "vitest";
import { FLAG, OWNER } from "@/engine/types";
import {
  attachPoints,
  ghostAt,
  orbitScenario,
  planeScenario,
  rng,
  scenarioView,
  simulatePlace,
  simulateShatter,
  simulateStorm,
  stackScenario,
} from "./fixtures";

describe("fabricated scenarios", () => {
  it("builds a 20x20 mid-game with cores, nodes, scars and ash", () => {
    const v = scenarioView(planeScenario({ seed: 3 }));
    expect(v.cells).toHaveLength(400);
    expect(v.cells.filter((_, i) => v.flags[i]! & FLAG.CORE)).toHaveLength(4);
    expect(v.flags.some((f) => f & FLAG.NODE)).toBe(true);
    expect(v.cells).toContain(OWNER.SCAR);
    expect(v.cells).toContain(OWNER.ASH);
    for (let s = 1; s <= 4; s++) expect(v.cells.filter((c) => c === s).length).toBeGreaterThan(8);
  });

  it("applies fog from the viewer's seat with stale memories", () => {
    const v = scenarioView(planeScenario({ seed: 3, fog: true }));
    expect(v.flags.some((f) => !(f & FLAG.VISIBLE))).toBe(true);
    expect(v.flags.some((f) => f & FLAG.STALE)).toBe(true);
    v.cells.forEach((c, i) => {
      if (c === 1) expect(v.flags[i]! & FLAG.VISIBLE).toBeTruthy();
    });
  });

  it("carves void columns for non-square shapes", () => {
    const v = scenarioView(planeScenario({ seed: 3, shape: "octagon", storm: false }));
    expect(v.cells[0]).toBe(OWNER.VOID);
    expect(v.cells[210]).not.toBe(OWNER.VOID);
  });

  it("stacks only on support in gravity games", () => {
    const v = scenarioView(stackScenario());
    const [w, h, d] = v.config.dims;
    for (let z = 1; z < d; z++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = x + w * (y + h * z);
          if (v.cells[c] !== OWNER.EMPTY) expect(v.cells[c - w * h]).not.toBe(OWNER.EMPTY);
        }
  });

  it("lets orbit pieces float", () => {
    const v = scenarioView(orbitScenario());
    expect(v.config.gravity).toBe(false);
    expect(v.cells.filter((c) => c >= 1 && c <= 4).length).toBeGreaterThan(30);
  });
});

describe("lab simulations", () => {
  it("places corner-linked pieces with events", () => {
    const s = planeScenario({ seed: 9 });
    const evs = simulatePlace(s, rng(1), 2);
    const placed = evs.find((e) => e.type === "placed");
    expect(placed && placed.type === "placed" && placed.cells.every((c) => s.board.cells[c] === 3)).toBe(true);
  });

  it("shatters an opponent into a scar and storms the next ring", () => {
    const s = planeScenario({ seed: 9 });
    const [e] = simulateShatter(s, rng(2), 0);
    expect(e?.type).toBe("shattered");
    if (e?.type === "shattered") expect(s.board.cells[e.cell]).toBe(OWNER.SCAR);
    const level = s.stormLevel;
    const [st] = simulateStorm(s);
    expect(s.stormLevel).toBe(level + 1);
    if (st?.type === "storm") for (const c of st.cells) expect(s.board.cells[c]).toBe(OWNER.ASH);
  });

  it("validates ghosts against occupancy, bounds and support", () => {
    const v = scenarioView(stackScenario());
    const [w, h] = v.config.dims;
    const floating = 0 + w * (0 + h * 5);
    const g = ghostAt(v, floating, [[0, 0, 0]]);
    expect(g.valid).toBe(v.cells[floating - w * h] !== OWNER.EMPTY && v.cells[floating] === OWNER.EMPTY);
    expect(ghostAt(v, w - 1, [[1, 0, 0]]).valid).toBe(false);
  });

  it("finds attach points that touch by a corner and never by a face", () => {
    const v = scenarioView(planeScenario({ seed: 4 }));
    const pts = attachPoints(v, 0);
    expect(pts.length).toBeGreaterThan(0);
    const w = v.config.dims[0];
    for (const p of pts) {
      for (const n of [p - 1, p + 1, p - w, p + w]) if (n >= 0 && n < v.cells.length && Math.abs((n % w) - (p % w)) <= 1) expect(v.cells[n]).not.toBe(1);
    }
  });
});
