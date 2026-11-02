import type { AiLevel, GameConfig, PresetName } from "@/engine/types";
import { PRESET_BY_NAME, presetConfig } from "./presets";

/** How a game is being started from the play hub. */
export type SetupKind = "online" | "bots" | "local";

/**
 * Everything needed to start a game. Produced by the play hub, carried in
 * router state to /game/local or /r/:code.
 */
export interface GameSetup {
  kind: SetupKind;
  preset: PresetName;
  config: GameConfig;
  /** One entry per seat: a bot level, or null for a human. */
  bots: (AiLevel | null)[];
  /** The local player's display name. */
  name: string;
  /** Set when joining (or having just created) an online room. */
  roomCode?: string;
}

export const AI_LEVELS: readonly AiLevel[] = ["ember", "flare", "nova"];

export const AI_LABELS: Record<AiLevel, { label: string; note: string }> = {
  ember: { label: "Ember", note: "Easy. Makes sensible moves but misses chances." },
  flare: { label: "Flare", note: "Medium. Thinks a move ahead and blocks you." },
  nova: { label: "Nova", note: "Hard. Plays out thousands of futures before it moves." },
};

export const MAX_NAME = 24;

export interface SetupInput {
  kind: SetupKind;
  preset: PresetName;
  seats?: number;
  /** Advanced knobs layered over the preset. */
  overrides?: Partial<GameConfig>;
  bots?: (AiLevel | null)[];
  name?: string;
  roomCode?: string;
}

export function clampSeats(n: number): number {
  return Math.min(4, Math.max(2, Math.round(Number.isFinite(n) ? n : 4)));
}

export function cleanName(name: string | undefined): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return n || "Player";
}

/**
 * Builds a consistent GameSetup from loose hub input. Rules it enforces:
 * - seats 2..4; Teams forces 4, Duel forces 2;
 * - teams implies 4 seats; sharedLight requires teams;
 * - fog radius 1..6 or null; storm values positive; 3D presets keep the cube kit;
 * - bots has exactly one entry per seat; in a bots game seat 0 is always you;
 *   online rooms never start with bots (the hub shows their seats as open).
 */
export function buildSetup(input: SetupInput): GameSetup {
  const info = PRESET_BY_NAME[input.preset];
  const requested = input.overrides?.seats ?? input.seats ?? info.defaultSeats;
  const seats = info.seats.length === 1 ? info.seats[0]! : clampSeats(requested);
  const config: GameConfig = { ...presetConfig(input.preset, seats), ...input.overrides, seats };

  if (config.teams) config.seats = 4;
  if (!config.teams) config.sharedLight = false;
  if (config.fog !== null) config.fog = Math.min(6, Math.max(1, Math.round(config.fog)));
  if (config.storm) {
    const { start, every, minSpan } = config.storm;
    config.storm = {
      start: Math.max(1, Math.round(start)),
      every: Math.max(1, Math.round(every)),
      minSpan: Math.max(4, Math.round(minSpan)),
    };
  }
  if (!config.arena) config.nodes = 0;
  if (config.turnSeconds !== null) config.turnSeconds = Math.max(10, Math.round(config.turnSeconds));
  if (info.dimension === "3d") config.kit = "cubes";
  else config.dims = [config.dims[0], config.dims[1], 1];

  const bots: (AiLevel | null)[] = [];
  for (let i = 0; i < config.seats; i++) {
    const given = input.bots?.[i];
    if (input.kind === "local") bots.push(null);
    else if (input.kind === "bots") bots.push(i === 0 ? null : given ?? "flare");
    // Online rooms start with open seats for friends; the host adds bots in the lobby.
    else bots.push(null);
  }

  const setup: GameSetup = {
    kind: input.kind,
    preset: input.preset,
    config,
    bots,
    name: cleanName(input.name),
  };
  if (input.roomCode) setup.roomCode = input.roomCode;
  return setup;
}

/** Where the hub sends you for a setup. */
export function setupPath(setup: GameSetup): string {
  return setup.kind === "online" && setup.roomCode ? `/r/${setup.roomCode}` : "/game/local";
}

/** Short human-readable facts about a config, for summaries and chips. */
export function describeConfig(config: GameConfig): string[] {
  const [w, h, d] = config.dims;
  const out = [d > 1 ? `${w}×${h}×${d}` : `${w}×${h}`, `${config.seats} seats`];
  if (d === 1 && config.shape !== "square") out.push(config.shape);
  if (config.topology === "torus") out.push("wraps");
  if (config.gravity) out.push("gravity");
  if (config.crowns) out.push("crowns");
  if (config.teams) out.push(config.sharedLight ? "teams, shared light" : "teams");
  out.push(config.arena ? `arena, ${config.nodes} nodes` : "no arena");
  if (config.fog !== null) out.push(`fog ${config.fog}`);
  if (config.storm) out.push(`storm r${config.storm.start}/${config.storm.every}`);
  out.push(config.turnSeconds ? `${config.turnSeconds}s turns` : "untimed");
  return out;
}
