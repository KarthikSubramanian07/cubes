import { DEFAULT_CUE_PARAMS, fireCue } from "./lab";
import { CUE_NAMES, createSound, installUnlock, volumeToGain, type CreateSoundOptions } from "./sound";
import { MAX_VOICES } from "./synth";
import { MockAudioContext, MockOscillator, asContext, memoryStorage } from "./testing/mockAudioContext";

function setup(mock = new MockAudioContext(), extra: CreateSoundOptions = {}) {
  let t = 1000;
  const clock = { advance: (ms: number) => (t += ms) };
  const sound = createSound({
    context: asContext(mock),
    storage: memoryStorage(),
    now: () => t,
    random: () => 0.5,
    prefs: { music: false, muted: false, volume: 0.7 },
    ...extra,
  });
  return { sound, mock, clock };
}

const sourcesOf = (m: MockAudioContext) => m.count("oscillator") + m.count("bufferSource");

describe("without an AudioContext (SSR / jsdom)", () => {
  test("jsdom really has no AudioContext", () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
  });

  test("every cue and setter is a silent no-op", async () => {
    const s = createSound({ storage: null });
    expect(s.getSettings().state).toBe("locked");
    for (const name of CUE_NAMES) expect(() => fireCue(s, name)).not.toThrow();
    expect(() => {
      s.setVolume(0.2);
      s.setMuted(true);
      s.setMuted(false);
      s.setMusic(true);
      s.setIntensity(0.9);
    }).not.toThrow();
    await expect(s.unlock()).resolves.toBe(false);
    expect(s.getSettings().state).toBe("unavailable");
    for (const name of CUE_NAMES) expect(() => fireCue(s, name)).not.toThrow();
    expect(s.stats().played).toBe(0);
    s.dispose();
  });

  test("a throwing context constructor is survivable", async () => {
    const s = createSound({
      storage: null,
      createContext: () => {
        throw new Error("nope");
      },
    });
    await expect(s.unlock()).resolves.toBe(false);
    expect(s.getSettings().state).toBe("unavailable");
    expect(() => s.place({ size: 3, seat: 0 })).not.toThrow();
  });
});

describe("with a suspended context", () => {
  test("cues schedule nothing until unlocked", () => {
    const { sound, mock } = setup(new MockAudioContext({ state: "suspended", resumable: false }));
    const before = sourcesOf(mock);
    for (const name of CUE_NAMES) expect(() => fireCue(sound, name)).not.toThrow();
    expect(sourcesOf(mock)).toBe(before);
    expect(sound.stats().played).toBe(0);
  });

  test("unlock resumes inside the gesture and plays a silent buffer (iOS)", async () => {
    const { sound, mock } = setup(new MockAudioContext({ state: "suspended" }));
    const ok = await sound.unlock();
    expect(ok).toBe(true);
    expect(mock.resumeCalls).toBe(1);
    expect(mock.count("bufferSource")).toBeGreaterThanOrEqual(1);
    expect(sound.getSettings().state).toBe("running");
    sound.place({ size: 3, seat: 1 });
    expect(sound.stats().played).toBe(1);
  });

  test("unlock reports false when autoplay stays blocked", async () => {
    const { sound } = setup(new MockAudioContext({ state: "suspended", resumable: false }));
    await expect(sound.unlock()).resolves.toBe(false);
  });

  test("unlock creates the context lazily via the factory", async () => {
    const mock = new MockAudioContext({ state: "suspended" });
    let made = 0;
    const s = createSound({ storage: null, createContext: () => (made++, asContext(mock)), prefs: { music: false } });
    expect(made).toBe(0);
    await s.unlock();
    await s.unlock();
    expect(made).toBe(1);
    expect(s.getSettings().state).toBe("running");
  });
});

