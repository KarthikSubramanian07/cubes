import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./SoundBoard.css";
import { DEFAULT_CUE_PARAMS, fireCue, renderCue, type CueParams, type RenderResult } from "./lab";
import { useSound, useSoundSettings } from "./SoundProvider";
import type { CueName } from "./sound";
import { SEAT_MODES } from "./theory";

/** Seat accents for the lab only; the game's palette lives with the renderer. */
const SEAT_HEX = ["#d9825b", "#5fb3b0", "#e6c15a", "#9b8cf0"] as const;

interface CueInfo {
  name: CueName;
  blurb: string;
  /** Which params change this cue (so we know when to re-render its waveform). */
  uses?: (keyof CueParams)[];
}

const GROUPS: { title: string; note: string; cues: CueInfo[] }[] = [
  {
    title: "Shards",
    note: "the hands",
    cues: [
      { name: "hover", blurb: "a tick so small it's almost a thought" },
      { name: "rotate", blurb: "quarter turn" },
      { name: "flip", blurb: "mirror, with air" },
      { name: "select", blurb: "pick from the tray; bigger is lower", uses: ["size"] },
      { name: "place", blurb: "the chord. seat picks the mode, size the shine", uses: ["size", "seat", "combo", "pan"] },
      { name: "invalid", blurb: "doesn't fit. a soft no" },
    ],
  },
  {
    title: "Arena",
    note: "surges",
    cues: [
      { name: "node", blurb: "covered a node: sparkle up", uses: ["pan"] },
      { name: "charge", blurb: "charge counter, rising with n", uses: ["charge"] },
      { name: "spark", blurb: "single cell, crackle" },
      { name: "leap", blurb: "whoosh, glide, land" },
      { name: "shatter", blurb: "glass fracture into scar", uses: ["pan"] },
      { name: "scan", blurb: "radar sweep through the fog" },
      { name: "misfire", blurb: "placed into the unseen" },
    ],
  },
  {
    title: "Weather",
    note: "the board itself",
    cues: [
      { name: "stormWarn", blurb: "the ring is about to go" },
      { name: "storm", blurb: "rumble and crumble" },
      { name: "dark", blurb: "a seat goes out", uses: ["seat"] },
    ],
  },
  {
    title: "Turns",
    note: "flow",
    cues: [
      { name: "turnStart", blurb: "your move (or theirs)", uses: ["isYou"] },
      { name: "tick", blurb: "turn clock; urgent under five", uses: ["seconds"] },
      { name: "win", blurb: "most of the board" },
      { name: "lose", blurb: "next one, then" },
    ],
  },
  {
    title: "Room",
    note: "people & chrome",
    cues: [
      { name: "join", blurb: "someone sat down" },
      { name: "leave", blurb: "someone stood up" },
      { name: "chat", blurb: "a message" },
      { name: "uiClick", blurb: "buttons" },
      { name: "uiToggle", blurb: "switches, up or down", uses: ["on"] },
    ],
  },
];

const ALL_CUES = GROUPS.flatMap((g) => g.cues);

function dbfs(peak: number): string {
  if (peak <= 0) return "−∞ dB";
  return `${(20 * Math.log10(peak)).toFixed(1).replace("-", "−")} dB`;
}

function Wave({ result, color }: { result: RenderResult | null | undefined; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = c.clientWidth || 200;
    const h = c.clientHeight || 36;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const env = result?.envelope;
    const mid = h / 2;
    if (!env || !result || result.peak <= 0) {
      g.fillStyle = "rgba(237,230,216,0.12)";
      g.fillRect(0, mid - 0.5, w, 1);
      return;
    }
    const n = env.length;
    const bw = w / n;
    // Fixed scale (not normalized) so loudness differences between cues read honestly.
    const scale = 1 / Math.max(0.35, result.peak);
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const v = Math.sqrt(Math.min(1, env[i]! * scale)); // sqrt: show quiet tails
      const bh = Math.max(1, v * (h - 4));
      g.globalAlpha = 0.35 + 0.65 * v;
      g.fillRect(i * bw, mid - bh / 2, Math.max(1, bw - 0.6), bh);
    }
    g.globalAlpha = 1;
  }, [result, color]);
  return <canvas ref={ref} className="wave" aria-hidden />;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  testId?: string;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{props.label}</span>
        <output>{props.format ? props.format(props.value) : props.value}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        data-testid={props.testId}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={props.on ? "toggle on" : "toggle"}
      data-testid={props.testId}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="knob" />
      <span>{props.label}</span>
    </button>
  );
}

