import { act, renderHook } from "@testing-library/react";
import type { GameConfig } from "@/engine/types";
import type { ClientMsg, Lobby, ServerMsg } from "./protocol";
import { isRoomCode, newRoomCode } from "./protocol";
import { RoomClient, roomUrl, type SocketLike, type StorageLike } from "./RoomClient";
import { useRoom } from "./useRoom";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: ClientMsg[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // server side helpers
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
  of<T extends ClientMsg["t"]>(t: T) {
    return this.sent.filter((m): m is Extract<ClientMsg, { t: T }> => m.t === t);
  }
}

function memStorage(init: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const config = { seats: 4 } as unknown as GameConfig;

function lobby(seats: Lobby["seats"], hostPid = "host-0001"): ServerMsg {
  return {
    t: "lobby",
    code: "K7QXM",
    phase: "lobby",
    hostPid,
    preset: "plane",
    config,
    seats,
    spectators: [],
  };
}

let now = 1_000_000;

function makeClient(storage = memStorage({ "cubes:pid": "pid-aaaaaaaa" })) {
  const client = new RoomClient({
    code: "K7QXM",
    name: "Ada",
    url: "ws://test/api/room/K7QXM",
    socket: (url) => new FakeSocket(url),
    storage,
    heartbeatMs: 1000,
    random: () => 0.5,
    now: () => now,
  });
  return { client, storage };
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1]!;

beforeEach(() => {
  FakeSocket.all = [];
  now = 1_000_000;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("room codes and urls", () => {
  expect(isRoomCode("K7QXM")).toBe(true);
  expect(isRoomCode("K7QXO")).toBe(false);
  for (let i = 0; i < 50; i++) expect(isRoomCode(newRoomCode())).toBe(true);
  expect(roomUrl("ABCDE", { protocol: "https:", host: "playcubes.pages.dev" })).toBe(
    "wss://playcubes.pages.dev/api/room/ABCDE",
  );
  expect(roomUrl("ABCDE", { protocol: "http:", host: "localhost:5173" })).toBe(
    "ws://localhost:5173/api/room/ABCDE",
  );
  expect(() => new RoomClient({ code: "nope", name: "x" })).toThrow();
});

test("says hello with a persistent pid and stores the seat token", () => {
  const storage = memStorage();
  const { client } = makeClient(storage);
  client.connect();
  expect(client.state.status).toBe("connecting");
  const ws = last();
  expect(ws.url).toBe("ws://test/api/room/K7QXM");
  ws.accept();
  const hello = ws.of("hello")[0]!;
  expect(hello.name).toBe("Ada");
  expect(hello.pid).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(storage.data.get("cubes:pid")).toBe(hello.pid);
  expect(hello.token).toBeNull();
  ws.push({ t: "welcome", pid: hello.pid, token: "tok-1", host: true });
  expect(client.state.status).toBe("open");
  expect(client.state.me).toEqual({ pid: hello.pid, host: true, seat: null });
  expect(storage.data.get("cubes:token:K7QXM")).toBe("tok-1");
});

test("queues sends until welcomed, then flushes in order", () => {
  const { client } = makeClient();
  client.connect();
  client.send({ t: "sit", seat: 1 });
  client.send({ t: "chat", text: "hi" });
  const ws = last();
  ws.accept();
  expect(ws.sent.map((m) => m.t)).toEqual(["hello"]);
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "tok", host: false });
  expect(ws.sent.map((m) => m.t)).toEqual(["hello", "sit", "chat"]);
  client.send({ t: "stand" });
  expect(ws.sent.map((m) => m.t)).toEqual(["hello", "sit", "chat", "stand"]);
});

test("reconnects with capped, jittered backoff and reclaims with the token", () => {
  const { client } = makeClient();
  client.connect();
  let ws = last();
  ws.accept();
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "tok-9", host: false });
  ws.drop();
  expect(client.state.status).toBe("reconnecting");
  // Sends during the outage are queued.
  client.send({ t: "emote", kind: "gg" });
  expect(FakeSocket.all).toHaveLength(1);
  vi.advanceTimersByTime(client.backoff(0));
  expect(FakeSocket.all).toHaveLength(2);
  // Fails again: the next delay is longer.
  last().drop();
  vi.advanceTimersByTime(client.backoff(1) - 1);
  expect(FakeSocket.all).toHaveLength(2);
  vi.advanceTimersByTime(1);
  expect(FakeSocket.all).toHaveLength(3);
  ws = last();
  ws.accept();
  expect(ws.of("hello")[0]!.token).toBe("tok-9");
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "tok-9", host: false });
  expect(ws.of("emote")).toHaveLength(1);
  expect(client.state.status).toBe("open");

  // Backoff grows, then caps at 5 s, with jitter in [cap/2, cap].
  const delays = [0, 1, 2, 3, 4, 5, 10, 30].map((n) => client.backoff(n));
  expect(delays.slice(0, 5)).toEqual([188, 375, 750, 1500, 3000]);
  expect(delays[6]).toBe(3750);
  const lo = new RoomClient({ code: "K7QXM", name: "a", url: "ws://x", random: () => 0 });
  const hi = new RoomClient({ code: "K7QXM", name: "a", url: "ws://x", random: () => 0.9999 });
  expect(lo.backoff(20)).toBe(2500);
  expect(hi.backoff(20)).toBeLessThanOrEqual(5000);
});