describe("with a running context", () => {
  test.each(CUE_NAMES)("%s schedules sound without throwing", (name) => {
    const { sound, mock } = setup();
    const before = sourcesOf(mock);
    expect(() => fireCue(sound, name)).not.toThrow();
    expect(sound.stats().played).toBe(1);
    expect(sourcesOf(mock)).toBeGreaterThan(before);
    for (const s of mock.sources) expect(s.started && s.stopped).toBe(true);
  });

  test("cues tolerate junk arguments", () => {
    const { sound } = setup();
    expect(() => {
      sound.place({ size: Number.NaN, seat: -7, combo: Infinity, pan: 99 });
      sound.select(0);
      sound.charge(-3);
      sound.tick(Number.NaN);
      sound.tick(0);
      sound.dark(12);
      sound.node({ pan: Number.NaN });
    }).not.toThrow();
  });

  test("works without StereoPannerNode", () => {
    const { sound, mock } = setup(new MockAudioContext({ noPanner: true }));
    expect(() => sound.place({ size: 5, seat: 2, pan: 0.5 })).not.toThrow();
    expect(mock.count("panner")).toBe(0);
  });

  test("pan creates a panner set to the board position", () => {
    const { sound, mock } = setup();
    sound.shatter({ pan: -0.6 });
    expect(mock.count("panner")).toBeGreaterThan(0);
  });

  test("hover is rate limited", () => {
    const { sound, clock } = setup();
    sound.hover();
    sound.hover();
    sound.hover();
    expect(sound.stats().played).toBe(1);
    clock.advance(20);
    sound.hover();
    expect(sound.stats().played).toBe(1);
    clock.advance(30);
    sound.hover();
    expect(sound.stats().played).toBe(2);
    expect(sound.stats().skipped).toBe(3);
  });

  test("rate limits are per cue", () => {
    const { sound } = setup();
    sound.hover();
    sound.uiClick();
    sound.place({ size: 2, seat: 0 });
    expect(sound.stats().played).toBe(3);
  });

  test("voices are released when sources end", () => {
    const { sound, mock } = setup();
    sound.place({ size: 5, seat: 3, combo: 3 });
    expect(sound.stats().voices).toBeGreaterThan(0);
    mock.finishAll();
    expect(sound.stats().voices).toBe(0);
  });

  test("the voice cap drops cues instead of piling up", () => {
    const { sound, clock } = setup();
    for (let i = 0; i < 60; i++) {
      sound.place({ size: 5, seat: i % 4, combo: 4 });
      clock.advance(20);
    }
    // One cue may straddle the cap, but never more.
    expect(sound.stats().voices).toBeLessThan(MAX_VOICES + 40);
    expect(sound.stats().skipped).toBeGreaterThan(0);
  });

  test("muted means no work at all", () => {
    const { sound, mock } = setup();
    sound.setMuted(true);
    const before = sourcesOf(mock);
    sound.place({ size: 4, seat: 0 });
    sound.win();
    expect(sourcesOf(mock)).toBe(before);
  });

  test("volume drives the master gain on a perceptual curve", () => {
    const { sound, mock } = setup();
    sound.setVolume(0.5);
    const gains = mock.created.filter((n) => n.kind === "gain") as unknown as { gain: { value: number } }[];
    expect(gains.some((g) => Math.abs(g.gain.value - volumeToGain(0.5)) < 1e-9)).toBe(true);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
  });

  test("subscribers hear about changes and get stable snapshots", () => {
    const { sound } = setup();
    const seen: number[] = [];
    const off = sound.subscribe(() => seen.push(sound.getSettings().volume));
    const a = sound.getSettings();
    expect(sound.getSettings()).toBe(a);
    sound.setVolume(0.1);
    sound.setIntensity(0.5);
    off();
    sound.setVolume(0.9);
    expect(seen).toEqual([0.1, 0.1]);
    expect(sound.getSettings().intensity).toBe(0.5);
  });

  test("dispose silences everything", () => {
    const { sound, mock } = setup();
    sound.dispose();
    const before = sourcesOf(mock);
    sound.place({ size: 3, seat: 0 });
    expect(sourcesOf(mock)).toBe(before);
    expect(() => sound.dispose()).not.toThrow();
  });
});

describe("music bed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("starts and stops with the music setting", () => {
    const { sound, mock } = setup();
    const before = mock.count("oscillator");
    sound.setMusic(true);
    const pad = mock.count("oscillator") - before;
    expect(pad).toBeGreaterThanOrEqual(3);
    expect(pad).toBeLessThanOrEqual(6);
    // Scheduler keeps ticking without errors as time passes.
    for (let i = 0; i < 60; i++) {
      mock.currentTime += 0.2;
      vi.advanceTimersByTime(200);
    }
    sound.setIntensity(1);
    for (let i = 0; i < 60; i++) {
      mock.currentTime += 0.2;
      vi.advanceTimersByTime(200);
    }
    sound.setMusic(false);
    const oscs = mock.created.filter((n): n is MockOscillator => n instanceof MockOscillator);
    expect(oscs.slice(0, pad + before).every((o) => o.stopped)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    sound.dispose();
  });

  test("schedules bells over time, more of them when intense", () => {
    const run = (intensity: number) => {
      const { sound, mock } = setup();
      sound.setIntensity(intensity);
      sound.setMusic(true);
      const base = sourcesOf(mock);
      for (let i = 0; i < 300; i++) {
        mock.currentTime += 0.2;
        vi.advanceTimersByTime(200);
      }
      sound.dispose();
      return sourcesOf(mock) - base;
    };
    const calm = run(0);
    const intense = run(1);
    expect(calm).toBeGreaterThan(0);
    expect(intense).toBeGreaterThan(calm);
  });

  test("mute pauses the bed and unmute resumes it", () => {
    const { sound, mock } = setup();
    sound.setMusic(true);
    sound.setMuted(true);
    expect(vi.getTimerCount()).toBe(0);
    const before = mock.count("oscillator");
    sound.setMuted(false);
    expect(mock.count("oscillator")).toBeGreaterThan(before);
    sound.dispose();
  });

  test("music waits for unlock", async () => {
    const mock = new MockAudioContext({ state: "suspended" });
    const { sound } = setup(mock, { prefs: { music: true } });
    expect(mock.count("oscillator")).toBe(0);
    await sound.unlock();
    expect(mock.count("oscillator")).toBeGreaterThanOrEqual(3);
    sound.dispose();
  });
});

describe("installUnlock", () => {
  test("unlocks on the first gesture and detaches cleanly", async () => {
    const mock = new MockAudioContext({ state: "suspended" });
    const { sound } = setup(mock);
    const target = new EventTarget();
    const off = installUnlock(sound, target);
    target.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(mock.resumeCalls).toBe(1);
    expect(sound.getSettings().state).toBe("running");
    off();
    await mock.suspend();
    target.dispatchEvent(new Event("keydown"));
    expect(mock.resumeCalls).toBe(1);
  });

  test("is a no-op without a target", () => {
    const { sound } = setup();
    expect(() => installUnlock(sound, undefined)()).not.toThrow();
  });
});

test("default params cover every cue", () => {
  expect(DEFAULT_CUE_PARAMS.size).toBeGreaterThan(0);
  expect(CUE_NAMES.length).toBe(25);
});
