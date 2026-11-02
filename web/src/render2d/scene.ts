/**
 * Turn an engine View into what the Paper board draws: shards (connected
 * same-owner groups) with their boundary loops, scars, ash, nodes, cores and
 * fog. Pure, so it is easy to test and to memoise.
 */
import { FLAG, OWNER, SEAT_NAMES, type View } from "@/engine/types";
import { cellName } from "./geometry";
import { components, traceLoops, type Loop } from "./outline";

export interface Shard {
  /** Stable identity: owner + cells (+ memory state). */
  key: string;
  seat: number;
  cells: number[];
  loops: Loop[];
  /** Every cell is fog memory, not current sight. */
  stale: boolean;
  /** Contains the seat's Core. */
  core: boolean;
}

export interface Scene {
  w: number;
  h: number;
  torus: boolean;
  playable: Uint8Array;
  boardLoops: Loop[];
  shards: Shard[];
  scars: number[];
  ash: number[];
  /** Empty node cells. */
  nodes: number[];
  /** Node cells that have been covered, with the covering seat. */
  takenNodes: { cell: number; seat: number }[];
  cores: { cell: number; seat: number }[];
  /** Cells outside current sight (fog games only). */
  fog: number[];
  fogLoops: Loop[];
  /** Fogged cells with no memory at all. */
  unknown: number[];
}

export const isSeatOwner = (o: number) => o >= 1 && o <= 4;

export function isFogged(view: View, i: number): boolean {
  return view.config.fog != null && ((view.flags[i] ?? 0) & FLAG.VISIBLE) === 0;
}

/** Key for the board's playable shape, so static layers can be memoised on it. */
export function shapeKey(view: View): string {
  const [w, h] = view.config.dims;
  let s = `${w}x${h}:${view.config.topology}:`;
  for (let i = 0; i < w * h; i++) if (view.cells[i] === OWNER.VOID) s += i.toString(36) + ",";
  return s;
}

export function buildScene(view: View): Scene {
  const [w, h] = view.config.dims;
  const n = w * h;
  const playable = new Uint8Array(n);
  const bySeat: number[][] = [[], [], [], []];
  const scars: number[] = [];
  const ash: number[] = [];
  const nodes: number[] = [];
  const takenNodes: { cell: number; seat: number }[] = [];
  const cores: { cell: number; seat: number }[] = [];
  const fog: number[] = [];
  const unknown: number[] = [];
  const hasFog = view.config.fog != null;

  for (let i = 0; i < n; i++) {
    const o = view.cells[i] ?? OWNER.VOID;
    const f = view.flags[i] ?? 0;
    if (o === OWNER.VOID) continue;
    playable[i] = 1;
    const fogged = hasFog && (f & FLAG.VISIBLE) === 0;
    if (fogged) {
      fog.push(i);
      if (o === OWNER.EMPTY && (f & FLAG.STALE) === 0) unknown.push(i);
    }
    if (isSeatOwner(o)) {
      const seat = o - 1;
      bySeat[seat]!.push(i);
      if (f & FLAG.CORE) cores.push({ cell: i, seat });
      else if (f & FLAG.NODE) takenNodes.push({ cell: i, seat });
    } else if (o === OWNER.SCAR) scars.push(i);
    else if (o === OWNER.ASH) ash.push(i);
    else if (o === OWNER.EMPTY && f & FLAG.NODE) nodes.push(i);
  }

  const coreSet = new Set(cores.map((c) => c.cell));
  const shards: Shard[] = [];
  bySeat.forEach((cells, seat) => {
    for (const comp of components(cells, w)) {
      const stale = hasFog && comp.every((i) => isFogged(view, i));
      shards.push({
        key: `${seat}|${stale ? "m" : "i"}|${comp.join(",")}`,
        seat,
        cells: comp,
        loops: traceLoops(comp, w),
        stale,
        core: comp.some((i) => coreSet.has(i)),
      });
    }
  });

  const playableCells: number[] = [];
  for (let i = 0; i < n; i++) if (playable[i]) playableCells.push(i);

  return {
    w,
    h,
    torus: view.config.topology === "torus",
    playable,
    boardLoops: traceLoops(playableCells, w),
    shards,
    scars,
    ash,
    nodes,
    takenNodes,
    cores,
    fog,
    fogLoops: fog.length ? traceLoops(fog, w) : [],
    unknown,
  };
}

/** Cells of `next` that became seat-owned since `prev` (for the bleed-in animation). */
export function freshCells(prev: readonly number[] | null, next: readonly number[]): Set<number> {
  const out = new Set<number>();
  if (!prev || prev.length !== next.length) return out;
  for (let i = 0; i < next.length; i++) {
    const o = next[i]!;
    if (isSeatOwner(o) && prev[i] !== o) out.add(i);
  }
  return out;
}

/** Plain-language description of a cell for screen readers. */
export function describeCell(view: View, i: number): string {
  const [w] = view.config.dims;
  const name = cellName(i, w);
  const o = view.cells[i] ?? OWNER.VOID;
  const f = view.flags[i] ?? 0;
  const parts: string[] = [];
  if (o === OWNER.VOID) return `${name}, off the board`;
  const fogged = isFogged(view, i);
  if (isSeatOwner(o)) {
    const seat = SEAT_NAMES[o - 1] ?? `Seat ${o}`;
    parts.push(f & FLAG.CORE ? `${seat} core` : `${seat} light`);
  } else if (o === OWNER.SCAR) parts.push("scar");
  else if (o === OWNER.ASH) parts.push("ash");
  else if (fogged && (f & FLAG.STALE) === 0) parts.push("unseen");
  else parts.push("empty");
  if (f & FLAG.NODE && !(f & FLAG.CORE)) parts.push(o === OWNER.EMPTY ? "node" : "taken node");
  if (fogged && (f & FLAG.STALE) !== 0) parts.push("remembered, not in sight");
  return `${name}, ${parts.join(", ")}`;
}
