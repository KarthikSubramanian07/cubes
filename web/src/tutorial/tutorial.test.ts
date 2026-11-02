import { initEngineForTests } from "@/engine/testing";
import { getKit, validateConfig } from "@/engine/engine";
import { FLAG, OWNER, type Action, type View } from "@/engine/types";
import { neighbourTables } from "@/game/board";
import { CHAPTERS, BLOCK_SPEC, CORE_SPEC, DOOR, GATE, HIDDEN_TARGET, POCKET, STACK_SPEC, crowns } from "./chapters";
import { explainPlacement } from "./explain";
import { at, buildGame, configOf, parseMap } from "./positions";
import { LessonRun } from "./runner";
import { candidates, playThrough, solve } from "./solver";
import { loadProgress, saveProgress, PROGRESS_KEY } from "./progress";

beforeAll(initEngineForTests);

const byId = (id: string) => CHAPTERS.find((c) => c.id === id)!;

function place(run: LessonRun, pred: (cells: number[]) => boolean, leap = false): Action {
  const p = run.legalByRules(leap).find((x) => pred(x.cells));
  if (!p) throw new Error("no such placement");
  return { type: "place", piece: p.piece, orient: p.orient, at: p.at, leap };
}

/** Pre-placed light obeys the link rule's spirit: no shard of yours touches your Core along a side. */
function coresClean(view: View): boolean {
  const { face } = neighbourTables(view.config);
  return view.seats.every((s) => face[s.core]!.every((f) => view.cells[f] !== s.seat + 1));
}

describe("tutorial positions", () => {
  it("has eight chapters with unique ids", () => {
    expect(CHAPTERS).toHaveLength(8);
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(8);
  });

  for (const ch of CHAPTERS) {
    describe(ch.id, () => {
      it("builds a valid, playable position", () => {
        const run = new LessonRun(ch);
        const view = run.view();
        expect(validateConfig(view.config)).toBeNull();
        expect(view.phase).toBe("playing");
        expect(view.turn).toBe(0);
        expect(view.cells.filter((_, i) => view.flags[i]! & FLAG.CORE)).toHaveLength(2);
        expect(coresClean(view)).toBe(true);
        expect(run.canAct()).toBe(true);
        expect(candidates(run).length).toBeGreaterThan(0);
        run.dispose();
      });

      it("can be completed by doing what it asks", () => {
        const run = new LessonRun(ch);
        const moves = playThrough(run);
        expect(run.failure).toBeNull();
        expect(run.complete).toBe(true);
        expect(moves.length).toBeGreaterThanOrEqual(ch.steps.length);
        run.dispose();
      });
    });
  }
});

