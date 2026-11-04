import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "./paper.css";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { SEAT_NAMES } from "@/engine/types";
import { cellBox, focusBrackets } from "./art";
import { centreCell, clientToCell, makeLayout, pixelsPerUnit, stepFocus, viewBoxOf, type Dir } from "./geometry";
import { hashSeed } from "./ink";
import { BoardBase, BoardFrame, Defs, Fog, Ghost, Marks, Pieces } from "./layers";
import { GRAPHITE, INK, PAPER, SEAT_INK } from "./palette";
import { buildScene, describeCell, freshCells, shapeKey } from "./scene";
import type { BoardSceneProps } from "./types";

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.32  0 0 0 0 0.27  0 0 0 0 0.2  0 0 0 0.11 0'/></filter>" +
    "<filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.09' numOctaves='2' seed='4' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.28  0 0 0 0.07 0'/></filter>" +
    "<rect width='100%' height='100%' filter='url(#f)'/><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

const PAPER_BG = `${GRAIN}, radial-gradient(120% 90% at 50% 38%, #f7f4ec 0%, ${PAPER} 55%, #e9e2d3 100%)`;

const DIRS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The calm, hand-drawn 2D board. Same props as the 3D renderer. */
export function PaperBoard(props: BoardSceneProps): JSX.Element {
  const { view, ghost, marks, selectedSeat = null, onHover, onSelect, quality = "high", reducedMotion = false } = props;
  const uid = "pb" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [w, h] = view.config.dims;
  const layout = useMemo(() => makeLayout(w, h), [w, h]);
  const vb = viewBoxOf(layout);
  const unit = layout.unit;

  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [ppu, setPpu] = useState(1);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPpu(pixelsPerUnit(r.width, r.height, layout));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  // Keep lines a legible physical width on small boards; quantised so resizing
  // doesn't regenerate every stroke.
  const inkScale = Math.round(clamp(0.8 / Math.max(ppu, 0.05), 1, 2.4) * 4) / 4;
  const cellPx = ppu * unit;

  const scene = useMemo(() => buildScene(view), [view]);
  const sk = useMemo(() => shapeKey(view), [view]);
  const playable = useCallback((i: number) => scene.playable[i] === 1, [scene]);

  // Bleed-in: which cells became owned since the previous view?
  const prevCells = useRef<number[] | null>(null);
  const fresh = useMemo(() => (reducedMotion ? new Set<number>() : freshCells(prevCells.current, view.cells)), [view.cells, reducedMotion]);
  useEffect(() => {
    prevCells.current = view.cells;
  }, [view.cells]);

  /* ---------------------------------------------------------- interaction */

  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const [focusCell, setFocusCell] = useState<number | null>(null);
  const [kbd, setKbd] = useState(false);
  const pointerFocus = useRef(false);
  const [announce, setAnnounce] = useState("");
  const lastHover = useRef<number | null>(null);
  const down = useRef<{ id: number; x: number; y: number; cell: number | null; type: string } | null>(null);

  const emitHover = useCallback(
    (cell: number | null) => {
      if (cell === lastHover.current) return;
      lastHover.current = cell;
      onHover(cell == null ? null : { cell });
    },
    [onHover],
  );

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      return clientToCell(clientX, clientY, svg.getBoundingClientRect(), layout, playable);
    },
    [layout, playable],
  );

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const c = cellAt(e.clientX, e.clientY);
    if (kbd) setKbd(false);
    setHoverCell(c);
    emitHover(c);
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    setHoverCell(null);
    emitHover(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    // Focus without letting the browser scroll the board under the pointer.
    // Pointer focus must not move the keyboard cursor (Chrome reports
    // :focus-visible here if a key was pressed earlier, e.g. a shortcut).
    if (e.pointerType === "mouse") {
      e.preventDefault();
      pointerFocus.current = true;
      rootRef.current?.focus({ preventScroll: true });
      pointerFocus.current = false;
    }
    down.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cell: cellAt(e.clientX, e.clientY), type: e.pointerType };
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || d.id !== e.pointerId) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell == null) return;
    if (d.type === "touch") {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      setFocusCell(cell);
      emitHover(cell);
      onSelect({ cell, button: 0, shift: false });
      return;
    }
    // A click that wanders a little still lands where it was released.
    if (cell === d.cell || Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 14) {
      emitHover(cell);
      onSelect({ cell, button: e.button, shift: e.shiftKey });
    }
  };

  const say = useCallback((cell: number, prefix = "") => setAnnounce(prefix + describeCell(view, cell)), [view]);

  const startCell = useCallback(() => {
    if (view.seat != null) {
      const core = view.seats.find((s) => s.seat === view.seat)?.core;
      if (core != null && scene.playable[core]) return core;
    }
    return centreCell(w, h, playable);
  }, [view, scene, w, h, playable]);

  const onKeyDown = (e: KeyboardEvent) => {
    const dir = DIRS[e.key];
    if (dir) {
      e.preventDefault();
      const from = focusCell ?? startCell();
      const next = focusCell == null ? from : stepFocus(from, dir, w, h, playable, scene.torus);
      setFocusCell(next);
      setKbd(true);
      emitHover(next);
      say(next);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const cell = focusCell ?? startCell();
      setFocusCell(cell);
      setKbd(true);
      onSelect({ cell, button: 0, shift: e.shiftKey });
      return;
    }
    if (e.key === "Escape") {
      setKbd(false);
      emitHover(null);
    }
  };

  const onFocus = () => {
    if (pointerFocus.current) return;
    let visible = false;
    try {
      visible = rootRef.current?.matches(":focus-visible") ?? false;
    } catch {
      visible = false;
    }
    if (!visible) return;
    const cell = focusCell ?? startCell();
    setFocusCell(cell);
    setKbd(true);
    emitHover(cell);
    say(cell);
  };

  const onBlur = () => {
    if (kbd) {
      setKbd(false);
      emitHover(null);
    }
  };

  // Tell screen-reader users whether the held shard fits where the cursor is.
  const ghostKey = ghost ? `${ghost.valid}:${ghost.cells.join(",")}` : "";
  useEffect(() => {
    if (!kbd || focusCell == null || !ghost) return;
    setAnnounce(`${describeCell(view, focusCell)}. ${ghost.valid ? "Shard fits here." : "Shard does not fit here."}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostKey]);

  // Keep the cursor on the board when the board shape changes.
  useEffect(() => {
    if (focusCell != null && !scene.playable[focusCell]) setFocusCell(null);
  }, [scene, focusCell]);

  /* ---------------------------------------------------------- summary */

  const summary = useMemo(() => {
    const counts = [0, 0, 0, 0];
    for (const s of scene.shards) if (!s.core) counts[s.seat]! += s.cells.length;
    const seats = view.seats.map((s) => `${SEAT_NAMES[s.seat] ?? `Seat ${s.seat + 1}`} ${counts[s.seat] ?? 0} cells`).join(", ");
    const extra = [scene.torus ? "edges wrap around" : "", scene.fog.length ? `${scene.fog.length} cells out of sight` : "", scene.nodes.length ? `${scene.nodes.length} open nodes` : ""]
      .filter(Boolean)
      .join(", ");
    return `${w} by ${h} board. ${seats}${extra ? `. ${extra}` : ""}. Arrow keys move the cursor, Enter places.`;
  }, [scene, view.seats, w, h]);

  const showKbdCursor = kbd && focusCell != null;

  return (
    <div
      ref={rootRef}
      className={`pb-root${reducedMotion ? " pb-still" : ""}`}
      style={{ background: PAPER_BG, backgroundColor: PAPER }}
      role="application"
      aria-roledescription="game board"
      aria-label="cubes board"
      aria-describedby={`${uid}-sum`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="paper-board"
    >
      <svg
        ref={svgRef}
        className="pb-svg"
        viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
        aria-hidden="true"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (down.current = null)}
      >
        <Defs uid={uid} unit={unit} quality={quality} />
        <BoardBase uid={uid} scene={scene} sk={sk} layout={layout} inkScale={inkScale} quality={quality} />
        <Pieces uid={uid} scene={scene} layout={layout} inkScale={inkScale} quality={quality} fresh={fresh} />
        <Fog uid={uid} scene={scene} layout={layout} inkScale={inkScale} quality={quality} />
        <BoardFrame uid={uid} scene={scene} sk={sk} layout={layout} inkScale={inkScale} cellPx={cellPx} />
        <Marks scene={scene} layout={layout} inkScale={inkScale} marks={marks} selectedSeat={selectedSeat} reducedMotion={reducedMotion} />
        <Ghost scene={scene} layout={layout} inkScale={inkScale} ghost={ghost} />
        {hoverCell != null && !ghost && !showKbdCursor && (
          <path d={cellBox(hoverCell, w, unit, unit * 0.06, hashSeed(hoverCell, 5))} fill="none" stroke={selectedSeat != null ? SEAT_INK[selectedSeat] : GRAPHITE} strokeOpacity={0.55} strokeWidth={1.3 * inkScale} strokeLinecap="round" />
        )}
        {showKbdCursor && <path d={focusBrackets(focusCell!, w, unit, inkScale)} fill={INK} />}
      </svg>
      <div id={`${uid}-sum`} className="pb-sr">
        {summary}
      </div>
      <div className="pb-sr" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  );
}

