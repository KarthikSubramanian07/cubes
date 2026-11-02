import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getPreset } from "@/engine/engine";
import type { Action, AiLevel } from "@/engine/types";
import { LocalMatch, type MatchSnapshot } from "./LocalMatch";

beforeAll(initEngineForTests);

/** Runs bots in-process, immediately. */
const syncBots = {
  think: async (json: string, seat: number, level: AiLevel): Promise<Action | null> => {
    const g = LocalGame.fromJSON(json);
    try {
      return g.botAction(seat, level, seat + 1, 0);
    } finally {
      g.free();
    }
  },
  dispose: () => {},
};

async function until(m: LocalMatch, pred: (s: MatchSnapshot) => boolean, ms = 20000) {
  const start = Date.now();
  while (!pred(m.getSnapshot())) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe("LocalMatch", () => {
  it("plays a human against a bot, with undo", async () => {
    const m = new LocalMatch({
      config: getPreset("duel", 2),
      seats: [{ kind: "human", name: "You" }, { kind: "bot", name: "Flare", level: "flare" }],
      seed: 9,
      botDelayMs: 0,
      bots: syncBots,
    });
    expect(m.getSnapshot().canAct).toBe(true);
    const legal = m.legal();
    expect(legal.length).toBeGreaterThan(0);
    const p = legal[0]!;
    expect(m.act({ type: "place", piece: p.piece, orient: p.orient, at: p.at, leap: false })).toEqual({ ok: true });
    await until(m, (s) => s.canAct);
    expect(m.getSnapshot().view.ply).toBe(2);
    expect(m.getSnapshot().undoable).toBe(true);
    expect(m.undo()).toBe(true);
    await until(m, (s) => s.canAct);
    expect(m.getSnapshot().view.ply).toBe(0);
    m.dispose();
  });

  it("can be disposed twice, as React's cleanups may do", () => {
    let disposed = 0;
    const m = new LocalMatch({
      config: getPreset("duel", 2),
      seats: [{ kind: "bot", name: "A", level: "ember" }, { kind: "human", name: "You" }],
      seed: 2,
      bots: { think: () => new Promise(() => {}), dispose: () => void disposed++ },
    });
    m.dispose();
    expect(() => m.dispose()).not.toThrow();
    expect(disposed).toBe(1);
  });

  it("rematch frees the old match once", () => {
    let disposed = 0;
    const bots = { think: () => new Promise<null>(() => {}), dispose: () => void disposed++ };
    const m = new LocalMatch({
      config: getPreset("duel", 2),
      seats: [{ kind: "human", name: "You" }, { kind: "bot", name: "A", level: "ember" }],
      seed: 3,
      bots,
    });
    const next = m.rematch();
    m.dispose();
    expect(disposed).toBe(1);
    next.dispose();
  });

  it("rejects moves out of turn", () => {
    const m = new LocalMatch({
      config: getPreset("duel", 2),
      seats: [{ kind: "bot", name: "A", level: "ember" }, { kind: "human", name: "You" }],
      seed: 1,
      botDelayMs: 0,
      bots: { think: () => new Promise(() => {}), dispose: () => {} },
    });
    expect(m.getSnapshot().canAct).toBe(false);
    expect(m.act({ type: "scan" }).ok).toBe(false);
    m.dispose();
  });

  it("asks for a hand-off between humans under fog", () => {
    const m = new LocalMatch({
      config: getPreset("fog", 2),
      seats: [{ kind: "human", name: "A" }, { kind: "human", name: "B" }],
      seed: 3,
      bots: syncBots,
    });
    const p = m.legal()[0]!;
    m.act({ type: "place", piece: p.piece, orient: p.orient, at: p.at, leap: false });
    const s = m.getSnapshot();
    expect(s.handoff).toBe(1);
    expect(s.canAct).toBe(false);
    expect(s.perspective).toBe(0);
    m.acceptHandoff();
    expect(m.getSnapshot().perspective).toBe(1);
    expect(m.getSnapshot().canAct).toBe(true);
    m.dispose();
  });

  it("bots finish a four-seat game on their own", async () => {
    const m = new LocalMatch({
      config: getPreset("plane", 4),
      seats: [0, 1, 2, 3].map((i) => ({ kind: "bot" as const, name: `Bot ${i}`, level: "ember" as const })),
      seed: 5,
      botDelayMs: 0,
      bots: syncBots,
    });
    await until(m, (s) => s.view.phase === "over", 60000);
    expect(m.getSnapshot().view.winners!.length).toBeGreaterThan(0);
    m.dispose();
  }, 70000);

  it("rebuilds every position of a finished game for the replay", async () => {
    const m = new LocalMatch({
      config: getPreset("duel", 2),
      seats: [{ kind: "bot", name: "A", level: "ember" }, { kind: "bot", name: "B", level: "ember" }],
      seed: 12,
      botDelayMs: 0,
      bots: syncBots,
    });
    await until(m, (s) => s.view.phase === "over", 60000);
    const frames = m.frames();
    const final = m.getSnapshot().view;
    expect(frames.length).toBe(m.replayLog().length + 1);
    expect(frames[0]!.ply).toBe(0);
    expect(frames[0]!.cells.filter((c) => c >= 1 && c <= 4).length).toBe(2); // just the two Cores
    expect(frames.at(-1)!.cells).toEqual(final.cells);
    expect(frames.at(-1)!.phase).toBe("over");
    // Cached until the game moves on.
    expect(m.frames()).toBe(frames);
    m.dispose();
  }, 70000);
});
