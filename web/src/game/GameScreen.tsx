/**
 * The in-game screen: board, seats, shard tray, surges, hand-written turn
 * annotations, event feed and overlays. Works for local and online matches
 * through the props; the board renderer is swappable (Paper / Night).
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { Action, AiLevel, GameEvent, Kit, Placement, View } from "@/engine/types";
import { FLAG, SEAT_NAMES } from "@/engine/types";
import type { BoardSceneProps } from "@/render2d";
import { useController } from "./useController";
import { diffPlaced } from "./board";
import { ShardIcon } from "./ui/ShardIcon";
import "./game.css";

const PaperBoard = lazy(() => import("@/render2d").then((m) => ({ default: m.PaperBoard })));

/** Renderers registered at runtime so the 3D renderer can be added without touching this file. */
export const NIGHT_RENDERER: { component: ComponentType<BoardSceneProps> | null } = { component: null };

export const SEAT_COLORS = ["#e2683c", "#2a9d8f", "#e9b949", "#7c6cf2"];

export interface SeatInfo {
  name: string;
  kind: "human" | "bot";
  level?: AiLevel;
  connected?: boolean;
  autopilot?: boolean;
}

export interface GameScreenProps {
  title: string;
  view: View;
  kit: Kit;
  seat: number | null;
  canAct: boolean;
  seats: SeatInfo[];
  thinking?: number | null;
  handoff?: number | null;
  onAcceptHandoff?(): void;
  legal(leap: boolean): Placement[];
  submit(action: Action): Promise<{ ok: true } | { ok: false; reason: string }>;
  undoable?: boolean;
  onUndo?(): void;
  onRematch?(): void;
  onResign?(): void;
  onLeave(): void;
  roomCode?: string;
  clock?: { seat: number; endsAt: number } | null;
  /** Extra chrome (chat, emotes) for online games. */
  aside?: React.ReactNode;
  sound?: {
    place?(o: { size: number; seat: number; combo?: number; pan?: number }): void;
    invalid?(): void;
    node?(): void;
    shatter?(): void;
    misfire?(): void;
    storm?(): void;
    dark?(seat: number): void;
    turnStart?(isYou: boolean): void;
    win?(): void;
    lose?(): void;
    select?(size: number): void;
    rotate?(): void;
    scan?(): void;
  };
}

let lastPointer: string = "mouse";
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType), { capture: true, passive: true });
}

function seatName(p: GameScreenProps, s: number): string {
  return p.seats[s]?.name || SEAT_NAMES[s] || `Seat ${s + 1}`;
}

function describe(p: GameScreenProps, e: GameEvent): string | null {
  const n = (s: number) => seatName(p, s);
  switch (e.type) {
    case "node":
      return `${n(e.seat)} grabbed a node. +1 charge`;
    case "shattered":
      return `${n(e.seat)} shattered a piece of ${n(e.victim)}'s light`;
    case "misfire":
      return e.seat === p.seat ? "misfire. something was hiding in the fog" : `${n(e.seat)} misfired into the fog`;
    case "scanned":
      return `${n(e.seat)} lit up the whole board`;
    case "dark":
      return `${n(e.seat)} went dark`;
    case "storm":
      return "the storm took the edge of the board";
    case "placed":
      if (e.leap) return `${n(e.seat)} leapt a gap`;
      if (e.spark) return `${n(e.seat)} sparked a single cell`;
      return null;
    default:
      return null;
  }
}

interface Toast {
  id: number;
  text: string;
  seat: number | null;
}

