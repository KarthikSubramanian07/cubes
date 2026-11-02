/**
 * "First light": eight small positions, each teaching one idea by making
 * you do it. Boards are drawn in ASCII (see positions.ts); every rule is
 * the engine's.
 */
import { LocalGame, getKit } from "@/engine/engine";
import { OWNER, cellCoords, type GameConfig, type GameEvent, type Placement, type View } from "@/engine/types";
import { attachPoints } from "@/game/board";
import { BASE_CONFIG, at, buildGame, rect, type PositionSpec } from "./positions";
import type { Chapter, Note, StepCtx } from "./lesson";

const D8: [number, number, number] = [8, 8, 1];

const placedBy = (events: GameEvent[], seat: number) =>
  events.filter((e): e is Extract<GameEvent, { type: "placed" }> => e.type === "placed" && e.seat === seat && !e.hidden);

const mine = (ctx: StepCtx) => ctx.who === "me";

/** Seat 0 can't move any more and the step isn't done. */
function stuck(ctx: StepCtx): string | null {
  const me = ctx.view.seats[0]!;
  if (ctx.view.phase === "over" || me.dark) return "You've run out of room to grow. Start over and try a different route.";
  return null;
}

/** Does `seat` have an attach point inside `region`? (Any shard into the region must cover one.) */
export function canReach(view: View, seat: number, region: number[]): boolean {
  if (view.seats[seat]?.dark) return false;
  const set = new Set(region);
  return attachPoints(view, seat).some((c) => set.has(c));
}

/* ------------------------------------------------------------------ 1 */

export const CORE_SPEC: PositionSpec = {
  config: { dims: D8 },
  map: [
    "........",
    ".B......",
    "........",
    "........",
    "...A....",
    "........",
    "........",
    "........",
  ],
  pieces: [["p3-v", "p4-t"], []],
  dark: [false, true],
};

const core: Chapter = {
  id: "core",
  title: ["Your ", "Core", "."],
  short: "Your Core",
  goal: "Place your first shard so it touches your Core at a corner.",
  body: [
    "That glowing square is your Core. Everything you will ever own grows out of it, one corner at a time.",
    "Pick a shard from the tray, turn it with R or flip it with F, and set it down so one of its cells touches the Core diagonally. Touch it along a side and the board says no.",
  ],
  controls: "R rotate · F flip · Enter place · Esc put down",
  board: "paper",
  build: () => buildGame(CORE_SPEC),
  steps: [
    {
      id: "link",
      label: "Touch your Core at a corner",
      done: (ctx) => mine(ctx) && placedBy(ctx.events, 0).length > 0,
      failed: stuck,
    },
  ],
  notes: ({ complete, lastPlaced }) => {
    const d = D8;
    if (complete) {
      return [
        { id: "linked", cell: lastPlaced[lastPlaced.length - 1] ?? at(d, 4, 3), text: "that's a link.\ncorner to corner.", dir: "ne", mark: "star" },
      ];
    }
    return [
      { id: "core", cell: at(d, 3, 4), text: "your Core.\nit glows. it's yours.", dir: "sw", reach: 1.8 },
      { id: "hook", cell: at(d, 4, 3), text: "hook on here,\nat a corner", dir: "ne", mark: "circle" },
      { id: "tide", cell: at(d, 1, 1), text: "Tide. napping\nthis chapter", dir: "e", tone: "seat-1", reach: 0.5 },
    ];
  },
  success: "That's a link.",
};

/* ------------------------------------------------------------------ 2 */

export const STAR = at(D8, 6, 1);

export const CORNERS_SPEC: PositionSpec = {
  config: { dims: D8 },
  map: [
    "........",
    "........",
    "........",
    "........",
    "..a.....",
    "..aa....",
    ".A....B.",
    "........",
  ],
  pieces: [["p5-w", "p5-l", "p4-l", "p3-i"], []],
  dark: [false, true],
};

