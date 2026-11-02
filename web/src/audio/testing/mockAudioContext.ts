/**
 * A strict, minimal fake of the Web Audio API for unit tests. It records what
 * gets created and enforces the rules the real API throws on (non-finite
 * values, exponential ramps to <= 0, start-after-stop), so tests catch the
 * same mistakes a browser would.
 */

export class MockParam {
  value: number;
  readonly events: { type: string; value: number; time: number }[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  private check(value: number, time: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(time)) throw new TypeError(`non-finite automation ${value} @ ${time}`);
    if (time < 0) throw new RangeError(`negative time ${time}`);
  }
  setValueAtTime(value: number, time: number): this {
    this.check(value, time);
    this.events.push({ type: "set", value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.check(value, time);
    this.events.push({ type: "linear", value, time });
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.check(value, time);
    if (value <= 0) throw new RangeError("exponential ramp to non-positive value");
    this.events.push({ type: "exp", value, time });
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, time: number, constant: number): this {
    this.check(value, time);
    if (!(constant > 0)) throw new RangeError("time constant must be > 0");
    this.events.push({ type: "target", value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.check(0, time);
    return this;
  }
}

export class MockNode {
  readonly kind: string;
  readonly outputs: unknown[] = [];
  disconnected = 0;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect<T>(dest: T): T {
    if (!dest) throw new TypeError("connect to nothing");
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.disconnected++;
  }
}

class MockSource extends MockNode {
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(when = 0): void {
    if (this.started) throw new Error("InvalidStateError: start called twice");
    if (!Number.isFinite(when)) throw new TypeError("bad start time");
    this.started = true;
  }
  stop(when = 0): void {
    if (!this.started) throw new Error("InvalidStateError: stop before start");
    if (!Number.isFinite(when)) throw new TypeError("bad stop time");
    this.stopped = true;
  }
  /** Simulate the source finishing. */
  end(): void {
    this.onended?.();
  }
}

export class MockOscillator extends MockSource {
  type: OscillatorType = "sine";
  frequency = new MockParam(440);
  detune = new MockParam(0);
  constructor() {
    super("oscillator");
  }
}

export class MockBufferSource extends MockSource {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new MockParam(1);
  constructor() {
    super("bufferSource");
  }
}

class MockBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    if (channels < 1 || length < 1) throw new RangeError("bad buffer size");
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(ch: number): Float32Array {
    const d = this.data[ch];
    if (!d) throw new RangeError("bad channel");
    return d;
  }
}

export interface MockOptions {
  state?: AudioContextState;
  /** If false, resume() resolves but the context stays suspended (autoplay blocked). */
  resumable?: boolean;
  /** Omit createStereoPanner, like older Safari. */
  noPanner?: boolean;
}

export class MockAudioContext {
  state: AudioContextState;
  currentTime = 0;
  sampleRate = 8000; // small, keeps generated buffers cheap in tests
  readonly destination = new MockNode("destination");
  onstatechange: (() => void) | null = null;
  readonly created: MockNode[] = [];
  readonly sources: MockSource[] = [];
  resumeCalls = 0;
  private readonly resumable: boolean;
  createStereoPanner?: () => MockNode & { pan: MockParam };

  constructor(opts: MockOptions = {}) {
    this.state = opts.state ?? "running";
    this.resumable = opts.resumable ?? true;
    if (!opts.noPanner) {
      this.createStereoPanner = () => this.track(Object.assign(new MockNode("panner"), { pan: new MockParam(0) }));
    }
  }

  private track<T extends MockNode>(n: T): T {
    this.created.push(n);
    if (n instanceof MockSource) this.sources.push(n);
    return n;
  }

  count(kind: string): number {
    return this.created.filter((n) => n.kind === kind).length;
  }

  /** Fire onended on every source, like time passing. */
  finishAll(): void {
    for (const s of this.sources) if (s.stopped) s.end();
  }

  createGain() {
    return this.track(Object.assign(new MockNode("gain"), { gain: new MockParam(1) }));
  }
  createOscillator() {
    return this.track(new MockOscillator());
  }
  createBufferSource() {
    return this.track(new MockBufferSource());
  }
  createBiquadFilter() {
    return this.track(
      Object.assign(new MockNode("biquad"), {
        type: "lowpass" as BiquadFilterType,
        frequency: new MockParam(350),
        Q: new MockParam(1),
        gain: new MockParam(0),
      }),
    );
  }
  createDynamicsCompressor() {
    return this.track(
      Object.assign(new MockNode("compressor"), {
        threshold: new MockParam(-24),
        knee: new MockParam(30),
        ratio: new MockParam(12),
        attack: new MockParam(0.003),
        release: new MockParam(0.25),
      }),
    );
  }
  createConvolver() {
    return this.track(Object.assign(new MockNode("convolver"), { buffer: null as unknown, normalize: true }));
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockBuffer(channels, length, sampleRate);
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumable && this.state !== "closed") {
      this.state = "running";
      this.onstatechange?.();
    }
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    this.onstatechange?.();
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

/** Cast helper: the mock is structurally enough of a context for our code. */
export function asContext(m: MockAudioContext): BaseAudioContext {
  return m as unknown as BaseAudioContext;
}

/** An in-memory Storage stand-in. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}
