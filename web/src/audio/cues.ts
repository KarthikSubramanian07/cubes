/**
 * The sound of cubes. Every cue is a small recipe over the `Synth`
 * primitives. Rules of thumb that keep it "never annoying":
 *
 * - Frequent cues (hover, rotate, tick) are tiny, dry and quiet.
 * - Nothing harsh: squares and saws always go through a lowpass.
 * - Bad news is soft (a muted thunk, a falling tone), never a buzzer.
 * - Every cue humanizes a little (pitch, timing) so repeats don't fatigue.
 */
import type { Synth } from "./synth";
import { midiToHz, pentatonicMidi, placeVoicing, seatStepToMidi } from "./theory";

export interface PlaceArgs {
  /** Shard size in cells (1..5). */
  size: number;
  /** Seat index 0..3. */
  seat: number;
  /** Consecutive good moves; each raises the chord a scale step. */
  combo?: number;
  /** Stereo position from board x, -1..1. */
  pan?: number;
}

export interface PanArgs {
  pan?: number;
}

const hz = (midi: number) => midiToHz(midi);
const pent = (step: number) => midiToHz(pentatonicMidi(step));

export function hover(s: Synth): void {
  s.tone({
    freq: 2350 * s.rand(0.97, 1.03),
    attack: 0.001,
    decay: 0.028,
    peak: 0.022,
    wet: 0,
  });
}

export function rotate(s: Synth): void {
  s.tone({ freq: 880, glideTo: 1180, glideTime: 0.05, attack: 0.002, decay: 0.07, peak: 0.045, wet: 0.08 });
  s.noise({ attack: 0.001, decay: 0.025, peak: 0.03, filter: { type: "bandpass", freq: 3200, q: 2.2 }, wet: 0 });
}

export function flip(s: Synth): void {
  s.noise({
    attack: 0.02,
    decay: 0.09,
    peak: 0.06,
    filter: { type: "bandpass", freq: 1100, q: 1.6, to: 4200 },
    wet: 0.1,
  });
  s.tone({ freq: 760, glideTo: 540, attack: 0.004, decay: 0.11, peak: 0.04, type: "triangle", wet: 0.1 });
}

export function select(s: Synth, size: number): void {
  const n = Math.max(1, Math.min(5, Math.round(size) || 1));
  const f = pent(11 - n); // bigger shard, lower note
  s.tone({ freq: f, type: "triangle", attack: 0.003, decay: 0.28, peak: 0.07, filter: { type: "lowpass", freq: 3600 }, wet: 0.15 });
  s.bell({ freq: f * 2, peak: 0.03, decay: 0.35, brightness: 0.3, wet: 0.2 });
}

export function place(s: Synth, a: PlaceArgs): void {
  const v = placeVoicing(a.seat, a.size, a.combo ?? 0);
  const n = v.midi.length;
  const strum = 0.014 + v.brightness * 0.01;
  const peak = 0.19 / Math.sqrt(n);
  v.midi.forEach((m, i) => {
    const isBass = i === 0 && n >= 4;
    s.bell({
      freq: hz(m),
      at: i * strum + s.rand(0, 0.004),
      peak: isBass ? peak * 0.8 : peak,
      decay: v.duration * (isBass ? 1.15 : 1 - i * 0.06),
      brightness: isBass ? v.brightness * 0.5 : v.brightness,
      pan: a.pan,
      wet: 0.28 + v.brightness * 0.12,
    });
  });
  // A warm body under the glass so it lands with some weight.
  if (a.size >= 3) {
    s.tone({
      freq: hz(v.midi[n >= 4 ? 1 : 0]! - 12),
      type: "triangle",
      attack: 0.006,
      decay: 0.45 + a.size * 0.06,
      peak: 0.05,
      filter: { type: "lowpass", freq: 900 },
      pan: a.pan,
      wet: 0.2,
    });
  }
  // Combos earn a little sparkle an octave above.
  if ((a.combo ?? 0) >= 2) {
    s.bell({
      freq: hz(v.midi[n - 1]! + 12),
      at: n * strum + 0.05,
      peak: 0.035 + Math.min(5, a.combo ?? 0) * 0.006,
      decay: 0.7,
      brightness: 0.9,
      pan: a.pan,
      wet: 0.45,
    });
  }
}

