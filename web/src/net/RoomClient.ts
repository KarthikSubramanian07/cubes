/**
 * RoomClient: one player's connection to a room Durable Object.
 *
 * - WebSocket to `/api/room/:code` on the same origin (or an explicit url).
 * - Reconnects with exponential backoff and full jitter, capped at 5 s.
 * - A persistent player id in localStorage (`cubes:pid`) and a per-room seat
 *   token (`cubes:token:CODE`) so a reload or a dropped network reclaims
 *   the same seat.
 * - Heartbeat pings measure latency and detect dead sockets.
 * - Sends made while reconnecting are queued and flushed after `welcome`.
 */

import type { View } from "@/engine/types";
import {
  isRoomCode,
  parseServerMsg,
  type ClientMsg,
  type EmoteKind,
  type ErrorCode,
  type Lobby,
  type ServerMsg,
} from "./protocol";

export type RoomStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface ChatLine {
  name: string;
  seat: number | null;
  text: string;
  at: number;
}

export interface Me {
  pid: string;
  host: boolean;
  /** Seat index while seated (lobby) or playing; null for spectators. */
  seat: number | null;
}

export interface Clock {
  seat: number;
  endsAt: number | null;
}

export interface RoomError {
  code: ErrorCode | "closed";
  message: string;
  at: number;
}

export interface RoomState {
  status: RoomStatus;
  lobby: Lobby | null;
  view: View | null;
  me: Me | null;
  clock: Clock | null;
  chat: ChatLine[];
  error: RoomError | null;
  /** Round-trip time of the last heartbeat, in ms. */
  latency: number | null;
}

export interface RoomEvents {
  state: RoomState;
  status: RoomStatus;
  message: ServerMsg;
  welcome: Extract<ServerMsg, { t: "welcome" }>;
  lobby: Lobby;
  view: View;
  clock: Clock;
  chat: ChatLine;
  emote: { name: string; seat: number | null; kind: EmoteKind };
  error: RoomError;
  latency: number;
}

type Listener<T> = (value: T) => void;

/** The bits of the WebSocket API we use, so tests can pass a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RoomClientOptions {
  code: string;
  name: string;
  /** Full ws(s) URL; defaults to `/api/room/CODE` on the current origin. */
  url?: string;
  socket?: SocketFactory;
  storage?: StorageLike;
  heartbeatMs?: number;
  /** Max backoff between reconnects. */
  maxBackoffMs?: number;
  random?: () => number;
  now?: () => number;
}

const OPEN = 1;
const MAX_QUEUE = 64;
const MAX_CHAT = 100;
const PID_KEY = "cubes:pid";

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Private mode or sandboxed iframes can throw on access.
  }
  return memoryStorage();
}

