/** Where you are in the lesson, kept in localStorage so a reload doesn't send you back to chapter one. */
import { CHAPTERS } from "./chapters";

export const PROGRESS_KEY = "cubes:learn:v1";

export interface Progress {
  chapter: number;
  done: string[];
}

const EMPTY: Progress = { chapter: 0, done: [] };

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<Progress>;
    const ids = new Set(CHAPTERS.map((c) => c.id));
    const chapter = Number.isInteger(p.chapter) ? Math.min(Math.max(p.chapter!, 0), CHAPTERS.length - 1) : 0;
    const done = Array.isArray(p.done) ? p.done.filter((d): d is string => typeof d === "string" && ids.has(d)) : [];
    return { chapter, done };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress just won't stick */
  }
}