const corners: Chapter = {
  id: "corners",
  title: ["Corners ", "only", "."],
  short: "Corners only",
  goal: "Reach the star. Each new shard must touch your light at a corner, never along a side.",
  body: [
    "This is the whole game, really. Your colour spreads in diagonals and leaves gaps behind it, and other people end up living in your gaps.",
    "The little ticks on the board are your attach points: empty cells where a new shard could hook on. Two shards will get you to the star if you aim them.",
  ],
  controls: "R rotate · F flip · scroll turns the shard too",
  board: "paper",
  build: () => buildGame(CORNERS_SPEC),
  steps: [
    {
      id: "reach",
      label: "Reach the star",
      depth: 2,
      done: (ctx) => ctx.view.cells[STAR] === 1,
      failed: (ctx) => {
        if (ctx.view.cells[STAR] !== OWNER.EMPTY && ctx.view.cells[STAR] !== 1) return "Something landed on the star. Start over?";
        return stuck(ctx);
      },
    },
  ],
  notes: ({ complete, view }) => {
    const d = D8;
    if (complete) return [{ id: "got", cell: STAR, text: "two hops,\nall corners", dir: "sw", mark: "star" }];
    const notes: Note[] = [{ id: "star", cell: STAR, text: "get here", dir: "w", mark: "star", reach: 1.4 }];
    if (view.cells[at(d, 4, 5)] === OWNER.EMPTY) {
      notes.push({ id: "face", cell: at(d, 4, 5), text: "flat against your\nown light? never.", dir: "se", mark: "cross", reach: 1.3 });
    }
    return notes;
  },
  success: "Two hops, all corners.",
};

/* ------------------------------------------------------------------ 3 */

export const GATE = at(D8, 3, 4);
export const POCKET = [GATE, ...rect(D8, 0, 5, 7, 7)];

export const BLOCK_SPEC: PositionSpec = {
  config: { dims: D8 },
  map: [
    "........",
    ".A....B.",
    "..a..b..",
    ".aa.bb..",
    "###.####",
    "........",
    "........",
    "........",
  ],
  pieces: [["p3-i", "p4-l", "p3-v"], ["p3-i", "p4-l", "p4-t", "p3-v", "p5-l", "p2-i"]],
};

/** Tide's plan: drop the Rod through the gap. */
export const TIDE_THREAT = [GATE, at(D8, 3, 5), at(D8, 3, 6)];

