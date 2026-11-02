/**
 * Generative ambient bed. Deliberately small so it costs almost nothing:
 *
 *   3 oscillators (two detuned saws + a triangle), one per chord tone
 *     -> one lowpass whose cutoff drifts on a very slow LFO
 *     -> a pad gain that "breathes" on a second slow LFO
 *     -> music bus (which also feeds the shared reverb)
 *
 * On top, a lookahead scheduler drops sparse pentatonic bell motifs and,
 * when intensity is high (late game, storm), a soft low pulse. The pad glides
 * through a slow I-vi-IV-ii progression, so it never loops audibly.
 */
import { Synth } from "./synth";
import { midiToHz, padVoicing, pentatonicMidi } from "./theory";

const LOOKAHEAD = 0.6; // seconds of audio scheduled ahead
const TICK_MS = 200;
const PAD_LEVEL = 0.055;

export class AmbientMusic {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly synth: Synth;
  private readonly random: () => number;

  private oscs: OscillatorNode[] = [];
  private nodes: AudioNode[] = [];
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode | null = null;
  private padGain: GainNode | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private chordIdx = 0;
  private nextChordAt = 0;
  private nextBellAt = 0;
  private nextPulseAt = 0;
  private bellStep = 7;
  private intensity = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, reverbIn: AudioNode, random: () => number = Math.random) {
    this.ctx = ctx;
    this.out = out;
    this.random = random;
    this.synth = new Synth(ctx, out, reverbIn, random);
  }

  get running(): boolean {
    return this.padGain !== null;
  }

  start(): void {
    if (this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0.0001, t);
    pad.gain.linearRampToValueAtTime(PAD_LEVEL, t + 4);
    pad.connect(this.out);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.value = this.cutoff();
    filter.connect(pad);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.lfoRate();
    const depth = ctx.createGain();
    depth.gain.value = this.lfoAmount();
    lfo.connect(depth).connect(filter.frequency);

    // Breath: a slower LFO gently swelling the pad level.
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.043;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = PAD_LEVEL * 0.3;
    breath.connect(breathDepth).connect(pad.gain);

    const voicing = padVoicing(this.chordIdx);
    const types: OscillatorType[] = ["sawtooth", "sawtooth", "triangle"];
    const oscs = voicing.map((m, i) => {
      const o = ctx.createOscillator();
      o.type = types[i]!;
      o.frequency.value = midiToHz(m);
      o.detune.value = this.spread(i);
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.9 : 0.55;
      o.connect(g).connect(filter);
      this.nodes.push(g);
      return o;
    });

    for (const o of [...oscs, lfo, breath]) o.start(t);
    this.oscs = [...oscs, lfo, breath];
    this.nodes.push(pad, filter, depth, breathDepth);
    this.filter = filter;
    this.lfo = lfo;
    this.lfoDepth = depth;
    this.padGain = pad;

    this.nextChordAt = t + this.chordLength();
    this.nextBellAt = t + 1.5 + this.random() * 2;
    this.nextPulseAt = t + 1;
    this.schedule();
  }

  /** Fade out and release everything. Safe to call repeatedly. */
  stop(fade = 1.2): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const pad = this.padGain;
    if (!pad) return;
    const t = this.ctx.currentTime;
    pad.gain.cancelScheduledValues(t);
    pad.gain.setValueAtTime(pad.gain.value, t);
    pad.gain.linearRampToValueAtTime(0.0001, t + fade);
    const oscs = this.oscs;
    const nodes = this.nodes;
    for (const o of oscs) {
      try {
        o.stop(t + fade + 0.1);
      } catch {
        // already stopped
      }
    }
    // Disconnect after the last oscillator has actually stopped.
    const last = oscs[0];
    if (last) last.onended = () => [...oscs, ...nodes].forEach((n) => n.disconnect());
    this.oscs = [];
    this.nodes = [];
    this.filter = null;
    this.lfo = null;
    this.lfoDepth = null;
    this.padGain = null;
  }

  setIntensity(x: number): void {
    this.intensity = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.filter?.frequency.setTargetAtTime(this.cutoff(), t, 1.2);
    this.lfo?.frequency.setTargetAtTime(this.lfoRate(), t, 1.5);
    this.lfoDepth?.gain.setTargetAtTime(this.lfoAmount(), t, 1.5);
    this.oscs.slice(0, 3).forEach((o, i) => o.detune.setTargetAtTime(this.spread(i), t, 2));
  }

  // Intensity mappings: calm is dark and still; intense is brighter and moving.
  private cutoff(): number {
    return 420 + this.intensity * 1500;
  }
  private lfoRate(): number {
    return 0.035 + this.intensity * 0.22;
  }
  private lfoAmount(): number {
    return 160 + this.intensity * 650;
  }
  private spread(i: number): number {
    const cents = 5 + this.intensity * 11;
    return [-cents, cents, 0][i] ?? 0;
  }
  private chordLength(): number {
    return 14 - this.intensity * 6 + this.random() * 3;
  }

  private schedule = (): void => {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    while (this.nextChordAt < horizon) {
      this.changeChord(this.nextChordAt);
      this.nextChordAt += this.chordLength();
    }
    while (this.nextBellAt < horizon) {
      this.motif(Math.max(0, this.nextBellAt - now));
      const gap = (2.6 + this.random() * 4.2) / (1 + this.intensity * 1.8);
      this.nextBellAt += gap;
    }
    if (this.intensity > 0.45) {
      const period = 1.15 - this.intensity * 0.35;
      while (this.nextPulseAt < horizon) {
        this.pulse(Math.max(0, this.nextPulseAt - now));
        this.nextPulseAt += period;
      }
    } else {
      this.nextPulseAt = horizon;
    }
    this.timer = setTimeout(this.schedule, TICK_MS);
  };

  private changeChord(at: number): void {
    this.chordIdx++;
    const voicing = padVoicing(this.chordIdx);
    this.oscs.slice(0, 3).forEach((o, i) => {
      o.frequency.setTargetAtTime(midiToHz(voicing[i]!), at, 1.6);
    });
  }

  private motif(at: number): void {
    const r = this.random();
    const len = r < 0.55 - this.intensity * 0.2 ? 1 : r < 0.88 ? 2 : 3;
    for (let i = 0; i < len; i++) {
      const move = [-2, -1, 1, 2][Math.floor(this.random() * 4)]!;
      this.bellStep = Math.max(4, Math.min(13, this.bellStep + move));
      this.synth.bell({
        freq: midiToHz(pentatonicMidi(this.bellStep)),
        at: at + i * (0.2 + this.random() * 0.12),
        peak: 0.028 + this.random() * 0.016,
        decay: 2 + this.random() * 1.2,
        brightness: 0.3 + this.intensity * 0.2,
        pan: (this.random() - 0.5) * 1.2,
        wet: 0.75,
      });
    }
  }

  private pulse(at: number): void {
    const root = padVoicing(this.chordIdx)[0]!;
    this.synth.tone({
      freq: midiToHz(root - 12),
      at,
      attack: 0.012,
      decay: 0.4,
      peak: (this.intensity - 0.45) * 0.16,
      filter: { type: "lowpass", freq: 320 },
      wet: 0.2,
    });
  }
}