export function GameScreen(props: GameScreenProps) {
  const { view, kit, seat, canAct } = props;
  const [renderer, setRenderer] = useState<"paper" | "night">(() => (NIGHT_RENDERER.component ? "night" : "paper"));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [layerCut, setLayerCut] = useState<number | null>(null);
  const prevView = useRef<View | null>(null);
  const toastId = useRef(0);
  const three = view.config.dims[2] > 1;
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ctl = useController(
    { view, kit, seat, canAct, legal: props.legal, submit: props.submit },
    {
      onError: (reason) => {
        setError(reason);
        props.sound?.invalid?.();
      },
    },
  );

  const say = (text: string, s: number | null) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, seat: s }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error]);

  // React to new positions: toasts and sounds.
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!prev || prev.ply === view.ply && prev.events === view.events) return;
    const w = view.config.dims[0];
    for (const e of view.events) {
      const text = describe(props, e);
      if (text) say(text, "seat" in e ? e.seat : null);
      if (e.type === "placed" && e.cells.length) {
        const x = (e.cells.reduce((a, c) => a + (c % w), 0) / e.cells.length / Math.max(1, w - 1)) * 2 - 1;
        props.sound?.place?.({ size: e.cells.length, seat: e.seat, pan: x });
      }
      if (e.type === "node") props.sound?.node?.();
      if (e.type === "shattered") props.sound?.shatter?.();
      if (e.type === "misfire") props.sound?.misfire?.();
      if (e.type === "storm") props.sound?.storm?.();
      if (e.type === "dark") props.sound?.dark?.(e.seat);
      if (e.type === "scanned") props.sound?.scan?.();
      if (e.type === "gameOver") {
        const won = seat !== null && e.winners.includes(seat);
        if (won) props.sound?.win?.();
        else props.sound?.lose?.();
      }
    }
    if (view.phase === "playing" && prev.turn !== view.turn) props.sound?.turnStart?.(view.turn === seat);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastPlaced = useMemo(() => {
    const placed = view.events.find((e) => e.type === "placed");
    if (placed && placed.type === "placed" && placed.cells.length) return placed.cells;
    return diffPlaced(prevView.current, view);
  }, [view]);
  const misfire = useMemo(() => view.events.flatMap((e) => (e.type === "misfire" ? e.cells : [])), [view]);

  const Board = renderer === "night" && NIGHT_RENDERER.component ? NIGHT_RENDERER.component : PaperBoard;
  const effectiveRenderer = Board === PaperBoard ? "paper" : "night";

  const myView = seat !== null ? view.seats[seat] : null;
  const charge = myView?.charge ?? 0;
  const color = (s: number) => SEAT_COLORS[s] ?? "#999";
  const over = view.phase === "over";
  const myTurn = canAct;
  const turnName = seatName(props, view.turn);

  // Tray: pieces grouped by size, biggest first.
  const tray = useMemo(() => {
    const groups = new Map<number, number[]>();
    kit.pieces.forEach((p, i) => {
      const g = groups.get(p.size) ?? [];
      g.push(i);
      groups.set(p.size, g);
    });
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [kit]);

  const clockLeft = useClock(props.clock ?? null);
  const fog = view.config.fog !== null;
  const arena = view.config.arena;

  return (
    <div className={`game ${effectiveRenderer}`} data-phase={view.phase}>
      <header className="game-top">
        <button className="game-leave" onClick={props.onLeave} aria-label="Leave game">
          <span aria-hidden>←</span> cubes
        </button>
        <div className="game-title">
          <span className="eyebrow">{props.title}</span>
          {props.roomCode && <span className="room-code">room {props.roomCode}</span>}
          <span className="round">round {view.round}</span>
          {view.nextStorm !== null && view.config.storm && (
            <span className="storm-chip" title="The outer ring collapses into ash">
              storm in {Math.max(0, view.nextStorm - view.round)}
            </span>
          )}
        </div>
        <div className="game-tools">
          {!three && NIGHT_RENDERER.component && (
            <div className="seg" role="group" aria-label="Board style">
              <button aria-pressed={effectiveRenderer === "night"} onClick={() => setRenderer("night")}>
                night
              </button>
              <button aria-pressed={effectiveRenderer === "paper"} onClick={() => setRenderer("paper")}>
                paper
              </button>
            </div>
          )}
          <button className="icon-btn" onClick={() => setHelp(true)} aria-label="Controls and rules">
            ?
          </button>
        </div>
      </header>

      <ol className="seats" aria-label="Players">
        {view.seats.map((s) => {
          const info = props.seats[s.seat];
          const active = view.turn === s.seat && !over;
          return (
            <li
              key={s.seat}
              className={`seat ${active ? "active" : ""} ${s.dark ? "dark" : ""} ${s.seat === seat ? "me" : ""}`}
              style={{ "--c": color(s.seat) } as React.CSSProperties}
            >
              <span className="seat-dot" aria-hidden />
              <span className="seat-name">
                {seatName(props, s.seat)}
                {s.seat === seat && !/^you$/i.test(seatName(props, s.seat)) && <em> (you)</em>}
                {info?.kind === "bot" && <small className="bot-tag">bot</small>}
                {info?.autopilot && <small className="bot-tag">autopilot</small>}
                {info?.connected === false && <small className="away">away</small>}
              </span>
              <span className="seat-score" aria-label="score">
                {s.score ?? "?"}
              </span>
              {arena && (
                <span className="seat-charge" aria-label={`charge ${s.charge ?? "unknown"}`}>
                  {s.charge === null ? "⚡?" : `⚡${s.charge}`}
                </span>
              )}
              <span className="seat-left" title="Shards left">
                {s.piecesLeft} left
              </span>
              {props.thinking === s.seat && <span className="thinking" aria-label="thinking" />}
              {active && clockLeft !== null && props.clock?.seat === s.seat && (
                <span className={`clock ${clockLeft <= 5 ? "urgent" : ""}`}>{clockLeft}s</span>
              )}
            </li>
          );
        })}
      </ol>

      <main className="board-wrap" onContextMenu={(e) => e.preventDefault()} onWheel={(e) => {
        if (effectiveRenderer === "paper" && ctl.piece !== null) ctl.transform(e.deltaY > 0 ? "rotate" : "rotateBack");
      }}>
        <Suspense fallback={<div className="board-loading">sharpening pencils…</div>}>
          <Board
            view={view}
            ghost={ctl.ghost ? { cells: ctl.ghost.cells, seat: ctl.ghost.seat, valid: ctl.ghost.valid } : null}
            marks={{ attach: ctl.marks.attach, targets: ctl.marks.targets, lastPlaced, misfire }}
            selectedSeat={seat}
            onHover={(t) => ctl.hover(t)}
            onSelect={(t) => ctl.select({ cell: t.cell, button: t.button, touch: lastPointer === "touch" })}
            reducedMotion={reduced}
            layerCut={layerCut}
          />
        </Suspense>

        {myTurn && !over && (
          <div className="turn-note hand" aria-live="polite">
            <span>{ctl.hint ?? (ctl.pending ? "tap again to place" : "your move")}</span>
            <svg viewBox="0 0 80 60" fill="none" aria-hidden className="hand-arrow">
              <path d="M8 6 C 30 4, 56 16, 64 44" />
              <path d="M54 38 L 65 47 L 70 33" />
            </svg>
          </div>
        )}
        {!myTurn && !over && (
          <div className="waiting-note hand" aria-live="polite">
            {props.thinking === view.turn ? `${turnName} is thinking…` : `${turnName}'s move`}
          </div>
        )}
        {error && (
          <div className="error-note hand" role="alert">
            {error}
          </div>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast hand" style={{ "--c": t.seat !== null ? color(t.seat) : "var(--ink)" } as React.CSSProperties}>
              {t.text}
            </div>
          ))}
        </div>

        {three && (
          <div className="layer-cut">
            <label>
              <span className="eyebrow">slice</span>
              <input
                type="range"
                min={0}
                max={view.config.dims[2] - 1}
                value={layerCut ?? view.config.dims[2] - 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLayerCut(v >= view.config.dims[2] - 1 ? null : v);
                }}
              />
            </label>
          </div>
        )}
      </main>

      <section className={`dock ${myTurn ? "live" : ""}`} aria-label="Your shards and surges">
        {seat !== null && myView && (
          <>
            <div className="tray" role="listbox" aria-label="Shards">
              {tray.map(([size, idx]) => (
                <div key={size} className="tray-group">
                  {idx.map((i) => {
                    const have = myView.pieces?.[i] ?? true;
                    const fits = ctl.playable.has(i);
                    const selected = ctl.piece === i;
                    const orients = kit.pieces[i]!.orients;
                    const cells = selected ? orients[ctl.orient] ?? orients[0]! : orients[0]!;
                    return (
                      <button
                        key={i}
                        role="option"
                        aria-selected={selected}
                        disabled={!have}
                        className={`shard ${selected ? "sel" : ""} ${have && !fits && myTurn ? "nofit" : ""}`}
                        title={`${kit.pieces[i]!.name} (${size})${have && !fits && myTurn ? ": doesn't fit anywhere right now" : ""}`}
                        onClick={() => {
                          ctl.selectPiece(i);
                          props.sound?.select?.(size);
                        }}
                      >
                        <ShardIcon cells={cells} color={color(seat)} dim={!have} iso={three} size={40} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="controls">
              <button className="ctl" disabled={ctl.piece === null} onClick={() => { ctl.transform("rotate"); props.sound?.rotate?.(); }} title="Rotate (R)">
                ↻ <span>rotate</span>
              </button>
              {three ? (
                <>
                  <button className="ctl" disabled={ctl.piece === null} onClick={() => ctl.transform("pitch")} title="Tip forward (T)">
                    ⤼ <span>tip</span>
                  </button>
                  <button className="ctl" disabled={ctl.piece === null} onClick={() => ctl.transform("roll")} title="Roll (G)">
                    ⤾ <span>roll</span>
                  </button>
                </>
              ) : (
                <button className="ctl" disabled={ctl.piece === null} onClick={() => { ctl.transform("flip"); props.sound?.rotate?.(); }} title="Flip (F)">
                  ⇋ <span>flip</span>
                </button>
              )}
              {ctl.pending && (
                <button className="ctl primary" onClick={ctl.confirm}>
                  place
                </button>
              )}
            </div>

            {arena && (
              <div className="surges" aria-label="Surges">
                <span className="charge" title="Charge: collect nodes to earn more">
                  ⚡ <strong>{charge}</strong>
                </span>
                <button
                  className={`surge ${ctl.piece === kit.sparkIndex ? "on" : ""}`}
                  disabled={!myTurn || charge < 1}
                  onClick={() => ctl.selectPiece(kit.sparkIndex)}
                  title="Spark (S): place a single cell. 1 charge"
                >
                  spark <small>1</small>
                </button>
                <button
                  className={`surge ${ctl.leap ? "on" : ""}`}
                  disabled={!myTurn || charge < 2}
                  onClick={() => ctl.setLeap(!ctl.leap)}
                  title="Leap (L): link from up to two cells away. 2 charge"
                >
                  leap <small>2</small>
                </button>
                <button
                  className={`surge ${ctl.mode === "shatter" ? "on" : ""}`}
                  disabled={!myTurn || charge < 3 || view.shatteredThisTurn}
                  onClick={() => ctl.setMode("shatter")}
                  title="Shatter (X): destroy one enemy cell. 3 charge"
                >
                  shatter <small>3</small>
                </button>
                {fog && (
                  <button
                    className="surge"
                    disabled={!myTurn || charge < 1 || view.scanning}
                    onClick={ctl.scan}
                    title="Scan (C): see the whole board until your next turn ends. 1 charge"
                  >
                    scan <small>1</small>
                  </button>
                )}
              </div>
            )}

            <div className="dock-actions">
              {props.undoable && props.onUndo && (
                <button className="quiet" onClick={props.onUndo} title="Take back your last move">
                  undo
                </button>
              )}
              {!over && props.onResign && (
                <button
                  className="quiet"
                  onClick={() => {
                    if (confirm("Go dark for the rest of this game?")) props.onResign?.();
                  }}
                >
                  resign
                </button>
              )}
            </div>
          </>
        )}
        {seat === null && <p className="spectating hand">just watching. enjoy the light show</p>}
        {props.aside}
      </section>

      {props.handoff !== null && props.handoff !== undefined && (
        <div className="overlay handoff" role="dialog" aria-modal="true" aria-label="Pass the device">
          <div className="sheet">
            <p className="hand" style={{ color: color(props.handoff) }}>
              no peeking
            </p>
            <h2>
              Pass it to <em style={{ color: color(props.handoff) }}>{seatName(props, props.handoff)}</em>
            </h2>
            <p>The fog only works if everyone looks away. Ready?</p>
            <button className="btn-primary" autoFocus onClick={props.onAcceptHandoff}>
              I'm {seatName(props, props.handoff)}, show me my board
            </button>
          </div>
        </div>
      )}

      {over && <GameOver {...props} />}

      {help && <Help three={three} arena={arena} fog={fog} onClose={() => setHelp(false)} />}
    </div>
  );
}

function useClock(clock: { seat: number; endsAt: number } | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [clock]);
  if (!clock) return null;
  return Math.max(0, Math.ceil((clock.endsAt - now) / 1000));
}

function GameOver(props: GameScreenProps) {
  const { view, seat } = props;
  const scores = view.scores ?? view.seats.map((s) => s.score ?? 0);
  const winners = view.winners ?? [];
  const order = [...view.seats.keys()].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const won = seat !== null && winners.includes(seat);
  const tie = winners.length > 1;
  const lit = view.cells.filter((c, i) => c >= 1 && c <= 4 && !(view.flags[i]! & FLAG.CORE)).length;
  return (
    <div className="overlay over" role="dialog" aria-modal="true" aria-label="Game over">
      <div className="sheet">
        <p className="hand">{won ? (tie ? "shared the light" : "you lit the most!") : seat === null ? "that's the game" : "next time"}</p>
        <h2>
          {tie ? "A tie between " : ""}
          {winners.map((w, i) => (
            <span key={w}>
              {i > 0 && (i === winners.length - 1 ? " and " : ", ")}
              <em style={{ color: SEAT_COLORS[w] }}>{seatName(props, w)}</em>
            </span>
          ))}
          {tie ? "" : " wins"}
        </h2>
        <ol className="final">
          {order.map((s) => (
            <li key={s} style={{ "--c": SEAT_COLORS[s] } as React.CSSProperties}>
              <span className="seat-dot" />
              <span>{seatName(props, s)}</span>
              <strong>{scores[s]}</strong>
              {view.seats[s]!.piecesLeft === 0 && <small className="hand">clean sweep +5</small>}
            </li>
          ))}
        </ol>
        <p className="muted">
          {lit} cells lit in {view.round} rounds.
        </p>
        <div className="row">
          {props.onRematch && (
            <button className="btn-primary" onClick={props.onRematch}>
              Rematch
            </button>
          )}
          <button className="btn-ghost" onClick={props.onLeave}>
            Back to the lobby
          </button>
        </div>
      </div>
    </div>
  );
}

function Help({ three, arena, fog, onClose }: { three: boolean; arena: boolean; fog: boolean; onClose(): void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay help" role="dialog" aria-modal="true" aria-label="Controls" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <p className="hand">the short version</p>
        <h2>Corners only. Never a face.</h2>
        <p>
          Each shard must touch your light at a corner and may never touch your own light along a {three ? "face" : "side"}. Touch
          anyone else however you like. Can't move? You go dark.
        </p>
        <dl className="keys">
          <dt>1–0</dt>
          <dd>pick a shard (biggest first)</dd>
          <dt>R / Q</dt>
          <dd>rotate / rotate back · right-click or scroll works too</dd>
          {three ? (
            <>
              <dt>T / G</dt>
              <dd>tip forward / roll sideways</dd>
            </>
          ) : (
            <>
              <dt>F</dt>
              <dd>flip</dd>
            </>
          )}
          <dt>Enter</dt>
          <dd>place the ghost</dd>
          <dt>Esc</dt>
          <dd>put the shard down</dd>
          {arena && (
            <>
              <dt>S · L · X{fog ? " · C" : ""}</dt>
              <dd>spark · leap · shatter{fog ? " · scan" : ""}</dd>
            </>
          )}
        </dl>
        <button className="btn-ghost" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
