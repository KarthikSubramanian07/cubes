import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import type { AiLevel } from "@/engine/types";
import { useDocumentMeta, SITE_URL } from "@/app/meta";
import { isRoomCode, normalizeRoomCode } from "@/app/roomCode";
import { buildSetup, cleanName, type GameSetup } from "@/app/setup";
import { Button } from "@/ui/Button";
import { HandNote } from "@/ui/HandNote";
import { RoomLobby, type LobbySeat } from "./room/RoomLobby";

interface RoomState {
  setup?: GameSetup;
  host?: boolean;
  name?: string;
}

function initialSeats(setup: GameSetup, name: string, host: boolean): LobbySeat[] {
  return Array.from({ length: setup.config.seats }, (_, i): LobbySeat => {
    if (i === 0) return { kind: "player", name: cleanName(name), ready: !host, host, you: true, connected: true };
    const bot = setup.bots[i];
    return bot ? { kind: "bot", level: bot } : { kind: "empty" };
  });
}

/**
 * /r/:code. For now the lobby runs on local mock state; the room Durable Object
 * client (WebSocket) will replace `seats`/`connection` and the handlers.
 */
export function Component() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = params.code ?? "";
  const code = normalizeRoomCode(raw);
  const state = (location.state ?? {}) as RoomState;
  // Mock: arriving with no router state means you opened a fresh link first, so you hold the room.
  const host = state.host ?? !state.name;
  const setup = state.setup ?? buildSetup({ kind: "online", preset: "plane", name: state.name });
  const [name, setName] = useState(state.setup?.name ?? state.name ?? "");
  const [seats, setSeats] = useState<LobbySeat[]>(() => initialSeats(setup, name, host));

  useDocumentMeta({
    title: code ? `Room ${code}` : "Room not found",
    description: "You've been invited to a game of cubes. Open the link, pick a name, and take a seat.",
    path: `/r/${code ?? raw}`,
    noindex: true,
  });

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

  function setBot(seat: number, level: AiLevel | null) {
    setSeats((xs) => xs.map((s, i) => (i === seat ? (level ? { kind: "bot", level } : { kind: "empty" }) : s)));
  }

  return (
    <RoomLobby
      code={code}
      shareUrl={`${SITE_URL}/r/${code}`}
      preset={setup.preset}
      config={setup.config}
      seats={seats}
      isHost={host}
      yourName={name}
      connection="connecting"
      onNameChange={(n) => {
        setName(n);
        setSeats((xs) => xs.map((s) => (s.kind === "player" && s.you ? { ...s, name: cleanName(n) } : s)));
      }}
      onReady={(r) => setSeats((xs) => xs.map((s) => (s.kind === "player" && s.you ? { ...s, ready: r } : s)))}
      onSetBot={setBot}
      onStart={() =>
        navigate(`/game/${code}`, {
          state: { setup: { ...setup, name: cleanName(name), bots: seats.map((s) => (s.kind === "bot" ? s.level : null)), roomCode: code } },
        })
      }
      onLeave={() => navigate("/play")}
    />
  );
}
