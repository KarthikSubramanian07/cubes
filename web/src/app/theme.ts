import { useEffect, useSyncExternalStore } from "react";

/** The user's stored preference. "system" follows prefers-color-scheme. */
export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "cubes:theme";

const listeners = new Set<() => void>();
let forcedNight = 0;

function media(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return media()?.matches ? "dark" : "light";
}

function paint(): void {
  if (typeof document === "undefined") return;
  const theme: Theme = forcedNight > 0 ? "dark" : resolveTheme(readThemePref());
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", theme === "dark" ? "#0f0e0c" : "#f2eee5");
}

function emit(): void {
  paint();
  for (const l of listeners) l();
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: the choice just won't persist */
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq = media();
  const onChange = () => emit();
  mq?.addEventListener?.("change", onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener?.("change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => `${readThemePref()}|${resolveTheme(readThemePref())}`;

export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void; toggle: () => void } {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "system|light");
  const [pref, theme] = snap.split("|") as [ThemePref, Theme];
  return {
    pref,
    theme,
    setPref: setThemePref,
    toggle: () => setThemePref(theme === "dark" ? "light" : "dark"),
  };
}

/** The game route is always night, whatever the shell theme says. */
export function useForceNight(): void {
  useEffect(() => {
    forcedNight++;
    paint();
    return () => {
      forcedNight--;
      paint();
    };
  }, []);
}
