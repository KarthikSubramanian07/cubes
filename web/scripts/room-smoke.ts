/**
 * End-to-end smoke test for the room server.
 *
 *   cd crates/rooms && npx wrangler@4 dev        # serves :8787
 *   cd web && bun run scripts/room-smoke.ts
 *
 * Two humans join ws://127.0.0.1:8787/api/room/ABCDE through RoomClient.
 * The host seats two bots and starts a 4-seat Plane game. Both humans play
 * legal moves picked from their own views. Midway the guest drops and
 * reclaims its seat with its token, and an impostor using the guest's pid
 * without the token is refused. The game must reach `phase: "over"` with
 * scores. Env: ROOM_BASE (default ws://127.0.0.1:8787), ROOM (default ABCDE;
 * if that room is already taken by an earlier run, a fresh code is used),
 * SKIP_HEALTH=1 when ROOM_BASE is a Pages origin (`wrangler pages dev dist`)
 * so the run exercises the Pages Function proxy too.
 */

import type { Action, View } from "../src/engine/types";
import { newRoomCode, type ClientMsg, type Lobby, type ServerMsg } from "../src/net/protocol";
import { RoomClient, type StorageLike } from "../src/net/RoomClient";

const BASE = process.env.ROOM_BASE ?? "ws://127.0.0.1:8787";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 240_000);

// ---- a tiny legal-move picker for flat 2D boards ----------------------------
// Mirrors crates/engine/src/pieces.rs: same shard order, same orientation
// order (8 planar maps in permutation-major order, normalized, deduped).

type V3 = [number, number, number];
const SHARDS: [number, number][][] = [
  [[0, 0], [1, 0]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 2]],
  [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
];

const cmp = (a: V3, b: V3) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function normalize(cells: V3[]): V3[] {
  const min = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c[a]!)));
  return cells.map((c) => [c[0] - min[0]!, c[1] - min[1]!, c[2] - min[2]!] as V3).sort(cmp);
}

function orientations(shape: [number, number][]): V3[][] {
  const cells: V3[] = shape.map(([x, y]) => [x, y, 0]);
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const out: V3[][] = [];
  for (const p of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let r = 0; r < 3; r++) m[r]![p[r]!] = signs & (1 << r) ? -1 : 1;
      if (m[2]![2] !== 1) continue;
      const img = cells.map((c) => [0, 1, 2].map((r) => m[r]![0]! * c[0] + m[r]![1]! * c[1] + m[r]![2]! * c[2]) as V3);
      const n = normalize(img);
      const key = JSON.stringify(n);
      if (!out.some((o) => JSON.stringify(o) === key)) out.push(n);
    }
  }
  return out;
}

const KIT = SHARDS.map(orientations);

/** The biggest legal placement for the viewer's seat, or a resignation. */
function pickMove(view: View): Action {
  const seat = view.seat!;
  const me = seat + 1;
  const [w, h] = view.config.dims;
  const own = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && view.cells[x + w * y] === me;
  const pieces = view.seats[seat]!.pieces!;
  const order = KIT.map((_, i) => i).sort((a, b) => SHARDS[b]!.length - SHARDS[a]!.length);
  for (const piece of order) {
    if (!pieces[piece]) continue;
    const orients = KIT[piece]!;
    for (let orient = 0; orient < orients.length; orient++) {
      const shape = orients[orient]!;
      for (let ay = 0; ay < h; ay++) {
        for (let ax = 0; ax < w; ax++) {
          let ok = true;
          let corner = false;
          for (const [dx, dy] of shape) {
            const x = ax + dx;
            const y = ay + dy;
            if (x >= w || y >= h || view.cells[x + w * y] !== 0) {
              ok = false;
              break;
            }
            if (own(x + 1, y) || own(x - 1, y) || own(x, y + 1) || own(x, y - 1)) {
              ok = false;
              break;
            }
            if (own(x + 1, y + 1) || own(x - 1, y + 1) || own(x + 1, y - 1) || own(x - 1, y - 1)) {
              corner = true;
            }
          }
          if (ok && corner) return { type: "place", piece, orient, at: [ax, ay, 0], leap: false };
        }
      }
    }
  }
  return { type: "resign" };
}

// ---- harness -----------------------------------------------------------------

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

function waitFor<T>(client: RoomClient, pred: (m: ServerMsg) => T | undefined | false, what: string, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`smoke: timed out waiting for ${what}`));
    }, ms);
    const off = client.on("message", (m) => {
      const v = pred(m);
      if (v !== undefined && v !== false) {
        clearTimeout(timer);
        off();
        resolve(v as T);
      }
    });
  });
}

const log = (...a: unknown[]) => console.log("[smoke]", ...a);

/** Play this client's seat whenever its view says it's on turn. */
function autoplay(client: RoomClient, label: string, stats: { moves: number }) {
  let lastPly = -1;
  const act = (view: View) => {
    if (view.phase !== "playing" || view.seat === null || view.turn !== view.seat) return;
    if (view.ply === lastPly) return;
    lastPly = view.ply;
    const action = pickMove(view);
    stats.moves++;
    client.send({ t: "action", action, ply: view.ply });
    if (action.type === "resign") log(`${label} has no move and resigns`);
  };
  const off = client.on("view", act);
  if (client.state.view) act(client.state.view);
  return off;
}

function connect(code: string, name: string, storage: StorageLike) {
  const client = new RoomClient({ code, name, url: `${BASE}/api/room/${code}`, storage, heartbeatMs: 5000 });
  client.on("error", (e) => {
    if (e.code !== "rateLimited") log(`${name} got error ${e.code}: ${e.message}`);
  });
  return client;
}