export interface SoundBoardProps {
  /** Render offline waveform thumbnails (on by default; the e2e suite turns them off to save CPU). */
  waveforms?: boolean;
}

export function SoundBoard({ waveforms = true }: SoundBoardProps = {}) {
  const sound = useSound();
  const settings = useSoundSettings();
  const [params, setParams] = useState<CueParams>({ ...DEFAULT_CUE_PARAMS });
  const [waves, setWaves] = useState<Partial<Record<CueName, RenderResult | null>>>({});
  const [firing, setFiring] = useState<Partial<Record<CueName, number>>>({});
  const [stats, setStats] = useState(sound.stats());
  const [lastFired, setLastFired] = useState<CueName | null>(null);
  const rendered = useRef(new Map<CueName, string>());

  const set = <K extends keyof CueParams>(k: K, v: CueParams[K]) => setParams((p) => ({ ...p, [k]: v }));
  const accent = SEAT_HEX[params.seat] ?? SEAT_HEX[0];

  useEffect(() => {
    const id = setInterval(() => setStats(sound.stats()), 200);
    return () => clearInterval(id);
  }, [sound]);

  // Offline-render waveforms: each cue re-renders only when a param it uses changes.
  useEffect(() => {
    const keyOf = (c: CueInfo) => (c.uses ?? []).map((u) => `${u}=${params[u]}`).join("&");
    if (!waveforms) return;
    const todo = ALL_CUES.filter((c) => rendered.current.get(c.name) !== keyOf(c));
    if (!todo.length) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        for (const c of todo) {
          if (cancelled) return;
          let r: RenderResult | null = null;
          try {
            r = await renderCue(c.name, params, { buckets: 120 });
          } catch {
            r = null;
          }
          if (cancelled) return;
          rendered.current.set(c.name, keyOf(c));
          setWaves((w) => ({ ...w, [c.name]: r }));
        }
      },
      rendered.current.size ? 180 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params, waveforms]);

  const fire = async (name: CueName) => {
    if (sound.getSettings().state !== "running") await sound.unlock();
    fireCue(sound, name, params);
    setFiring((f) => ({ ...f, [name]: (f[name] ?? 0) + 1 }));
    setLastFired(name);
  };

  const stateLabel = useMemo(() => {
    switch (settings.state) {
      case "running":
        return "live";
      case "locked":
        return "tap anything to wake";
      case "unavailable":
        return "no web audio here";
      default:
        return settings.state;
    }
  }, [settings.state]);

  const mode = SEAT_MODES[params.seat]!;

  return (
    <div className="lab" style={{ "--accent": accent } as CSSProperties}>
      <header className="lab-head">
        <p className="eyebrow">cubes / dev / sound lab</p>
        <h1>
          Every sound the board can make, <em>synthesized live.</em>
        </h1>
        <p className="lede">
          No audio files. Glass is inharmonic sine partials, the room is generated noise, and the four seats share one
          key in four modes so a crowded board still sounds like one piece.
        </p>
        <div className="status" data-testid="status">
          <span className={`pill ${settings.state}`} data-testid="ctx-state" data-state={settings.state}>
            <i />
            {stateLabel}
          </span>
          <span>
            voices <b data-testid="voices">{stats.voices}</b>
          </span>
          <span>
            played <b data-testid="played">{stats.played}</b>
          </span>
          <span>
            skipped <b>{stats.skipped}</b>
          </span>
          <span className="last">{lastFired ? `last: ${lastFired}` : "nothing yet"}</span>
        </div>
      </header>

      <div className="lab-body">
        <aside className="panel">
          <section>
            <h2>Master</h2>
            <Slider
              label="volume"
              value={settings.volume}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}`}
              onChange={(v) => sound.setVolume(v)}
              testId="volume"
            />
            <div className="row">
              <Toggle label="mute" on={settings.muted} onChange={(m) => sound.setMuted(m)} testId="mute" />
              <Toggle
                label="music"
                on={settings.music}
                onChange={(m) => {
                  void sound.unlock();
                  sound.setMusic(m);
                }}
                testId="music"
              />
            </div>
            <Slider
              label="intensity"
              value={settings.intensity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => (v < 0.34 ? "calm" : v < 0.67 ? "late game" : "storm")}
              onChange={(v) => sound.setIntensity(v)}
              testId="intensity"
            />
          </section>

          <section>
            <h2>Seat</h2>
            <div className="seats">
              {SEAT_MODES.map((m) => (
                <button
                  type="button"
                  key={m.seat}
                  className={params.seat === m.seat ? "seat on" : "seat"}
                  style={{ "--seat": SEAT_HEX[m.seat] } as CSSProperties}
                  aria-pressed={params.seat === m.seat}
                  data-testid={`seat-${m.seat}`}
                  onClick={() => set("seat", m.seat)}
                >
                  <i />
                  <span>{m.name}</span>
                  <small>{m.mode}</small>
                </button>
              ))}
            </div>
            <p className="hint">
              {mode.name} plays in {mode.mode}. Each combo step lifts the chord one degree.
            </p>
          </section>

          <section>
            <h2>Shard</h2>
            <div className="segmented" role="radiogroup" aria-label="shard size">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={params.size === n}
                  key={n}
                  className={params.size === n ? "on" : ""}
                  onClick={() => set("size", n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <Slider label="combo" value={params.combo} min={0} max={7} step={1} onChange={(v) => set("combo", v)} />
            <Slider
              label="pan (board x)"
              value={params.pan}
              min={-1}
              max={1}
              step={0.05}
              format={(v) => (Math.abs(v) < 0.03 ? "centre" : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`)}
              onChange={(v) => set("pan", v)}
              testId="pan"
            />
          </section>

          <section>
            <h2>Clock & charge</h2>
            <Slider label="charge n" value={params.charge} min={1} max={9} step={1} onChange={(v) => set("charge", v)} />
            <Slider
              label="seconds left"
              value={params.seconds}
              min={0}
              max={15}
              step={1}
              format={(v) => `${v}s`}
              onChange={(v) => set("seconds", v)}
            />
            <div className="row">
              <Toggle label="your turn" on={params.isYou} onChange={(v) => set("isYou", v)} />
              <Toggle label="toggle on" on={params.on} onChange={(v) => set("on", v)} />
            </div>
          </section>
        </aside>

        <main className="cues">
          {GROUPS.map((g) => (
            <section key={g.title} className="group">
              <h2>
                {g.title} <span>{g.note}</span>
              </h2>
              <div className="grid">
                {g.cues.map((c) => {
                  const w = waves[c.name];
                  const n = firing[c.name] ?? 0;
                  return (
                    <button
                      type="button"
                      key={c.name}
                      className="cue"
                      data-testid={`cue-${c.name}`}
                      onPointerEnter={() => sound.hover()}
                      onClick={() => void fire(c.name)}
                    >
                      <span className="cue-top">
                        <code>{c.name}()</code>
                        <span className="peak">{!waveforms ? "" : w ? dbfs(w.peak) : w === null ? "n/a" : "…"}</span>
                      </span>
                      <span className="blurb">{c.blurb}</span>
                      <Wave result={w} color={accent} />
                      {n > 0 && <span className="ring" key={n} />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="foot">
            Peaks are offline renders through the real master bus (compressor, limiter, reverb). Anything above −1 dB
            would be a bug.
          </p>
        </main>
      </div>
    </div>
  );
}
