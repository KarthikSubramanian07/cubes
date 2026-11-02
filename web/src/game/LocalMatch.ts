/**
 * A local match: pass-and-play, versus bots, or bots only. Runs the engine
 * in the page and bots in a worker. React subscribes via `subscribe`.
 */
import { LocalGame, randomSeed } from "@/engine/engine";
import { BotRunner } from "@/engine/bots";
import type { Action, AiLevel, GameConfig, GameEvent, Placement, View } from "@/engine/types";

export interface LocalSeat {
  kind: "human" | "bot";
  name: string;
  level?: AiLevel;
}

export interface LocalMatchOptions {
  config: GameConfig;
  seats: LocalSeat[];
  seed?: number;
  /** Minimum time a bot "thinks", so moves are watchable. */
  botDelayMs?: number;
  /** Inject a bot runner (tests use a synchronous one). */
  bots?: Pick<BotRunner, "think" | "dispose">;
}

export interface MatchSnapshot {
  view: View;
  /** Whose eyes we're looking through. */
  perspective: number | null;
  /** Fogged pass-and-play: the device must be handed to this seat first. */
  handoff: number | null;
  canAct: boolean;
  thinking: number | null;
  events: GameEvent[];
  seats: LocalSeat[];
  undoable: boolean;
}

type Listener = (s: MatchSnapshot) => void;

export class LocalMatch {
  private game: LocalGame;
  private readonly seed: number;
  private readonly bots: Pick<BotRunner, "think" | "dispose">;
  private listeners = new Set<Listener>();
  private perspective: number | null;
  private handoff: number | null = null;
  private thinking: number | null = null;
  private lastEvents: GameEvent[] = [];
  private disposed = false;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private snapshot!: MatchSnapshot;
  private beliefCache: { ply: number; seat: number; game: LocalGame } | null = null;

  constructor(private readonly opts: LocalMatchOptions) {
    if (opts.seats.length !== opts.config.seats) throw new Error("seat count mismatch");
    this.seed = opts.seed ?? randomSeed();
    this.game = LocalGame.create(opts.config, this.seed);
    this.bots = opts.bots ?? new BotRunner();
    const humans = this.humans();
    // With no humans we watch through seat 0's eyes.
    this.perspective = humans.length ? humans[0]! : 0;
    this.refresh();
    this.scheduleBot();
  }

  private humans(): number[] {
    return this.opts.seats.flatMap((s, i) => (s.kind === "human" ? [i] : []));
  }

  get config(): GameConfig {
    return this.opts.config;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): MatchSnapshot {
    return this.snapshot;
  }

  private refresh(): void {
    const humans = this.humans();
    const full = this.game.view(null);
    const turn = full.turn;
    const fog = this.opts.config.fog !== null;
    // Pass-and-play follows the active human; under fog it needs a hand-off.
    if (full.phase === "playing" && this.opts.seats[turn]?.kind === "human" && humans.length > 1 && this.perspective !== turn) {
      if (fog) this.handoff = turn;
      else this.perspective = turn;
    }
    const view = this.game.view(this.perspective);
    const canAct =
      full.phase === "playing" &&
      this.handoff === null &&
      this.perspective !== null &&
      this.perspective === turn &&
      this.opts.seats[turn]?.kind === "human";
    this.snapshot = {
      view,
      perspective: this.perspective,
      handoff: this.handoff,
      canAct,
      thinking: this.thinking,
      events: this.lastEvents,
      seats: this.opts.seats,
      undoable: this.undoTarget() !== null,
    };
    for (const l of this.listeners) l(this.snapshot);
  }

  /** Confirm the hand-off screen: the device is now with `handoff`. */
  acceptHandoff(): void {
    if (this.handoff === null) return;
    this.perspective = this.handoff;
    this.handoff = null;
    this.refresh();
  }

  /** Legal placements for the acting seat, computed from what it can see. */
  legal(leap = false): Placement[] {
    const s = this.snapshot;
    if (!s.canAct || s.perspective === null) return [];
    if (this.opts.config.fog === null) return this.game.legal(s.perspective, { leap });
    return this.belief(s.view, s.perspective).legal(s.perspective, { leap });
  }

