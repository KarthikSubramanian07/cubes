/**
 * Persisted audio preferences. Tiny on purpose: three values in one
 * localStorage key, tolerant of missing storage (SSR, private mode, quota).
 */

export const AUDIO_PREFS_KEY = "cubes:audio:v1";

export interface AudioPrefs {
  /** Master volume, 0..1 (perceptual curve applied by the engine). */
  volume: number;
  muted: boolean;
  /** Ambient music bed on/off. */
  music: boolean;
}

export const DEFAULT_AUDIO_PREFS: Readonly<AudioPrefs> = Object.freeze({
  volume: 0.7,
  muted: false,
  music: true,
});

/** The subset of `Storage` we use, so tests can pass a plain object. */
export type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PrefsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    // Accessing localStorage throws in some sandboxed iframes.
    return null;
  }
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Coerce anything into valid prefs, falling back field by field. */
export function sanitizePrefs(raw: unknown): AudioPrefs {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    volume: typeof src.volume === "number" && Number.isFinite(src.volume) ? clamp01(src.volume) : DEFAULT_AUDIO_PREFS.volume,
    muted: typeof src.muted === "boolean" ? src.muted : DEFAULT_AUDIO_PREFS.muted,
    music: typeof src.music === "boolean" ? src.music : DEFAULT_AUDIO_PREFS.music,
  };
}

export function loadAudioPrefs(storage: PrefsStorage | null = defaultStorage()): AudioPrefs {
  if (!storage) return { ...DEFAULT_AUDIO_PREFS };
  try {
    const text = storage.getItem(AUDIO_PREFS_KEY);
    return text ? sanitizePrefs(JSON.parse(text)) : { ...DEFAULT_AUDIO_PREFS };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPrefs(prefs: AudioPrefs, storage: PrefsStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(AUDIO_PREFS_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    // Quota or privacy mode: settings just won't persist.
  }
}
