/**
 * One chapter of the lesson: the essay column (goal, steps, why), the live
 * board with its pencil annotations, and the same tray and controls as the
 * real game (useController), trimmed to what this chapter teaches.
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSound } from "@/audio";
import type { Action, GameEvent, View } from "@/engine/types";
import { SEAT_COLORS } from "@/game/GameScreen";
import { useController } from "@/game/useController";
import { anchorFor, cellsAt, grabOffset, transformOrient, type Transform } from "@/game/placement";
import { diffPlaced } from "@/game/board";
import { ShardIcon } from "@/game/ui/ShardIcon";
import type { BoardSceneProps } from "@/render2d/types";
import { ArrowRight, Button } from "@/ui/Button";
import { Doodle } from "@/ui/Doodle";
import { HandNote } from "@/ui/HandNote";
import { Annotations, paperFrame, type Frame } from "./Annotations";
import { explainPlacement } from "./explain";
import type { Chapter, Note, Surge } from "./lesson";
import { LEARNER, LessonRun } from "./runner";
import { solve } from "./solver";

const PaperBoard = lazy(() => import("@/render2d/PaperBoard").then((m) => ({ default: m.PaperBoard })));
const NightBoard = lazy(() =>
  import("@/render3d/BoardScene").then((m) => ({ default: m.BoardScene as unknown as ComponentType<BoardSceneProps> })),
);

let lastPointer = "mouse";
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType), { capture: true, passive: true });
}

const SURGE_KEYS: Record<string, Surge> = { l: "leap", s: "spark", x: "shatter", c: "scan" };
const SURGE_COST: Record<Surge, number> = { spark: 1, leap: 2, shatter: 3, scan: 1 };

export interface ChapterViewProps {
  chapter: Chapter;
  index: number;
  total: number;
  reduced: boolean;
  onComplete(): void;
  onNext(): void;
  onBack(): void;
  isLast: boolean;
}

export function ChapterView(props: ChapterViewProps) {
  const { chapter } = props;
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<LessonRun | null>(null);

  useEffect(() => {
    const r = new LessonRun(chapter);
    setRun(r);
    return () => {
      setRun(null);
      r.dispose();
    };
  }, [chapter, attempt]);

  return run ? (
    <ChapterLive key={`${chapter.id}:${attempt}`} {...props} run={run} attempt={attempt} onRestart={() => setAttempt((a) => a + 1)} />
  ) : (
    <div className="ln-chapter ln-chapter--loading" />
  );
}

function useStageFrame(dims: View["config"]["dims"], three: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      setFrame(three ? { width: r.width, height: r.height, cellSize: 0, cell: () => null } : paperFrame(dims, r.width, r.height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims, three]);
  return [ref, frame] as const;
}

interface LiveProps extends ChapterViewProps {
  run: LessonRun;
  attempt: number;
  onRestart(): void;
}

function ChapterLive({ chapter, index, total, reduced, run, onComplete, onNext, onBack, onRestart, isLast }: LiveProps) {
  const sound = useSound();
  const [view, setView] = useState<View>(() => run.view());
  const [thinking, setThinking] = useState(false);
  const [flash, setFlash] = useState<{ note: Note; key: number } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const prevView = useRef<View | null>(null);
  const pendingExplain = useRef<Note | null>(null);
  const kit = run.kit;
  const three = view.config.dims[2] > 1;
  const dims = view.config.dims;
  const [stageRef, frame] = useStageFrame(dims, three);
  const combo = useRef(0);

  const playEvents = useCallback(
    (events: GameEvent[]) => {
      const w = dims[0];
      for (const e of events) {
        if (e.type === "placed" && e.cells.length) {
          const pan = (e.cells.reduce((a, c) => a + (c % w), 0) / e.cells.length / Math.max(1, w - 1)) * 2 - 1;
          if (e.seat === LEARNER) combo.current++;
          sound.place({ size: e.cells.length, seat: e.seat, pan, combo: e.seat === LEARNER ? combo.current : 0 });
          if (e.leap) sound.leap();
          if (e.spark) sound.spark();
        }
        if (e.type === "node") sound.node();
        if (e.type === "shattered") sound.shatter();
        if (e.type === "misfire") sound.misfire();
        if (e.type === "scanned") sound.scan();
      }
    },
    [sound, dims],
  );

  const sync = useCallback(() => {
    prevView.current = view;
    setView(run.view());
  }, [run, view]);

  // The chapter just finished: a star, a chord, and a note in the margin.
  const wasComplete = useRef(run.complete);
  useEffect(() => {
    if (run.complete && !wasComplete.current) {
      wasComplete.current = true;
      setCelebrate(true);
      onComplete();
      const t = setTimeout(() => sound.win(), 260);
      return () => clearTimeout(t);
    }
  }, [view, run, onComplete, sound]);

  // The opponent's reply.
  useEffect(() => {
    if (!run.opponentDue()) {
      setThinking(false);
      return;
    }
    setThinking(true);
    const t = setTimeout(
      () => {
        const events = run.opponentMove();
        playEvents(events);
        setThinking(false);
        prevView.current = run.view();
        setView(run.view());
      },
      reduced ? 250 : 750,
    );
    return () => clearTimeout(t);
  }, [view, run, reduced, playEvents]);

  const canAct = run.canAct() && !thinking;
  const ctl = useController(
    {
      view,
      kit,
      seat: LEARNER,
      canAct,
      legal: (leap) => run.legal(leap),
      submit: async (action: Action) => {
        const r = run.act(action);
        if (!r.ok) return { ok: false, reason: r.reason };
        playEvents(r.events);
        setFlash(null);
        sync();
        return { ok: true };
      },
    },
    {
      onError: (reason) => {
        const note = pendingExplain.current ?? { id: "err", text: reason, dir: "ne", cell: undefined };
        pendingExplain.current = null;
        setFlash((f) => ({ note: { ...note, id: "err" }, key: (f?.key ?? 0) + 1 }));
        sound.invalid();
      },
    },
  );

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  // Surges this step doesn't use stay locked, keyboard included.
  const allowed = run.surges();
  const chapterSurges = useMemo(() => new Set(chapter.steps.flatMap((s) => s.surges ?? [])), [chapter]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const surge = SURGE_KEYS[e.key.toLowerCase()];
      if (surge && !allowed.has(surge)) {
        e.stopImmediatePropagation();
        if (chapterSurges.has(surge)) {
          sound.invalid();
          setFlash((f) => ({ note: { id: "err", text: run.currentStep.allowWhy ?? `not yet: ${surge} comes later`, dir: "ne" }, key: (f?.key ?? 0) + 1 }));
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [allowed, chapterSurges, run, sound]);

  /** Why the shard in hand can't go where the pointer is. */
  const explainCells = useCallback(
    (cells: number[] | null, anchor?: number): Note | null => {
      const ex = explainPlacement(view, LEARNER, cells, { leap: ctl.leap, anchor });
      if (ex) return { id: "err", cell: ex.cell, text: ex.text, dir: "ne", mark: "cross", reach: 1.3 };
      if (!cells) return null;
      return { id: "err", cell: cells[0], text: run.currentStep.allowWhy ?? "legal, but not what this chapter wants", dir: "ne", reach: 1.3 };
    },
    [view, ctl.leap, run],
  );

  const live = useMemo<Note | null>(() => {
    if (!ctl.ghost || ctl.ghost.valid) return null;
    return explainCells(ctl.ghost.cells);
  }, [ctl.ghost, explainCells]);

  const onSelect = (t: { cell: number; button: number }) => {
    const touch = lastPointer === "touch";
    pendingExplain.current = null;
    if (ctl.piece !== null && ctl.mode === "place" && t.button !== 2) {
      if (touch) {
        const orients = ctl.piece === kit.sparkIndex ? [[[0, 0, 0]] as [number, number, number][]] : kit.pieces[ctl.piece]!.orients;
        const cells = orients[ctl.orient] ?? orients[0]!;
        const raw = cellsAt(dims, cells, anchorFor(dims, cells, t.cell));
        pendingExplain.current = explainCells(raw, t.cell);
      } else if (ctl.ghost && !ctl.ghost.valid) {
        pendingExplain.current = explainCells(ctl.ghost.cells);
      }
    }
    ctl.select({ cell: t.cell, button: t.button, touch });
  };

  const lastPlaced = useMemo(() => {
    const placed = view.events.find((e) => e.type === "placed");
    if (placed && placed.type === "placed" && placed.cells.length) return placed.cells;
    return diffPlaced(prevView.current, view);
  }, [view]);
  const misfire = useMemo(() => view.events.flatMap((e) => (e.type === "misfire" ? e.cells : [])), [view]);

  const notes = useMemo(
    () => chapter.notes({ view, step: run.step, complete: run.complete, lastPlaced }),
    [chapter, view, run.step, run.complete, lastPlaced],
  );
  const errorNote = flash?.note ?? live;

  // Tray: what the learner held when the chapter began.
  const startPieces = useRef(view.seats[LEARNER]!.pieces ?? []);
  const tray = useMemo(
    () => startPieces.current.flatMap((have, i) => (have ? [i] : [])).sort((a, b) => kit.pieces[b]!.size - kit.pieces[a]!.size),
    [kit],
  );
  const me = view.seats[LEARNER]!;
  const charge = me.charge ?? 0;
  const showCharge = view.config.arena && (chapterSurges.size > 0 || view.flags.some((f) => f & 1));
  const color = SEAT_COLORS[LEARNER]!;
  const Board = chapter.board === "night" ? NightBoard : PaperBoard;
  const over = view.phase === "over";

  const status = run.failure
    ? null
    : run.complete
      ? null
      : thinking
        ? `${chapter.id === "graduate" ? "Ember" : "Tide"} is thinking…`
        : ctl.pending
            ? "tap again to place"
            : ctl.mode === "shatter"
              ? "pick an enemy cell to shatter"
              : ctl.piece === null
                ? "pick a shard"
                : ctl.leap
                  ? "leaping: two cells of reach"
                  : null;

  // Test hook: lets the e2e suite ask for the intended move and where to click.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.webdriver) return;
    const w = window as unknown as { __learn?: unknown };
    w.__learn = {
      chapter: chapter.id,
      step: run.step,
      complete: run.complete,
      canAct,
      solve: () => solve(run),
      /** Keys to press after picking `piece` so the shard in hand turns into `orient`. */
      keysFor: (piece: number, orient: number) => keysToOrient(run, piece, orient),
      /** Cell to point at so the ghost lands exactly at `at`. */
      aimCell: (piece: number, orient: number, at: [number, number, number]) => {
        if (piece === kit.sparkIndex) return at[0] + dims[0] * (at[1] + dims[1] * at[2]);
        const cells = kit.pieces[piece]!.orients[orient]!;
        const g = grabOffset(cells);
        return at[0] + g[0] + dims[0] * (at[1] + g[1] + dims[1] * at[2]);
      },
      point: (cell: number) => {
        const p = frame?.cell(cell);
        const r = stageRef.current?.getBoundingClientRect();
        return p && r ? { x: r.left + p[0], y: r.top + p[1] } : null;
      },
      act: (a: Action) => {
        const r = run.act(a);
        if (r.ok) {
          playEvents(r.events);
          sync();
        }
        return r.ok;
      },
    };
  });

  const stepsDone = run.complete ? chapter.steps.length : run.step;
  const finalResult = chapter.id === "graduate" && over ? resultLine(view) : null;

  return (
    <article className={`ln-chapter ln-chapter--${chapter.board}`} data-chapter={chapter.id} data-complete={run.complete || undefined}>
      <div className="ln-intro">
        <p className="ln-num num">
          §{String(index + 1).padStart(2, "0")} <span>/ {String(total).padStart(2, "0")}</span>
        </p>
        <h1 className="ln-title">
          {chapter.title[0]}
          <em>{chapter.title[1]}</em>
          {chapter.title[2]}
        </h1>
        <p className="ln-goal">{chapter.goal}</p>

        <ol className="ln-steps" aria-label="Steps">
          {chapter.steps.map((s, i) => {
            const state = i < stepsDone ? "done" : i === run.step && !run.complete ? "now" : "later";
            return (
              <li key={s.id} className={`ln-step is-${state}`}>
                <span className="ln-step__box" aria-hidden="true">
                  {state === "done" && <Doodle variant="check" strokeWidth={3.4} />}
                </span>
                <span className="ln-step__label">{s.label}</span>
                <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (now)" : ""}</span>
              </li>
            );
          })}
        </ol>

        {run.failure && (
          <div className="ln-failure" role="alert">
            <HandNote tilt={-2} size="md" decorative={false}>
              {run.failure}
            </HandNote>
            <Button variant="accent" size="sm" onClick={onRestart}>
              Start over
            </Button>
          </div>
        )}

        {run.complete && (
          <div className="ln-success" role="status">
            <span className="ln-success__star" aria-hidden="true">
              <Doodle variant="star" color="var(--pollen)" strokeWidth={2.4} />
            </span>
            <HandNote tilt={-4} size="lg" highlight decorative={false}>
              {finalResult ?? chapter.success}
            </HandNote>
          </div>
        )}
      </div>

      <div className="ln-play">
        <div className={`ln-stage ${chapter.board === "night" ? "theme-night" : ""}`} ref={stageRef} onContextMenu={(e) => e.preventDefault()} onWheel={(e) => {
          if (chapter.board === "paper" && ctl.piece !== null) ctl.transform(e.deltaY > 0 ? "rotate" : "rotateBack");
        }}>
          <div className="ln-board">
          <Suspense fallback={<div className="ln-stage__loading">sharpening pencils…</div>}>
            <Board
              view={view}
              ghost={ctl.ghost ? { cells: ctl.ghost.cells, seat: ctl.ghost.seat, valid: ctl.ghost.valid } : null}
              marks={{ attach: ctl.marks.attach, targets: ctl.marks.targets, lastPlaced, misfire }}
              selectedSeat={LEARNER}
              onHover={(t) => ctl.hover(t)}
              onSelect={(t) => onSelect(t)}
              reducedMotion={reduced}
              cameraPreset="iso"
            />
          </Suspense>
          </div>
          <Annotations notes={notes} frame={frame} dims={dims} stamp={`${run.step}:${run.complete}`} error={run.complete ? null : errorNote} errorKey={flash?.key ?? 0} />
          {celebrate && (
            <div className="ln-stamp" aria-hidden="true">
              <Doodle variant="star" color="var(--pollen)" strokeWidth={3} />
            </div>
          )}
        </div>

        <p className="ln-status" aria-live="polite">
          {status ?? "\u00a0"}
        </p>
        <div className={`ln-dock ${canAct ? "is-live" : ""}`} aria-label="Your shards">
          <div className="ln-tray" role="listbox" aria-label="Shards">
            {tray.map((i) => {
              const have = me.pieces?.[i] ?? false;
              const selected = ctl.piece === i;
              const orients = kit.pieces[i]!.orients;
              const cells = selected ? (orients[ctl.orient] ?? orients[0]!) : orients[0]!;
              return (
                <button
                  key={i}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={`${kit.pieces[i]!.name}, ${kit.pieces[i]!.size} cells${have ? "" : ", placed"}`}
                  disabled={!have || !canAct}
                  data-piece={i}
                  className={`ln-shard ${selected ? "is-sel" : ""}`}
                  onClick={() => {
                    ctl.selectPiece(i);
                    sound.select(kit.pieces[i]!.size);
                  }}
                >
                  <ShardIcon cells={cells} color={color} dim={!have} iso={three} size={40} />
                </button>
              );
            })}
          </div>
          <div className="ln-controls">
            <button type="button" className="ln-ctl" disabled={ctl.piece === null} onClick={() => turn("rotate")} title="Rotate (R)">
              ↻ <span>rotate</span>
            </button>
            {three ? (
              <>
                <button type="button" className="ln-ctl" disabled={ctl.piece === null} onClick={() => turn("pitch")} title="Tip forward (T)">
                  ⤼ <span>tip</span>
                </button>
                <button type="button" className="ln-ctl" disabled={ctl.piece === null} onClick={() => turn("roll")} title="Roll (G)">
                  ⤾ <span>roll</span>
                </button>
              </>
            ) : (
              <button type="button" className="ln-ctl" disabled={ctl.piece === null} onClick={() => turn("flip")} title="Flip (F)">
                ⇋ <span>flip</span>
              </button>
            )}
            {ctl.pending && (
              <button type="button" className="ln-ctl ln-ctl--go" onClick={ctl.confirm}>
                place
              </button>
            )}
          </div>
          {chapterSurges.size > 0 && (
            <div className="ln-surges" aria-label="Surges">
              {showCharge && (
                <span className="ln-charge" title="Charge: cover nodes to earn more">
                  <span aria-hidden="true">⚡</span> <strong className="num">{charge}</strong>
                  <span className="sr-only"> charge</span>
                </span>
              )}
              {(["spark", "leap", "shatter", "scan"] as Surge[])
                .filter((s) => chapterSurges.has(s))
                .map((s) => {
                  const on = s === "spark" ? ctl.piece === kit.sparkIndex : s === "leap" ? ctl.leap : s === "shatter" ? ctl.mode === "shatter" : false;
                  const usable = canAct && allowed.has(s) && charge >= SURGE_COST[s] && !(s === "shatter" && view.shatteredThisTurn) && !(s === "scan" && view.scanning);
                  return (
                    <button
                      key={s}
                      type="button"
                      data-surge={s}
                      className={`ln-surge ${on ? "is-on" : ""} ${allowed.has(s) && canAct ? "is-now" : ""}`}
                      disabled={!usable}
                      onClick={() => {
                        if (s === "spark") ctl.selectPiece(kit.sparkIndex);
                        else if (s === "leap") ctl.setLeap(!ctl.leap);
                        else if (s === "shatter") ctl.setMode("shatter");
                        else ctl.scan();
                        sound.uiToggle(!on);
                      }}
                    >
                      {s} <small className="num">{SURGE_COST[s]}</small>
                    </button>
                  );
                })}
            </div>
          )}
          {chapter.controls && <p className="ln-keys">{chapter.controls}</p>}
        </div>
      </div>
      <div className="ln-more">
        <div className="ln-body">
          {chapter.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {isLast && run.complete ? (
          <div className="ln-grad">
            <p>That's everything. The rest is practice, and other people.</p>
            <div className="ln-grad__cta">
              <Button to="/play" size="lg" iconRight={<ArrowRight />}>
                Play a real game
              </Button>
              <Button to="/play" state={{ kind: "online" }} size="lg" variant="ghost">
                Make a room
              </Button>
            </div>
          </div>
        ) : null}

        <nav className="ln-nav" aria-label="Chapter navigation">
          <Button variant="quiet" size="sm" onClick={onBack} disabled={index === 0}>
            ← Back
          </Button>
          <Button variant="quiet" size="sm" onClick={onRestart} className="ln-restart">
            Start over
          </Button>
          {!isLast && (
            <Button variant={run.complete ? "primary" : "ghost"} size="md" onClick={onNext} iconRight={<ArrowRight />} className="ln-next">
              {run.complete ? "Next chapter" : "Skip"}
            </Button>
          )}
        </nav>
      </div>
    </article>
  );

  function turn(t: Transform) {
    ctl.transform(t);
    sound.rotate();
  }
}

function resultLine(view: View): string {
  const scores = view.scores ?? view.seats.map((s) => s.score ?? 0);
  const [me, them] = [scores[0] ?? 0, scores[1] ?? 0];
  if (me > them) return `You won, ${me} to ${them}.`;
  if (me < them) return `Ember won, ${them} to ${me}. Next time.`;
  return `A tie, ${me} each.`;
}

/** Shortest R/F (or R/T/G in 3D) key sequence from orientation 0 to `target`. */
export function keysToOrient(run: LessonRun, piece: number, target: number): string[] {
  const kit = run.kit;
  const moves: [Transform, string][] = kit.kind === "cubes" ? [["rotate", "r"], ["pitch", "t"], ["roll", "g"]] : [["rotate", "r"], ["flip", "f"]];
  const seen = new Map<number, string[]>([[0, []]]);
  const queue = [0];
  while (queue.length) {
    const o = queue.shift()!;
    if (o === target) return seen.get(o)!;
    for (const [t, k] of moves) {
      const n = transformOrient(kit, piece, o, t);
      if (!seen.has(n)) {
        seen.set(n, [...seen.get(o)!, k]);
        queue.push(n);
      }
    }
  }
  return [];
}
