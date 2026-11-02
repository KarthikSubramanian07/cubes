/**
 * `createSound()`: the one object the game talks to.
 *
 * Signal flow
 *
 *   cues  -> sfx bus ---+
 *   music -> music bus -+--> glue compressor -> limiter -> master -> out
 *   (per-voice sends) -> reverb in -> convolver -> reverb return -+
 *
 * Safety rules
 * - Never constructs an AudioContext until `unlock()` (a user gesture), so
 *   there are no autoplay warnings and it is inert under SSR / jsdom.
 * - Every cue is a no-op unless the context is actually running (or is an
 *   OfflineAudioContext being rendered), and never throws into game code.
 * - A voice cap drops cues instead of letting a burst choke the CPU.
 */
import {
  type AudioPrefs,
  type PrefsStorage,
  clamp01,
  loadAudioPrefs,
  saveAudioPrefs,
} from "./audioPrefs";
import * as cues from "./cues";
import type { PanArgs, PlaceArgs } from "./cues";
import { AmbientMusic } from "./music";
import { MAX_VOICES, Synth, isOfflineContext, makeImpulseResponse } from "./synth";

export type { PanArgs, PlaceArgs } from "./cues";

export type SoundState = AudioContextState | "interrupted" | "unavailable" | "locked";

export interface SoundSettings extends AudioPrefs {
  intensity: number;
  state: SoundState;
}

export interface SoundStats {
  /** Cues actually scheduled. */
  played: number;
  /** Cues skipped by rate limiting, mute, the voice cap, or a locked context. */
  skipped: number;
  /** Sources currently sounding. */
  voices: number;
}

export interface Sound {
  /** Call from a user gesture (pointerdown / keydown). iOS-safe. Resolves true once running. */
  unlock(): Promise<boolean>;
  setVolume(v: number): void;
  setMuted(muted: boolean): void;
  setMusic(on: boolean): void;
  /** 0..1, how restless the music bed is (late game, storm). */
  setIntensity(x: number): void;

  getSettings(): SoundSettings;
  subscribe(listener: () => void): () => void;
  stats(): SoundStats;
  /** Close the context and drop listeners. */
  dispose(): void;

  hover(): void;
  rotate(): void;
  flip(): void;
  select(size: number): void;
  place(args: PlaceArgs): void;
  invalid(): void;
  node(args?: PanArgs): void;
  charge(n: number): void;
  spark(): void;
  leap(): void;
  shatter(args?: PanArgs): void;
  scan(): void;
  misfire(): void;
  stormWarn(): void;
  storm(): void;
  dark(seat: number): void;
  turnStart(isYou: boolean): void;
  tick(secondsLeft: number): void;
  win(): void;
  lose(): void;
  join(): void;
  leave(): void;
  chat(): void;
  uiClick(): void;
  uiToggle(on?: boolean): void;
}

/** Every cue method name, in a stable order (used by the sound lab and tests). */
export const CUE_NAMES = [
  "hover",
  "rotate",
  "flip",
  "select",
  "place",
  "invalid",
  "node",
  "charge",
  "spark",
  "leap",
  "shatter",
  "scan",
  "misfire",
  "stormWarn",
  "storm",
  "dark",
  "turnStart",
  "tick",
  "win",
  "lose",
  "join",
  "leave",
  "chat",
  "uiClick",
  "uiToggle",
] as const satisfies readonly (keyof Sound)[];

export type CueName = (typeof CUE_NAMES)[number];

export interface CreateSoundOptions {
  /** Use this context instead of creating one (an OfflineAudioContext to render, or a mock). */
  context?: BaseAudioContext;
  /** Factory used by `unlock()` when no context was given. Return null if unsupported. */
  createContext?: () => BaseAudioContext | null;
  /** Where prefs persist. Defaults to localStorage; pass null to disable. */
  storage?: PrefsStorage | null;
  /** Millisecond clock for rate limiting. Defaults to performance.now. */
  now?: () => number;
  /** RNG for humanization. Defaults to Math.random. */
  random?: () => number;
  /** Initial prefs override (otherwise loaded from storage). */
  prefs?: Partial<AudioPrefs>;
}

/** Minimum gap between repeats of a cue, in ms. Everything else gets DEFAULT_GAP. */
const MIN_GAP_MS: Partial<Record<CueName, number>> = {
  hover: 45,
  rotate: 35,
  flip: 35,
  tick: 120,
  chat: 90,
  uiClick: 30,
  select: 30,
};
const DEFAULT_GAP = 16;

/** Perceptual volume: the slider feels linear to the ear. */
export function volumeToGain(v: number): number {
  const x = clamp01(v);
  return x * x;
}

