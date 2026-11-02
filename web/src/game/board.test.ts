import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getPreset } from "@/engine/engine";
import type { PresetName } from "@/engine/types";
import { attachPoints, shatterTargets } from "./board";

beforeAll(initEngineForTests);

describe("board helpers agree with the Rust engine", () => {
  const presets: PresetName[] = ["plane", "torus", "stack", "orbit", "teams"];
  it.each(presets)("every legal non-leap placement covers an attach point (%s)", (name) => {
    const g = LocalGame.create(getPreset(name, 4), 2);
    for (let ply = 0; ply < 10; ply++) {
      const v = g.view(null);
      if (v.phase !== "playing") break;
      const seat = v.turn;
      const attach = new Set(attachPoints(g.view(seat), seat));
      const legal = g.legal(seat);
      for (const p of legal) expect(p.cells.some((c) => attach.has(c))).toBe(true);
      const a = g.botAction(seat, "ember", ply, 0)!;
      g.apply(seat, a);
    }
    g.free();
  });

  it("shatter targets are exactly what the engine accepts", () => {
    const g = LocalGame.create(getPreset("duel", 2), 6);
    for (let i = 0; i < 8; i++) {
      const s = g.view(null).turn;
      g.apply(s, g.botAction(s, "flare", i, 0)!);
    }
    const json = JSON.parse(g.toJSON());
    const seat = json.state.turn as number;
    json.state.seats[seat].charge = 5;
    const g2 = LocalGame.fromJSON(JSON.stringify(json));
    const v = g2.view(seat);
    const targets = new Set(shatterTargets(v, seat));
    expect(targets.size).toBeGreaterThan(0);
    for (let c = 0; c < v.cells.length; c++) {
      expect(g2.check(seat, { type: "shatter", cell: c }).ok).toBe(targets.has(c));
    }
    g.free();
    g2.free();
  });
});
