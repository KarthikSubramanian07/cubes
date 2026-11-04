/**
 * The interaction brain of the game screen, shared by both renderers and by
 * local and online matches. It owns: which shard is in hand and how it's
 * turned, Leap/Shatter modes, the snapping ghost, board marks, keyboard
 * shortcuts, and tap-to-preview / tap-to-confirm on touch screens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Kit, Placement, Vec3, View } from "@/engine/types";
import { anchorFor, cellsAt, fitsNear, snapPlacement, transformOrient, type Transform } from "./placement";
import { attachPoints, shatterTargets } from "./board";

export interface ControllerSource {
  view: View;
  kit: Kit;
  /** The seat this player controls (null when spectating). */
  seat: number | null;
  canAct: boolean;
  legal(leap: boolean): Placement[];
  submit(action: Action): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export type Mode = "place" | "shatter";

export interface Ghost {
  cells: number[];
  seat: number;
  valid: boolean;
  placement: Placement | null;
}

export interface Controller {
  piece: number | null;
  orient: number;
  leap: boolean;
  mode: Mode;
  ghost: Ghost | null;
  marks: { attach: number[]; targets: number[] };
  playable: Set<number>;
  legalCount: number;
  hint: string | null;
  busy: boolean;
  /** A placement is previewed and waiting for a second tap / confirm. */
  pending: boolean;
  /** How the pending preview got there: a tap, or stepping through fits with N. */
  pendingVia: "touch" | "key" | null;
  selectPiece(piece: number | null): void;
  transform(t: Transform): void;
  setLeap(on: boolean): void;
  setMode(m: Mode): void;
  hover(target: { cell: number } | null): void;
  select(target: { cell: number; button?: number; touch?: boolean }): void;
  confirm(): void;
  cancel(): void;
  scan(): void;
  /** Preview the next (or previous) spot the held shard fits, nearest the cursor first. */
  cycleFit(dir: 1 | -1): void;
}

/** In 3D the hovered cell is often face-adjacent to your own light; snap to fits this close. */
const SNAP_RADIUS_3D = 2;

const SURGE_SPARK = 1;
const SURGE_LEAP = 2;
const SURGE_SHATTER = 3;