export function randomPid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "p" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function roomUrl(code: string, loc: { protocol: string; host: string } = location): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/api/room/${code}`;
}

export class RoomClient {
  readonly code: string;
  private name: string;
  private readonly url: string;
  private readonly makeSocket: SocketFactory;
  private readonly storage: StorageLike;
  private readonly heartbeatMs: number;
  private readonly maxBackoffMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  private ws: SocketLike | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private welcomed = false;
  private stopped = true;
  private queue: string[] = [];
  private listeners = new Map<keyof RoomEvents, Set<Listener<never>>>();
  private _state: RoomState = {
    status: "idle",
    lobby: null,
    view: null,
    me: null,
    clock: null,
    chat: [],
    error: null,
    latency: null,
  };

  constructor(opts: RoomClientOptions) {
    if (!isRoomCode(opts.code)) throw new Error(`bad room code: ${opts.code}`);
    this.code = opts.code;
    this.name = opts.name;
    this.url = opts.url ?? roomUrl(opts.code);
    this.makeSocket = opts.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.storage = opts.storage ?? defaultStorage();
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5_000;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  // ---- identity -------------------------------------------------------

  /** This browser's player id for this room (room-scoped if the global one was refused). */
  get pid(): string {
    const scoped = this.storage.getItem(`${PID_KEY}:${this.code}`);
    if (scoped) return scoped;
    let pid = this.storage.getItem(PID_KEY);
    if (!pid) {
      pid = randomPid();
      this.storage.setItem(PID_KEY, pid);
    }
    return pid;
  }

  private get tokenKey(): string {
    return `cubes:token:${this.code}`;
  }

  // ---- events ---------------------------------------------------------

  on<K extends keyof RoomEvents>(event: K, fn: Listener<RoomEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof RoomEvents>(event: K, value: RoomEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) (fn as Listener<RoomEvents[K]>)(value);
  }

  get state(): RoomState {
    return this._state;
  }

  private patch(p: Partial<RoomState>): void {
    this._state = { ...this._state, ...p };
    this.emit("state", this._state);
  }

  private setStatus(status: RoomStatus): void {
    if (this._state.status === status) return;
    this.patch({ status });
    this.emit("status", status);
  }

  // ---- lifecycle ------------------------------------------------------

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  /** Close for good (no reconnect). */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, "bye");
      } catch {
        // already closed
      }
    }
    this.welcomed = false;
    this.setStatus("closed");
  }

  private open(): void {
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: SocketLike;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => {
      this.lastPong = this.now();
      this.sendRaw(
        JSON.stringify({
          t: "hello",
          pid: this.pid,
          name: this.name,
          token: this.storage.getItem(this.tokenKey),
        } satisfies ClientMsg),
      );
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      const msg = parseServerMsg(ev.data);
      if (msg) this.receive(msg);
    };
    ws.onclose = () => this.dropped();
    ws.onerror = () => {
      // A close event always follows; reconnect happens there.
    };
  }

  private dropped(): void {
    const ws = this.ws;
    if (ws) ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    this.ws = null;
    this.welcomed = false;
    this.stopHeartbeat();
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  /** Delay before attempt `n` (0-based): full jitter over min(cap, 250 * 2^n). */
  backoff(n: number): number {
    const ceiling = Math.min(this.maxBackoffMs, 250 * 2 ** n);
    return Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.setStatus("reconnecting");
    const delay = this.backoff(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.now() - this.lastPong > this.heartbeatMs * 2.5) {
        // No pong for a while: the socket is dead even if it looks open.
        try {
          this.ws?.close(4000, "heartbeat timeout");
        } catch {
          // ignore
        }
        this.dropped();
        return;
      }
      this.sendRaw(JSON.stringify({ t: "ping", ts: this.now() } satisfies ClientMsg));
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // ---- sending --------------------------------------------------------

  /** Send a message now, or queue it until the room has welcomed us. */
  send(msg: ClientMsg): void {
    if (msg.t === "rename") this.name = msg.name;
    const text = JSON.stringify(msg);
    if (this.welcomed && this.ws?.readyState === OPEN) {
      this.sendRaw(text);
      return;
    }
    if (msg.t === "ping" || msg.t === "hello") return;
    this.queue.push(text);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  private sendRaw(text: string): void {
    try {
      this.ws?.send(text);
    } catch {
      // The close handler will reconnect.
    }
  }

  private flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const text of q) this.sendRaw(text);
  }

  // ---- receiving ------------------------------------------------------

  private seatOf(lobby: Lobby | null, pid: string): number | null {
    const s = lobby?.seats.find((x) => x.kind === "human" && x.pid === pid);
    return s ? s.seat : null;
  }

  private receive(msg: ServerMsg): void {
    this.emit("message", msg);
    switch (msg.t) {
      case "welcome": {
        this.storage.setItem(this.tokenKey, msg.token);
        this.attempt = 0;
        this.welcomed = true;
        this.patch({
          me: { pid: msg.pid, host: msg.host, seat: this.seatOf(this._state.lobby, msg.pid) },
          error: null,
          // The server replays recent chat after every welcome.
          chat: [],
        });
        this.setStatus("open");
        this.emit("welcome", msg);
        this.flush();
        break;
      }
      case "lobby": {
        const { t: _t, ...lobby } = msg;
        const me = this._state.me;
        this.patch({
          lobby,
          me: me ? { ...me, host: lobby.hostPid === me.pid, seat: this.seatOf(lobby, me.pid) } : me,
        });
        this.emit("lobby", lobby);
        break;
      }
      case "view":
        this.patch({ view: msg.view });
        this.emit("view", msg.view);
        break;
      case "clock": {
        const clock = { seat: msg.seat, endsAt: msg.endsAt };
        this.patch({ clock });
        this.emit("clock", clock);
        break;
      }
      case "chat": {
        const line = { name: msg.name, seat: msg.seat, text: msg.text, at: msg.at };
        this.patch({ chat: [...this._state.chat, line].slice(-MAX_CHAT) });
        this.emit("chat", line);
        break;
      }
      case "emote":
        this.emit("emote", { name: msg.name, seat: msg.seat, kind: msg.kind });
        break;
      case "error": {
        if (msg.code === "badToken") {
          // Someone else holds this pid here: use a room-scoped one.
          this.storage.setItem(`${PID_KEY}:${this.code}`, randomPid());
          this.storage.removeItem(this.tokenKey);
          this.sendRaw(
            JSON.stringify({ t: "hello", pid: this.pid, name: this.name } satisfies ClientMsg),
          );
        }
        const error = { code: msg.code, message: msg.message, at: this.now() };
        this.patch({ error });
        this.emit("error", error);
        break;
      }
      case "pong": {
        this.lastPong = this.now();
        const latency = Math.max(0, this.now() - msg.ts);
        this.patch({ latency });
        this.emit("latency", latency);
        break;
      }
    }
  }
}
