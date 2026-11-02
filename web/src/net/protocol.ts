/**
 * The room wire protocol: JSON messages tagged by `t`, camelCase fields.
 * Mirrors crates/rooms/src/protocol.rs exactly. Keep both sides in sync.
 */

import type { Action, AiLevel, GameConfig, PresetName, View } from "@/engine/types";

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_CHAT_CHARS = 200;
export const MAX_NAME_CHARS = 24;
export const MAX_SEATS = 4;

export const EMOTES = ["nice", "oof", "gg", "hmm", "wow", "zap"] as const;
export type EmoteKind = (typeof EMOTES)[number];

/** Five characters from an alphabet without I, O, 0 or 1. */
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isRoomCode(code: string): boolean {
  return ROOM_CODE.test(code);
}

/** A fresh random room code. */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = "";
  for (const b of bytes) s += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return s;
}

/** Player ids: 8 to 64 of [A-Za-z0-9_-]. */
export const PID = /^[A-Za-z0-9_-]{8,64}$/;

export type ClientMsg =
  | { t: "hello"; pid: string; name: string; token?: string | null }
  | { t: "rename"; name: string }
  | { t: "sit"; seat: number }
  | { t: "stand" }
  | { t: "configure"; preset: PresetName | "custom"; config: GameConfig }
  | { t: "setBot"; seat: number; level: AiLevel | null }
  | { t: "kick"; seat: number }
  | { t: "start" }
  | { t: "action"; action: Action; ply: number }
  | { t: "rematch" }
  | { t: "chat"; text: string }
  | { t: "emote"; kind: EmoteKind }
  | { t: "ping"; ts: number };

export type RoomPhase = "lobby" | "playing" | "over";
export type SeatKind = "empty" | "human" | "bot";

export interface LobbySeat {
  seat: number;
  kind: SeatKind;
  name: string;
  pid?: string;
  connected: boolean;
  level?: AiLevel;
  /** A disconnected human whose seat a bot is playing for now. */
  autopilot?: boolean;
}

export interface Spectator {
  pid: string;
  name: string;
}

export interface Lobby {
  code: string;
  phase: RoomPhase;
  hostPid: string | null;
  preset: PresetName | "custom";
  config: GameConfig;
  seats: LobbySeat[];
  spectators: Spectator[];
}

export type ErrorCode =
  | "badMessage"
  | "tooLarge"
  | "rateLimited"
  | "noHello"
  | "badToken"
  | "notHost"
  | "wrongPhase"
  | "badSeat"
  | "badConfig"
  | "notEnoughPlayers"
  | "stale"
  | "illegal";

export type ServerMsg =
  | { t: "welcome"; pid: string; token: string; host: boolean }
  | ({ t: "lobby" } & Lobby)
  | { t: "view"; view: View }
  /** Turn timer; `endsAt` is epoch ms, null when no clock is running. */
  | { t: "clock"; seat: number; endsAt: number | null }
  | { t: "error"; code: ErrorCode; message: string }
  | { t: "chat"; name: string; seat: number | null; text: string; at: number }
  | { t: "emote"; name: string; seat: number | null; kind: EmoteKind }
  | { t: "pong"; ts: number };

export type ServerMsgOf<T extends ServerMsg["t"]> = Extract<ServerMsg, { t: T }>;

/** Parse a frame from the server; null if it isn't a known message. */
export function parseServerMsg(data: unknown): ServerMsg | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as unknown;
    if (msg && typeof msg === "object" && typeof (msg as { t?: unknown }).t === "string") {
      return msg as ServerMsg;
    }
  } catch {
    // fall through
  }
  return null;
}
