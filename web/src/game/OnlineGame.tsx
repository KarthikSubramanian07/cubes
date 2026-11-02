/**
 * An online match inside a room. The server is the referee; this screen
 * shows the seat's (possibly fogged) view, computes hints locally from it,
 * and sends actions tagged with the ply they were made at.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LocalGame, getKit, loadEngine } from "@/engine/engine";
import type { Action, Kit, Placement, View } from "@/engine/types";
import { SEAT_NAMES } from "@/engine/types";
import { SoundProvider, useSound } from "@/audio";
import type { UseRoom } from "@/net/useRoom";
import { EMOTES, MAX_CHAT_CHARS, type EmoteKind } from "@/net/protocol";
import { GameScreen, SEAT_COLORS, type SeatInfo } from "./GameScreen";
import { PRESET_TITLES } from "./LocalGamePage";
import "./online.css";

const EMOTE_GLYPH: Record<EmoteKind, string> = { nice: "nice!", oof: "oof", gg: "gg", hmm: "hmm…", wow: "wow", zap: "⚡" };

interface Props {
  room: UseRoom;
  code: string;
  onLeave(): void;
}

export default function OnlineGame(props: Props) {
  return (
    <SoundProvider>
      <Online {...props} />
    </SoundProvider>
  );
}

function Online({ room, code, onLeave }: Props) {
  const sound = useSound();
  const [ready, setReady] = useState(false);
  const view = room.view!;
  const lobby = room.lobby!;
  const belief = useRef<{ ply: number; key: string; game: LocalGame } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadEngine().then(() => alive && setReady(true));
    return () => {
      alive = false;
      belief.current?.game.free();
      belief.current = null;
    };
  }, []);

  const kit: Kit | null = useMemo(() => (ready ? getKit(view.config.kit) : null), [ready, view.config.kit]);

  // Filled lobby seats, in order, are the game's seats.
  const seats: SeatInfo[] = useMemo(
    () =>
      lobby.seats
        .filter((s) => s.kind !== "empty")
        .map((s, i) => ({
          // Two people called "Player" is no help; fall back to the seat colour.
          name: !s.name || /^player$/i.test(s.name) ? SEAT_NAMES[i]! : s.name,
          kind: s.kind === "bot" ? "bot" : "human",
          level: s.level,
          connected: s.kind === "human" ? s.connected : undefined,
          autopilot: s.autopilot,
        })),
    [lobby.seats],
  );

  const mySeat = view.seat;
  const canAct = view.phase === "playing" && mySeat !== null && view.turn === mySeat;

  const gameFor = (v: View): LocalGame => {
    const key = `${v.ply}:${v.shatteredThisTurn}:${v.scanning}`;
    if (belief.current?.key === key) return belief.current.game;
    belief.current?.game.free();
    const game = LocalGame.fromView(v);
    belief.current = { ply: v.ply, key, game };
    return game;
  };

  const legal = (leap: boolean): Placement[] => (ready && mySeat !== null ? gameFor(view).legal(mySeat, { leap }) : []);

  const submit = async (action: Action) => {
    if (mySeat === null) return { ok: false as const, reason: "you're watching this game" };
    const local = gameFor(view).check(mySeat, action);
    if (!local.ok) return local;
    room.send({ t: "action", action, ply: view.ply });
    return { ok: true as const };
  };

  const notice = room.error && room.error.code !== "closed" ? { message: room.error.message, at: room.error.at } : null;
  const clock = room.clock && room.clock.endsAt !== null ? { seat: room.clock.seat, endsAt: room.clock.endsAt } : null;
  const title = lobby.preset === "custom" ? "Custom" : PRESET_TITLES[lobby.preset];

  if (!kit) return <div className="game paper g-board-loading">loading the board…</div>;

  return (
    <GameScreen
      title={title}
      roomCode={code}
      view={view}
      kit={kit}
      seat={mySeat}
      canAct={canAct}
      seats={seats}
      legal={legal}
      submit={submit}
      clock={clock}
      notice={notice}
      onRematch={room.me?.host ? () => room.send({ t: "rematch" }) : undefined}
      onResign={mySeat !== null ? () => room.send({ t: "action", action: { type: "resign" }, ply: view.ply }) : undefined}
      onLeave={onLeave}
      sound={sound}
      aside={<Chatter room={room} />}
    />
  );
}

interface Line {
  key: string;
  name: string;
  seat: number | null;
  text: string;
  emote?: boolean;
}

/** Chat and emotes, folded into the dock. */
function Chatter({ room }: { room: UseRoom }) {
  const [text, setText] = useState("");
  const [emotes, setEmotes] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef(0);
  const sound = useSound();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!room.client) return;
    return room.client.on("emote", (e) => {
      setEmotes((xs) => [...xs.slice(-12), { key: `e${Date.now()}${Math.random()}`, name: e.name, seat: e.seat, text: EMOTE_GLYPH[e.kind], emote: true }]);
      sound.chat();
    });
  }, [room.client, sound]);

  useEffect(() => {
    if (room.chat.length > seen.current) sound.chat();
    seen.current = room.chat.length;
  }, [room.chat.length, sound]);

  const lines: Line[] = useMemo(() => {
    const chat = room.chat.map((c, i) => ({ key: `c${i}${c.at}`, name: c.name, seat: c.seat, text: c.text, at: c.at }));
    return [...chat, ...emotes].slice(-30);
  }, [room.chat, emotes]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines.length, open]);

  return (
    <div className={`g-chat ${open ? "open" : ""}`}>
      <div className="g-emotes" role="group" aria-label="Emotes">
        {EMOTES.map((k) => (
          <button key={k} className="g-emote" onClick={() => room.send({ t: "emote", kind: k })}>
            {EMOTE_GLYPH[k]}
          </button>
        ))}
        <button className="g-emote g-chat-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          chat{room.chat.length ? ` · ${room.chat.length}` : ""}
        </button>
      </div>
      {open && (
        <>
          <ol className="g-chat-lines" ref={listRef} aria-live="polite">
            {lines.length === 0 && <li className="g-chat-empty hand">no messages yet</li>}
            {lines.map((l) => (
              <li key={l.key} className={l.emote ? "emote" : ""}>
                <strong style={{ color: l.seat !== null ? SEAT_COLORS[l.seat] : undefined }}>{l.name}</strong> {l.text}
              </li>
            ))}
          </ol>
          <form
            className="g-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              room.send({ t: "chat", text: t.slice(0, MAX_CHAT_CHARS) });
              setText("");
            }}
          >
            <input
              value={text}
              maxLength={MAX_CHAT_CHARS}
              onChange={(e) => setText(e.target.value)}
              placeholder="type a message, then press enter"
              aria-label="Chat message"
            />
          </form>
        </>
      )}
    </div>
  );
}