function bestInto(game: LocalGame, seat: number, region: number[]): Placement | null {
  const set = new Set(region);
  let best: Placement | null = null;
  let score = 0;
  for (const p of game.legal(seat)) {
    const s = p.cells.filter((c) => set.has(c)).length;
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return best;
}

const block: Chapter = {
  id: "block",
  title: ["Get in their ", "way", "."],
  short: "Block",
  goal: "Tide wants the pocket below the wall. Take the gap before it does.",
  body: [
    "You can't stop anyone from playing, but you can take the cell they need. The scribbled cells are scars: dead ground nobody can build on.",
    "Tide's only way into the pocket is the one-cell gap in the wall. Put a shard through it and the whole pocket is yours to grow into later.",
  ],
  board: "paper",
  build: () => buildGame(BLOCK_SPEC),
  steps: [
    {
      id: "block",
      label: "Take the gap",
      done: (ctx) => mine(ctx) && !canReach(ctx.view, 1, POCKET),
      failed: (ctx) => {
        if (POCKET.some((c) => ctx.view.cells[c] === 2)) return "Tide slipped through the gap first. Want a rematch?";
        return stuck(ctx);
      },
    },
  ],
  opponent: (game) => {
    const into = bestInto(game, 1, POCKET);
    if (!into) return null;
    return { type: "place", piece: into.piece, orient: into.orient, at: into.at, leap: false };
  },
  notes: ({ complete, view }) => {
    if (complete) return [{ id: "mine", cell: at(D8, 4, 6), text: "cut off. that whole\npocket is yours now", dir: "e", mark: "star", reach: 1 }];
    const tideIn = POCKET.some((c) => view.cells[c] === 2);
    if (tideIn) return [{ id: "lost", cell: GATE, text: "Tide got there first", dir: "e", tone: "seat-1" }];
    return [
      { id: "gate", cell: GATE, text: "the only\nway in", dir: "sw", mark: "circle", reach: 1.3 },
      { id: "threat", cell: at(D8, 3, 6), text: "Tide's next move,\nprobably", dir: "e", tone: "seat-1", outline: { cells: TIDE_THREAT, tone: "seat-1" }, reach: 1.4 },
    ];
  },
  success: "Cut off. That pocket is all yours.",
};

/* ------------------------------------------------------------------ 4 */

export const NODE = at(D8, 2, 4);
export const GAP = at(D8, 0, 7);

export const SURGES_SPEC: PositionSpec = {
  config: { dims: D8 },
  map: [
    "....#...",
    ".A..#...",
    "..aa#...",
    "....#...",
    "..*.#...",
    "....#...",
    "#a..#...",
    ".#..#..B",
  ],
  pieces: [["p3-v", "p4-l", "p4-t", "p3-i"], []],
  charge: [2, 0],
  dark: [false, true],
};

/** The Spark's piece index (the engine must be loaded first, so it's looked up lazily). */
const sparkIndex = () => getKit("shards").sparkIndex;

const surges: Chapter = {
  id: "surges",
  title: ["Nodes and ", "surges", "."],
  short: "Nodes & surges",
  goal: "Grab the node, Leap the wall, then Spark into the one-cell gap.",
  body: [
    "Nodes are the glowing diamonds. Cover one and you bank a charge. Charge buys surges.",
    "Leap (2 charge) lets a shard link from up to two cells away, so walls stop being walls. Spark (1 charge) places a single cell, for gaps no shard fits.",
  ],
  controls: "L leap · S spark",
  board: "paper",
  build: () => buildGame(SURGES_SPEC),
  steps: [
    {
      id: "node",
      label: "Cover the node · +1 charge",
      allow: (p, leap) => !leap && p.piece !== sparkIndex() && p.cells.includes(NODE),
      allowWhy: "grab the node first",
      done: (ctx) => mine(ctx) && ctx.events.some((e) => e.type === "node" && e.seat === 0),
      failed: stuck,
    },
    {
      id: "leap",
      label: "Leap the wall · 2 charge",
      surges: ["leap"],
      allow: (p, leap, view) => leap && p.piece !== sparkIndex() && p.cells.every((c) => cellCoords(view.config.dims, c)[0] >= 5),
      allowWhy: "turn on Leap and land past the wall",
      done: (ctx) => mine(ctx) && placedBy(ctx.events, 0).some((e) => e.leap),
      failed: stuck,
    },
    {
      id: "spark",
      label: "Spark the gap · 1 charge",
      surges: ["spark"],
      allow: (p, leap) => !leap && p.piece === sparkIndex() && p.cells.includes(GAP),
      allowWhy: "pick Spark and drop it in the circled gap",
      done: (ctx) => mine(ctx) && placedBy(ctx.events, 0).some((e) => e.spark),
      failed: stuck,
    },
  ],
  notes: ({ step, complete }) => {
    if (complete) return [{ id: "done", cell: GAP, text: "charge well spent", dir: "ne", mark: "star", reach: 1.6 }];
    if (step === 0) return [{ id: "node", cell: NODE, text: "a node.\n+1 charge", dir: "s", mark: "circle", reach: 1.1 }];
    if (step === 1) return [{ id: "wall", cell: at(D8, 4, 4), text: "a wall. leap it:\nlink from two away", dir: "e", reach: 1.2 }];
    return [{ id: "gap", cell: GAP, text: "one cell wide.\nonly a spark fits", dir: "ne", mark: "circle", reach: 1.6 }];
  },
  success: "Charge spent well.",
};

/* ------------------------------------------------------------------ 5 */

export const DOOR = at(D8, 5, 3);
export const BELOW = rect(D8, 0, 4, 7, 7);

export const SHATTER_SPEC: PositionSpec = {
  config: { dims: D8 },
  map: [
    "........",
    ".A....B.",
    "..a..b..",
    "###a#b##",
    "........",
    "........",
    "........",
    "........",
  ],
  pieces: [["p4-l", "p4-t", "p5-l"], ["p3-i", "p4-l", "p4-t", "p3-v", "p2-i"]],
  charge: [3, 0],
};

const shatter: Chapter = {
  id: "shatter",
  title: ["Break the ", "chain", "."],
  short: "Shatter",
  goal: "Shatter the cell holding Tide's door open, then claim the space below.",
  body: [
    "Shatter costs 3 charge and destroys one enemy cell. It leaves a scar: dead, unscorable, and nobody can build on it.",
    "Use it to cut a chain, not to redecorate. It doesn't end your turn, so you still get to place afterwards.",
  ],
  controls: "X shatter",
  board: "paper",
  build: () => buildGame(SHATTER_SPEC),
  steps: [
    {
      id: "shatter",
      label: "Shatter the door · 3 charge",
      surges: ["shatter"],
      allow: () => false,
      allowWhy: "shatter first: press Shatter, then pick the cell",
      done: (ctx) => mine(ctx) && ctx.events.some((e) => e.type === "shattered") && !canReach(ctx.view, 1, BELOW),
      failed: (ctx) =>
        ctx.action.type === "shatter" ? "That one wasn't holding the door. Start over and try its neighbour." : stuck(ctx),
    },
    {
      id: "claim",
      label: "Claim the space below",
      allow: (p) => p.cells.some((c) => BELOW.includes(c)),
      allowWhy: "go below the wall",
      done: (ctx) => mine(ctx) && placedBy(ctx.events, 0).some((e) => e.cells.some((c) => BELOW.includes(c))),
      failed: stuck,
    },
  ],
  notes: ({ step, complete }) => {
    if (complete) return [{ id: "ok", cell: at(D8, 4, 6), text: "door closed.\nall yours.", dir: "e", mark: "star", reach: 1 }];
    if (step === 0)
      return [
        { id: "door", cell: DOOR, text: "this one holds\nthe door open", dir: "e", mark: "circle", tone: "accent", reach: 1.2 },
        { id: "tide", cell: at(D8, 6, 4), text: "Tide can still\nget in here", dir: "se", tone: "seat-1", reach: 1.2 },
      ];
    return [{ id: "scar", cell: DOOR, text: "a scar now.\ndead ground", dir: "e", reach: 1.2 }];
  },
  success: "Door closed. Space claimed.",
};

/* ------------------------------------------------------------------ 6 */

const D10: [number, number, number] = [10, 10, 1];
export const HIDDEN_TARGET = at(D10, 6, 3);
export const FOG_SUGGEST = rect(D10, 3, 3, 7, 3);

export const FOG_SPEC: PositionSpec = {
  config: { dims: D10, fog: 2 },
  map: [
    "..........",
    ".A........",
    "..a.......",
    "......h...",
    "......hh..",
    "..........",
    "..........",
    "......hh..",
    "........B.",
    "..........",
  ],
  pieces: [["p5-i", "p5-l", "p4-l"], []],
  charge: [1, 0],
  dark: [false, true],
};

const fog: Chapter = {
  id: "fog",
  title: ["Into the ", "fog", "."],
  short: "Fog",
  goal: "Drop the long shard on the marked spot, see what happens, then Scan.",
  body: [
    "Under fog you only see two cells out from your own light. Everything else is memory, and memory lies.",
    "Place onto something you couldn't see and it misfires: the shard comes back to you, but the turn is gone. Scan (1 charge) lights up the whole board until your next turn ends.",
  ],
  controls: "C scan",
  board: "paper",
  build: () => buildGame(FOG_SPEC),
  steps: [
    {
      id: "misfire",
      label: "Place on the marked spot",
      allow: (p) => p.cells.includes(HIDDEN_TARGET),
      allowWhy: "try the dashed spot",
      done: (ctx) => mine(ctx) && ctx.events.some((e) => e.type === "misfire"),
      failed: stuck,
    },
    {
      id: "scan",
      label: "Scan · 1 charge",
      surges: ["scan"],
      allow: () => false,
      allowWhy: "scan first, then place",
      done: (ctx) => mine(ctx) && ctx.events.some((e) => e.type === "scanned"),
      failed: stuck,
    },
    {
      id: "place",
      label: "Now place it where it really fits",
      done: (ctx) => mine(ctx) && placedBy(ctx.events, 0).length > 0,
      failed: stuck,
    },
  ],
  notes: ({ step, complete }) => {
    if (complete) return [{ id: "ok", cell: at(D10, 3, 3), text: "seen, then placed", dir: "sw", mark: "star", reach: 1.4 }];
    if (step === 0)
      return [
        { id: "spot", cell: at(D10, 5, 3), text: "looks empty.\nlooks.", dir: "s", outline: { cells: FOG_SUGGEST, tone: "accent" }, reach: 1.6 },
      ];
    if (step === 1) return [{ id: "oops", cell: HIDDEN_TARGET, text: "Tide was hiding here.\nturn lost, shard kept", dir: "s", tone: "seat-1", reach: 2 }];
    return [{ id: "clear", cell: at(D10, 7, 5), text: "everything in sight,\nfor now", dir: "s", reach: 1.4 }];
  },
  success: "Seen, then placed.",
};

/* ------------------------------------------------------------------ 7 */

const D3: [number, number, number] = [5, 5, 3];

export const STACK_SPEC: PositionSpec = {
  config: { dims: D3, gravity: true, crowns: true, kit: "cubes", arena: false, nodes: 0 },
  map: [
    [
      "....B",
      ".A.b.",
      "..ab.",
      "..a..",
      ".....",
    ],
    [
      ".....",
      ".....",
      "..ba.",
      "..b..",
      ".....",
    ],
    [
      ".....",
      ".....",
      ".....",
      ".....",
      ".....",
    ],
  ],
  pieces: [["c2-i", "c3-i", "c3-v"], []],
  dark: [false, true],
};

/** Columns whose top cube belongs to `seat`. */
export function crowns(view: View, seat: number): number {
  const [w, h, d] = view.config.dims;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let z = d - 1; z >= 0; z--) {
        const o = view.cells[x + w * (y + h * z)]!;
        if (o === OWNER.EMPTY) continue;
        if (o === seat + 1) n++;
        break;
      }
  return n;
}

