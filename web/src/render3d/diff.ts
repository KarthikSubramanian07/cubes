import { FLAG, OWNER, type GameEvent, type View } from "@/engine/types";

/** A visual change worth animating, derived from two consecutive Views. */
export type AnimEvent =
  /** Cubes that dropped in for a seat this turn. */
  | { kind: "place"; seat: number; cells: number[]; spark: boolean; leap: boolean }
  /** Cells that appeared because fog lifted, not because someone just placed them. */
  | { kind: "reveal"; cells: number[] }
  /** Cells that went from owned back to empty (undo, rewind, fog memory cleared). */
  | { kind: "remove"; cells: number[]; seats: number[] }
  /** A node was covered and its charge collected. */
  | { kind: "node"; seat: number; cell: number }
  /** An owned cell was destroyed by a Shatter and became a scar. */
  | { kind: "shatter"; cell: number; victim: number; seat: number | null }
  /** The storm collapsed these cells into ash. `seats[i]` is the previous owner seat or -1. */
  | { kind: "storm"; cells: number[]; seats: number[] }
  /** A fog placement hit something unseen. */
  | { kind: "misfire"; seat: number; cells: number[] };

export interface DiffResult {
  /** True when the views are not comparable (new game, new perspective, rewind). Snap, don't animate. */
  reset: boolean;
  events: AnimEvent[];
}

const isSeatOwner = (o: number | undefined): o is number => o !== undefined && o >= 1 && o <= 4;

function sameDims(a: View, b: View): boolean {
  const [aw, ah, ad] = a.config.dims;
  const [bw, bh, bd] = b.config.dims;
  return aw === bw && ah === bh && ad === bd && a.cells.length === b.cells.length;
}

/**
 * Compare two consecutive Views and describe what changed as animation events.
 *
 * The cell diff is the source of truth (it survives dropped messages and
 * multi-ply jumps); `next.events` adds intent the diff cannot see: who
 * shattered, whether a new cell was a placement or a fog reveal, misfires.
 */
export function diffViews(prev: View | null, next: View): DiffResult {
  if (!prev || !sameDims(prev, next) || prev.seat !== next.seat || next.ply < prev.ply) {
    return { reset: true, events: [] };
  }

  const placedBySeat = new Map<number, number[]>();
  const newlyOwned: number[] = [];
  const removed: number[] = [];
  const removedSeats: number[] = [];
  const stormCells: number[] = [];
  const stormSeats: number[] = [];
  const shatters: { cell: number; victim: number }[] = [];
  const nodes: { cell: number; seat: number }[] = [];
  let cellsChanged = false;

  const n = next.cells.length;
  for (let i = 0; i < n; i++) {
    const a = prev.cells[i];
    const b = next.cells[i];
    const fa = prev.flags[i] ?? 0;
    const fb = next.flags[i] ?? 0;
    if (a !== b || fa !== fb) cellsChanged = true;
    if (a === b) continue;
    if (isSeatOwner(b)) {
      newlyOwned.push(i);
      if (fa & FLAG.NODE && !(fb & FLAG.NODE)) nodes.push({ cell: i, seat: b - 1 });
    } else if (b === OWNER.SCAR) {
      shatters.push({ cell: i, victim: isSeatOwner(a) ? a - 1 : -1 });
    } else if (b === OWNER.ASH) {
      stormCells.push(i);
      stormSeats.push(isSeatOwner(a) ? a - 1 : -1);
    } else if (b === OWNER.EMPTY && isSeatOwner(a)) {
      removed.push(i);
      removedSeats.push(a - 1);
    }
  }

  const fresh = next.ply !== prev.ply || cellsChanged;
  const evs: GameEvent[] = fresh ? next.events : [];

  // Placement intent from events, when the engine told us.
  const placedFromEvents = new Set<number>();
  const placeMeta = new Map<number, { spark: boolean; leap: boolean }>();
  let hasPlacedEvent = false;
  for (const e of evs) {
    if (e.type === "placed") {
      hasPlacedEvent = true;
      placeMeta.set(e.seat, { spark: e.spark, leap: e.leap });
      for (const c of e.cells) placedFromEvents.add(c);
    }
  }

  const reveals: number[] = [];
  for (const i of newlyOwned) {
    const seat = next.cells[i]! - 1;
    let isPlacement: boolean;
    if (hasPlacedEvent) {
      isPlacement = placedFromEvents.has(i);
    } else if (next.config.fog !== null) {
      // No event to go on: a cell that just came into sight is a reveal.
      const wasVisible = ((prev.flags[i] ?? 0) & FLAG.VISIBLE) !== 0;
      isPlacement = wasVisible;
    } else {
      isPlacement = true;
    }
    if (isPlacement) {
      const list = placedBySeat.get(seat);
      if (list) list.push(i);
      else placedBySeat.set(seat, [i]);
    } else {
      reveals.push(i);
    }
  }

  const events: AnimEvent[] = [];

  const shatterSeat = new Map<number, number>();
  for (const e of evs) if (e.type === "shattered") shatterSeat.set(e.cell, e.seat);
  for (const s of shatters) {
    events.push({ kind: "shatter", cell: s.cell, victim: s.victim, seat: shatterSeat.get(s.cell) ?? null });
  }

  for (const [seat, cells] of placedBySeat) {
    const meta = placeMeta.get(seat) ?? { spark: cells.length === 1, leap: false };
    events.push({ kind: "place", seat, cells, spark: meta.spark, leap: meta.leap });
  }

  const nodeSeen = new Set<number>();
  for (const nd of nodes) {
    nodeSeen.add(nd.cell);
    events.push({ kind: "node", seat: nd.seat, cell: nd.cell });
  }
  for (const e of evs) {
    if (e.type === "node" && !nodeSeen.has(e.cell)) {
      nodeSeen.add(e.cell);
      events.push({ kind: "node", seat: e.seat, cell: e.cell });
    }
  }

  if (stormCells.length) events.push({ kind: "storm", cells: stormCells, seats: stormSeats });

  for (const e of evs) {
    if (e.type === "misfire" && e.cells.length) events.push({ kind: "misfire", seat: e.seat, cells: [...e.cells] });
  }

  if (reveals.length) events.push({ kind: "reveal", cells: reveals });
  if (removed.length) events.push({ kind: "remove", cells: removed, seats: removedSeats });

  return { reset: false, events };
}
