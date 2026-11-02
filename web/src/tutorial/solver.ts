/**
 * Finds the move a step is asking for, by trying the learner's candidate
 * actions on copies of the lesson and asking the step's own predicate.
 * Unit tests use it to prove every chapter is winnable; the e2e suite uses
 * it to play through the page.
 */
import type { Action } from "@/engine/types";
import { shatterTargets } from "@/game/board";
import { LEARNER, type LessonRun } from "./runner";

/** Everything the learner could do right now that the lesson accepts. Biggest shards first. */
export function candidates(run: LessonRun): Action[] {
  if (!run.canAct()) return [];
  const surges = run.surges();
  const view = run.view();
  const out: Action[] = [];
  const size = (piece: number) => run.kit.pieces[piece]?.size ?? 1;
  for (const leap of surges.has("leap") ? [false, true] : [false]) {
    const ps = run.legal(leap).sort((a, b) => size(b.piece) - size(a.piece));
    for (const p of ps) out.push({ type: "place", piece: p.piece, orient: p.orient, at: p.at, leap });
  }
  const charge = view.seats[LEARNER]?.charge ?? 0;
  if (surges.has("shatter") && charge >= 3 && !view.shatteredThisTurn) {
    for (const cell of shatterTargets(view, LEARNER)) out.push({ type: "shatter", cell });
  }
  if (surges.has("scan") && charge >= 1 && view.config.fog !== null && !view.scanning) out.push({ type: "scan" });
  return out;
}

function advanced(before: LessonRun, after: LessonRun): boolean {
  return after.complete || after.step > before.step;
}

/** Play the opponent until it's the learner's turn again (or the game ends). */
function settle(run: LessonRun): void {
  for (let i = 0; i < 8 && run.opponentDue(); i++) run.opponentMove();
}

/**
 * An action that finishes the current step within the step's depth (default
 * one move), or null. Open-ended steps return the biggest legal placement.
 */
export function solve(run: LessonRun): Action | null {
  const step = run.currentStep;
  const cands = candidates(run);
  if (step.open) return cands.find((a) => a.type === "place") ?? cands[0] ?? null;
  return search(run, step.depth ?? 1, cands);
}

function search(run: LessonRun, depth: number, cands = candidates(run)): Action | null {
  for (const a of cands) {
    const copy = run.clone();
    try {
      if (!copy.act(a).ok) continue;
      if (advanced(run, copy)) return a;
      if (depth > 1 && !copy.failure) {
        settle(copy);
        if (search(copy, depth - 1)) return a;
      }
    } finally {
      copy.dispose();
    }
  }
  return null;
}

/** Play a chapter to the end with the solver. Returns the actions taken. */
export function playThrough(run: LessonRun, maxMoves = 60): Action[] {
  const taken: Action[] = [];
  for (let i = 0; i < maxMoves && !run.complete && !run.failure; i++) {
    settle(run);
    if (run.complete || !run.canAct()) break;
    const a = solve(run);
    if (!a) break;
    const r = run.act(a);
    if (!r.ok) throw new Error(`solver picked an illegal move: ${r.reason}`);
    taken.push(a);
  }
  settle(run);
  return taken;
}
