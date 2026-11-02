/**
 * /game/local: versus bots, pass-and-play, or watch bots. The setup comes
 * from router state (the play hub) or from the query string, e.g.
 * /game/local?preset=duel&seats=human,nova
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import "@fontsource/caveat/500.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import { getKit, getPreset, loadEngine, validateConfig } from "@/engine/engine";
import type { AiLevel, GameConfig, Kit, PresetName } from "@/engine/types";
import { SEAT_NAMES } from "@/engine/types";
import { SoundProvider, useSound } from "@/audio";
import type { GameSetup } from "@/app/setup";
import { LocalMatch, type LocalSeat, type MatchSnapshot } from "./LocalMatch";
import { GameScreen } from "./GameScreen";

export interface LocalSetup {
  preset: PresetName;
  config?: GameConfig;
  seats: LocalSeat[];
}

const PRESETS: PresetName[] = ["plane", "duel", "pure", "fog", "storm", "torus", "teams", "stack", "orbit"];
const LEVELS: AiLevel[] = ["ember", "flare", "nova"];
const LEVEL_NAMES: Record<AiLevel, string> = { ember: "Ember", flare: "Flare", nova: "Nova" };

export const PRESET_TITLES: Record<PresetName, string> = {
  plane: "Plane",
  duel: "Duel",
  pure: "Pure",
  fog: "Fog",
  storm: "Storm",
  torus: "Torus",
  teams: "Teams",
  stack: "Stack · 3D",
  orbit: "Orbit · 3D",
};

/** Parse `?preset=duel&seats=human,flare,nova&names=Ana,,` into a setup. */
export function setupFromQuery(search: string): LocalSetup {
  const q = new URLSearchParams(search);
  const preset = (PRESETS.includes(q.get("preset") as PresetName) ? q.get("preset") : "duel") as PresetName;
  const kinds = (q.get("seats") ?? "human,flare").split(",").slice(0, 4);
  const names = (q.get("names") ?? "").split(",");
  const seats: LocalSeat[] = kinds.map((k, i) => {
    const level = LEVELS.includes(k as AiLevel) ? (k as AiLevel) : null;
    return level
      ? { kind: "bot", level, name: `${LEVEL_NAMES[level]}` }
      : { kind: "human", name: names[i] || (kinds.filter((x) => x === "human").length > 1 ? SEAT_NAMES[i]! : "You") };
  });
  while (seats.length < 2) seats.push({ kind: "bot", level: "flare", name: "Flare" });
  return { preset, seats };
}

/** Convert the play hub's GameSetup (one bot level or null per seat) into seats. */
export function fromHubSetup(g: GameSetup): LocalSetup {
  const humans = g.bots.filter((b) => b === null).length;
  const seats: LocalSeat[] = g.bots.map((level, i) => {
    if (level) return { kind: "bot", level, name: LEVEL_NAMES[level] };
    const first = g.bots.indexOf(null) === i;
    // Pass & play: the hub calls the other seats by their colours, so the
    // first seat does too unless its player typed a name.
    const named = g.name && g.name !== "Player" ? g.name : SEAT_NAMES[i]!;
    return { kind: "human", name: first && humans === 1 ? "You" : first ? named : SEAT_NAMES[i]! };
  });
  return { preset: g.preset, config: g.config, seats };
}

function configFor(setup: LocalSetup): GameConfig {
  const base = setup.config ?? getPreset(setup.preset, setup.seats.length);
  // Presets like Teams fix their seat count; pad with bots to match.
  return base;
}

function padSeats(seats: LocalSeat[], n: number): LocalSeat[] {
  const out = seats.slice(0, n);
  while (out.length < n) out.push({ kind: "bot", level: "flare", name: "Flare" });
  // Unique bot names: "Flare", "Flare II"...
  const seen = new Map<string, number>();
  return out.map((s) => {
    const c = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, c);
    return c > 1 ? { ...s, name: `${s.name} ${"I".repeat(c)}` } : s;
  });
}

export default function LocalGamePage() {
  return (
    <SoundProvider>
      <LocalGame />
    </SoundProvider>
  );
}

function LocalGame() {
  const location = useLocation();
  const navigate = useNavigate();
  const sound = useSound();
  const setup = useMemo<LocalSetup>(() => {
    const given = (location.state as { setup?: GameSetup | LocalSetup } | null)?.setup;
    if (given && "bots" in given) return fromHubSetup(given);
    return given ?? setupFromQuery(location.search);
  }, [location.state, location.search]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [match, setMatch] = useState<LocalMatch | null>(null);
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const [kit, setKit] = useState<Kit | null>(null);

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setFailure(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const config = configFor(setup);
    const err = validateConfig(config);
    if (err) {
      setFailure(err);
      return;
    }
    const m = new LocalMatch({ config, seats: padSeats(setup.seats, config.seats) });
    setKit(getKit(config.kit));
    setMatch(m);
    // A new setup (or StrictMode's double run) must not leave the old match's
    // engine and bot worker running in the background.
    return () => m.dispose();
  }, [ready, setup]);

  // Subscribe to whichever match is current; dispose it on unmount.
  const current = useRef<LocalMatch | null>(null);
  useEffect(() => {
    if (!match) return;
    current.current = match;
    return match.subscribe(setSnap);
  }, [match]);
  useEffect(() => () => current.current?.dispose(), []);

  useEffect(() => {
    document.title = `${PRESET_TITLES[setup.preset]} · cubes`;
  }, [setup.preset]);

  if (failure) {
    return (
      <div className="game paper" style={{ placeItems: "center", display: "grid" }}>
        <div className="g-sheet">
          <p className="g-hand">well, this is awkward</p>
          <h2>The board wouldn't load.</h2>
          <p>{failure}</p>
          <button className="g-btn-ghost" onClick={() => navigate("/play")}>
            Back to the lobby
          </button>
        </div>
      </div>
    );
  }
  if (!match || !snap || !kit) {
    return <div className="game paper g-board-loading">sharpening pencils…</div>;
  }

  return (
    <GameScreen
      title={PRESET_TITLES[setup.preset]}
      view={snap.view}
      kit={kit}
      seat={snap.perspective}
      canAct={snap.canAct}
      seats={snap.seats}
      thinking={snap.thinking}
      handoff={snap.handoff}
      onAcceptHandoff={() => match.acceptHandoff()}
      legal={(leap) => match.legal(leap)}
      submit={async (a) => match.act(a)}
      undoable={snap.undoable}
      onUndo={() => match.undo()}
      onRematch={() => {
        setMatch(match.rematch());
      }}
      onResign={() => match.resign()}
      onLeave={() => navigate("/play")}
      sound={sound}
    />
  );
}
