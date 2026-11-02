/**
 * Low-level synthesis primitives on top of the Web Audio API.
 *
 * Every sound in the game is built from three things: enveloped oscillators
 * (`tone`), enveloped filtered noise (`noise`), and a glassy additive `bell`.
 * Each voice is routed through an optional stereo panner into the effects bus
 * plus a per-voice reverb send, and tears itself down when it ends, so a long
 * session never accumulates dead nodes.
 */

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isOfflineContext(ctx: BaseAudioContext): boolean {
  return typeof (ctx as Partial<OfflineAudioContext>).startRendering === "function";
}

/** Envelope floor: exponential ramps cannot reach zero. */
const FLOOR = 0.0001;
/** Hard cap on simultaneously sounding sources. New cues are dropped above it. */
export const MAX_VOICES = 96;

export interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** Sweep the cutoff to this frequency... */
  to?: number;
  /** ...over this many seconds (defaults to the whole note). */
  time?: number;
}

export interface VoiceOpts {
  /** Start offset in seconds from now. */
  at?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Optional pan sweep target, reached at the end of the voice (or `panTime`). */
  panTo?: number;
  panTime?: number;
  /** Reverb send level 0..1. */
  wet?: number;
}

export interface EnvOpts {
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
}

export interface ToneOpts extends VoiceOpts, EnvOpts {
  freq: number;
  type?: OscillatorType;
  /** Detune in cents. */
  detune?: number;
  /** Glide the pitch to this frequency. */
  glideTo?: number;
  /** Glide duration in seconds (defaults to the whole note). */
  glideTime?: number;
  filter?: FilterOpts;
}

export interface NoiseOpts extends VoiceOpts, EnvOpts {
  filter?: FilterOpts;
  /** Playback rate of the noise buffer; < 1 darkens it. */
  rate?: number;
}

export interface BellOpts extends VoiceOpts {
  freq: number;
  peak: number;
  decay: number;
  /** 0..1: more partials, sharper attack, brighter transient. */
  brightness?: number;
}

/**
 * Partial ratios of a free glass bar / wine-glass-like resonator. Inharmonic
 * on purpose: this is what makes a sine stack read as "glass" not "organ".
 */
export const GLASS_PARTIALS = [1, 2.32, 4.25, 6.63, 9.38] as const;

interface Group {
  input: GainNode;
  pending: number;
  nodes: AudioNode[];
}