async function join(code: string, name: string, storage: StorageLike) {
  const client = connect(code, name, storage);
  const welcome = waitFor(client, (m) => (m.t === "welcome" ? m : undefined), `${name} welcome`);
  client.connect();
  return { client, welcome: await welcome };
}

async function rawHello(code: string, msg: ClientMsg): Promise<ServerMsg> {
  const ws = new WebSocket(`${BASE}/api/room/${code}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("smoke: raw hello timed out")), 10_000);
    ws.onopen = () => ws.send(JSON.stringify(msg));
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(String(ev.data)) as ServerMsg);
    };
    ws.onerror = () => reject(new Error("smoke: raw socket error"));
  });
}

async function main() {
  const started = Date.now();
  if (!process.env.SKIP_HEALTH) {
    // The Worker serves /api/health; through Pages (SKIP_HEALTH=1) it doesn't exist.
    const health = await fetch(BASE.replace(/^ws/, "http") + "/api/health");
    check(health.ok && (await health.text()) === "ok", "health check");
    log("health ok");
  }
  const bad = await fetch(BASE.replace(/^ws/, "http") + "/api/room/ABCDI", { headers: { Upgrade: "websocket" } });
  check(bad.status === 400, `bad code should be 400, got ${bad.status}`);

  let code = process.env.ROOM ?? "ABCDE";
  const hostStore = memStorage();
  let host = await join(code, "Host", hostStore);
  if (!host.welcome.host) {
    host.client.close();
    code = newRoomCode();
    log(`room ABCDE is held by an earlier run; using ${code}`);
    host = await join(code, "Host", hostStore);
  }
  check(host.welcome.host, "first player is host");
  const guestStore = memStorage();
  const guest = await join(code, "Guest", guestStore);
  check(!guest.welcome.host, "second player is not host");
  log(`room ${code}: host ${host.welcome.pid}, guest ${guest.welcome.pid}`);

  const seated = waitFor(
    host.client,
    (m) =>
      m.t === "lobby" && m.seats.filter((s) => s.kind !== "empty").length === 4 ? (m as Lobby) : undefined,
    "four filled seats",
  );
  host.client.send({ t: "sit", seat: 0 });
  guest.client.send({ t: "sit", seat: 1 });
  host.client.send({ t: "setBot", seat: 2, level: "flare" });
  host.client.send({ t: "setBot", seat: 3, level: "ember" });
  const lobby = await seated;
  log("seats:", lobby.seats.map((s) => `${s.seat}:${s.kind}:${s.name}`).join(" "));
  check(lobby.seats[1]!.pid === guest.welcome.pid, "guest in seat 1");

  // Guests can't start.
  const notHost = waitFor(guest.client, (m) => (m.t === "error" ? m.code : undefined), "notHost");
  guest.client.send({ t: "start" });
  check((await notHost) === "notHost", "guest start refused");

  const playing = waitFor(host.client, (m) => (m.t === "view" ? m.view : undefined), "first view");
  host.client.send({ t: "start" });
  const first = await playing;
  check(first.config.seats === 4 && first.seat === 0, "host sees seat 0 of a 4-seat game");
  log(`game started on ${first.config.dims.join("x")}`);

  const stats = { moves: 0 };
  autoplay(host.client, "host", stats);
  const offGuest = autoplay(guest.client, "guest", stats);

  // Let a few rounds happen, then drop the guest and reclaim the seat.
  await waitFor(host.client, (m) => (m.t === "view" && m.view.ply >= 6 ? true : undefined), "ply 6", 60_000);
  offGuest();
  guest.client.close();
  const dropped = await waitFor(
    host.client,
    (m) => (m.t === "lobby" && m.seats[1] && !m.seats[1].connected ? true : undefined),
    "guest shown disconnected",
  );
  check(dropped, "disconnect visible");

  const impostor = await rawHello(code, { t: "hello", pid: guest.welcome.pid, name: "Impostor" });
  check(impostor.t === "error" && impostor.code === "badToken", `impostor refused, got ${JSON.stringify(impostor)}`);
  log("impostor without token refused");

  const back = await join(code, "Guest", guestStore);
  check(back.welcome.pid === guest.welcome.pid, "same pid after reconnect");
  check(back.welcome.token === guest.welcome.token, "same token after reconnect");
  const backView = back.client.state.view ?? (await waitFor(back.client, (m) => (m.t === "view" ? m.view : undefined), "view after reclaim"));
  check(backView.seat === 1, "reclaimed seat 1");
  check(back.client.state.lobby?.seats[1]?.connected, "seat 1 connected again");
  log(`guest reclaimed seat 1 at ply ${backView.ply}`);
  autoplay(back.client, "guest", stats);

  const deadline = started + TIMEOUT_MS;
  const over = await waitFor(
    host.client,
    (m) => (m.t === "view" && m.view.phase === "over" ? m.view : undefined),
    "game over",
    deadline - Date.now(),
  );
  check(over.scores && over.scores.length === 4, "final scores for 4 seats");
  check(over.winners && over.winners.length >= 1, "winners");
  const finalLobby = await waitFor(host.client, (m) => (m.t === "lobby" ? m : undefined), "final lobby", 5000).catch(
    () => host.client.state.lobby,
  );
  check(finalLobby?.phase === "over", "lobby phase over");
  log(`game over after ${over.ply} plies (${stats.moves} human moves): scores ${over.scores.join(", ")}, winners ${over.winners.join(", ")}`);

  // Rematch starts a fresh game with the same seats.
  const rematch = waitFor(host.client, (m) => (m.t === "view" && m.view.ply === 0 ? m.view : undefined), "rematch view");
  host.client.send({ t: "rematch" });
  check((await rematch).phase === "playing", "rematch playing");
  log("rematch started");

  host.client.close();
  back.client.close();
  log(`PASS in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
