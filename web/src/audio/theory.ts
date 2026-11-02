/**
 * Pure music theory. No Web Audio in here, so it is trivially testable and
 * deterministic: the same seat, size and combo always give the same chord.
 *
 * Everything lives in one parent major key so four players placing at once
 * still sound like one piece. Each seat is a different *mode* of that key
 * (a different scale degree treated as home), which gives every colour its
 * own character without ever clashing:
 *
 *   Clay   (seat 0)  dorian      warm, earthy
 *   Tide   (seat 1)  aeolian     cool, a little wistful
 *   Pollen (seat 2)  lydian      bright, floating
 *   Iris   (seat 3)  mixolydian  open, airy
 */

/** Major scale intervals in semitones. */
export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** Parent tonic as MIDI note: Eb4. Warm, sits well under glassy partials. */
export const PARENT_TONIC = 63;

export interface SeatMode {
  seat: number;
  name: string;
  mode: string;
  /** Degree of the parent scale this seat treats as home (0-based). */
  degree: number;
}

export const SEAT_MODES: readonly SeatMode[] = Object.freeze([
  { seat: 0, name: "Clay", mode: "dorian", degree: 1 },
  { seat: 1, name: "Tide", mode: "aeolian", degree: 5 },
  { seat: 2, name: "Pollen", mode: "lydian", degree: 3 },
  { seat: 3, name: "Iris", mode: "mixolydian", degree: 4 },
]);

export function seatMode(seat: number): SeatMode {
  const n = SEAT_MODES.length;
  const i = Number.isFinite(seat) ? ((Math.trunc(seat) % n) + n) % n : 0;
  return SEAT_MODES[i]!;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** MIDI note for an absolute degree of the parent scale (may be negative or > 6). */
export function parentDegreeToMidi(degree: number, tonic = PARENT_TONIC): number {
  const d = Math.trunc(degree);
  const octave = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return tonic + octave * 12 + MAJOR[idx]!;
}

/** MIDI note `step` scale steps above the seat's modal home. */
export function seatStepToMidi(seat: number, step: number): number {
  return parentDegreeToMidi(seatMode(seat).degree + step);
}

export interface PlaceVoicing {
  /** Chord tones as MIDI notes, low to high. */
  midi: number[];
  /** 0..1, drives partial count, filter cutoff and attack sharpness. */
  brightness: number;
  /** Ring time in seconds. */
  duration: number;
}

const MAX_COMBO_STEPS = 7;

/**
 * The placement chime. Root sits on the seat's home, raised one scale step
 * per combo (capped at an octave). Bigger shards stack more chord tones,
 * ring longer and shine brighter.
 */
export function placeVoicing(seat: number, size: number, combo = 0): PlaceVoicing {
  const s = Math.max(1, Math.min(5, Math.round(Number.isFinite(size) ? size : 1)));
  const c = Math.max(0, Math.min(MAX_COMBO_STEPS, Math.floor(Number.isFinite(combo) ? combo : 0)));
  const stacks: Record<number, number[]> = {
    1: [0, 4],
    2: [0, 4],
    3: [0, 2, 4],
    4: [-7, 0, 2, 4],
    5: [-7, 0, 2, 4, 8],
  };
  const midi = stacks[s]!.map((step) => seatStepToMidi(seat, c + step));
  return {
    midi,
    brightness: 0.25 + (s - 1) * 0.17 + c * 0.02,
    duration: 0.9 + s * 0.35,
  };
}

/** Parent-key major pentatonic (degrees 1 2 3 5 6), for the ambient bells. */
export const PENTATONIC_DEGREES = [0, 1, 2, 4, 5] as const;

/** MIDI note for a pentatonic step (wraps across octaves). */
export function pentatonicMidi(step: number, tonic = PARENT_TONIC): number {
  const n = PENTATONIC_DEGREES.length;
  const s = Math.trunc(step);
  const octave = Math.floor(s / n);
  const idx = ((s % n) + n) % n;
  return parentDegreeToMidi(PENTATONIC_DEGREES[idx]!, tonic) + octave * 12;
}

/**
 * The pad's slow progression, as parent-scale degree roots:
 * I, vi, IV, ii. Voiced root, fifth, ninth for an open, unresolved shimmer.
 */
export const PAD_PROGRESSION = [0, 5, 3, 1] as const;

export function padVoicing(chordIndex: number, tonic = PARENT_TONIC - 12): number[] {
  const n = PAD_PROGRESSION.length;
  const root = PAD_PROGRESSION[((Math.trunc(chordIndex) % n) + n) % n]!;
  return [root, root + 4, root + 8].map((d) => parentDegreeToMidi(d, tonic));
}
