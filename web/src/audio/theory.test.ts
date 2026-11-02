import {
  MAJOR,
  PARENT_TONIC,
  SEAT_MODES,
  padVoicing,
  pentatonicMidi,
  placeVoicing,
  seatMode,
  seatStepToMidi,
} from "./theory";

const parentPitchClasses = new Set(MAJOR.map((i) => (PARENT_TONIC + i) % 12));
const inKey = (m: number) => parentPitchClasses.has(((m % 12) + 12) % 12);

describe("seat to scale mapping", () => {
  test("every seat has its own mode and home degree", () => {
    expect(new Set(SEAT_MODES.map((m) => m.mode)).size).toBe(4);
    expect(new Set(SEAT_MODES.map((m) => m.degree)).size).toBe(4);
    expect(SEAT_MODES.map((m) => m.name)).toEqual(["Clay", "Tide", "Pollen", "Iris"]);
  });

  test("is deterministic: same inputs, same chord, every time", () => {
    for (let seat = 0; seat < 4; seat++)
      for (let size = 1; size <= 5; size++)
        for (let combo = 0; combo < 4; combo++) {
          expect(placeVoicing(seat, size, combo)).toEqual(placeVoicing(seat, size, combo));
        }
    // Pin the actual values so an accidental retune shows up in review.
    expect(placeVoicing(0, 3, 0).midi).toEqual([65, 68, 72]); // F dorian triad (F Ab C)
    expect(placeVoicing(2, 3, 0).midi).toEqual([68, 72, 75]); // Ab lydian triad (Ab C Eb)
  });

  test("seats start on different roots", () => {
    const roots = [0, 1, 2, 3].map((s) => seatStepToMidi(s, 0));
    expect(new Set(roots).size).toBe(4);
  });

  test("all chord tones stay in the shared parent key", () => {
    for (let seat = 0; seat < 4; seat++)
      for (let size = 1; size <= 5; size++)
        for (let combo = 0; combo < 9; combo++) {
          for (const m of placeVoicing(seat, size, combo).midi) expect(inKey(m)).toBe(true);
        }
  });

  test("seat index wraps and tolerates junk", () => {
    expect(seatMode(4)).toBe(seatMode(0));
    expect(seatMode(-1)).toBe(seatMode(3));
    expect(seatMode(Number.NaN)).toBe(seatMode(0));
  });

  test("combo raises the root by one scale step", () => {
    for (let seat = 0; seat < 4; seat++) {
      const a = placeVoicing(seat, 3, 0).midi[0]!;
      const b = placeVoicing(seat, 3, 1).midi[0]!;
      expect(b).toBe(seatStepToMidi(seat, 1));
      expect(b - a).toBeGreaterThanOrEqual(1);
      expect(b - a).toBeLessThanOrEqual(2);
    }
  });

  test("combo is capped at an octave", () => {
    expect(placeVoicing(1, 3, 50)).toEqual(placeVoicing(1, 3, 7));
  });

  test("bigger shards are richer, brighter and longer", () => {
    for (let size = 2; size <= 5; size++) {
      const a = placeVoicing(0, size - 1);
      const b = placeVoicing(0, size);
      expect(b.midi.length).toBeGreaterThanOrEqual(a.midi.length);
      expect(b.brightness).toBeGreaterThan(a.brightness);
      expect(b.duration).toBeGreaterThan(a.duration);
    }
  });

  test("pentatonic and pad stay in key", () => {
    for (let s = -5; s < 20; s++) expect(inKey(pentatonicMidi(s))).toBe(true);
    for (let c = 0; c < 8; c++) for (const m of padVoicing(c)) expect(inKey(m)).toBe(true);
    expect(pentatonicMidi(5) - pentatonicMidi(0)).toBe(12);
  });
});
