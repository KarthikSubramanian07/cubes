import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BoardShape, GameEvent, Vec3 } from "@/engine/types";
import { FLAG, OWNER } from "@/engine/types";
import { BoardScene } from "./BoardScene";
import {
  attachPoints,
  ghostAt,
  orbitScenario,
  planeScenario,
  rng,
  scenarioView,
  simulateMisfire,
  simulateNodeGrab,
  simulatePlace,
  simulateShatter,
  simulateStorm,
  stackScenario,
  type Scenario,
} from "./fixtures";
import { SEAT_HEX } from "./palette";
import type { QualityTier } from "./quality";
import type { BoardGhost, CameraPreset, HoverInfo, SelectInfo } from "./types";

type SceneKey = "plane" | "fog" | "stack" | "orbit";

const SCENES: { key: SceneKey; label: string; note: string }[] = [
  { key: "plane", label: "Plane", note: "20×20 · storm · scars" },
  { key: "fog", label: "Fog", note: "20×20 · radius 2" },
  { key: "stack", label: "Stack", note: "8×8×8 · gravity" },
  { key: "orbit", label: "Orbit", note: "7×7×7 · free" },
];

const SHAPES_2D: Vec3[][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [2, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [1, 1, 0],
    [1, 2, 0],
  ],
];
const SHAPES_3D: Vec3[][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [1, 1, 0],
  ],
];

function rotate(shape: Vec3[], turns: number): Vec3[] {
  let out = shape;
  for (let k = 0; k < turns % 4; k++) out = out.map(([x, y, z]) => [-y, x, z] as Vec3);
  const mx = Math.min(...out.map((c) => c[0]));
  const my = Math.min(...out.map((c) => c[1]));
  return out.map(([x, y, z]) => [x - mx, y - my, z] as Vec3);
}

function makeScenario(key: SceneKey, shape: BoardShape, seed: number): Scenario {
  switch (key) {
    case "plane":
      return planeScenario({ seed, shape, storm: true });
    case "fog":
      return planeScenario({ seed: seed + 3, shape, fog: true, storm: false });
    case "stack":
      return stackScenario(seed + 4);
    case "orbit":
      return orbitScenario(seed + 1);
  }
}

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === "undefined" ? "" : location.search);
}

declare global {
  interface Window {
    __lab?: {
      place(): void;
      node(): void;
      shatter(): void;
      storm(): void;
      misfire(): void;
      hover(cell: number | null): void;
      measureFps(ms?: number): Promise<number>;
      ready: boolean;
    };
  }
}

function measureFps(ms = 3000): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = (t: number) => {
      frames++;
      if (t - start < ms) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (t - start));
    };
    requestAnimationFrame(tick);
  });
}

