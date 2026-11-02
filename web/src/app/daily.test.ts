import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getPreset, validateConfig } from "@/engine/engine";
import { dailyNumber, dailyPreset, dailySeed, isDay, shareGrid, shareText, todayUTC } from "./daily";

beforeAll(initEngineForTests);

describe("daily board", () => {
  it("numbers days from the epoch and flips at UTC midnight", () => {
    expect(dailyNumber("2026-11-01")).toBe(1);
    expect(dailyNumber("2026-11-02")).toBe(2);
    expect(dailyNumber("2027-11-01")).toBe(366);
    expect(todayUTC(new Date("2026-11-02T23:59:59Z"))).toBe("2026-11-02");
    expect(todayUTC(new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-03");
  });

  it("rejects things that aren't dates", () => {
    expect(isDay("2026-11-02")).toBe(true);
    expect(isDay("2026-13-45")).toBe(false);
    expect(isDay("tomorrow")).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it("gives every day its own stable seed, safely inside 2^53", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 10, 1) + i * 86400000).toISOString().slice(0, 10);
      const s = dailySeed(day);
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(dailySeed(day)).toBe(s);
      seeds.add(s);
    }
    expect(seeds.size).toBe(400);
  });

  it("rotates through modes that are all valid two-player games", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.UTC(2026, 10, 2) + i * 86400000).toISOString().slice(0, 10);
      const preset = dailyPreset(day);
      seen.add(preset);
      expect(validateConfig(getPreset(preset, 2))).toBeNull();
    }
    expect(dailyPreset("2026-11-02")).toBe("duel"); // a Monday
    expect(dailyPreset("2026-11-08")).toBe("stack"); // a Sunday
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it("draws the board as a small grid and writes a shareable result", () => {
    const g = LocalGame.create(getPreset("duel", 2), dailySeed("2026-11-02"));
    const view = g.view(null);
    g.free();
    const grid = shareGrid(view, 0);
    const rows = grid.split("\n");
    expect(rows).toHaveLength(7);
    for (const r of rows) expect([...r]).toHaveLength(7);
    const text = shareText({ day: "2026-11-02", outcome: "win", score: 52, opponent: 41, grid });
    expect(text).toContain("cubes daily #2 · Duel");
    expect(text).toContain("beat Flare 52–41");
    expect(text.endsWith("https://playcubes.pages.dev/daily")).toBe(true);
  });
});

describe("shareGrid", () => {
  it("only paints a block for whoever holds at least half of it", async () => {
    const { getPreset: preset } = await import("@/engine/engine");
    const config = preset("duel", 2); // 14x14 -> 2x2 blocks
    const cells = new Array(14 * 14).fill(0);
    // Top-left block fully yours, the next one a single opponent square.
    cells[0] = cells[1] = cells[14] = cells[15] = 1;
    cells[2] = 2;
    const grid = shareGrid({ config, cells } as never, 0).split("\n");
    expect([...grid[0]!].slice(0, 3).join("")).toBe("🟧⬜⬜");
  });
});