const stack: Chapter = {
  id: "stack",
  title: ["Up a ", "dimension", "."],
  short: "Up a dimension",
  goal: "Stack a shard on top of Tide's tower to crown that column.",
  body: [
    "In 3D every cube needs something underneath it. And because you can never touch your own light along a face, you can't stack on yourself. You climb on everyone else.",
    "The top cube of each column is a crown, worth a point at the end. Tide climbed on you; return the favour.",
  ],
  controls: "drag to orbit · R rotate · T tip · G roll",
  board: "night",
  build: () => buildGame(STACK_SPEC),
  steps: [
    {
      id: "crown",
      label: "Crown one of Tide's towers",
      done: (ctx) => {
        if (!mine(ctx)) return false;
        const [w, h] = ctx.view.config.dims;
        return placedBy(ctx.events, 0).some((e) => e.cells.some((c) => c >= w * h && ctx.view.cells[c - w * h] === 2));
      },
      failed: stuck,
    },
  ],
  notes: ({ complete }) => {
    if (complete) return [{ id: "crowned", text: "crowned. the top\ncube is yours", dir: "ne", mark: "star" }];
    return [
      { id: "tower", text: "Tide's tower is the teal\none sitting on your cubes", dir: "nw", tone: "seat-1" },
      { id: "self", text: "your own cubes?\nno stacking on yourself", dir: "se" },
    ];
  },
  success: "Crowned.",
};