export function invalid(s: Synth): void {
  s.tone({ freq: 150, glideTo: 82, glideTime: 0.12, attack: 0.003, decay: 0.16, peak: 0.2, filter: { type: "lowpass", freq: 520 }, wet: 0.05 });
  s.noise({ attack: 0.002, decay: 0.05, peak: 0.05, filter: { type: "lowpass", freq: 700 }, rate: 0.5, wet: 0 });
}

export function node(s: Synth, a: PanArgs = {}): void {
  const steps = [5, 7, 9, 10, 12];
  steps.forEach((st, i) => {
    s.bell({ freq: pent(st), at: i * 0.055, peak: 0.075 - i * 0.006, decay: 0.55 + i * 0.08, brightness: 0.85, pan: a.pan, wet: 0.4 });
  });
  s.noise({ at: 0.04, attack: 0.08, decay: 0.3, peak: 0.018, filter: { type: "highpass", freq: 6500 }, pan: a.pan, wet: 0.5 });
}

export function charge(s: Synth, n: number): void {
  const c = Math.max(1, Math.min(9, Math.round(n) || 1));
  const f = pent(4 + c);
  s.tone({ freq: f / 2, glideTo: f, glideTime: 0.1, attack: 0.03, decay: 0.12, peak: 0.04, type: "triangle", filter: { type: "lowpass", freq: 2400 }, wet: 0.15 });
  s.bell({ freq: f, at: 0.1, peak: 0.08, decay: 0.6 + c * 0.04, brightness: 0.55 + c * 0.04, wet: 0.35 });
}

export function spark(s: Synth): void {
  s.bell({ freq: pent(13), peak: 0.1, decay: 0.75, brightness: 1, wet: 0.4 });
  for (let i = 0; i < 6; i++) {
    s.noise({
      at: s.rand(0, 0.14),
      attack: 0.001,
      decay: 0.008 + s.rand(0, 0.01),
      peak: 0.04 * (1 - i / 8),
      filter: { type: "highpass", freq: 5200 },
      pan: s.rand(-0.4, 0.4),
      wet: 0.3,
    });
  }
}

export function leap(s: Synth): void {
  s.noise({
    attack: 0.14,
    decay: 0.3,
    peak: 0.09,
    filter: { type: "bandpass", freq: 380, q: 1.3, to: 3400, time: 0.38 },
    pan: -0.35,
    panTo: 0.35,
    wet: 0.35,
  });
  s.tone({ freq: 290, glideTo: 880, glideTime: 0.32, attack: 0.08, decay: 0.28, peak: 0.06, type: "triangle", filter: { type: "lowpass", freq: 2600 }, wet: 0.3 });
  s.bell({ freq: pent(10), at: 0.33, peak: 0.07, decay: 0.7, brightness: 0.7, pan: 0.3, wet: 0.45 });
}

export function shatter(s: Synth, a: PanArgs = {}): void {
  const pan = a.pan ?? 0;
  // The crack: a few short, bright noise bursts.
  for (let i = 0; i < 4; i++) {
    s.noise({
      at: i * s.rand(0.012, 0.03),
      attack: 0.001,
      decay: s.rand(0.025, 0.07),
      peak: 0.16 - i * 0.025,
      filter: { type: i % 2 ? "highpass" : "bandpass", freq: s.rand(2200, 6500), q: 1.4 },
      pan: pan + s.rand(-0.25, 0.25),
      wet: 0.3,
    });
  }
  // The ring of the fragments: inharmonic, short, scattered.
  const f0 = s.rand(880, 1180);
  const ratios = [1, 1.59, 2.14, 2.83, 3.71, 4.92];
  ratios.forEach((r, i) => {
    s.tone({
      freq: f0 * r,
      at: s.rand(0, 0.06),
      attack: 0.001,
      decay: s.rand(0.12, 0.55) / (1 + i * 0.2),
      peak: 0.045 / (1 + i * 0.3),
      pan: pan + s.rand(-0.3, 0.3),
      wet: 0.4,
    });
  });
  // And a low thud so it has mass.
  s.tone({ freq: 95, glideTo: 48, attack: 0.002, decay: 0.18, peak: 0.16, filter: { type: "lowpass", freq: 400 }, pan, wet: 0.1 });
}