describe("chapter predicates", () => {
  it("Core: the first legal shard completes it, a side touch is explained", () => {
    const run = new LessonRun(byId("core"));
    const view = run.view();
    const core = at(CORE_SPEC.config.dims, 3, 4);
    const right = at(CORE_SPEC.config.dims, 4, 4);
    const why = explainPlacement(view, 0, [right, at(CORE_SPEC.config.dims, 5, 4)]);
    expect(why?.problem).toBe("face-core");
    expect(why?.cell).toBe(core);
    expect(why?.text).toMatch(/touches your Core along a side\. corners only\./);
    expect(run.act(solve(run)!).ok).toBe(true);
    expect(run.complete).toBe(true);
    run.dispose();
  });

  it("Corners: needs two shards to reach the star", () => {
    const run = new LessonRun(byId("corners"));
    const copy = run.clone();
    // No single shard gets there.
    for (const a of candidates(copy)) {
      const c = copy.clone();
      c.act(a);
      expect(c.complete).toBe(false);
      c.dispose();
    }
    copy.dispose();
    playThrough(run);
    expect(run.complete).toBe(true);
    run.dispose();
  });

  it("Block: taking the gap shuts Tide out; anything else lets it in", () => {
    const good = new LessonRun(byId("block"));
    good.act(place(good, (c) => c.includes(GATE)));
    expect(good.complete).toBe(true);
    good.opponentMove();
    expect(POCKET.some((c) => good.view().cells[c] === 2)).toBe(false);
    good.dispose();

    const bad = new LessonRun(byId("block"));
    bad.act(place(bad, (c) => !c.includes(GATE) && c.every((x) => x < 32)));
    expect(bad.complete).toBe(false);
    bad.opponentMove();
    expect(POCKET.some((c) => bad.view().cells[c] === 2)).toBe(true);
    expect(bad.failure).toMatch(/Tide slipped through/);
    bad.dispose();
    expect(BLOCK_SPEC.map).toHaveLength(8);
  });

  it("Surges: node, then leap, then spark, each only in its turn", () => {
    const run = new LessonRun(byId("surges"));
    const kit = getKit("shards");
    expect(run.legal(true)).toHaveLength(0);
    expect(run.legal(false).every((p) => p.piece !== kit.sparkIndex)).toBe(true);
    run.act(solve(run)!);
    expect(run.step).toBe(1);
    expect(run.view().seats[0]!.charge).toBe(3);
    run.act(solve(run)!);
    expect(run.step).toBe(2);
    expect(run.view().seats[0]!.charge).toBe(1);
    run.act(solve(run)!);
    expect(run.complete).toBe(true);
    expect(run.view().seats[0]!.charge).toBe(0);
    run.dispose();
  });

  it("Shatter: only the door cell counts", () => {
    const wrong = new LessonRun(byId("shatter"));
    const other = wrong.view().cells.findIndex((o, i) => o === 2 && i !== DOOR && !(wrong.view().flags[i]! & FLAG.CORE));
    expect(wrong.act({ type: "shatter", cell: other }).ok).toBe(true);
    expect(wrong.failure).toMatch(/wasn't holding the door/);
    wrong.dispose();

    const right = new LessonRun(byId("shatter"));
    expect(right.act({ type: "shatter", cell: DOOR }).ok).toBe(true);
    expect(right.view().cells[DOOR]).toBe(OWNER.SCAR);
    expect(right.step).toBe(1);
    playThrough(right);
    expect(right.complete).toBe(true);
    right.dispose();
  });

  it("Fog: the marked spot misfires, Scan reveals, then a real placement", () => {
    const run = new LessonRun(byId("fog"));
    const v0 = run.view();
    expect(v0.cells[HIDDEN_TARGET]).toBe(OWNER.EMPTY);
    expect(v0.flags[HIDDEN_TARGET]! & FLAG.VISIBLE).toBe(0);
    const ev = run.act(solve(run)!);
    expect(ev.ok && ev.events.some((e) => e.type === "misfire")).toBe(true);
    expect(run.view().cells[HIDDEN_TARGET]).toBe(2);
    expect(run.view().seats[0]!.piecesLeft).toBe(3);
    expect(solve(run)).toEqual({ type: "scan" });
    run.act({ type: "scan" });
    expect(run.view().scanning).toBe(true);
    run.act(solve(run)!);
    expect(run.complete).toBe(true);
    run.dispose();
  });

  it("Stack: stacking on yourself is explained, crowning Tide's tower completes it", () => {
    const run = new LessonRun(byId("stack"));
    const view = run.view();
    const d = STACK_SPEC.config.dims;
    const own = at(d, 3, 2, 1);
    expect(view.cells[own]).toBe(1);
    const why = explainPlacement(view, 0, [at(d, 3, 2, 2), at(d, 2, 2, 2)]);
    expect(why?.text).toMatch(/can't stack on your own cubes/);
    const before = crowns(view, 0);
    run.act(solve(run)!);
    expect(run.complete).toBe(true);
    expect(crowns(run.view(), 0)).toBeGreaterThan(before);
    run.dispose();
  });

  it("Graduation: a real game against Ember runs to the end", () => {
    const run = new LessonRun(byId("graduate"));
    playThrough(run, 40);
    expect(run.view().phase).toBe("over");
    expect(run.complete).toBe(true);
    run.dispose();
  });

  it("rejects moves the step doesn't want, with the step's reason", () => {
    const run = new LessonRun(byId("surges"));
    const off = place(run, (c) => !c.includes(at([8, 8, 1], 2, 4)));
    const r = run.act(off);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("grab the node first");
    run.dispose();
  });
});

describe("position parser", () => {
  it("reads every symbol", () => {
    const p = parseMap({ config: { dims: [8, 8, 1] }, map: ["A.a*#hbB", ...Array(7).fill("........")] });
    expect(p.cells.slice(0, 8)).toEqual([1, 0, 1, 0, OWNER.SCAR, 2, 2, 2]);
    expect(p.flags[3]).toBe(FLAG.NODE);
    expect(p.cores).toEqual([0, 7]);
    expect(p.hidden).toEqual([5]);
  });

  it("rejects bad maps", () => {
    expect(() => parseMap({ config: { dims: [8, 8, 1] }, map: ["A......B"] })).toThrow(/rows/);
    expect(() => parseMap({ config: { dims: [8, 8, 1] }, map: Array(8).fill("........") })).toThrow(/Core/);
    expect(() => parseMap({ config: { dims: [8, 8, 1] }, map: ["A.....?B", ...Array(7).fill("........")] })).toThrow(/symbol/);
  });

  it("builds games whose config validates", () => {
    expect(validateConfig(configOf(STACK_SPEC))).toBeNull();
    const g = buildGame(CORE_SPEC);
    expect(g.view(0).seats[1]!.dark).toBe(true);
    g.free();
  });
});

describe("explanations", () => {
  const run = () => new LessonRun(byId("block"));
  it("names occupied cells, scars and missing links", () => {
    const r = run();
    const v = r.view();
    const d: [number, number, number] = [8, 8, 1];
    expect(explainPlacement(v, 0, [at(d, 0, 4)])?.problem).toBe("scar");
    expect(explainPlacement(v, 0, [at(d, 5, 3)])?.text).toMatch(/someone already lives there/);
    expect(explainPlacement(v, 0, [at(d, 6, 6), at(d, 7, 6)])?.problem).toBe("no-link");
    expect(explainPlacement(v, 0, [at(d, 3, 3)])?.problem).toBe("face");
    expect(explainPlacement(v, 0, null, { anchor: 3 })?.problem).toBe("offboard");
    expect(explainPlacement(v, 0, [GATE, at(d, 3, 5)])).toBeNull();
    r.dispose();
  });
});

describe("progress", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips and survives junk", () => {
    expect(loadProgress()).toEqual({ chapter: 0, done: [] });
    saveProgress({ chapter: 3, done: ["core", "corners"] });
    expect(loadProgress()).toEqual({ chapter: 3, done: ["core", "corners"] });
    localStorage.setItem(PROGRESS_KEY, "{nope");
    expect(loadProgress()).toEqual({ chapter: 0, done: [] });
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ chapter: 99, done: ["core", "bogus"] }));
    expect(loadProgress()).toEqual({ chapter: 7, done: ["core"] });
  });
});
