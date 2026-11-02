import type { ReactNode } from "react";
import { SEAT_NAMES } from "@/engine/types";
import { LogoMark } from "@/ui/Logo";
import { ShardGlyph } from "@/ui/ShardGlyph";
import { SurgeIcon, type SurgeName } from "@/ui/SurgeIcon";
import type { ShardShape } from "@/ui/shards";
import { Link } from "react-router";

export interface HudSeat {
  seat: number;
  name: string;
  score: number | null;
  charge: number | null;
  piecesLeft: number;
  dark?: boolean;
  you?: boolean;
  bot?: string | null;
}

export function TopBar({
  code,
  seats,
  turn,
  round,
  clock,
  actions,
}: {
  code: string;
  seats: readonly HudSeat[];
  turn: number;
  round: number;
  clock?: string | null;
  actions?: ReactNode;
}) {
  const current = seats.find((s) => s.seat === turn);
  return (
    <div className="hud-top">
      <Link to="/" className="hud-top__home" aria-label="cubes, home">
        <LogoMark size={22} />
      </Link>
      <div className="hud-top__room">
        <span className="hud-label">room</span>
        <span className="hud-top__code num">{code}</span>
      </div>
      <ol className="hud-seats" aria-label="Seats" style={{ ["--n" as string]: seats.length }}>
        {seats.map((s) => (
          <li
            key={s.seat}
            className={["hud-seat", s.seat === turn && "is-turn", s.dark && "is-dark"].filter(Boolean).join(" ")}
            style={{ ["--seat" as string]: `var(--seat-${s.seat})` }}
            aria-current={s.seat === turn ? "true" : undefined}
          >
            <span className="hud-seat__dot" aria-hidden="true" />
            <span className="hud-seat__who">
              <span className="hud-seat__name">
                {s.name}
                {s.you && s.name.toLowerCase() !== "you" && <span className="hud-seat__you"> (you)</span>}
              </span>
              <span className="hud-seat__meta">
                {SEAT_NAMES[s.seat]}
                {s.bot ? ` · ${s.bot}` : ""} · {s.piecesLeft} left
              </span>
            </span>
            <span className="hud-seat__score num" aria-label={`score ${s.score ?? "hidden"}`}>
              {s.score ?? "?"}
            </span>
            <span className="hud-seat__charge" aria-label={`charge ${s.charge ?? "hidden"}`}>
              {Array.from({ length: 9 }, (_, k) => (
                <i key={k} className={s.charge !== null && k < s.charge ? "on" : undefined} />
              ))}
            </span>
          </li>
        ))}
      </ol>
      <div className="hud-turn" role="status" aria-live="polite">
        <span className="hud-label">round {round}</span>
        <span className="hud-turn__who" style={{ ["--seat" as string]: `var(--seat-${turn})` }}>
          {current?.you ? "Your move" : `${current?.name ?? SEAT_NAMES[turn]} to move`}
        </span>
        {clock && <span className="hud-turn__clock num">{clock}</span>}
      </div>
      {actions && <div className="hud-top__actions">{actions}</div>}
    </div>
  );
}

export function Tray({
  shards,
  used,
  selected,
  seat,
  onSelect,
}: {
  shards: readonly ShardShape[];
  used: ReadonlySet<string>;
  selected: string | null;
  seat: number;
  onSelect: (id: string) => void;
}) {
  const left = shards.length - used.size;
  return (
    <div className="tray">
      <div className="tray__head">
        <span className="hud-label">your shards</span>
        <span className="num tray__count">
          {left}
          <span className="muted">/{shards.length}</span>
        </span>
      </div>
      <div className="tray__grid" role="listbox" aria-label="Shards in your kit">
        {shards.map((s) => {
          const isUsed = used.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={selected === s.id}
              aria-disabled={isUsed}
              disabled={isUsed}
              className="tray__item"
              onClick={() => onSelect(s.id)}
            >
              <ShardGlyph cells={s.cells} size={9} frame={5} color={`var(--seat-${seat})`} glow={!isUsed} title={`${s.name}, ${s.cells.length} cells`} />
            </button>
          );
        })}
      </div>
      <p className="tray__keys">
        <kbd className="kbd">R</kbd> rotate <kbd className="kbd">F</kbd> flip <kbd className="kbd">Esc</kbd> drop
      </p>
    </div>
  );
}

const SURGES: { name: SurgeName; label: string; cost: number }[] = [
  { name: "spark", label: "Spark", cost: 1 },
  { name: "leap", label: "Leap", cost: 2 },
  { name: "shatter", label: "Shatter", cost: 3 },
  { name: "scan", label: "Scan", cost: 1 },
];

export function SurgeBar({ charge, fog, armed, onArm }: { charge: number; fog: boolean; armed: SurgeName | null; onArm: (s: SurgeName | null) => void }) {
  return (
    <div className="surgebar" role="toolbar" aria-label="Surges">
      <div className="surgebar__charge">
        <span className="hud-label">charge</span>
        <span className="num">{charge}</span>
      </div>
      {SURGES.map((s) => {
        const disabled = s.cost > charge || (s.name === "scan" && !fog);
        return (
          <button
            key={s.name}
            type="button"
            className="surgebar__btn"
            aria-pressed={armed === s.name}
            disabled={disabled}
            title={s.name === "scan" && !fog ? "Scan only works in fog modes" : `${s.label}: ${s.cost} charge`}
            onClick={() => onArm(armed === s.name ? null : s.name)}
          >
            <SurgeIcon surge={s.name} />
            <span>{s.label}</span>
            <span className="surgebar__cost" aria-label={`costs ${s.cost}`}>
              {Array.from({ length: s.cost }, (_, k) => (
                <i key={k} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