  /** Validate an action for the acting seat without applying it. */
  check(action: Action): { ok: true } | { ok: false; reason: string } {
    const s = this.snapshot;
    if (!s.canAct || s.perspective === null) return { ok: false, reason: "it isn't your turn" };
    return this.game.check(s.perspective, action);
  }

  private belief(view: View, seat: number): LocalGame {
    const c = this.beliefCache;
    if (c && c.ply === view.ply && c.seat === seat && !view.shatteredThisTurn) return c.game;
    c?.game.free();
    const game = LocalGame.fromView(view);
    this.beliefCache = { ply: view.ply, seat, game };
    return game;
  }

  /** Apply an action for the acting human seat. */
  act(action: Action): { ok: true } | { ok: false; reason: string } {
    const s = this.snapshot;
    if (!s.canAct || s.perspective === null) return { ok: false, reason: "it isn't your turn" };
    const check = this.game.check(s.perspective, action);
    if (!check.ok) return check;
    this.lastEvents = this.game.apply(s.perspective, action);
    this.invalidateBelief();
    this.refresh();
    this.scheduleBot();
    return { ok: true };
  }

  private invalidateBelief(): void {
    this.beliefCache?.game.free();
    this.beliefCache = null;
  }

  private scheduleBot(): void {
    if (this.disposed) return;
    const full = this.game.view(null);
    if (full.phase !== "playing") return;
    const seat = full.turn;
    const spec = this.opts.seats[seat];
    if (spec?.kind !== "bot") return;
    const gen = ++this.generation;
    this.thinking = seat;
    this.refresh();
    const started = performance.now();
    const minDelay = this.opts.botDelayMs ?? 650;
    void this.bots.think(this.game.toJSON(), seat, spec.level ?? "flare").then((action) => {
      if (this.disposed || gen !== this.generation) return;
      const wait = Math.max(0, minDelay - (performance.now() - started));
      this.botTimer = setTimeout(() => {
        if (this.disposed || gen !== this.generation) return;
        const now = this.game.view(null);
        if (now.phase !== "playing" || now.turn !== seat) return;
        const chosen: Action = action && this.game.check(seat, action).ok ? action : { type: "resign" };
        this.lastEvents = this.game.apply(seat, chosen);
        this.invalidateBelief();
        this.thinking = null;
        this.refresh();
        this.scheduleBot();
      }, wait);
    });
  }

  /** Index into the log to rewind to: just before the last human action. */
  private undoTarget(): number | null {
    if (this.humans().length !== 1) return null;
    const log = this.game.log();
    const human = this.humans()[0]!;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i]!.seat === human && log[i]!.action.type !== "resign") return i;
    }
    return null;
  }

  /** Take back your last move (and the bot replies after it). Solo games only. */
  undo(): boolean {
    const target = this.undoTarget();
    if (target === null) return false;
    const log = this.game.log().slice(0, target);
    const next = LocalGame.create(this.opts.config, this.seed);
    for (const e of log) next.apply(e.seat, e.action);
    this.game.free();
    this.game = next;
    this.generation++;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.thinking = null;
    this.lastEvents = [];
    this.invalidateBelief();
    this.refresh();
    this.scheduleBot();
    return true;
  }

  /** Resign the acting seat (or a specific human seat). */
  resign(seat = this.snapshot.perspective): void {
    if (seat === null) return;
    if (!this.game.check(seat, { type: "resign" }).ok) return;
    this.lastEvents = this.game.apply(seat, { type: "resign" });
    this.invalidateBelief();
    this.refresh();
    this.scheduleBot();
  }

  /** A fresh match with the same seats and config. */
  rematch(): LocalMatch {
    this.dispose();
    return new LocalMatch({ ...this.opts, seed: undefined });
  }

  replayLog(): { seat: number; action: Action }[] {
    return this.game.log();
  }

  /** Free the engine and stop the bots. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.invalidateBelief();
    this.bots.dispose();
    this.game.free();
    this.listeners.clear();
  }
}
