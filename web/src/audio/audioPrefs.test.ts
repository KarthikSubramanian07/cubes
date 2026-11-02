import { AUDIO_PREFS_KEY, DEFAULT_AUDIO_PREFS, loadAudioPrefs, sanitizePrefs, saveAudioPrefs } from "./audioPrefs";
import { createSound } from "./sound";
import { memoryStorage } from "./testing/mockAudioContext";

describe("audio prefs", () => {
  test("defaults when nothing is stored", () => {
    expect(loadAudioPrefs(memoryStorage())).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
  });

  test("round-trips through storage under the versioned key", () => {
    const store = memoryStorage();
    saveAudioPrefs({ volume: 0.3, muted: true, music: false }, store);
    expect(JSON.parse(store.map.get(AUDIO_PREFS_KEY)!)).toEqual({ volume: 0.3, muted: true, music: false });
    expect(loadAudioPrefs(store)).toEqual({ volume: 0.3, muted: true, music: false });
  });

  test("survives corrupt or hostile data", () => {
    expect(loadAudioPrefs(memoryStorage({ [AUDIO_PREFS_KEY]: "{nope" }))).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizePrefs({ volume: 7, muted: "yes", music: null })).toEqual({ ...DEFAULT_AUDIO_PREFS, volume: 1 });
    expect(sanitizePrefs({ volume: -1 }).volume).toBe(0);
    expect(sanitizePrefs(42)).toEqual(DEFAULT_AUDIO_PREFS);
  });

  test("storage that throws is ignored", () => {
    const evil = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadAudioPrefs(evil)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => saveAudioPrefs(DEFAULT_AUDIO_PREFS, evil)).not.toThrow();
  });

  test("the sound engine persists every setting change", () => {
    const store = memoryStorage();
    const s = createSound({ storage: store });
    s.setVolume(0.25);
    s.setMuted(true);
    s.setMusic(false);
    expect(loadAudioPrefs(store)).toEqual({ volume: 0.25, muted: true, music: false });
    const again = createSound({ storage: store });
    expect(again.getSettings()).toMatchObject({ volume: 0.25, muted: true, music: false });
  });

  test("uses localStorage by default", () => {
    localStorage.removeItem(AUDIO_PREFS_KEY);
    const s = createSound();
    s.setVolume(0.4);
    expect(JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY)!).volume).toBe(0.4);
    localStorage.removeItem(AUDIO_PREFS_KEY);
  });
});
