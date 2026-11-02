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
import { addDaily, addResult, dailyStreak, loadStats, saveStats, verdict } from "@/app/stats";
import { DAILY_OPPONENT, DAILY_TITLES, dailyNumber, dailyPreset, dailySeed, isDay, shareGrid, shareText, todayUTC } from "@/app/daily";
import { soloResult } from "./result";

export interface LocalSetup {
  preset: PresetName;
  config?: GameConfig;
  seats: LocalSeat[];
  /** Fixed seed (the daily board); otherwise random. */
  seed?: number;
  /** The daily board's date, "YYYY-MM-DD". */
  daily?: string;
}

/** /daily (today) or /daily?day=2026-11-02 (an older board, for practice). */
export function dailySetup(search: string, today = todayUTC()): LocalSetup {
  const asked = new URLSearchParams(search).get("day");
  const day = isDay(asked) && asked <= today ? asked : today;
  return {
    preset: dailyPreset(day),
    seats: [{ kind: "human", name: "You" }, { kind: "bot", level: DAILY_OPPONENT.level, name: DAILY_OPPONENT.name }],
    seed: dailySeed(day),
    daily: day,
  };
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
  const isDaily = location.pathname.replace(/\/$/, "") === "/daily";
  const setup = useMemo<LocalSetup>(() => {
    if (isDaily) return dailySetup(location.search);
    const given = (location.state as { setup?: GameSetup | LocalSetup } | null)?.setup;
    if (given && "bots" in given) return fromHubSetup(given);
    return given ?? setupFromQuery(location.search);
  }, [location.state, location.search, isDaily]);
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
    const m = new LocalMatch({ config, seats: padSeats(setup.seats, config.seats), seed: setup.seed });
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

  // The daily counts once: the first game that finishes on today's board.
  const today = useMemo(() => todayUTC(), []);
  const [dailyDone] = useState(() => (setup.daily ? !!loadStats().daily[setup.daily] : false));
  const counts = !!setup.daily && setup.daily === today && !dailyDone;
  const onDailyBoard = !!setup.daily && (match ? match.isSeed(setup.seed!) : true);
  const title = setup.daily
    ? `Daily #${dailyNumber(setup.daily)} · ${DAILY_TITLES[setup.preset] ?? PRESET_TITLES[setup.preset]}${onDailyBoard && counts ? "" : " · practice"}`
    : PRESET_TITLES[setup.preset];
  const [share, setShare] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title} · cubes`;
  }, [title]);

  // Solo games against bots go on your record, once per match.
  const recorded = useRef<LocalMatch | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  useEffect(() => {
    if (!match || !snap || snap !== match.getSnapshot() || snap.view.phase !== "over" || recorded.current === match) return;
    recorded.current = match;
    const r = soloResult(snap);
    if (!r) return;
    let stats = addResult(loadStats(), r);
    let note = verdict(stats, r.level, LEVEL_NAMES[r.level]);
    if (setup.daily && match.isSeed(setup.seed!)) {
      const v = snap.view;
      const opponent = (v.scores ?? v.seats.map((x) => x.score ?? 0))[1] ?? 0;
      const result = { outcome: r.outcome, score: r.score, opponent, grid: shareGrid(v, 0) };
      if (counts) {
        stats = addDaily(stats, setup.daily, result);
        const streak = dailyStreak(stats, today);
        note = streak > 1 ? `${streak} dailies in a row. See you tomorrow.` : "That's today's daily done. New board at midnight UTC.";
      }
      const kept = stats.daily[setup.daily] ?? result;
      setShare(shareText({ day: setup.daily, ...kept }, window.location.origin));
      if (!counts) note = dailyDone ? "Practice round. Your first try today is the one that counts." : "Practice round on an older board.";
    }
    saveStats(stats);
    setResultNote(note);
  }, [match, snap]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setResultNote(null);
    setShare(null);
  }, [match]);

  if (failure) {
    return (
      <div className="game paper" style={{ placeItems: "center", display: "grid" }}>
        <div className="g-sheet">
          <p className="g-hand">something went wrong</p>
          <h2>The game couldn't load.</h2>
          <p>{failure}</p>
          <button className="g-btn-ghost" onClick={() => navigate("/play")}>
            Back to the lobby
          </button>
        </div>
      </div>
    );
  }
  if (!match || !snap || !kit) {
    return <div className="game paper g-board-loading">loading the board…</div>;
  }

  return (
    <GameScreen
      title={title}
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
      undoable={snap.undoable && !onDailyBoard}
      onUndo={() => match.undo()}
      onRematch={() => {
        setMatch(match.rematch());
      }}
      onResign={() => match.resign()}
      frames={() => match.frames()}
      resultNote={resultNote}
      shareText={share}
      rematchLabel={setup.daily ? "Practice round" : undefined}
      onLeave={() => navigate("/play")}
      sound={sound}
    />
  );
}