export function scan(s: Synth): void {
  s.noise({
    attack: 0.25,
    decay: 0.6,
    peak: 0.05,
    filter: { type: "bandpass", freq: 300, q: 4, to: 3800, time: 0.85 },
    pan: -0.85,
    panTo: 0.85,
    wet: 0.4,
  });
  s.tone({ freq: 1318, attack: 0.002, decay: 1.1, peak: 0.07, pan: -0.5, wet: 0.5 });
  s.tone({ freq: 1318, at: 0.42, attack: 0.002, decay: 0.8, peak: 0.03, pan: 0.5, wet: 0.6 });
}

export function misfire(s: Synth): void {
  const t = [0, 0.045, 0.1, 0.13];
  t.forEach((at, i) => {
    s.tone({ freq: 220 - i * 9, at, attack: 0.002, decay: 0.035, peak: 0.05, type: "square", detune: 0, filter: { type: "lowpass", freq: 1700 }, wet: 0.05 });
    s.tone({ freq: 233 - i * 9, at, attack: 0.002, decay: 0.035, peak: 0.04, type: "square", detune: 14, filter: { type: "lowpass", freq: 1700 }, wet: 0.05 });
  });
  s.tone({ freq: 180, at: 0.17, glideTo: 70, attack: 0.004, decay: 0.2, peak: 0.07, type: "sawtooth", filter: { type: "lowpass", freq: 900, to: 200 }, wet: 0.1 });
}

export function stormWarn(s: Synth): void {
  // Slow swell, with a tremolo made from close detuned partials (beating).
  s.tone({ freq: 110, attack: 0.9, decay: 1.1, peak: 0.09, type: "triangle", filter: { type: "lowpass", freq: 700 }, wet: 0.4 });
  s.tone({ freq: 116.5, attack: 0.9, decay: 1.1, peak: 0.06, type: "triangle", filter: { type: "lowpass", freq: 700 }, wet: 0.4 });
  s.tone({ freq: 164.8, attack: 1.0, decay: 1.0, peak: 0.04, wet: 0.5 });
  s.noise({ attack: 0.8, decay: 1.4, peak: 0.12, filter: { type: "lowpass", freq: 180 }, rate: 0.5, wet: 0.3 });
}

export function storm(s: Synth): void {
  // Deep rumble.
  s.noise({ attack: 0.25, hold: 0.3, decay: 2.4, peak: 0.45, filter: { type: "lowpass", freq: 160, q: 0.9, to: 55 }, rate: 0.4, wet: 0.3 });
  s.tone({ freq: 52, glideTo: 34, attack: 0.15, decay: 2, peak: 0.18, wet: 0.1 });
  // Crumbling: grains of debris, thinning out.
  for (let i = 0; i < 18; i++) {
    const at = 0.2 + s.rand(0, 1.6) * (i / 18 + 0.2);
    s.noise({
      at,
      attack: 0.002,
      decay: s.rand(0.015, 0.045),
      peak: 0.08 * (1 - i / 22),
      filter: { type: "bandpass", freq: s.rand(700, 2600), q: 3 },
      pan: s.rand(-0.8, 0.8),
      wet: 0.35,
    });
  }
  // A few glass fragments settling.
  for (let i = 0; i < 6; i++) {
    s.tone({ freq: s.rand(2100, 5200), at: 0.4 + s.rand(0, 1.4), attack: 0.001, decay: s.rand(0.08, 0.25), peak: 0.018, pan: s.rand(-0.7, 0.7), wet: 0.5 });
  }
}

export function dark(s: Synth, seat: number): void {
  const f = hz(seatStepToMidi(seat, 4));
  s.bell({ freq: f, peak: 0.06, decay: 0.9, brightness: 0.4, wet: 0.45 });
  s.tone({
    freq: f,
    glideTo: f / 2.6,
    glideTime: 1.3,
    attack: 0.04,
    decay: 1.4,
    peak: 0.09,
    type: "triangle",
    filter: { type: "lowpass", freq: 3200, to: 260, time: 1.4 },
    wet: 0.5,
  });
}

export function turnStart(s: Synth, isYou: boolean): void {
  if (isYou) {
    s.bell({ freq: pent(5), peak: 0.09, decay: 1.4, brightness: 0.5, wet: 0.45 });
    s.bell({ freq: pent(7), at: 0.13, peak: 0.085, decay: 1.6, brightness: 0.55, wet: 0.5 });
  } else {
    s.bell({ freq: pent(2), peak: 0.035, decay: 0.9, brightness: 0.25, wet: 0.45 });
  }
}

