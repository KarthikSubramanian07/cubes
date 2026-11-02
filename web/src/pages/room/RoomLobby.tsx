import { useId } from "react";
import type { AiLevel, GameConfig, PresetName } from "@/engine/types";
import { PRESET_BY_NAME } from "@/app/presets";
import { AI_LABELS, AI_LEVELS, MAX_NAME, describeConfig } from "@/app/setup";
import { ArrowRight, Button } from "@/ui/Button";
import { CopyField } from "@/ui/CopyField";
import { HandNote } from "@/ui/HandNote";
import { ModeArt } from "@/ui/ModeArt";
import { Pill } from "@/ui/Pill";
import { SeatChip } from "@/ui/SeatChip";
import { useToast } from "@/ui/Toast";
import "./room.css";

export type LobbySeat =
  | { kind: "empty" }
  | { kind: "player"; name: string; ready: boolean; host?: boolean; you?: boolean; connected?: boolean }
  | { kind: "bot"; level: AiLevel };

export type LobbyConnection = "connecting" | "open" | "closed";

export interface RoomLobbyProps {
  code: string;
  shareUrl: string;
  preset: PresetName;
  config: GameConfig;
  seats: readonly LobbySeat[];
  isHost: boolean;
  yourName: string;
  connection: LobbyConnection;
  onNameChange: (name: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  /** Host only: fill an empty seat with a bot, or change its level. */
  onSetBot: (seat: number, level: AiLevel | null) => void;
  onLeave: () => void;
}

/** Can the host start? Two or more seats filled, and every connected human ready. */
export function canStart(seats: readonly LobbySeat[]): boolean {
  const filled = seats.filter((s) => s.kind !== "empty");
  return filled.length >= 2 && filled.every((s) => s.kind === "bot" || s.ready || s.host);
}

const CONN_LABEL: Record<LobbyConnection, string> = {
  connecting: "connecting",
  open: "live",
  closed: "offline",
};

/** The room lobby, presentational. The network layer owns the state and passes it in. */
export function RoomLobby({
  code,
  shareUrl,
  preset,
  config,
  seats,
  isHost,
  yourName,
  connection,
  onNameChange,
  onReady,
  onStart,
  onSetBot,
  onLeave,
}: RoomLobbyProps) {
  const toast = useToast();
  const nameId = useId();
  const info = PRESET_BY_NAME[preset];
  const me = seats.find((s): s is Extract<LobbySeat, { kind: "player" }> => s.kind === "player" && !!s.you);
  const humans = seats.filter((s) => s.kind === "player").length;
  const alone = humans <= 1 && !seats.some((s) => s.kind === "bot");
  const ready = canStart(seats);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="lobby wrap">
      <section className="lobby__invite" aria-labelledby="lobby-code">
        <div className="lobby__status">
          <p className="eyebrow">Room</p>
          <Pill tone={connection === "open" ? "live" : "default"}>{CONN_LABEL[connection]}</Pill>
        </div>
        <h1 id="lobby-code" className="lobby__code" aria-label={`Room code ${code.split("").join(" ")}`}>
          {code.split("").map((ch, i) => (
            <span key={i} className="lobby__char" style={{ ["--i" as string]: i }} aria-hidden="true">
              {ch}
            </span>
          ))}
        </h1>
        <HandNote className="lobby__code-note annot" tilt={-4} arrow="down-left" size="sm">
          read it out loud. no I, no O,{"\n"}no 0, no 1. you're welcome.
        </HandNote>
        <CopyField label="Invite link" value={shareUrl} onCopied={() => toast.show("Link copied. Go find some friends.")} />
        {canShare && (
          <Button
            variant="quiet"
            size="sm"
            className="lobby__share"
            onClick={() => navigator.share({ title: "Join my cubes room", text: `Room ${code}`, url: shareUrl }).catch(() => {})}
          >
            Share with an app…
          </Button>
        )}

        <div className="lobby__table">
          <div className="lobby__art">
            <ModeArt mode={preset} />
          </div>
          <div>
            <p className="eyebrow eyebrow--plain">The table</p>
            <h2 className="lobby__mode">
              {info.label} <em>{info.dimension === "3d" ? "in 3D" : ""}</em>
            </h2>
            <p className="lobby__flavor">{info.flavor}</p>
            <ul className="lobby__chips" aria-label="Settings">
              {describeConfig(config).map((d) => (
                <li key={d}>
                  <Pill>{d}</Pill>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lobby__seats" aria-labelledby="lobby-seats-title">
        <div className="lobby__seats-head">
          <h2 id="lobby-seats-title">
            Seats <span className="num muted">{seats.filter((s) => s.kind !== "empty").length}/{seats.length}</span>
          </h2>
        </div>
        <ol className="seats">
          {seats.map((s, i) => (
            <li key={i} className={`seat seat--${s.kind}`} style={{ ["--seat" as string]: `var(--seat-${i})` }}>
              <span className="seat__swatch" aria-hidden="true" />
              {s.kind === "empty" && (
                <>
                  <SeatChip seat={i} label={<span className="muted">waiting…</span>} />
                  {isHost && (
                    <div className="seat__actions" role="group" aria-label={`Fill seat ${i + 1} with a bot`}>
                      {AI_LEVELS.map((l) => (
                        <button key={l} type="button" className="seat__bot-btn" onClick={() => onSetBot(i, l)}>
                          + {AI_LABELS[l].label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {s.kind === "player" && (
                <>
                  <SeatChip seat={i} label={s.name} />
                  <span className="seat__tags">
                    {s.you && <span className="seat__tag">you</span>}
                    {s.host && <span className="seat__tag">host</span>}
                    {s.connected === false && <span className="seat__tag">away</span>}
                  </span>
                  <span className={s.ready || s.host ? "seat__state is-ready" : "seat__state"}>{s.host ? "hosting" : s.ready ? "ready" : "not ready"}</span>
                </>
              )}
              {s.kind === "bot" && (
                <>
                  <SeatChip seat={i} label={`${AI_LABELS[s.level].label} bot`} />
                  <span className="seat__tags">
                    <span className="seat__tag">bot</span>
                  </span>
                  {isHost ? (
                    <button type="button" className="seat__remove" onClick={() => onSetBot(i, null)} aria-label={`Remove bot from seat ${i + 1}`}>
                      remove
                    </button>
                  ) : (
                    <span className="seat__state is-ready">ready</span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>

        {alone && (
          <div className="lobby__empty">
            <svg className="lobby__empty-art" viewBox="0 0 120 70" aria-hidden="true">
              <rect x="10" y="20" width="22" height="22" rx="4" className="le-a" />
              <rect x="32" y="42" width="22" height="22" rx="4" className="le-ghost" />
              <rect x="66" y="6" width="22" height="22" rx="4" className="le-ghost" />
              <rect x="88" y="28" width="22" height="22" rx="4" className="le-ghost" />
            </svg>
            <div>
              <p className="lobby__empty-title">
                Waiting for <em>friends</em>.
              </p>
              <p className="muted">Send them the link. The room stays open while you're here; empty seats can be filled with bots if your friends are slow.</p>
            </div>
            <HandNote className="lobby__empty-note annot" tilt={-5} arrow="up" size="sm">
              they're probably{"\n"}finding their shoes
            </HandNote>
          </div>
        )}

        <div className="lobby__you">
          <div className="field">
            <label className="field__label" htmlFor={nameId}>
              Your name
            </label>
            <input
              id={nameId}
              className="input"
              placeholder="Player"
              value={yourName}
              maxLength={MAX_NAME}
              autoComplete="nickname"
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <div className="lobby__actions">
            {isHost ? (
              <Button size="lg" iconRight={<ArrowRight />} disabled={!ready} onClick={onStart}>
                Start game
              </Button>
            ) : (
              <Button size="lg" variant={me?.ready ? "ghost" : "primary"} onClick={() => onReady(!me?.ready)}>
                {me?.ready ? "Not ready" : "I'm ready"}
              </Button>
            )}
            <Button variant="quiet" onClick={onLeave}>
              Leave room
            </Button>
          </div>
          {isHost && !ready && (
            <p className="lobby__hint">
              You need at least one more seat filled, and everyone ready, to start.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
