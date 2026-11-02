import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { AiLevel, BoardShape, GameConfig, PresetName } from "@/engine/types";
import { BOARD_SHAPES, PRESETS, PRESET_BY_NAME, presetConfig } from "@/app/presets";
import { normalizeRoomCode } from "@/app/roomCode";
import { AI_LABELS, AI_LEVELS, MAX_NAME, buildSetup, describeConfig, type GameSetup, type SetupKind } from "@/app/setup";
import { ArrowRight, Button } from "@/ui/Button";
import { HandNote } from "@/ui/HandNote";
import { ModeArt } from "@/ui/ModeArt";
import { Pill } from "@/ui/Pill";
import { SeatChip } from "@/ui/SeatChip";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Toggle } from "@/ui/Toggle";
import "./play.css";

export interface PlayHubProps {
  onStart: (setup: GameSetup) => void;
  /** Join an existing room by code. */
  onJoin: (code: string, name: string) => void;
  initialKind?: SetupKind;
  initialName?: string;
}

const KINDS: { kind: SetupKind; title: string; text: string; note: string }[] = [
  { kind: "online", title: "Online room", text: "Get a link to send to friends. They join from any browser, no install.", note: "2–4 players" },
  { kind: "bots", title: "Versus bots", text: "Play alone against the computer. Choose easy, medium or hard for each seat.", note: "start in seconds" },
  { kind: "local", title: "Pass & play", text: "Share one screen and take turns. Good for a table or a couch.", note: "one device" },
];

function KindIcon({ kind }: { kind: SetupKind }) {
  return (
    <svg className="kind__icon" viewBox="0 0 64 40" aria-hidden="true">
      {kind === "online" && (
        <>
          <rect x="4" y="12" width="16" height="16" rx="3" className="ki-a" />
          <rect x="44" y="12" width="16" height="16" rx="3" className="ki-b" />
          <path d="M22 18 C 30 10, 36 10, 42 18 M22 22 C 30 30, 36 30, 42 22" className="ki-line" />
        </>
      )}
      {kind === "bots" && (
        <>
          <rect x="6" y="12" width="16" height="16" rx="3" className="ki-a" />
          <rect x="22" y="28" width="10" height="10" rx="2" className="ki-c" />
          <rect x="40" y="6" width="18" height="18" rx="4" className="ki-bot" />
          <circle cx="45.5" cy="15" r="1.8" className="ki-eye" />
          <circle cx="52.5" cy="15" r="1.8" className="ki-eye" />
          <path d="M49 6 L49 2" className="ki-line" />
        </>
      )}
      {kind === "local" && (
        <>
          <rect x="14" y="6" width="36" height="26" rx="4" className="ki-screen" />
          <rect x="22" y="13" width="7" height="7" rx="1.5" className="ki-a" />
          <rect x="29" y="20" width="7" height="7" rx="1.5" className="ki-b" />
          <path d="M8 36 C 20 32, 44 32, 56 36" className="ki-line" />
        </>
      )}
    </svg>
  );
}

function Step({ n, title, children, aside }: { n: number; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section className="hub__step" aria-labelledby={id}>
      <header className="hub__step-head">
        <span className="hub__step-n num">{String(n).padStart(2, "0")}</span>
        <h2 id={id}>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

const TIMERS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 120, label: "2m" },
];