export class Synth {
  readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly reverbIn: AudioNode;
  readonly random: () => number;
  private noiseBuf: AudioBuffer | null = null;
  private readonly hasPanner: boolean;
  /** Sources currently scheduled or sounding. */
  active = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, reverbIn: AudioNode, random: () => number = Math.random) {
    this.ctx = ctx;
    this.out = out;
    this.reverbIn = reverbIn;
    this.random = random;
    this.hasPanner = typeof ctx.createStereoPanner === "function";
  }

  /** Audio clock "now" plus a hair of scheduling headroom. */
  now(): number {
    return this.ctx.currentTime + 0.005;
  }

  /** Random float in [lo, hi). */
  rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  /** Two seconds of seeded white noise, built once and looped from random offsets. */
  private noiseBuffer(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rnd = mulberry32(0xc0be5);
    for (let i = 0; i < len; i++) data[i] = rnd() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  /**
   * A routed voice group: input -> [panner] -> fx bus, plus a reverb send.
   * Sources connect into `input` with their own envelopes. The group frees
   * its nodes once every source added to it has ended.
   */
  group(opts: VoiceOpts, t0: number, end: number): Group {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const nodes: AudioNode[] = [input];
    let tail: AudioNode = input;
    if (this.hasPanner && (opts.pan !== undefined || opts.panTo !== undefined)) {
      const p = ctx.createStereoPanner();
      const from = clampPan(opts.pan ?? 0);
      p.pan.setValueAtTime(from, t0);
      if (opts.panTo !== undefined) p.pan.linearRampToValueAtTime(clampPan(opts.panTo), t0 + (opts.panTime ?? end - t0));
      input.connect(p);
      nodes.push(p);
      tail = p;
    }
    tail.connect(this.out);
    const wet = opts.wet ?? 0.25;
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = Math.min(1, wet);
      tail.connect(send);
      send.connect(this.reverbIn);
      nodes.push(send);
    }
    return { input, pending: 0, nodes };
  }

  /** Register a source with a group and arrange teardown. */
  private track(g: Group, src: AudioScheduledSourceNode, chain: AudioNode[], t0: number, end: number, offset?: number): void {
    g.pending++;
    this.active++;
    src.onended = () => {
      this.active = Math.max(0, this.active - 1);
      for (const n of chain) n.disconnect();
      if (--g.pending === 0) for (const n of g.nodes) n.disconnect();
    };
    if (offset === undefined) src.start(t0);
    else (src as AudioBufferSourceNode).start(t0, offset);
    src.stop(end + 0.05);
  }

  private envelope(param: AudioParam, t0: number, e: EnvOpts): number {
    const attack = Math.max(0.001, e.attack ?? 0.004);
    const hold = Math.max(0, e.hold ?? 0);
    const peak = Math.max(FLOOR * 2, e.peak);
    param.setValueAtTime(FLOOR, t0);
    param.linearRampToValueAtTime(peak, t0 + attack);
    if (hold > 0) param.setValueAtTime(peak, t0 + attack + hold);
    const end = t0 + attack + hold + Math.max(0.005, e.decay);
    param.exponentialRampToValueAtTime(FLOOR, end);
    return end;
  }

  private filter(f: FilterOpts, t0: number, end: number): BiquadFilterNode {
    const bq = this.ctx.createBiquadFilter();
    bq.type = f.type;
    bq.Q.value = f.q ?? 0.7;
    bq.frequency.setValueAtTime(clampHz(f.freq), t0);
    if (f.to !== undefined) bq.frequency.exponentialRampToValueAtTime(clampHz(f.to), t0 + (f.time ?? end - t0));
    return bq;
  }

  /** Length of an envelope, for callers that need to line things up. */
  static span(e: EnvOpts): number {
    return Math.max(0.001, e.attack ?? 0.004) + Math.max(0, e.hold ?? 0) + Math.max(0.005, e.decay);
  }

  tone(o: ToneOpts, into?: Group): void {
    const ctx = this.ctx;
    const t0 = this.now() + Math.max(0, o.at ?? 0);
    const end = t0 + Synth.span(o);
    const g = into ?? this.group(o, t0, end);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(clampHz(o.freq), t0);
    if (o.glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(clampHz(o.glideTo), t0 + (o.glideTime ?? end - t0));
    }
    if (o.detune) osc.detune.value = o.detune;
    const env = ctx.createGain();
    this.envelope(env.gain, t0, o);
    const chain: AudioNode[] = [osc, env];
    if (o.filter) {
      const f = this.filter(o.filter, t0, end);
      osc.connect(f).connect(env);
      chain.push(f);
    } else {
      osc.connect(env);
    }
    env.connect(g.input);
    this.track(g, osc, chain, t0, end);
  }

  noise(o: NoiseOpts, into?: Group): void {
    const ctx = this.ctx;
    const t0 = this.now() + Math.max(0, o.at ?? 0);
    const end = t0 + Synth.span(o);
    const g = into ?? this.group(o, t0, end);
    const src = ctx.createBufferSource();
    const buf = this.noiseBuffer();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
    if (o.rate) src.playbackRate.value = o.rate;
    const env = ctx.createGain();
    this.envelope(env.gain, t0, o);
    const chain: AudioNode[] = [src, env];
    if (o.filter) {
      const f = this.filter(o.filter, t0, end);
      src.connect(f).connect(env);
      chain.push(f);
    } else {
      src.connect(env);
    }
    env.connect(g.input);
    this.track(g, src, chain, t0, end, this.random() * (buf.duration - 0.1));
  }

  /** A struck glass resonator: inharmonic sine partials plus a tiny transient. */
  bell(o: BellOpts): void {
    const b = clamp(o.brightness ?? 0.5, 0, 1);
    const t0 = this.now() + Math.max(0, o.at ?? 0);
    const end = t0 + o.decay + 0.01;
    const g = this.group(o, t0, end);
    const count = Math.min(GLASS_PARTIALS.length, 2 + Math.round(b * 3));
    const nyquist = this.ctx.sampleRate / 2;
    for (let k = 0; k < count; k++) {
      const f = o.freq * GLASS_PARTIALS[k]!;
      if (f > Math.min(16000, nyquist * 0.9)) break;
      const amp = k === 0 ? o.peak : (o.peak * (0.12 + 0.5 * b)) / (k * 1.15);
      this.tone(
        {
          freq: f,
          at: o.at,
          attack: 0.0015 + (1 - b) * 0.006,
          decay: o.decay / (1 + k * 0.85),
          peak: amp,
          detune: k === 0 ? 0 : this.rand(-5, 5),
        },
        g,
      );
    }
    if (b > 0.15) {
      this.noise(
        {
          at: o.at,
          attack: 0.001,
          decay: 0.02 + b * 0.015,
          peak: o.peak * 0.22 * b,
          filter: { type: "highpass", freq: 3800, q: 0.8 },
        },
        g,
      );
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function clampPan(p: number): number {
  return Number.isFinite(p) ? clamp(p, -1, 1) : 0;
}

function clampHz(f: number): number {
  return Number.isFinite(f) ? clamp(f, 10, 20000) : 440;
}

/**
 * A cheap, cohesive room: stereo decaying noise whose high end dies faster
 * than its low end (a one-pole lowpass that closes over time), like a soft
 * stone hall. Seeded, so the room is identical on every load.
 */
export function makeImpulseResponse(ctx: BaseAudioContext, seconds = 2.2, seed = 0x5eed): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const preDelay = Math.floor(rate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const rnd = mulberry32(seed + ch * 7919);
    let y = 0;
    for (let i = 0; i < len; i++) {
      if (i < preDelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelay) / (len - preDelay);
      const a = 0.15 + 0.8 * t; // lowpass coefficient: darker as it decays
      const x = rnd() * 2 - 1;
      y += (1 - a) * (x - y);
      const env = (1 - t) ** 2.6;
      data[i] = (y * (1 + a * 1.5)) * env;
    }
  }
  return buf;
}
