/**
 * Shared helpers for the sound lab, tests and the e2e check: fire any cue by
 * name with one bag of parameters, and render cues offline for inspection.
 */
import { CUE_NAMES, createSound, type CueName, type Sound } from "./sound";

export interface CueParams {
  size: number;
  seat: number;
  pan: number;
  combo: number;
  /** charge(n) */
  charge: number;
  /** tick(secondsLeft) */
  seconds: number;
  /** turnStart(isYou) */
  isYou: boolean;
  /** uiToggle(on) */
  on: boolean;
}

export const DEFAULT_CUE_PARAMS: Readonly<CueParams> = Object.freeze({
  size: 4,
  seat: 0,
  pan: 0,
  combo: 0,
  charge: 3,
  seconds: 4,
  isYou: true,
  on: true,
});

/** Call `name` on `sound` with whichever params it takes. */
export function fireCue(sound: Sound, name: CueName, p: CueParams = DEFAULT_CUE_PARAMS): void {
  switch (name) {
    case "select":
      return sound.select(p.size);
    case "place":
      return sound.place({ size: p.size, seat: p.seat, combo: p.combo, pan: p.pan });
    case "node":
      return sound.node({ pan: p.pan });
    case "shatter":
      return sound.shatter({ pan: p.pan });
    case "charge":
      return sound.charge(p.charge);
    case "dark":
      return sound.dark(p.seat);
    case "turnStart":
      return sound.turnStart(p.isYou);
    case "tick":
      return sound.tick(p.seconds);
    case "uiToggle":
      return sound.uiToggle(p.on);
    default:
      return sound[name]();
  }
}

/** How long to render each cue offline, in seconds (tail of the reverb included). */
export const CUE_SECONDS: Record<CueName, number> = {
  hover: 0.4,
  rotate: 0.6,
  flip: 0.7,
  select: 1,
  place: 3.2,
  invalid: 0.8,
  node: 2,
  charge: 1.6,
  spark: 1.8,
  leap: 1.9,
  shatter: 1.9,
  scan: 2.4,
  misfire: 0.9,
  stormWarn: 3.2,
  storm: 4,
  dark: 2.8,
  turnStart: 2.6,
  tick: 0.8,
  win: 4.4,
  lose: 4,
  join: 1.5,
  leave: 1.5,
  chat: 0.8,
  uiClick: 0.4,
  uiToggle: 0.6,
};

export interface RenderResult {
  name: CueName;
  /** Peak absolute sample value across both channels. */
  peak: number;
  rms: number;
  /** Downsampled |amplitude| envelope for drawing (max per bucket). */
  envelope: Float32Array;
  seconds: number;
}

/**
 * Render one cue into an OfflineAudioContext through the full master bus.
 * Returns null where OfflineAudioContext is unavailable (jsdom, SSR).
 */
export async function renderCue(
  name: CueName,
  params: CueParams = DEFAULT_CUE_PARAMS,
  { sampleRate = 22050, buckets = 160, seed = 1 }: { sampleRate?: number; buckets?: number; seed?: number } = {},
): Promise<RenderResult | null> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return null;
  const seconds = CUE_SECONDS[name];
  const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  let x = seed;
  const random = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  const sound = createSound({ context: ctx, storage: null, prefs: { volume: 1, muted: false, music: false }, random });
  fireCue(sound, name, params);
  const buf = await ctx.startRendering();
  sound.dispose();
  return analyse(name, buf, buckets);
}

export function analyse(name: CueName, buf: AudioBuffer, buckets: number): RenderResult {
  const len = buf.length;
  const env = new Float32Array(buckets);
  let peak = 0;
  let sum = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const v = Math.abs(d[i]!);
      sum += v * v;
      if (v > peak) peak = v;
      const b = Math.min(buckets - 1, Math.floor((i / len) * buckets));
      if (v > env[b]!) env[b] = v;
    }
  }
  return { name, peak, rms: Math.sqrt(sum / (len * buf.numberOfChannels)), envelope: env, seconds: buf.duration };
}

export { CUE_NAMES };
