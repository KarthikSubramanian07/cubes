import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getKit, getPreset, validateConfig } from "./engine";
import { FLAG, OWNER, type PresetName } from "./types";

beforeAll(initEngineForTests);

describe("engine contract", () => {
  it("exposes the kits", () => {
    const shards = getKit("shards");
    expect(shards.pieces).toHaveLength(20);
    expect(shards.sparkIndex).toBe(20);
    expect(shards.pieces.reduce((n, p) => n + p.size, 0)).toBe(88);
    expect(getKit("cubes").pieces).toHaveLength(17);
  });

  it("validates configs", () => {
    const cfg = getPreset("plane", 4);
    expect(validateConfig(cfg)).toBeNull();
    expect(validateConfig({ ...cfg, seats: 7 })).toMatch(/seats/);
  });

  it("produces views matching types.ts", () => {
    const g = LocalGame.create(getPreset("duel", 2), 42);
    const v = g.view(0);
    expect(v.cells).toHaveLength(14 * 14);
    expect(v.phase).toBe("playing");
    expect(v.seats[0]!.pieces).toHaveLength(20);
    const cores = v.flags.filter((f) => f & FLAG.CORE).length;
    expect(cores).toBe(2);
    expect(v.cells.filter((c) => c === OWNER.EMPTY).length).toBeGreaterThan(150);
    g.free();
  });

  it("rejects illegal actions with a reason", () => {
    const g = LocalGame.create(getPreset("duel", 2), 1);
    const r = g.check(1, { type: "scan" });
    expect(r.ok).toBe(false);
    g.free();
  });

  const presets: PresetName[] = ["plane", "duel", "fog", "storm", "torus", "stack", "orbit"];
  it.each(presets)("bots play %s to the end through the JSON boundary", (name) => {
    const g = LocalGame.create(getPreset(name, 2), 7);
    let guard = 0;
    while (g.view(null).phase === "playing" && guard++ < 1500) {
      const seat = g.view(null).turn;
      const action = g.botAction(seat, "flare", guard, 0);
      expect(action).not.toBeNull();
      const legal = g.check(seat, action!);
      expect(legal).toEqual({ ok: true });
      g.apply(seat, action!);
    }
    const end = g.view(null);
    expect(end.phase).toBe("over");
    expect(end.winners!.length).toBeGreaterThan(0);
    const restored = LocalGame.fromJSON(g.toJSON());
    expect(restored.view(null)).toEqual(end);
    restored.free();
    g.free();
  });

  it("legal placements round-trip into accepted actions", () => {
    const g = LocalGame.create(getPreset("plane", 4), 3);
    const legal = g.legal(0);
    expect(legal.length).toBeGreaterThan(10);
    const p = legal[legal.length - 1]!;
    const events = g.apply(0, { type: "place", piece: p.piece, orient: p.orient, at: p.at, leap: false });
    expect(events[0]).toMatchObject({ type: "placed", seat: 0, cells: p.cells });
    g.free();
  });
});
