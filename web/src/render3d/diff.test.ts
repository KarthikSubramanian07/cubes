import { describe, expect, it } from "vitest";
import { FLAG, OWNER, type GameEvent, type View } from "@/engine/types";
import { diffViews } from "./diff";
import { baseConfig } from "./fixtures";

function view(patch: Partial<View> & { n?: number; fog?: boolean } = {}): View {
  const n = patch.n ?? 16;
  const config = baseConfig([4, 4, 1], { fog: patch.fog ? 2 : null });
  return {
    config,
    seat: 0,
    cells: new Array(n).fill(0),
    flags: new Array(n).fill(FLAG.VISIBLE),
    seats: [],
    turn: 0,
    round: 1,
    ply: 0,
    phase: "playing",
    stormLevel: 0,
    nextStorm: null,
    scanning: false,
    shatteredThisTurn: false,
    events: [],
    scores: null,
    winners: null,
    ...patch,
  };
}

function next(prev: View, edit: (cells: number[], flags: number[]) => void, events: GameEvent[] = [], dPly = 1): View {
  const cells = [...prev.cells];
  const flags = [...prev.flags];
  edit(cells, flags);
  return { ...prev, cells, flags, events, ply: prev.ply + dPly };
}

describe("diffViews: when to snap", () => {
  it("resets on the first view, a new board, a new perspective and a rewind", () => {
    const a = view();
    expect(diffViews(null, a)).toEqual({ reset: true, events: [] });
    expect(diffViews(a, { ...view({ n: 25 }), config: baseConfig([5, 5, 1]) }).reset).toBe(true);
    expect(diffViews(a, { ...a, seat: 1 }).reset).toBe(true);
    expect(diffViews({ ...a, ply: 5 }, { ...a, ply: 4 }).reset).toBe(true);
  });

  it("reports nothing when a View is re-sent unchanged, even with stale events", () => {
    const a = view({ events: [{ type: "misfire", seat: 0, cells: [1] }] });
    expect(diffViews(a, { ...a })).toEqual({ reset: false, events: [] });
  });
});

describe("diffViews: placements", () => {
  it("groups new cells by seat", () => {
    const a = view();
    const b = next(a, (c) => {
      c[0] = 1;
      c[1] = 1;
      c[5] = 3;
    });
    const r = diffViews(a, b);
    expect(r.reset).toBe(false);
    expect(r.events).toEqual([
      { kind: "place", seat: 0, cells: [0, 1], spark: false, leap: false },
      { kind: "place", seat: 2, cells: [5], spark: true, leap: false },
    ]);
  });

  it("uses placed events to tell placements from fog reveals", () => {
    const a = view({ fog: true });
    const b = next(
      a,
      (c) => {
        c[0] = 1;
        c[9] = 2;
      },
      [{ type: "placed", seat: 0, piece: 3, cells: [0], leap: true, spark: false, hidden: false }],
    );
    expect(diffViews(a, b).events).toEqual([
      { kind: "place", seat: 0, cells: [0], spark: false, leap: true },
      { kind: "reveal", cells: [9] },
    ]);
  });

  it("without events under fog, cells that just came into sight are reveals", () => {
    const a = view({ fog: true });
    a.flags[3] = 0; // was not visible
    const b = next(a, (c, f) => {
      c[3] = 2;
      f[3] = FLAG.VISIBLE;
      c[4] = 1; // was visible: a real placement
    });
    const kinds = diffViews(a, b).events.map((e) => e.kind);
    expect(kinds).toEqual(["place", "reveal"]);
  });

  it("collects nodes from cleared flags and events without double counting", () => {
    const a = view();
    a.flags[6] = FLAG.VISIBLE | FLAG.NODE;
    const b = next(
      a,
      (c, f) => {
        c[6] = 2;
        f[6] = FLAG.VISIBLE;
      },
      [{ type: "node", seat: 1, cell: 6 }],
    );
    expect(diffViews(a, b).events.filter((e) => e.kind === "node")).toEqual([{ kind: "node", seat: 1, cell: 6 }]);
  });
});

describe("diffViews: destruction", () => {
  it("turns a scar into a shatter with the attacker from events", () => {
    const a = view();
    a.cells[2] = 3;
    const b = next(a, (c) => (c[2] = OWNER.SCAR), [{ type: "shattered", seat: 0, cell: 2, victim: 2 }], 0);
    expect(diffViews(a, b).events).toEqual([{ kind: "shatter", cell: 2, victim: 2, seat: 0 }]);
  });

  it("collects storm ash with the previous owners", () => {
    const a = view();
    a.cells[0] = 4;
    const b = next(a, (c) => {
      c[0] = OWNER.ASH;
      c[1] = OWNER.ASH;
    });
    expect(diffViews(a, b).events).toEqual([{ kind: "storm", cells: [0, 1], seats: [3, -1] }]);
  });

  it("passes misfires through and notices removals", () => {
    const a = view();
    a.cells[7] = 1;
    const b = next(a, (c) => (c[7] = OWNER.EMPTY), [{ type: "misfire", seat: 0, cells: [8, 9] }]);
    expect(diffViews(a, b).events).toEqual([
      { kind: "misfire", seat: 0, cells: [8, 9] },
      { kind: "remove", cells: [7], seats: [0] },
    ]);
  });
});
