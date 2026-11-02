/**
 * Typed wrapper around the Rust engine compiled to WebAssembly
 * (crates/wasm). All values cross the boundary as JSON that matches
 * ./types.ts, so this file is mostly parsing and memoisation.
 */
import init, {
  Engine,
  kit as wasmKit,
  preset as wasmPreset,
  validateConfig as wasmValidate,
} from "../wasm/pkg/cubes_wasm";
import type {
  Action,
  AiLevel,
  CheckResult,
  EngineGame,
  GameConfig,
  GameEvent,
  Kit,
  KitKind,
  Placement,
  PresetName,
  View,
} from "./types";

let ready: Promise<void> | null = null;

/** Load the engine once. Safe to call repeatedly. */
export function loadEngine(input?: Parameters<typeof init>[0]): Promise<void> {
  ready ??= init(input).then(() => undefined);
  return ready;
}

const kits = new Map<KitKind, Kit>();

export function getKit(kind: KitKind): Kit {
  let k = kits.get(kind);
  if (!k) {
    k = JSON.parse(wasmKit(kind)) as Kit;
    kits.set(kind, k);
  }
  return k;
}

export function getPreset(name: PresetName, seats: number): GameConfig {
  const json = wasmPreset(name, seats);
  if (!json) throw new Error(`unknown preset ${name}`);
  return JSON.parse(json) as GameConfig;
}

/** Returns an error message, or null when the config is valid. */
export function validateConfig(config: GameConfig): string | null {
  return wasmValidate(JSON.stringify(config)) ?? null;
}

export function randomSeed(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  // Keep within 2^53 so it survives the f64 boundary exactly.
  return (a[0]! & 0x1fffff) * 2 ** 32 + a[1]!;
}

export class LocalGame implements EngineGame {
  private constructor(private readonly inner: Engine) {}

  static create(config: GameConfig, seed = randomSeed()): LocalGame {
    return new LocalGame(new Engine(JSON.stringify(config), seed));
  }

  static fromJSON(json: string): LocalGame {
    return new LocalGame(Engine.fromJSON(json));
  }

  /** A perfect-information game built from a (possibly fogged) view. */
  static fromView(view: View): LocalGame {
    return new LocalGame(Engine.fromView(JSON.stringify(view)));
  }

  view(seat: number | null): View {
    return JSON.parse(this.inner.view(seat ?? -1)) as View;
  }

  legal(seat: number, opts?: { leap?: boolean }): Placement[] {
    return JSON.parse(this.inner.legal(seat, opts?.leap ?? false)) as Placement[];
  }

  check(seat: number, action: Action): CheckResult {
    return JSON.parse(this.inner.check(seat, JSON.stringify(action))) as CheckResult;
  }

  apply(seat: number, action: Action): GameEvent[] {
    return JSON.parse(this.inner.apply(seat, JSON.stringify(action))) as GameEvent[];
  }

  aiTurn(seat: number, level: AiLevel, budgetMs: number): Action[] {
    const a = this.botAction(seat, level, randomSeed(), budgetMs);
    return a ? [a] : [];
  }

  botAction(seat: number, level: AiLevel, seed: number, budgetMs: number): Action | null {
    const json = this.inner.botAction(seat, level, seed, budgetMs);
    return json ? (JSON.parse(json) as Action) : null;
  }

  log(): { seat: number; action: Action }[] {
    return JSON.parse(this.inner.log()) as { seat: number; action: Action }[];
  }

  toJSON(): string {
    return this.inner.toJSON();
  }

  free(): void {
    this.inner.free();
  }
}