function defaultCreateContext(): BaseAudioContext | null {
  const w = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface Graph {
  sfx: GainNode;
  music: GainNode;
  reverbIn: GainNode;
  master: GainNode;
  synth: Synth;
  ambient: AmbientMusic;
}

export function createSound(options: CreateSoundOptions = {}): Sound {
  const storage = options.storage;
  const now = options.now ?? defaultNow;
  const random = options.random ?? Math.random;
  const createContext = options.createContext ?? defaultCreateContext;

  let prefs: AudioPrefs = { ...loadAudioPrefs(storage), ...options.prefs };
  let intensity = 0;
  let ctx: BaseAudioContext | null = options.context ?? null;
  let graph: Graph | null = null;
  let disposed = false;
  let hidden = false;
  let unlocked = false;
  const last = new Map<CueName, number>();
  const listeners = new Set<() => void>();
  const stats = { played: 0, skipped: 0 };
  let snapshot: SoundSettings = makeSnapshot();

  function offline(): boolean {
    return !!ctx && isOfflineContext(ctx);
  }

  function state(): SoundState {
    if (!ctx) return disposed ? "closed" : unlocked ? "unavailable" : "locked";
    return ctx.state as SoundState;
  }

  function makeSnapshot(): SoundSettings {
    return { ...prefs, intensity, state: state() };
  }

  function emit(): void {
    snapshot = makeSnapshot();
    for (const l of listeners) {
      try {
        l();
      } catch {
        // listeners must not break audio
      }
    }
  }

  function persist(): void {
    saveAudioPrefs(prefs, storage);
  }

  function buildGraph(c: BaseAudioContext): Graph {
    const sfx = c.createGain();
    const music = c.createGain();
    music.gain.value = 0.55;
    const reverbIn = c.createGain();
    const convolver = c.createConvolver();
    convolver.buffer = makeImpulseResponse(c);
    const reverbOut = c.createGain();
    reverbOut.gain.value = 0.42;

    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.22;

    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.09;

    const master = c.createGain();
    master.gain.value = prefs.muted ? 0 : volumeToGain(prefs.volume);

    sfx.connect(glue);
    music.connect(glue);
    music.connect(reverbIn); // the bed lives inside the room
    reverbIn.connect(convolver).connect(reverbOut).connect(glue);
    glue.connect(limiter).connect(master).connect(c.destination);

    return {
      sfx,
      music,
      reverbIn,
      master,
      synth: new Synth(c, sfx, reverbIn, random),
      ambient: new AmbientMusic(c, music, reverbIn, random),
    };
  }

  function ensureGraph(): Graph | null {
    if (graph) return graph;
    if (!ctx) return null;
    try {
      graph = buildGraph(ctx);
    } catch {
      graph = null;
    }
    return graph;
  }

  function live(): boolean {
    if (disposed || !ctx) return false;
    return offline() || ctx.state === "running";
  }

  /** Bring the music bed in line with prefs, visibility and context state. */
  function syncMusic(): void {
    const g = graph;
    if (!g || offline()) return;
    const want = prefs.music && !prefs.muted && !hidden && live();
    try {
      if (want && !g.ambient.running) {
        g.ambient.start();
        g.ambient.setIntensity(intensity);
      } else if (!want && g.ambient.running) {
        g.ambient.stop();
      }
    } catch {
      // never let the bed break the game
    }
  }

  function applyMaster(): void {
    const g = graph;
    if (!g || !ctx) return;
    const target = prefs.muted ? 0 : volumeToGain(prefs.volume);
    try {
      g.master.gain.cancelScheduledValues(ctx.currentTime);
      g.master.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
    } catch {
      g.master.gain.value = target;
    }
  }

  function onStateChange(): void {
    syncMusic();
    emit();
  }

  function attach(c: BaseAudioContext): void {
    c.onstatechange = onStateChange;
  }

  // Pause the bed (and the whole context) while the tab is hidden.
  const onVisibility = (): void => {
    hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (!ctx || offline()) return;
    const live = ctx as AudioContext;
    if (hidden) {
      syncMusic();
      if (ctx.state === "running" && typeof live.suspend === "function") live.suspend().catch(() => {});
    } else if (unlocked && typeof live.resume === "function") {
      live.resume().then(syncMusic, () => {});
    }
  };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  if (ctx) {
    attach(ctx);
    ensureGraph();
  }

  function playSilentBuffer(c: BaseAudioContext): void {
    // iOS only truly unlocks once a source has started inside the gesture.
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.start(0);
      src.onended = () => src.disconnect();
    } catch {
      // ignore
    }
  }

  async function unlock(): Promise<boolean> {
    if (disposed) return false;
    unlocked = true;
    if (!ctx) {
      try {
        ctx = createContext();
      } catch {
        ctx = null;
      }
      if (!ctx) {
        emit();
        return false;
      }
      attach(ctx);
    }
    ensureGraph();
    if (offline()) return true;
    const c = ctx as AudioContext;
    if (c.state !== "running") {
      // Synchronous part runs inside the gesture: resume + silent buffer.
      const resumed = typeof c.resume === "function" ? c.resume() : Promise.resolve();
      playSilentBuffer(c);
      try {
        await resumed;
      } catch {
        // stays suspended; the next gesture will try again
      }
    }
    syncMusic();
    emit();
    return c.state === "running";
  }

  /** Wrap a cue recipe with gating, rate limiting and the voice cap. */
  function cue<A extends unknown[]>(name: CueName, recipe: (s: Synth, ...args: A) => void): (...args: A) => void {
    const gap = MIN_GAP_MS[name] ?? DEFAULT_GAP;
    return (...args: A) => {
      if (!live() || prefs.muted) {
        stats.skipped++;
        return;
      }
      const g = ensureGraph();
      if (!g) {
        stats.skipped++;
        return;
      }
      const t = now();
      const prev = last.get(name);
      if (prev !== undefined && t - prev < gap) {
        stats.skipped++;
        return;
      }
      if (g.synth.active >= MAX_VOICES) {
        stats.skipped++;
        return;
      }
      last.set(name, t);
      try {
        recipe(g.synth, ...args);
        stats.played++;
      } catch (err) {
        stats.skipped++;
        if (import.meta.env?.DEV) console.warn(`[audio] cue ${name} failed`, err);
      }
    };
  }

  return {
    unlock,
    setVolume(v) {
      prefs = { ...prefs, volume: clamp01(v) };
      persist();
      applyMaster();
      emit();
    },
    setMuted(m) {
      prefs = { ...prefs, muted: !!m };
      persist();
      applyMaster();
      syncMusic();
      emit();
    },
    setMusic(on) {
      prefs = { ...prefs, music: !!on };
      persist();
      syncMusic();
      emit();
    },
    setIntensity(x) {
      intensity = clamp01(x);
      try {
        graph?.ambient.setIntensity(intensity);
      } catch {
        // ignore
      }
      emit();
    },
    getSettings: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    stats: () => ({ ...stats, voices: graph?.synth.active ?? 0 }),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      try {
        graph?.ambient.stop(0.05);
      } catch {
        // ignore
      }
      const c = ctx as AudioContext | null;
      if (c && !options.context && typeof c.close === "function") c.close().catch(() => {});
      if (c) c.onstatechange = null;
      ctx = null;
      graph = null;
      emit();
      listeners.clear();
    },

    hover: cue("hover", cues.hover),
    rotate: cue("rotate", cues.rotate),
    flip: cue("flip", cues.flip),
    select: cue("select", cues.select),
    place: cue("place", cues.place),
    invalid: cue("invalid", cues.invalid),
    node: cue("node", (s, a?: PanArgs) => cues.node(s, a)),
    charge: cue("charge", cues.charge),
    spark: cue("spark", cues.spark),
    leap: cue("leap", cues.leap),
    shatter: cue("shatter", (s, a?: PanArgs) => cues.shatter(s, a)),
    scan: cue("scan", cues.scan),
    misfire: cue("misfire", cues.misfire),
    stormWarn: cue("stormWarn", cues.stormWarn),
    storm: cue("storm", cues.storm),
    dark: cue("dark", cues.dark),
    turnStart: cue("turnStart", cues.turnStart),
    tick: cue("tick", cues.tick),
    win: cue("win", cues.win),
    lose: cue("lose", cues.lose),
    join: cue("join", cues.join),
    leave: cue("leave", cues.leave),
    chat: cue("chat", cues.chat),
    uiClick: cue("uiClick", cues.uiClick),
    uiToggle: cue("uiToggle", (s, on?: boolean) => cues.uiToggle(s, on)),
  };
}

/**
 * Attach one-shot-ish unlock listeners for the first user gesture. They stay
 * attached (cheap: unlock() returns fast once running) so that iOS, which can
 * re-suspend after interruptions, recovers on the next tap.
 */
export function installUnlock(sound: Sound, target: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined = globalThis.window): () => void {
  if (!target) return () => {};
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const handler = (): void => {
    const s = sound.getSettings().state;
    if (s !== "running") void sound.unlock();
  };
  for (const e of events) target.addEventListener(e, handler, { capture: true, passive: true });
  return () => {
    for (const e of events) target.removeEventListener(e, handler, { capture: true });
  };
}