/** The play hub, presentational: everything it decides comes out through onStart / onJoin. */
export function PlayHub({ onStart, onJoin, initialKind = "online", initialName = "" }: PlayHubProps) {
  const [kind, setKind] = useState<SetupKind>(initialKind);
  const [preset, setPreset] = useState<PresetName>("plane");
  const [seats, setSeats] = useState<number>(PRESET_BY_NAME.plane.defaultSeats);
  const [overrides, setOverrides] = useState<Partial<GameConfig>>({});
  const [bots, setBots] = useState<(AiLevel | null)[]>([null, "flare", "flare", "flare"]);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const advId = useId();
  const nameId = useId();
  const codeId = useId();

  useEffect(() => setKind(initialKind), [initialKind]);

  const info = PRESET_BY_NAME[preset];
  const setup = useMemo(
    () => buildSetup({ kind, preset, seats, overrides, bots, name }),
    [kind, preset, seats, overrides, bots, name],
  );
  const config = setup.config;
  const is3d = info.dimension === "3d";

  function pickPreset(p: PresetName) {
    setPreset(p);
    setOverrides({});
    setSeats(PRESET_BY_NAME[p].defaultSeats);
  }

  function set<K extends keyof GameConfig>(key: K, value: GameConfig[K]) {
    setOverrides((o) => ({ ...o, [key]: value }));
  }

  function setSize(n: number) {
    set("dims", is3d ? [n, n, n] : [n, n, 1]);
  }

  function submitJoin() {
    const c = normalizeRoomCode(code);
    if (!c) {
      setCodeError("Room codes are five letters or digits, like K7QXM.");
      return;
    }
    setCodeError(null);
    onJoin(c, name);
  }

  const seatOptions = [2, 3, 4].map((n) => ({ value: n, label: `${n}`, disabled: !info.seats.includes(n) }));
  const startLabel = kind === "online" ? "Create room" : kind === "bots" ? "Start vs bots" : "Start pass & play";

  return (
    <div className="hub">
      <div className="hub__main">
        <Step n={1} title="How are you playing?">
          <div className="kinds" role="radiogroup" aria-label="How are you playing?">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                className="card card--interactive kind"
                onClick={() => setKind(k.kind)}
              >
                <KindIcon kind={k.kind} />
                <span className="kind__title">{k.title}</span>
                <span className="kind__text">{k.text}</span>
                <span className="kind__note hand" aria-hidden="true">
                  {k.note}
                </span>
              </button>
            ))}
          </div>
          {kind === "online" && (
            <form
              className="hub__join"
              onSubmit={(e) => {
                e.preventDefault();
                submitJoin();
              }}
            >
              <label htmlFor={codeId} className="hub__join-label">
                Got a code already?
              </label>
              <div className="hub__join-row">
                <input
                  id={codeId}
                  className="input input--mono"
                  placeholder="ABCDE"
                  value={code}
                  maxLength={64}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? `${codeId}-err` : undefined}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError(null);
                  }}
                />
                <Button type="submit" variant="ghost">
                  Join
                </Button>
              </div>
              {codeError && (
                <p id={`${codeId}-err`} className="hub__error" role="alert">
                  {codeError}
                </p>
              )}
            </form>
          )}
        </Step>

        <Step
          n={2}
          title="Pick a mode"
          aside={
            <HandNote className="hub__step-note annot" tilt={-4} size="sm" arrow="down-left">
              new here? try Duel
            </HandNote>
          }
        >
          <div className="presets" role="radiogroup" aria-label="Mode">
            {PRESETS.map((p) => {
              const c = presetConfig(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.name}
                  className="card card--interactive preset"
                  onClick={() => pickPreset(p.name)}
                >
                  <span className="preset__art">
                    <ModeArt mode={p.name} />
                  </span>
                  <span className="preset__name">
                    {p.label}
                    {p.dimension === "3d" && <Pill>3D</Pill>}
                  </span>
                  <span className="preset__blurb">{p.blurb}</span>
                  <span className="preset__dims mono">
                    {c.dims[2] > 1 ? `${c.dims[0]}×${c.dims[1]}×${c.dims[2]}` : `${c.dims[0]}×${c.dims[1]}`} · {p.seats.length === 1 ? `${p.seats[0]} seats` : `${p.seats[0]}–${p.seats[p.seats.length - 1]} seats`}
                  </span>
                </button>
              );
            })}
          </div>
        </Step>

        <Step n={3} title={kind === "bots" ? "Seats and bots" : "Seats"}>
          <div className="hub__seats">
            <div className="field">
              <span className="field__label" id={`${advId}-seats`}>
                Players
              </span>
              <SegmentedControl label="Number of seats" value={config.seats} onChange={(n) => setSeats(n)} options={seatOptions} />
              {info.seats.length === 1 && <p className="hub__hint">{info.label} is always {info.seats[0]} seats.</p>}
            </div>
            <div className="field">
              <label className="field__label" htmlFor={nameId}>
                Your name
              </label>
              <input
                id={nameId}
                className="input"
                placeholder="Player"
                value={name}
                maxLength={MAX_NAME}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <ul className="seatlist">
            {Array.from({ length: config.seats }, (_, i) => (
              <li key={i} className="seatlist__row">
                <SeatChip seat={i} label={i === 0 ? setup.name : kind === "bots" ? `${AI_LABELS[setup.bots[i] ?? "flare"].label} bot` : kind === "online" ? "open seat" : "next at the table"} />
                {kind === "bots" && i > 0 && (
                  <SegmentedControl
                    label={`Bot level for seat ${i + 1}`}
                    value={setup.bots[i] ?? "flare"}
                    onChange={(lvl) => setBots((b) => b.map((x, j) => (j === i ? lvl : x)))}
                    options={AI_LEVELS.map((l) => ({ value: l, label: AI_LABELS[l].label }))}
                  />
                )}
                {i === 0 && <span className="seatlist__you mono">you</span>}
              </li>
            ))}
          </ul>
          {kind === "bots" && (
            <p className="hub__hint">
              <strong>Ember</strong> {AI_LABELS.ember.note.toLowerCase()} <strong>Flare</strong> {AI_LABELS.flare.note.toLowerCase()}{" "}
              <strong>Nova</strong> {AI_LABELS.nova.note.toLowerCase()}
            </p>
          )}
        </Step>

        <section className="hub__adv" aria-labelledby={`${advId}-btn`}>
          <button
            id={`${advId}-btn`}
            type="button"
            className="hub__adv-btn"
            aria-expanded={advanced}
            aria-controls={advId}
            onClick={() => setAdvanced((a) => !a)}
          >
            <span>Advanced</span>
            <span className="hub__adv-sub">Board size, shape, fog, storm, teams, timer</span>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="hub__adv-chev">
              <path d="M5 7.6 C 7.4 10, 8.6 11.4, 10 12.8 C 11.6 11.2, 13 9.8, 15.2 7.4" />
            </svg>
          </button>
          <div id={advId} className="hub__adv-panel" hidden={!advanced}>
            <div className="knobs">
              <div className="field">
                <label className="field__label" htmlFor={`${advId}-size`}>
                  Board size <span className="knob__val num">{is3d ? `${config.dims[0]}³` : `${config.dims[0]}×${config.dims[1]}`}</span>
                </label>
                <input
                  id={`${advId}-size`}
                  type="range"
                  className="range"
                  min={is3d ? 4 : 8}
                  max={is3d ? 10 : 24}
                  value={config.dims[0]}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
              </div>
              {!is3d && (
                <div className="field">
                  <span className="field__label">Shape</span>
                  <SegmentedControl<BoardShape>
                    label="Board shape"
                    value={config.shape}
                    onChange={(v) => set("shape", v)}
                    options={BOARD_SHAPES.map((s) => ({ value: s, label: s }))}
                  />
                </div>
              )}
              <div className="field">
                <span className="field__label">Turn timer</span>
                <SegmentedControl
                  label="Turn timer"
                  value={config.turnSeconds ?? 0}
                  onChange={(v) => set("turnSeconds", v === 0 ? null : v)}
                  options={TIMERS}
                />
              </div>
              <div className="knob-col">
                <Toggle
                  checked={config.arena}
                  onChange={(v) => setOverrides((o) => ({ ...o, arena: v, nodes: v ? Math.max(o.nodes ?? presetConfig(preset).nodes, 8) : 0 }))}
                  label="Arena"
                  hint="Nodes, charge and surges"
                />
                {config.arena && (
                  <div className="field knob-sub">
                    <label className="field__label" htmlFor={`${advId}-nodes`}>
                      Nodes <span className="knob__val num">{config.nodes}</span>
                    </label>
                    <input id={`${advId}-nodes`} type="range" className="range" min={4} max={24} step={4} value={config.nodes} onChange={(e) => set("nodes", Number(e.target.value))} />
                  </div>
                )}
              </div>
              <div className="knob-col">
                <Toggle checked={config.fog !== null} onChange={(v) => set("fog", v ? 2 : null)} label="Fog of war" hint="See only near your own light" />
                {config.fog !== null && (
                  <div className="field knob-sub">
                    <label className="field__label" htmlFor={`${advId}-fog`}>
                      Vision radius <span className="knob__val num">{config.fog}</span>
                    </label>
                    <input id={`${advId}-fog`} type="range" className="range" min={1} max={4} value={config.fog} onChange={(e) => set("fog", Number(e.target.value))} />
                  </div>
                )}
              </div>
              <div className="knob-col">
                <Toggle
                  checked={config.storm !== null}
                  onChange={(v) => set("storm", v ? { start: 6, every: 3, minSpan: 8 } : null)}
                  label="Storm"
                  hint="The outer ring turns to ash"
                />
                {config.storm && (
                  <div className="knob-sub knob-pair">
                    <div className="field">
                      <label className="field__label" htmlFor={`${advId}-ss`}>
                        From round <span className="knob__val num">{config.storm.start}</span>
                      </label>
                      <input id={`${advId}-ss`} type="range" className="range" min={2} max={12} value={config.storm.start} onChange={(e) => set("storm", { ...config.storm!, start: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor={`${advId}-se`}>
                        Every <span className="knob__val num">{config.storm.every}</span>
                      </label>
                      <input id={`${advId}-se`} type="range" className="range" min={1} max={6} value={config.storm.every} onChange={(e) => set("storm", { ...config.storm!, every: Number(e.target.value) })} />
                    </div>
                  </div>
                )}
              </div>
              {!is3d && (
                <div className="knob-col">
                  <Toggle checked={config.topology === "torus"} onChange={(v) => set("topology", v ? "torus" : "flat")} label="Torus" hint="Edges wrap on both axes" />
                </div>
              )}
              <div className="knob-col">
                <Toggle
                  checked={config.teams}
                  onChange={(v) => {
                    setOverrides((o) => ({ ...o, teams: v, sharedLight: v }));
                    if (v) setSeats(4);
                  }}
                  disabled={!info.seats.includes(4)}
                  label="Teams"
                  hint="Seats 1+3 vs 2+4 (needs 4 seats)"
                />
                {config.teams && (
                  <div className="knob-sub">
                    <Toggle checked={config.sharedLight} onChange={(v) => set("sharedLight", v)} label="Shared light" hint="Link off your ally's corners" />
                  </div>
                )}
              </div>
            </div>
            <button type="button" className="hub__reset" onClick={() => setOverrides({})}>
              Reset to {info.label} defaults
            </button>
          </div>
        </section>
      </div>

      <aside className="hub__rail" aria-label="Summary">
        <div className="card summary">
          <p className="eyebrow eyebrow--plain">Your table</p>
          <h2 className="summary__title">
            {info.label} <em>{kind === "online" ? "online" : kind === "bots" ? "vs bots" : "pass & play"}</em>
          </h2>
          <div className="summary__art">
            <ModeArt mode={preset} />
          </div>
          <ul className="summary__chips" aria-label="Settings">
            {describeConfig(config).map((d) => (
              <li key={d}>
                <Pill>{d}</Pill>
              </li>
            ))}
          </ul>
          <Button size="lg" block iconRight={<ArrowRight />} onClick={() => onStart(setup)}>
            {startLabel}
          </Button>
          <HandNote className="summary__note annot" tilt={-5} arrow="up-left" size="sm">
            ready? start here
          </HandNote>
        </div>
      </aside>
    </div>
  );
}
