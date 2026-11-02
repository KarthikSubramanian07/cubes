/**
 * The shape of a lesson. A chapter is a curated position plus an ordered list
 * of steps; each step has a success predicate evaluated against the real
 * engine after every move, so "done" always means the rules agreed.
 */
import type { LocalGame } from "@/engine/engine";
import type { Action, GameEvent, Placement, View } from "@/engine/types";

export type Surge = "spark" | "leap" | "shatter" | "scan";

export interface StepCtx {
  game: LocalGame;
  /** The learner's view after the action. */
  view: View;
  /** The learner's view before it. */
  before: View;
  events: GameEvent[];
  action: Action;
  /** Who just moved: the learner or the opponent. */
  who: "me" | "them";
}

export interface Step {
  id: string;
  /** Checklist label. */
  label: string;
  /** Surges the learner may use during this step. */
  surges?: Surge[];
  /** Narrow which engine-legal placements the lesson accepts right now. */
  allow?(p: Placement, leap: boolean, view: View): boolean;
  /** Said when a placement is legal by the rules but not what this step wants. */
  allowWhy?: string;
  done(ctx: StepCtx): boolean;
  /** A message when the position can no longer be won (offer a restart). */
  failed?(ctx: StepCtx): string | null;
  /** Learner moves needed to finish (the solver searches this deep). */
  depth?: number;
  /** Open-ended steps (a real game): any legal action moves things along. */
  open?: boolean;
}

export type NoteDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface Note {
  id: string;
  /** Cell the arrow points at. Omit for a free-floating note pinned to a corner of the stage. */
  cell?: number;
  text: string;
  dir: NoteDir;
  tone?: "accent" | "ink" | "seat-0" | "seat-1" | "muted";
  mark?: "circle" | "star" | "cross";
  /** Dashed outline of cells (a suggested or threatened placement). */
  outline?: { cells: number[]; tone: "accent" | "seat-0" | "seat-1" };
  /** Arrow length in cells (default 1.6). */
  reach?: number;
}

export interface NoteCtx {
  view: View;
  step: number;
  complete: boolean;
  lastPlaced: number[];
}

export interface Chapter {
  id: string;
  /** Title in three parts: before, the italic accent, after. */
  title: [string, string, string];
  short: string;
  goal: string;
  body: string[];
  /** Small print under the board: controls worth knowing in this chapter. */
  controls?: string;
  board: "paper" | "night";
  build(): LocalGame;
  steps: Step[];
  /** Scripted opponent move; null falls back to the Ember bot. */
  opponent?(game: LocalGame): Action | null;
  notes(ctx: NoteCtx): Note[];
  success: string;
}
