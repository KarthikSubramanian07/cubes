/**
 * The daily board: one seeded game a day, the same for everyone, against
 * Flare. The mode rotates through the week so Tuesdays feel like Tuesdays.
 * Only your first finished attempt counts, and it shares as a tiny grid.
 */
import type { PresetName, View } from "@/engine/types";

/** Day #1. */
export const DAILY_EPOCH = "2026-11-01";
export const DAILY_OPPONENT = { level: "flare", name: "Flare" } as const;

/** Monday first, matching getUTCDay() rotated by one. */
const ROTATION: readonly PresetName[] = ["duel", "fog", "storm", "torus", "pure", "duel", "stack"];

export const DAILY_TITLES: Partial<Record<PresetName, string>> = {
  duel: "Duel",
  fog: "Fog",
  storm: "Storm",
  torus: "Torus",
  pure: "Pure",
  stack: "Stack · 3D",
};

/** Today's date in UTC, "YYYY-MM-DD". Everyone's daily flips at the same moment. */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isDay(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function dailyNumber(day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DAILY_EPOCH}T00:00:00Z`)) / 86400000) + 1;
}

export function dailyPreset(day: string): PresetName {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return ROTATION[(dow + 6) % 7]!;
}

/** A stable seed below 2^53 from the date: FNV-1a twice, high and low halves. */
export function dailySeed(day: string): number {
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  return (fnv(`cubes:hi:${day}`) & 0x1fffff) * 2 ** 32 + fnv(`cubes:lo:${day}`);
}

const YOU = "🟧";
const THEM = "🟦";
const EMPTY = "⬜";
const DEAD = "⬛";

/**
 * The final board as a small emoji grid, seen from above. Each emoji covers a
 * block of cells and shows whoever holds most of it.
 */
export function shareGrid(view: View, me: number, maxSide = 7): string {
  const [w, h, d] = view.config.dims;
  const top = (x: number, y: number): number => {
    for (let z = d - 1; z >= 0; z--) {
      const o = view.cells[x + y * w + z * w * h]!;
      if (o !== 0) return o;
    }
    return 0;
  };
  const block = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const rows: string[] = [];
  for (let by = 0; by < h; by += block) {
    let row = "";
    for (let bx = 0; bx < w; bx += block) {
      let mine = 0;
      let theirs = 0;
      let dead = 0;
      let n = 0;
      for (let y = by; y < Math.min(h, by + block); y++) {
        for (let x = bx; x < Math.min(w, bx + block); x++) {
          const o = top(x, y);
          n++;
          if (o === me + 1) mine++;
          else if (o >= 1 && o <= 4) theirs++;
          else if (o !== 0) dead++;
        }
      }
      // A block is someone's when they hold at least half of it.
      const need = Math.ceil(n / 2);
      row += mine >= need && mine >= theirs ? YOU : theirs >= need ? THEM : dead > n / 2 ? DEAD : EMPTY;
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export interface DailyShare {
  day: string;
  outcome: "win" | "loss" | "tie";
  score: number;
  opponent: number;
  grid: string;
}

export function shareText(r: DailyShare, origin = "https://playcubes.pages.dev"): string {
  const verb = r.outcome === "win" ? "beat Flare" : r.outcome === "tie" ? "tied Flare" : "lost to Flare";
  const title = DAILY_TITLES[dailyPreset(r.day)] ?? "Duel";
  return [`cubes daily #${dailyNumber(r.day)} · ${title}`, `${verb} ${r.score}–${r.opponent}`, "", r.grid, "", `${origin}/daily`].join("\n");
}
