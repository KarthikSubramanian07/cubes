/**
 * LessonRun: one attempt at a chapter. Owns the engine game, applies the
 * learner's actions, plays the opponent, and walks the step list by
 * evaluating each step's predicate against the engine after every move.
 * No React in here, so tests drive it exactly like the page does.
 */
import { LocalGame, getKit } from "@/engine/engine";
import type { Action, GameEvent, Placement, View } from "@/engine/types";
import type { Chapter, StepCtx, Surge } from "./lesson";

export const LEARNER = 0;
export const RIVAL = 1;

export type ActResult = { ok: true; events: GameEvent[] } | { ok: false; reason: string };

export class LessonRun {
  game: LocalGame;
  step = 0;
  complete = false;
  failure: string | null = null;
  /** Bumps on every change, for React to subscribe to. */
  version = 0;
  private belief: { key: string; game: LocalGame } | null = null;
  private botSeed = 1;

  constructor(
    readonly chapter: Chapter,
    game?: LocalGame,
  ) {
    this.game = game ?? chapter.build();
  }

  /** An independent copy at the same point (the solver explores with these). */
  clone(): LessonRun {
    const r = new LessonRun(this.chapter, LocalGame.fromJSON(this.game.toJSON()));
    r.step = this.step;
    r.complete = this.complete;
    r.failure = this.failure;
    r.botSeed = this.botSeed;
    return r;
  }

  view(): View {
    return this.game.view(LEARNER);
  }

  get kit() {
    return getKit(this.game.view(null).config.kit);
  }

  get currentStep() {
    return this.chapter.steps[Math.min(this.step, this.chapter.steps.length - 1)]!;
  }

  surges(): Set<Surge> {
    return new Set(this.complete ? [] : (this.currentStep.surges ?? []));
  }

  canAct(): boolean {
    const v = this.game.view(null);
    return v.phase === "playing" && v.turn === LEARNER && !this.complete && this.failure === null;
  }

  /** Placements the engine allows (judged on what the learner can see) that this step accepts. */
  legal(leap: boolean): Placement[] {
    if (!this.canAct()) return [];
    const surges = this.surges();
    if (leap && !surges.has("leap")) return [];
    const spark = this.kit.sparkIndex;
    const view = this.view();
    const all = this.source(view).legal(LEARNER, { leap });
    const step = this.currentStep;
    return all.filter((p) => (p.piece !== spark || surges.has("spark")) && (!step.allow || step.allow(p, leap, view)));
  }

  /** Engine-legal placements before the lesson's filter (to tell "illegal" from "not now"). */
  legalByRules(leap: boolean): Placement[] {
    if (!this.canAct()) return [];
    return this.source(this.view()).legal(LEARNER, { leap });
  }

  private source(view: View): LocalGame {
    if (view.config.fog === null) return this.game;
    const key = `${view.ply}:${view.scanning}:${view.shatteredThisTurn}`;
    if (this.belief?.key !== key) {
      this.belief?.game.free();
      this.belief = { key, game: LocalGame.fromView(view) };
    }
    return this.belief.game;
  }

  /** Apply a learner action, then advance the lesson. */
  act(action: Action): ActResult {
    if (!this.canAct()) return { ok: false, reason: this.complete ? "this chapter is done" : "it isn't your turn" };
    const surges = this.surges();
    const why = this.currentStep.allowWhy ?? "not this one. follow the notes";
    if (action.type === "place") {
      const leap = action.leap;
      const ok = this.legal(leap).some((p) => p.piece === action.piece && p.orient === action.orient && p.at.every((v, i) => v === action.at[i]));
      if (!ok) {
        const legalAnyway = this.legalByRules(leap).some(
          (p) => p.piece === action.piece && p.orient === action.orient && p.at.every((v, i) => v === action.at[i]),
        );
        if (legalAnyway || (leap && !surges.has("leap"))) return { ok: false, reason: why };
      }
    } else if (action.type === "shatter" && !surges.has("shatter")) return { ok: false, reason: why };
    else if (action.type === "scan" && !surges.has("scan")) return { ok: false, reason: why };
    else if (action.type === "resign") return { ok: false, reason: "no resigning in a lesson" };

    const check = this.game.check(LEARNER, action);
    if (!check.ok) return check;
    const before = this.view();
    const events = this.game.apply(LEARNER, action);
    this.evaluate({ game: this.game, view: this.view(), before, events, action, who: "me" });
    this.version++;
    return { ok: true, events };
  }

  opponentDue(): boolean {
    const v = this.game.view(null);
    return v.phase === "playing" && v.turn === RIVAL;
  }

  /** The opponent's reply: the chapter's script, else the Ember bot. */
  opponentMove(): GameEvent[] {
    if (!this.opponentDue()) return [];
    const scripted = this.chapter.opponent?.(this.game) ?? null;
    let action: Action | null = scripted && this.game.check(RIVAL, scripted).ok ? scripted : null;
    action ??= this.game.botAction(RIVAL, "ember", this.botSeed++, 0);
    if (!action || !this.game.check(RIVAL, action).ok) action = { type: "resign" };
    const before = this.view();
    const events = this.game.apply(RIVAL, action);
    this.evaluate({ game: this.game, view: this.view(), before, events, action, who: "them" });
    this.version++;
    return events;
  }

  private evaluate(ctx: StepCtx): void {
    if (this.complete) return;
    const step = this.currentStep;
    if (step.done(ctx)) {
      this.step++;
      if (this.step >= this.chapter.steps.length) {
        this.complete = true;
        this.step = this.chapter.steps.length - 1;
      }
      return;
    }
    const failed = step.failed?.(ctx) ?? null;
    if (failed) this.failure = failed;
  }

  dispose(): void {
    this.belief?.game.free();
    this.belief = null;
    this.game.free();
  }
}
