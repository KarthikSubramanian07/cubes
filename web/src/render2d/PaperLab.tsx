import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./lab/lab.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FLAG, SEAT_NAMES } from "@/engine/types";
import { hashSeed } from "./ink";
import { cellName } from "./geometry";
import { fabricate, ORIENTS, SCENES, SHAPES, type LabGame, type SceneName } from "./lab/fabricate";
import { SEAT_COLORS, SEAT_INK } from "./palette";
import { PaperBoard } from "./PaperBoard";
import type { BoardMarks, HoverTarget, SelectTarget } from "./types";

type Quality = "low" | "medium" | "high";

function readParams() {
  const p = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const scene = (SCENES.find((s) => s.id === p.get("scene"))?.id ?? "plane") as SceneName;
  const q = p.get("quality");
  const quality: Quality = q === "low" || q === "medium" ? q : "high";
  const reduced = p.get("motion") === "reduce" || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  return { scene, quality, reduced };
}

/** Dev playground for the Paper board: fabricated games and simulated moves. */
export function PaperLab() {
  const initial = useMemo(readParams, []);
  const [scene, setScene] = useState<SceneName>(initial.scene);
  const [quality, setQuality] = useState<Quality>(initial.quality);
  const [reduced, setReduced] = useState(initial.reduced);
  const [showAttach, setShowAttach] = useState(true);
  const [showTargets, setShowTargets] = useState(false);
  const game = useRef<LabGame>(fabricate(initial.scene));
  const [version, setVersion] = useState(0);
  const [last, setLast] = useState<number[]>([]);
  const [misfire, setMisfire] = useState<number[]>([]);
  const [piece, setPiece] = useState(13);
  const [orient, setOrient] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [log, setLog] = useState<string>("A fresh page.");

  const bump = () => setVersion((v) => v + 1);
  const g = game.current;
  const perspective = scene === "fog" ? 0 : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => g.view(perspective), [version, scene]);
  const seat = scene === "fog" ? 0 : g.turn;

  const reset = useCallback((s: SceneName) => {
    game.current = fabricate(s);
    setLast([]);
    setMisfire([]);
    setScene(s);
    setLog("A fresh page.");
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("scene", scene);
    history.replaceState(null, "", url);
  }, [scene]);

  // Keep the held piece one the seat still has.
  const kit = g.kits[seat]!;
  const heldPiece = kit[piece] ? piece : Math.max(0, kit.lastIndexOf(true));

  const ghostCells = hover != null ? g.cellsFor(heldPiece, orient, hover) : null;
  const ghost = ghostCells ? { cells: ghostCells, seat, valid: g.isLegal(seat, ghostCells) } : null;

  const marks: BoardMarks = useMemo(() => {
    const m: BoardMarks = { lastPlaced: last, misfire };
    if (showAttach) m.attach = g.attachCells(seat);
    if (showTargets) {
      const t: number[] = [];
      view.cells.forEach((o, i) => {
        if (o >= 1 && o <= 4 && o !== seat + 1 && !(view.flags[i]! & FLAG.CORE) && hashSeed(i, version) % 6 === 0) t.push(i);
      });
      m.targets = t;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, last, misfire, showAttach, showTargets, seat]);

  const simulate = (n: number) => {
    let placed: number[] = [];
    let who = -1;
    for (let i = 0; i < n; i++) {
      const r = g.step();
      if (!r) break;
      placed = r.cells;
      who = r.seat;
    }
    setLast(placed);
    setMisfire([]);
    setLog(who >= 0 ? `${SEAT_NAMES[who]} played ${placed.length} cells.` : "Nobody can move.");
    bump();
  };

  const onHover = useCallback((t: HoverTarget | null) => setHover(t?.cell ?? null), []);
  const onSelect = useCallback(
    (t: SelectTarget) => {
      if (t.button === 2) {
        setOrient((o) => o + 1);
        return;
      }
      if (t.shift) {
        setOrient((o) => o + 4);
        return;
      }
      const cells = g.cellsFor(heldPiece, orient, t.cell);
      if (!cells || !g.isLegal(seat, cells)) {
        setLog(`${cellName(t.cell, g.w)} doesn't fit. Corners, not edges.`);
        return;
      }
      if (scene !== "fog") {
        // Hand the turn to the next seat after a manual placement.
        g.place(seat, heldPiece, cells);
        g.turn = (g.turn + 1) % g.seats;
      } else {
        g.place(0, heldPiece, cells);
      }
      setLast(cells);
      setMisfire([]);
      setLog(`${SEAT_NAMES[seat]} placed ${SHAPES[heldPiece]!.name} at ${cellName(t.cell, g.w)}.`);
      bump();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldPiece, orient, seat, scene, version],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") setOrient((o) => o + 1);
      if (e.key === "f" || e.key === "F") setOrient((o) => o + 4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doShatter = () => {
    const v = g.shatter(seat);
    setLog(v == null ? "Nothing to shatter." : `${SEAT_NAMES[seat]} shattered ${cellName(v, g.w)}.`);
    setLast([]);
    bump();
  };
  const doMisfire = () => {
    const hidden = scene === "fog" ? g.hiddenOccupied(0) : view.cells.flatMap((o, i) => (o >= 1 && o <= 4 && o !== seat + 1 && !(view.flags[i]! & FLAG.CORE) ? [i] : []));
    const pick = hidden.filter((_, k) => k % Math.max(1, Math.floor(hidden.length / 3)) === 0).slice(0, 3);
    setMisfire(pick);
    setLog(pick.length ? `Misfire. ${pick.map((c) => cellName(c, g.w)).join(", ")} were taken.` : "No hidden cells to hit.");
  };
  const doStorm = () => {
    const ash = g.storm();
    setLog(`The storm took ${ash.length} cells.`);
    setLast([]);
    bump();
  };

  const info = SCENES.find((s) => s.id === scene)!;
  const nOrients = ORIENTS[heldPiece]!.length;

  return (
    <div className="lab">
      <header className="lab-head">
        <p className="lab-eyebrow">cubes / render2d / paper lab</p>
        <h1 className="lab-title">
          The <em>paper</em> board
        </h1>
        <p className="lab-sub">
          A calm counterpart to the night board. Every line is drawn from a seed, so the page looks the same every time you open it.
          <span className="lab-note">drawn, not rendered</span>
        </p>
        <nav className="lab-tabs" aria-label="Scenes">
          {SCENES.map((s) => (
            <button key={s.id} className={`lab-tab${s.id === scene ? " is-on" : ""}`} aria-pressed={s.id === scene} onClick={() => reset(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
      </header>

      <main className="lab-main">
        <section className="lab-board" aria-label={`${info.title} board`}>
          <PaperBoard
            view={view}
            ghost={ghost}
            marks={marks}
            selectedSeat={seat}
            onHover={onHover}
            onSelect={onSelect}
            quality={quality}
            reducedMotion={reduced}
          />
        </section>

        <aside className="lab-side">
          <p className="lab-scene-note">{info.note}</p>

          <div className="lab-turn">
            <span className="lab-swatch" style={{ background: SEAT_COLORS[seat], borderColor: SEAT_INK[seat] }} />
            <span>
              <strong>{SEAT_NAMES[seat]}</strong> to play{scene === "fog" ? " (you)" : ""}
            </span>
            <span className="lab-mono">{hover != null ? cellName(hover, g.w) : "--"}</span>
          </div>

          <div className="lab-group">
            <p className="lab-label">holding</p>
            <div className="lab-row">
              <select className="lab-select" value={heldPiece} onChange={(e) => setPiece(Number(e.target.value))} aria-label="Shard">
                {SHAPES.map((s, i) => (
                  <option key={s.name} value={i} disabled={!kit[i]}>
                    {s.name} ({s.cells.length})
                  </option>
                ))}
              </select>
              <button className="lab-btn ghost" onClick={() => setOrient((o) => o + 1)} title="Rotate (R or right-click)">
                rotate
              </button>
              <span className="lab-mono">
                {(orient % nOrients) + 1}/{nOrients}
              </span>
            </div>
          </div>

          <div className="lab-group">
            <p className="lab-label">simulate</p>
            <div className="lab-grid">
              <button className="lab-btn" onClick={() => simulate(1)}>
                next move
              </button>
              <button className="lab-btn" onClick={() => simulate(scene === "fog" ? 4 : g.seats)}>
                a full round
              </button>
              <button className="lab-btn" onClick={doShatter}>
                shatter
              </button>
              <button className="lab-btn" onClick={doMisfire}>
                misfire
              </button>
              <button className="lab-btn" onClick={doStorm}>
                storm
              </button>
              <button className="lab-btn ghost" onClick={() => reset(scene)}>
                new page
              </button>
            </div>
          </div>

          <div className="lab-group">
            <p className="lab-label">show</p>
            <label className="lab-check">
              <input type="checkbox" checked={showAttach} onChange={(e) => setShowAttach(e.target.checked)} /> corner ticks
            </label>
            <label className="lab-check">
              <input type="checkbox" checked={showTargets} onChange={(e) => setShowTargets(e.target.checked)} /> shatter targets
            </label>
            <label className="lab-check">
              <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion
            </label>
            <div className="lab-row" role="radiogroup" aria-label="Quality">
              {(["low", "medium", "high"] as const).map((q) => (
                <button key={q} role="radio" aria-checked={quality === q} className={`lab-chip${quality === q ? " is-on" : ""}`} onClick={() => setQuality(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          <p className="lab-log" aria-live="polite">
            {log}
          </p>
          <p className="lab-help">Hover to see the shard. Click to place, right-click or R to rotate, F to flip. Tab into the board and use the arrow keys.</p>
        </aside>
      </main>
    </div>
  );
}
