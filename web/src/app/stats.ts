/**
 * Your record against the bots, kept in this browser only. Solo games (one
 * human, the rest bots) count; pass-and-play and online games don't, since
 * there's no telling who "you" were.
 */
import type { AiLevel } from "@/engine/types";

export type Outcome = "win" | "loss" | "tie";

export interface LevelRecord {
  win: number;
  loss: number;
  tie: number;
}

export interface Stats {
  v: 1;
  played: number;
  /** Highest score in any counted game. */
  best: number;
  /** Current run of wins, any opponent. */
  streak: number;
  bestStreak: number;
  byLevel: Record<AiLevel, LevelRecord>;
  /** Daily challenge results by UTC day ("2026-11-02"). */
  daily: Record<string, DailyResult>;
}

export interface DailyResult {
  outcome: Outcome;
  score: number;
  opponent: number;
  /** A tiny picture of the final board, for sharing. */
  grid: string;
}

export interface GameResult {
  /** The strongest bot in the game; that's who you beat (or didn't). */
  level: AiLevel;
  outcome: Outcome;
  score: number;
}

const KEY = "cubes:stats:v1";

export function emptyStats(): Stats {
  const r = (): LevelRecord => ({ win: 0, loss: 0, tie: 0 });
  return { v: 1, played: 0, best: 0, streak: 0, bestStreak: 0, byLevel: { ember: r(), flare: r(), nova: r() }, daily: {} };
}

export function loadStats(storage: Pick<Storage, "getItem"> | null = safeStorage()): Stats {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyStats();
    const s = JSON.parse(raw) as Partial<Stats>;
    if (s.v !== 1) return emptyStats();
    const base = emptyStats();
    return { ...base, ...s, byLevel: { ...base.byLevel, ...s.byLevel }, daily: { ...s.daily } };
  } catch {
    return emptyStats();
  }
}

export function saveStats(s: Stats, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: the record just doesn't persist */
  }
}

/** Fold one finished game into the record. Pure; returns a new object. */
export function addResult(s: Stats, r: GameResult): Stats {
  const lvl = { ...s.byLevel[r.level], [r.outcome]: s.byLevel[r.level][r.outcome] + 1 };
  const streak = r.outcome === "win" ? s.streak + 1 : 0;
  return {
    ...s,
    played: s.played + 1,
    best: Math.max(s.best, r.score),
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
    byLevel: { ...s.byLevel, [r.level]: lvl },
  };
}

export function addDaily(s: Stats, day: string, r: DailyResult): Stats {
  if (s.daily[day]) return s; // first attempt counts
  return { ...s, daily: { ...s.daily, [day]: r } };
}

/** Consecutive days, ending today or yesterday, with a daily result. */
export function dailyStreak(s: Stats, today: string): number {
  let n = 0;
  let d = new Date(`${today}T00:00:00Z`);
  if (!s.daily[today]) d = new Date(d.getTime() - 86400000);
  while (s.daily[d.toISOString().slice(0, 10)]) {
    n++;
    d = new Date(d.getTime() - 86400000);
  }
  return n;
}

export function totals(s: Stats): LevelRecord {
  const t = { win: 0, loss: 0, tie: 0 };
  for (const r of Object.values(s.byLevel)) {
    t.win += r.win;
    t.loss += r.loss;
    t.tie += r.tie;
  }
  return t;
}

/** A short, honest line about how it's going against one bot. */
export function verdict(s: Stats, level: AiLevel, name: string): string | null {
  const r = s.byLevel[level];
  const n = r.win + r.loss + r.tie;
  if (n < 2) return null;
  if (s.streak >= 3) return `${s.streak} wins in a row. ${name} would like a word.`;
  if (r.win === 0) return `0 for ${n} against ${name}. It's beatable, promise.`;
  if (r.loss === 0) return `Unbeaten against ${name}: ${r.win} for ${n}.`;
  return `You and ${name}: ${plural(r.win, "win")}, ${plural(r.loss, "loss", "losses")}${r.tie ? `, ${plural(r.tie, "tie")}` : ""}.`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