test("heartbeat measures latency and replaces a dead socket", () => {
  const { client } = makeClient();
  const latencies: number[] = [];
  client.on("latency", (ms) => latencies.push(ms));
  client.connect();
  const ws = last();
  ws.accept();
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "t", host: false });
  vi.advanceTimersByTime(1000);
  const ping = ws.of("ping")[0]!;
  now += 42;
  ws.push({ t: "pong", ts: ping.ts });
  expect(latencies).toEqual([42]);
  expect(client.state.latency).toBe(42);
  // Silence: after 2.5 intervals without a pong the socket is replaced.
  vi.advanceTimersByTime(1000);
  now += 3000;
  vi.advanceTimersByTime(1000);
  expect(ws.closed).toBe(true);
  expect(client.state.status).toBe("reconnecting");
  vi.advanceTimersByTime(client.backoff(0));
  expect(FakeSocket.all).toHaveLength(2);
});

test("tracks lobby, seat, host, view, clock and chat", () => {
  const { client } = makeClient();
  const seen: string[] = [];
  client.on("message", (m) => seen.push(m.t));
  client.connect();
  const ws = last();
  ws.accept();
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "t", host: false });
  ws.push(
    lobby(
      [
        { seat: 0, kind: "bot", name: "Flare", connected: true, level: "flare" },
        { seat: 1, kind: "human", name: "Ada", pid: "pid-aaaaaaaa", connected: true },
      ],
      "pid-aaaaaaaa",
    ),
  );
  expect(client.state.me).toEqual({ pid: "pid-aaaaaaaa", host: true, seat: 1 });
  expect(client.state.lobby?.seats[0]?.level).toBe("flare");
  expect((client.state.lobby as unknown as { t?: string }).t).toBeUndefined();
  ws.push({ t: "clock", seat: 1, endsAt: 5 });
  expect(client.state.clock).toEqual({ seat: 1, endsAt: 5 });
  ws.push({ t: "chat", name: "Ada", seat: 1, text: "hi", at: 3 });
  expect(client.state.chat).toEqual([{ name: "Ada", seat: 1, text: "hi", at: 3 }]);
  ws.push({ t: "view", view: { ply: 3 } as never });
  expect(client.state.view?.ply).toBe(3);
  // The finished match arrives for the replay; a new game clears it.
  ws.push({ t: "replay", game: '{"seed":18446744073709551608}' });
  expect(client.state.replay).toBe('{"seed":18446744073709551608}');
  ws.push({ t: "view", view: { ply: 0, phase: "playing" } as never });
  expect(client.state.replay).toBeNull();
  ws.push({ t: "error", code: "stale", message: "out of date" });
  expect(client.state.error?.code).toBe("stale");
  // Garbage frames are ignored.
  ws.onmessage?.({ data: "{not json" });
  ws.onmessage?.({ data: 7 });
  expect(seen).toEqual(["welcome", "lobby", "clock", "chat", "view", "replay", "view", "error"]);
  // A new welcome (reconnect) resets chat, since the server replays it.
  ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "t", host: true });
  expect(client.state.chat).toEqual([]);
});

test("a refused pid switches to a room-scoped one", () => {
  const { client, storage } = makeClient();
  client.connect();
  const ws = last();
  ws.accept();
  ws.push({ t: "error", code: "badToken", message: "taken" });
  const hellos = ws.of("hello");
  expect(hellos).toHaveLength(2);
  expect(hellos[1]!.pid).not.toBe("pid-aaaaaaaa");
  expect(storage.data.get("cubes:pid:K7QXM")).toBe(hellos[1]!.pid);
  expect(storage.data.get("cubes:pid")).toBe("pid-aaaaaaaa");
});

test("close stops reconnecting", () => {
  const { client } = makeClient();
  client.connect();
  last().accept();
  client.close();
  expect(client.state.status).toBe("closed");
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("useRoom exposes live room state", () => {
  const storage = memStorage({ "cubes:pid": "pid-aaaaaaaa" });
  const { result, unmount } = renderHook(() =>
    useRoom("K7QXM", "Ada", { url: "ws://t", socket: (u) => new FakeSocket(u), storage }),
  );
  expect(["connecting", "idle"]).toContain(result.current.status);
  const ws = last();
  act(() => {
    ws.accept();
    ws.push({ t: "welcome", pid: "pid-aaaaaaaa", token: "t", host: true });
  });
  expect(result.current.status).toBe("open");
  expect(result.current.me?.host).toBe(true);
  act(() => result.current.send({ t: "sit", seat: 0 }));
  expect(ws.of("sit")).toHaveLength(1);
  unmount();
  expect(ws.closed).toBe(true);
});