export function tick(s: Synth, secondsLeft: number): void {
  const sec = Number.isFinite(secondsLeft) ? secondsLeft : 99;
  if (sec <= 0) {
    s.tone({ freq: 196, glideTo: 147, attack: 0.004, decay: 0.35, peak: 0.1, type: "triangle", filter: { type: "lowpass", freq: 1200 }, wet: 0.25 });
    return;
  }
  // 0 when relaxed, 1 at the last second.
  const u = sec > 5 ? 0 : (6 - sec) / 5;
  const f = 1050 * (1 + u * 0.5);
  s.tone({ freq: f, attack: 0.001, decay: 0.03 + u * 0.02, peak: 0.028 + u * 0.06, filter: { type: "bandpass", freq: f, q: 3 }, type: "triangle", wet: 0.05 + u * 0.1 });
  if (u > 0) s.tone({ freq: f * 2.01, attack: 0.001, decay: 0.03, peak: 0.02 * u, wet: 0.1 });
  if (sec <= 2) s.tone({ freq: f * 1.12, at: 0.12, attack: 0.001, decay: 0.035, peak: 0.05, type: "triangle", wet: 0.1 });
}

export function win(s: Synth): void {
  const steps = [0, 2, 4, 5, 7, 9, 10];
  steps.forEach((st, i) => {
    s.bell({ freq: pent(st + 2), at: i * 0.075, peak: 0.08, decay: 0.9 + i * 0.1, brightness: 0.6 + i * 0.05, pan: -0.5 + i / 6, wet: 0.45 });
  });
  const chord = [0, 2, 4, 6].map((st) => pent(st + 5));
  chord.forEach((f, i) => {
    s.bell({ freq: f, at: 0.6 + i * 0.02, peak: 0.065, decay: 3, brightness: 0.7, wet: 0.6 });
    s.tone({ freq: f / 2, at: 0.55, attack: 0.4, decay: 2.6, peak: 0.03, type: "triangle", filter: { type: "lowpass", freq: 1400 }, wet: 0.6 });
  });
  s.noise({ at: 0.6, attack: 0.3, decay: 1.8, peak: 0.015, filter: { type: "highpass", freq: 7000 }, wet: 0.7 });
}

export function lose(s: Synth): void {
  [9, 7, 6, 4].forEach((st, i) => {
    s.bell({ freq: pent(st), at: i * 0.22, peak: 0.06, decay: 1.1, brightness: 0.3, wet: 0.5 });
  });
  // Land softly on the relative minor (vi), warm and unhurried.
  const vi = [3, 5, 7].map((st) => pent(st));
  vi.forEach((f) => {
    s.tone({ freq: f / 2, at: 0.85, attack: 0.35, decay: 2.2, peak: 0.035, type: "triangle", filter: { type: "lowpass", freq: 1100 }, wet: 0.6 });
  });
}

export function join(s: Synth): void {
  s.bell({ freq: pent(5), peak: 0.06, decay: 0.6, brightness: 0.45, wet: 0.35 });
  s.bell({ freq: pent(7), at: 0.085, peak: 0.06, decay: 0.8, brightness: 0.5, wet: 0.35 });
}

export function leave(s: Synth): void {
  s.bell({ freq: pent(7), peak: 0.045, decay: 0.5, brightness: 0.3, wet: 0.35 });
  s.bell({ freq: pent(4), at: 0.1, peak: 0.045, decay: 0.7, brightness: 0.25, wet: 0.35 });
}

export function chat(s: Synth): void {
  s.tone({ freq: 1568, attack: 0.002, decay: 0.05, peak: 0.04, wet: 0.15 });
  s.tone({ freq: 2093, at: 0.06, attack: 0.002, decay: 0.07, peak: 0.035, wet: 0.2 });
}

export function uiClick(s: Synth): void {
  s.tone({ freq: 1750 * s.rand(0.98, 1.02), attack: 0.001, decay: 0.018, peak: 0.035, wet: 0 });
  s.noise({ attack: 0.001, decay: 0.006, peak: 0.02, filter: { type: "highpass", freq: 4000 }, wet: 0 });
}

export function uiToggle(s: Synth, on = true): void {
  const [a, b] = on ? [660, 990] : [990, 660];
  s.tone({ freq: a, attack: 0.002, decay: 0.04, peak: 0.04, type: "triangle", wet: 0.08 });
  s.tone({ freq: b, at: 0.045, attack: 0.002, decay: 0.06, peak: 0.04, type: "triangle", wet: 0.1 });
}