/** Dev playground for the Night board: fabricated games, simulated events, a ghost that follows the pointer. */
export function Lab() {
  const p = params();
  const [scene, setScene] = useState<SceneKey>(() => (SCENES.some((s) => s.key === p.get("scene")) ? (p.get("scene") as SceneKey) : "plane"));
  const [shape, setShape] = useState<BoardShape>(() => (p.get("shape") as BoardShape) || "square");
  const [quality, setQuality] = useState<QualityTier | "auto">(() => (p.get("quality") as QualityTier) || "auto");
  const [reduced, setReduced] = useState(p.get("reduced") === "1");
  const [preset, setPreset] = useState<CameraPreset>(() => (p.get("camera") as CameraPreset) || "iso");
  const [showAttach, setShowAttach] = useState(p.get("attach") !== "0");
  const [shatterMode, setShatterMode] = useState(false);
  const [layerCut, setLayerCut] = useState<number | null>(null);
  const [panel, setPanel] = useState(p.get("ui") !== "0");
  const [seed, setSeed] = useState(() => Number(p.get("seed") ?? 7));
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [turns, setTurns] = useState(0);
  const [shapeIdx, setShapeIdx] = useState(0);
  const [charge, setCharge] = useState(2);
  const [fps, setFps] = useState<number | null>(null);
  const [lastPlaced, setLastPlaced] = useState<number[]>([]);
  const [misfire, setMisfire] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  const scenario = useRef<Scenario>(makeScenario(scene, shape, seed));
  const events = useRef<GameEvent[]>([]);
  const random = useRef(rng(seed * 97 + 1));
  const chargeRef = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [moteTarget, setMoteTarget] = useState<[number, number]>([-0.86, 0.82]);

  useEffect(() => {
    scenario.current = makeScenario(scene, shape, seed);
    events.current = [];
    random.current = rng(seed * 97 + 1);
    setLastPlaced([]);
    setMisfire([]);
    setLayerCut(null);
    setTick((t) => t + 1);
  }, [scene, shape, seed]);

  const view = useMemo(
    () => scenarioView(scenario.current, events.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );
  const is3D = view.config.dims[2] > 1;
  const seat = view.ply % view.config.seats;

  const apply = useCallback((evs: GameEvent[]) => {
    events.current = evs;
    const placed = evs.find((e) => e.type === "placed");
    if (placed && placed.type === "placed") setLastPlaced(placed.cells);
    const mis = evs.find((e) => e.type === "misfire");
    setMisfire(mis && mis.type === "misfire" ? mis.cells : []);
    const nodes = evs.filter((e) => e.type === "node").length;
    if (nodes) window.setTimeout(() => setCharge((c) => Math.min(9, c + nodes)), 1300);
    setTick((t) => t + 1);
  }, []);

  const actions = useMemo(
    () => ({
      place: () => apply(simulatePlace(scenario.current, random.current)),
      node: () => apply(simulateNodeGrab(scenario.current, random.current, seat)),
      shatter: () => apply(simulateShatter(scenario.current, random.current, seat)),
      storm: () => apply(simulateStorm(scenario.current)),
      misfire: () => apply(simulateMisfire(scenario.current, random.current, seat)),
    }),
    [apply, seat],
  );

  useEffect(() => {
    window.__lab = {
      ...actions,
      hover: (cell) => setHover(cell === null ? null : { cell }),
      measureFps: async (ms) => {
        const v = await measureFps(ms);
        setFps(v);
        return v;
      },
      ready: true,
    };
  }, [actions]);

  // Keep motes aimed at the charge counter.
  useEffect(() => {
    const update = () => {
      const el = chargeRef.current;
      const st = stage.current;
      if (!el || !st) return;
      const a = el.getBoundingClientRect();
      const b = st.getBoundingClientRect();
      const cx = a.left + a.width / 2 - b.left;
      const cy = a.top + a.height / 2 - b.top;
      setMoteTarget([(cx / b.width) * 2 - 1, -((cy / b.height) * 2 - 1)]);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [panel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "r") setTurns((t) => t + 1);
      else if (e.key === "p") actions.place();
      else if (e.key === "s") actions.shatter();
      else if (e.key === "t") actions.storm();
      else if (e.key === "m") actions.misfire();
      else if (e.key === "n") actions.node();
      else if (e.key === "h") setPanel((v) => !v);
      else if (e.key === "1") setPreset("iso");
      else if (e.key === "2") setPreset("top");
      else if (e.key === "3") setPreset("side");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  useEffect(() => {
    if (p.get("fps") !== "1") return;
    const id = window.setTimeout(() => void measureFps(3000).then(setFps), 2500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const shapeCells = useMemo(() => {
    const set = is3D ? SHAPES_3D : SHAPES_2D;
    return rotate(set[shapeIdx % set.length]!, turns);
  }, [is3D, shapeIdx, turns]);

  const ghost = useMemo<BoardGhost | null>(() => {
    if (!hover || shatterMode) return null;
    const g = ghostAt(view, hover.cell, shapeCells);
    return { cells: g.cells, seat, valid: g.valid };
  }, [hover, view, shapeCells, seat, shatterMode]);

  const attach = useMemo(() => (showAttach && !shatterMode ? attachPoints(view, seat) : undefined), [showAttach, shatterMode, view, seat]);
  const targets = useMemo(() => {
    if (!shatterMode) return undefined;
    const out: number[] = [];
    view.cells.forEach((o, i) => {
      if (o >= 1 && o <= 4 && o !== seat + 1 && !(view.flags[i]! & FLAG.CORE)) out.push(i);
    });
    return out;
  }, [shatterMode, view, seat]);

  const onSelect = useCallback(
    (t: SelectInfo) => {
      if (t.button === 2) {
        setTurns((v) => v + 1);
        return;
      }
      const s = scenario.current;
      if (shatterMode) {
        const o = s.board.cells[t.cell]!;
        if (o >= 1 && o <= 4 && o !== seat + 1) {
          s.board.cells[t.cell] = OWNER.SCAR;
          apply([{ type: "shattered", seat, cell: t.cell, victim: o - 1 }]);
          setShatterMode(false);
        }
        return;
      }
      const g = ghostAt(view, t.cell, shapeCells);
      if (!g.valid) return;
      const evs: GameEvent[] = [{ type: "placed", seat, piece: 0, cells: g.cells, leap: false, spark: false, hidden: false }];
      for (const c of g.cells) {
        if (s.board.flags[c]! & FLAG.NODE) {
          s.board.flags[c]! &= ~FLAG.NODE;
          evs.push({ type: "node", seat, cell: c });
        }
        s.board.cells[c] = seat + 1;
      }
      s.ply++;
      apply(evs);
    },
    [view, shapeCells, seat, shatterMode, apply],
  );

  const onHover = useCallback((t: HoverInfo | null) => setHover(t), []);

  return (
    <div style={styles.root}>
      <style>{css}</style>
      <div ref={stage} style={styles.stage}>
        <BoardScene
          view={view}
          ghost={ghost}
          marks={{ attach, targets, lastPlaced, misfire }}
          selectedSeat={seat}
          onHover={onHover}
          onSelect={onSelect}
          quality={quality === "auto" ? undefined : quality}
          reducedMotion={reduced}
          layerCut={layerCut}
          cameraPreset={preset}
          moteTarget={moteTarget}
          key={`${quality}-${scene}`}
        />
      </div>

      <header className="lab-hud">
        <div className="lab-brand">
          <span className="lab-mark" />
          cubes <em>lab</em>
        </div>
        <div className="lab-turn">
          <span className="lab-dot" style={{ background: SEAT_HEX[seat] }} />
          <span className="lab-eyebrow">ply {view.ply}</span>
          <span className="lab-hand">{shatterMode ? "pick a victim" : "your move"}</span>
        </div>
        <div className="lab-charge" ref={chargeRef} title="charge">
          <span className="lab-gem">◆</span>
          {charge}
        </div>
      </header>

      {fps !== null && (
        <div className="lab-fps" data-testid="fps">
          {fps.toFixed(0)} fps · {(1000 / fps).toFixed(1)} ms
        </div>
      )}

      <button className="lab-toggle" onClick={() => setPanel((v) => !v)} aria-label={panel ? "hide panel" : "lab panel"}>
        {panel ? "hide" : "lab"}
      </button>

      {panel && (
        <aside className="lab-panel" data-testid="lab-panel">
          <section>
            <div className="lab-eyebrow">scene</div>
            <div className="lab-row">
              {SCENES.map((s) => (
                <button key={s.key} className={`lab-chip ${scene === s.key ? "on" : ""}`} onClick={() => setScene(s.key)} title={s.note}>
                  {s.label}
                </button>
              ))}
            </div>
            {!is3D && (
              <div className="lab-row">
                {(["square", "octagon", "cross", "diamond"] as BoardShape[]).map((s) => (
                  <button key={s} className={`lab-chip small ${shape === s ? "on" : ""}`} onClick={() => setShape(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="lab-eyebrow">simulate</div>
            <div className="lab-row">
              <button className="lab-btn" onClick={actions.place}>
                place <kbd>p</kbd>
              </button>
              <button className="lab-btn" onClick={actions.node}>
                node <kbd>n</kbd>
              </button>
              <button className="lab-btn" onClick={actions.shatter}>
                shatter <kbd>s</kbd>
              </button>
              <button className="lab-btn" onClick={actions.storm}>
                storm <kbd>t</kbd>
              </button>
              <button className="lab-btn" onClick={actions.misfire}>
                misfire <kbd>m</kbd>
              </button>
              <button className={`lab-btn ${shatterMode ? "on" : ""}`} onClick={() => setShatterMode((v) => !v)}>
                aim shatter
              </button>
              <button className="lab-btn" onClick={() => setSeed((s) => s + 1)}>
                reset
              </button>
            </div>
          </section>
          <section>
            <div className="lab-eyebrow">piece · right-click or r to rotate</div>
            <div className="lab-row">
              {(is3D ? SHAPES_3D : SHAPES_2D).map((_, i) => (
                <button key={i} className={`lab-chip small ${shapeIdx === i ? "on" : ""}`} onClick={() => setShapeIdx(i)}>
                  {is3D ? ["tri L", "screw", "tee"][i] : ["L", "S", "T5"][i]}
                </button>
              ))}
              <label className="lab-check">
                <input type="checkbox" checked={showAttach} onChange={(e) => setShowAttach(e.target.checked)} /> attach marks
              </label>
            </div>
          </section>
          <section>
            <div className="lab-eyebrow">view</div>
            <div className="lab-row">
              {(["iso", "top", "side"] as CameraPreset[]).map((c) => (
                <button key={c} className={`lab-chip small ${preset === c ? "on" : ""}`} onClick={() => setPreset(c)}>
                  {c}
                </button>
              ))}
              <span className="lab-sep" />
              {(["auto", "low", "medium", "high"] as const).map((qv) => (
                <button key={qv} className={`lab-chip small ${quality === qv ? "on" : ""}`} onClick={() => setQuality(qv)}>
                  {qv}
                </button>
              ))}
            </div>
            <div className="lab-row">
              <label className="lab-check">
                <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion
              </label>
              {is3D && (
                <label className="lab-check">
                  slice
                  <input
                    type="range"
                    min={0}
                    max={view.config.dims[2]}
                    value={layerCut === null ? view.config.dims[2] : layerCut}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLayerCut(v >= view.config.dims[2] ? null : v);
                    }}
                  />
                  <span className="lab-eyebrow">{layerCut === null ? "all" : `z ≤ ${layerCut}`}</span>
                </label>
              )}
              <button className="lab-btn" onClick={() => void measureFps(3000).then(setFps)}>
                measure fps
              </button>
            </div>
          </section>
          <footer className="lab-foot">
            hover {hover ? hover.cell : "none"}
            {hover?.normal ? ` · n ${hover.normal.join(",")}` : ""} · drag to orbit · double-tap empty space to recentre
          </footer>
        </aside>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { position: "fixed", inset: 0, background: "#0f0e0c", color: "#efe7da", overflow: "hidden" },
  stage: { position: "absolute", inset: 0 },
};

const css = `
.lab-hud { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 18px; padding: 18px 22px; pointer-events: none; font-family: "Hanken Grotesk Variable", "Hanken Grotesk", system-ui, sans-serif; }
.lab-brand { font-family: "Newsreader Variable", Georgia, serif; font-size: 22px; letter-spacing: -0.01em; color: #f4ece0; display: flex; align-items: center; gap: 10px; }
.lab-brand em { font-style: italic; color: #e2683c; }
.lab-mark { width: 12px; height: 12px; border-radius: 3px; background: linear-gradient(135deg, #e2683c, #e9b949); box-shadow: 0 0 14px #e2683c88; transform: rotate(45deg); }
.lab-turn { display: flex; align-items: center; gap: 10px; }
.lab-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 12px currentColor; }
.lab-hand { font-family: Caveat, cursive; font-size: 22px; color: #e9d9bd; transform: rotate(-2deg); }
.lab-charge { order: -1; margin-right: 6px; display: flex; align-items: center; gap: 6px; font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 15px; color: #fff1d0; padding: 6px 11px; border-radius: 999px; border: 1px solid #3a3127; background: #17140fcc; backdrop-filter: blur(8px); }
.lab-gem { color: #ffe3a8; text-shadow: 0 0 10px #ffd27a; }
.lab-eyebrow { font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: #8a7a62; }
.lab-fps { position: absolute; top: 20px; right: 22px; font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 12px; color: #c9b998; padding: 6px 10px; border: 1px solid #2a241c; border-radius: 8px; background: #15120ecc; }
.lab-toggle { position: absolute; right: 18px; bottom: 18px; z-index: 3; font: 500 12px "JetBrains Mono Variable", ui-monospace, monospace; letter-spacing: 0.1em; text-transform: uppercase; color: #efe7da; background: #1a1611e6; border: 1px solid #3a3127; border-radius: 999px; padding: 8px 14px; cursor: pointer; }
.lab-panel { position: absolute; left: 18px; bottom: 18px; width: min(440px, calc(100vw - 36px)); max-height: calc(100vh - 110px); overflow: auto; display: flex; flex-direction: column; gap: 14px; padding: 16px 16px 12px; border-radius: 16px; border: 1px solid #2c251d; background: linear-gradient(180deg, #1a1611ee, #120f0cee); backdrop-filter: blur(14px); box-shadow: 0 30px 80px #0009, inset 0 1px 0 #ffffff0d; font-family: "Hanken Grotesk Variable", "Hanken Grotesk", system-ui, sans-serif; z-index: 2; }
.lab-panel section { display: flex; flex-direction: column; gap: 8px; }
.lab-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lab-chip, .lab-btn { font: 500 13px "Hanken Grotesk Variable", system-ui, sans-serif; color: #e9dfcf; background: #221d17; border: 1px solid #342c22; border-radius: 9px; padding: 6px 11px; cursor: pointer; transition: background .15s, border-color .15s, color .15s; }
.lab-chip.small { font-size: 12px; padding: 4px 9px; }
.lab-chip:hover, .lab-btn:hover { border-color: #5a4a36; background: #2a231b; }
.lab-chip.on, .lab-btn.on { color: #1a120b; background: #e9b949; border-color: #e9b949; }
.lab-btn kbd { font: 10px "JetBrains Mono Variable", monospace; color: #8a7a62; margin-left: 4px; }
.lab-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #cbbfab; }
.lab-check input[type=range] { width: 110px; accent-color: #e2683c; }
.lab-check input[type=checkbox] { accent-color: #e2683c; }
.lab-sep { width: 1px; height: 18px; background: #342c22; margin: 0 4px; }
.lab-foot { font: 11px "JetBrains Mono Variable", monospace; color: #6f6250; border-top: 1px dashed #2c251d; padding-top: 10px; }
@media (max-width: 640px) {
  .lab-hud { padding: 14px 14px; gap: 12px; }
  .lab-brand { font-size: 18px; }
  .lab-hand { display: none; }
  .lab-panel { left: 10px; right: 10px; bottom: 10px; width: auto; max-height: 42vh; padding: 12px; gap: 10px; }
  .lab-toggle { bottom: auto; top: 14px; right: 14px; }
  .lab-fps { top: 56px; right: 14px; }
}
`;