export function useController(src: ControllerSource, opts: { onError?: (reason: string) => void; onPlaced?: () => void } = {}): Controller {
  const { view, kit, seat, canAct } = src;
  const [piece, setPiece] = useState<number | null>(null);
  const [orient, setOrient] = useState(0);
  const [leap, setLeapState] = useState(false);
  const [mode, setModeState] = useState<Mode>("place");
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const [pinned, setPinned] = useState<Placement | null>(null);
  const [busy, setBusy] = useState(false);
  const lastAt = useRef<Vec3 | null>(null);
  const [pinVia, setPinVia] = useState<"touch" | "key" | null>(null);
  const cycle = useRef<{ key: string; list: Placement[]; index: number } | null>(null);
  const three = view.config.dims[2] > 1;
  const charge = seat !== null ? (view.seats[seat]?.charge ?? 0) : 0;
  const pieces = seat !== null ? view.seats[seat]?.pieces : null;

  // Legal placements are recomputed only when the position changes.
  const legalKey = `${view.ply}:${view.turn}:${leap}:${canAct}:${charge}:${view.shatteredThisTurn}`;
  const legal = useMemo(() => (canAct ? src.legal(leap) : []), [legalKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const playable = useMemo(() => new Set(legal.map((p) => p.piece)), [legal]);

  // Drop the selection if it became unavailable (used, or turn changed).
  useEffect(() => {
    if (piece === null) return;
    const spark = piece === kit.sparkIndex;
    const gone = spark ? charge < SURGE_SPARK + (leap ? SURGE_LEAP : 0) : pieces && !pieces[piece];
    if (gone) setPiece(null);
  }, [piece, pieces, charge, leap, kit.sparkIndex]);

  useEffect(() => {
    setPinned(null);
    if (!canAct) setModeState("place");
  }, [view.ply, canAct]);

  useEffect(() => {
    if (leap && charge < SURGE_LEAP) setLeapState(false);
  }, [leap, charge]);

  const orientsOf = useCallback(
    (p: number): Vec3[][] => (p === kit.sparkIndex ? [[[0, 0, 0]]] : kit.pieces[p]!.orients),
    [kit],
  );

  // The ghost for the shard in hand aimed at `cell`: snapped to a legal spot when one is close, red otherwise.
  const ghostAt = useCallback(
    (cell: number): Ghost | null => {
      if (seat === null || piece === null) return null;
      const cells = orientsOf(piece)[orient] ?? orientsOf(piece)[0]!;
      const dims = view.config.dims;
      const at = anchorFor(dims, cells, cell);
      lastAt.current = at;
      const snapped = snapPlacement(legal, piece, orient, cell, at, three ? { dims, radius: SNAP_RADIUS_3D } : false);
      if (snapped) return { cells: snapped.cells, seat, valid: true, placement: snapped };
      const raw = cellsAt(dims, cells, at, view.config.topology === "torus");
      if (!raw) return null;
      return { cells: raw, seat, valid: false, placement: null };
    },
    [seat, piece, orient, legal, view.config, orientsOf, three],
  );

  const ghost = useMemo<Ghost | null>(() => {
    if (seat === null || !canAct || mode !== "place" || piece === null) return null;
    if (pinned) return { cells: pinned.cells, seat, valid: true, placement: pinned };
    if (hoverCell === null) return null;
    return ghostAt(hoverCell);
  }, [seat, canAct, mode, piece, pinned, hoverCell, ghostAt]);

  const marks = useMemo(() => {
    if (seat === null || !canAct) return { attach: [], targets: [] };
    return {
      attach: mode === "place" && !leap ? attachPoints(view, seat) : [],
      targets: mode === "shatter" ? shatterTargets(view, seat) : [],
    };
  }, [view, seat, canAct, mode, leap]);

  const hint = useMemo(() => {
    if (!canAct) return null;
    if (mode === "shatter") return "tap an opponent's square to destroy it";
    if (piece === null) return playable.size ? "your turn · pick a piece below" : "nothing fits · try a power-up";
    if (ghost && !ghost.valid) return "touch your colour at a corner, never a side";
    return null;
  }, [canAct, mode, piece, playable, ghost]);

  const submit = useCallback(
    async (action: Action) => {
      if (busy) return;
      setBusy(true);
      try {
        const r = await src.submit(action);
        if (!r.ok) opts.onError?.(r.reason);
        else if (action.type === "place") {
          setPiece(null);
          setPinned(null);
          setLeapState(false);
          opts.onPlaced?.();
        } else if (action.type === "shatter") {
          setModeState("place");
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, src, opts],
  );

  const placeGhost = useCallback(() => {
    const p = ghost?.placement;
    if (!p) return false;
    void submit({ type: "place", piece: p.piece, orient: p.orient, at: p.at, leap });
    return true;
  }, [ghost, leap, submit]);

  const selectPiece = useCallback(
    (p: number | null) => {
      setPinned(null);
      setModeState("place");
      if (p === null || p === piece) {
        setPiece(p === piece ? null : p);
        return;
      }
      setPiece(p);
      setOrient(0);
    },
    [piece],
  );

  const transform = useCallback(
    (t: Transform) => {
      if (piece === null) return;
      setPinned(null);
      setOrient((o) => transformOrient(kit, piece, o, t));
    },
    [kit, piece],
  );

  const select = useCallback(
    (target: { cell: number; button?: number; touch?: boolean }) => {
      if (!canAct || seat === null) return;
      if (target.button === 2) {
        transform("rotate");
        return;
      }
      if (mode === "shatter") {
        if (marks.targets.includes(target.cell)) void submit({ type: "shatter", cell: target.cell });
        else opts.onError?.("you can only shatter an opponent's square");
        return;
      }
      if (piece === null) return;
      if (target.touch) {
        // First tap previews, a second tap on the preview confirms.
        if (pinned && pinned.cells.includes(target.cell)) {
          placeGhost();
          return;
        }
        const cells = orientsOf(piece)[orient]!;
        const dims = view.config.dims;
        const snapped = snapPlacement(legal, piece, orient, target.cell, anchorFor(dims, cells, target.cell), {
          allowOrientChange: true,
          dims,
          radius: three ? SNAP_RADIUS_3D : 0,
        });
        if (snapped) {
          setOrient(snapped.orient);
          setPinned(snapped);
          setPinVia("touch");
        } else opts.onError?.("that piece doesn't fit there");
        return;
      }
      // Place exactly what's under the pointer now, not the ghost from the last
      // pointer move: the board may have shifted under a still cursor.
      setHoverCell(target.cell);
      const g = pinned && pinVia === "key" && pinned.cells.includes(target.cell) ? ghost : ghostAt(target.cell);
      const p = g?.placement;
      if (p) void submit({ type: "place", piece: p.piece, orient: p.orient, at: p.at, leap });
      else opts.onError?.(g ? "it must touch your colour at a corner, never a side" : "that's off the board");
    },
    [canAct, seat, mode, marks, piece, pinned, pinVia, orient, legal, view.config.dims, three, ghost, ghostAt, leap, placeGhost, submit, transform, orientsOf, opts],
  );

  const setLeap = useCallback(
    (on: boolean) => {
      if (on && charge < SURGE_LEAP) {
        opts.onError?.("leap costs 2 charge · cover glowing nodes to earn it");
        return;
      }
      setPinned(null);
      setLeapState(on);
    },
    [charge, opts],
  );

  const setMode = useCallback(
    (m: Mode) => {
      if (m === "shatter" && (charge < SURGE_SHATTER || view.shatteredThisTurn)) {
        opts.onError?.(view.shatteredThisTurn ? "one shatter per turn" : "shatter costs 3 charge · cover glowing nodes to earn it");
        return;
      }
      setPinned(null);
      setModeState((cur) => (cur === m ? "place" : m));
    },
    [charge, view.shatteredThisTurn, opts],
  );

  const scan = useCallback(() => void submit({ type: "scan" }), [submit]);

  const cycleFit = useCallback(
    (dir: 1 | -1) => {
      if (!canAct || seat === null || mode !== "place") return;
      // With nothing in hand, pick up the biggest shard that fits somewhere.
      let p = piece;
      if (p === null) {
        const best = [...playable].filter((i) => i !== kit.sparkIndex).sort((a, b) => kit.pieces[b]!.size - kit.pieces[a]!.size || a - b)[0];
        if (best === undefined) {
          opts.onError?.("none of your pieces fit right now");
          return;
        }
        p = best;
        setPiece(best);
      }
      const key = `${legalKey}:${p}`;
      let c = cycle.current;
      if (!c || c.key !== key) {
        const from = hoverCell ?? view.seats[seat]?.core ?? null;
        c = { key, list: fitsNear(legal, p, view.config.dims, from), index: -1 };
        cycle.current = c;
      }
      if (!c.list.length) {
        opts.onError?.("that piece doesn't fit anywhere right now");
        return;
      }
      c.index = (c.index + dir + c.list.length) % c.list.length;
      const next = c.list[c.index]!;
      setOrient(next.orient);
      setPinned(next);
      setPinVia("key");
    },
    [canAct, seat, mode, piece, playable, kit, legalKey, hoverCell, legal, view.seats, view.config.dims, opts],
  );

  const cancel = useCallback(() => {
    setPinned(null);
    if (mode !== "place") setModeState("place");
    else setPiece(null);
  }, [mode]);

  // Keyboard: R/E rotate, Q back, F flip, T/G pitch/roll (3D), 1-9/0 pieces,
  // L leap, X shatter, S spark, C scan, Enter/Space place, Esc cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        r: () => transform("rotate"),
        e: () => transform("rotate"),
        q: () => transform("rotateBack"),
        f: () => transform("flip"),
        t: () => transform("pitch"),
        g: () => transform("roll"),
        l: () => setLeap(!leap),
        x: () => setMode("shatter"),
        s: () => selectPiece(kit.sparkIndex),
        c: () => scan(),
        n: () => cycleFit(e.shiftKey ? -1 : 1),
        enter: () => void placeGhost(),
        " ": () => void placeGhost(),
        escape: () => cancel(),
      };
      if (/^[0-9]$/.test(k)) {
        // Number keys walk the pieces you still hold, largest first.
        const avail = kit.pieces
          .map((p, i) => ({ i, size: p.size }))
          .filter(({ i }) => pieces?.[i])
          .sort((a, b) => b.size - a.size || a.i - b.i);
        const idx = k === "0" ? 9 : Number(k) - 1;
        const pick = avail[idx];
        if (pick) {
          e.preventDefault();
          selectPiece(pick.i);
        }
        return;
      }
      const fn = map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transform, setLeap, setMode, selectPiece, scan, placeGhost, cancel, cycleFit, leap, kit, pieces]);

  // Mouse wheel over the board rotates the shard in hand.
  return {
    piece,
    orient,
    leap,
    mode,
    ghost,
    marks,
    playable,
    legalCount: legal.length,
    hint,
    busy,
    pending: pinned !== null,
    pendingVia: pinned !== null ? pinVia : null,
    selectPiece,
    transform,
    setLeap,
    setMode,
    hover: (t) => {
      // Moving the pointer drops a preview picked with N; a tapped preview stays put.
      if (t && pinned && pinVia === "key" && !pinned.cells.includes(t.cell)) {
        setPinned(null);
        cycle.current = null;
      }
      setHoverCell(t?.cell ?? null);
    },
    select,
    confirm: () => void placeGhost(),
    cancel,
    scan,
    cycleFit,
  };
}