/* ------------------------------------------------------------------ 8 */

export const FINAL_PIECES = ["p5-l", "p5-t", "p5-v", "p4-t", "p4-s", "p3-v", "p2-i"];

export const FINAL_CONFIG: GameConfig = { ...BASE_CONFIG, dims: [10, 10, 1], nodes: 4 };

/** A real two-seat game, both seats holding the same short kit. */
export function buildFinal(seed = 11): LocalGame {
  const g = LocalGame.create(FINAL_CONFIG, seed);
  const data = JSON.parse(g.toJSON()) as { state: { seats: { pieces: boolean[] }[] } };
  g.free();
  const kit = getKit("shards");
  for (const s of data.state.seats) s.pieces = kit.pieces.map((p) => FINAL_PIECES.includes(p.id));
  return LocalGame.fromJSON(JSON.stringify(data));
}

const graduate: Chapter = {
  id: "graduate",
  title: ["Your first ", "game", "."],
  short: "Graduation",
  goal: "A real game on a small board, seven shards each. Beat Ember, or at least make it sweat.",
  body: [
    "Same rules, nothing scripted. Ember is the gentlest of the bots. Most cells wins, and placing your whole kit adds 5.",
    "Use the nodes. Block when you can. Corners only.",
  ],
  controls: "1–7 pick a shard · R F turn it · L S X surges",
  board: "paper",
  build: () => buildFinal(),
  steps: [
    {
      id: "play",
      label: "Play it out against Ember",
      surges: ["spark", "leap", "shatter"],
      open: true,
      done: (ctx) => ctx.view.phase === "over",
    },
  ],
  notes: ({ view, complete }) => {
    if (complete || view.ply > 0) return [];
    const coreCell = view.seats[0]!.core;
    return [{ id: "you", cell: coreCell, text: "you start here", dir: "ne", reach: 1.4 }];
  },
  success: "Graduated.",
};

export const CHAPTERS: Chapter[] = [core, corners, block, surges, shatter, fog, stack, graduate];
