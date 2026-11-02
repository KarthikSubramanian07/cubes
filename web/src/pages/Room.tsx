import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { useDocumentMeta, SITE_URL } from "@/app/meta";
import { isRoomCode, normalizeRoomCode } from "@/app/roomCode";
import { cleanName, type GameSetup } from "@/app/setup";
import { Button } from "@/ui/Button";
import { HandNote } from "@/ui/HandNote";
import { useRoom } from "@/net/useRoom";
import type { Lobby } from "@/net/protocol";
import { RoomLobby, type LobbySeat } from "./room/RoomLobby";

const OnlineGame = lazy(() => import("@/game/OnlineGame"));

interface RoomState {
  setup?: GameSetup;
  host?: boolean;
  name?: string;
}

const NAME_KEY = "cubes:name";

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* private mode */
  }
}

/** Map the server's lobby onto the presentational lobby's seats. */
export function lobbySeats(lobby: Lobby, myPid: string | null): LobbySeat[] {
  return lobby.seats.map((s): LobbySeat => {
    if (s.kind === "bot") return { kind: "bot", level: s.level ?? "flare" };
    if (s.kind === "human")
      return {
        kind: "player",
        name: s.name,
        ready: true,
        host: s.pid === lobby.hostPid,
        you: s.pid === myPid,
        connected: s.connected,
      };
    return { kind: "empty" };
  });
}

/** /r/:code: the live room. Lobby first, then the game in place. */
export function Component() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = params.code ?? "";
  const code = normalizeRoomCode(raw);
  const state = (location.state ?? {}) as RoomState;
  const [name, setName] = useState(() => cleanName(state.setup?.name ?? state.name ?? storedName()));
  const valid = !!code && isRoomCode(code) && code === raw;
  const room = useRoom(valid ? code : null, name);
  const configured = useRef(false);
  const autoSat = useRef(false);

  useDocumentMeta({
    title: code ? `Room ${code}` : "Room not found",
    description: "You've been invited to a game of cubes. Open the link, pick a name, and take a seat.",
    path: `/r/${code ?? raw}`,
    noindex: true,
  });

  const me = room.me;
  const lobby = room.lobby;

  // The creator arrives with the play hub's setup: apply it once, as host.
  useEffect(() => {
    if (!lobby || !me?.host || configured.current || lobby.phase !== "lobby") return;
    configured.current = true;
    const setup = state.setup;
    if (!setup) return;
    room.send({ t: "configure", preset: setup.preset, config: setup.config });
    if (me.seat === null) room.send({ t: "sit", seat: 0 });
    setup.bots.forEach((level, i) => {
      if (level && i > 0) room.send({ t: "setBot", seat: i, level });
    });
  }, [lobby, me, state.setup, room]);

  // Friends who open the link sit down automatically if there's room.
  useEffect(() => {
    if (!lobby || !me || autoSat.current || lobby.phase !== "lobby" || me.seat !== null) return;
    if (me.host && state.setup) return;
    const free = lobby.seats.find((s) => s.kind === "empty");
    autoSat.current = true;
    if (free) room.send({ t: "sit", seat: free.seat });
  }, [lobby, me, state.setup, room]);

  if (!code || !isRoomCode(code)) {
    return (
      <section className="wrap-narrow lobby-missing">
        <HandNote tilt={-4} size="lg">
          that code has a typo in it, probably
        </HandNote>
        <h1>
          No room called <em>{raw.slice(0, 12) || "that"}</em>.
        </h1>
        <p className="lede">Room codes are five characters, letters and digits, without I, O, 0 or 1. Check the link, or make a new room.</p>
        <Button to="/play" state={{ kind: "online" }}>
          Make a room
        </Button>
      </section>
    );
  }

  if (code !== raw) return <Navigate to={`/r/${code}`} replace state={location.state} />;

  if (lobby && lobby.phase !== "lobby" && room.view) {
    return (
      <Suspense fallback={null}>
        <OnlineGame room={room} code={code} onLeave={() => navigate("/play")} />
      </Suspense>
    );
  }

  const connection = room.status === "open" ? "open" : room.status === "closed" ? "closed" : "connecting";
  const preset = lobby?.preset && lobby.preset !== "custom" ? lobby.preset : (state.setup?.preset ?? "plane");
  const config = lobby?.config ?? state.setup?.config;
  const seats = lobby ? lobbySeats(lobby, me?.pid ?? null) : [];

  return (
    <RoomLobby
      code={code}
      shareUrl={`${SITE_URL}/r/${code}`}
      preset={preset}
      config={config ?? { dims: [20, 20, 1], shape: "square", topology: "flat", gravity: false, seats: 4, teams: false, sharedLight: false, arena: true, nodes: 12, fog: null, storm: null, crowns: false, turnSeconds: null, kit: "shards" }}
      seats={seats.length ? seats : [{ kind: "empty" }, { kind: "empty" }, { kind: "empty" }, { kind: "empty" }]}
      isHost={!!me?.host}
      yourName={name}
      connection={connection}
      onNameChange={(n) => {
        setName(n);
        rememberName(n);
      }}
      onReady={() => {}}
      onSit={(seat) => room.send({ t: "sit", seat })}
      onStand={() => room.send({ t: "stand" })}
      onKick={(seat) => room.send({ t: "kick", seat })}
      onSetBot={(seat, level) => room.send({ t: "setBot", seat, level })}
      onStart={() => room.send({ t: "start" })}
      onLeave={() => navigate("/play")}
      spectators={lobby?.spectators.map((s) => s.name) ?? []}
    />
  );
}
