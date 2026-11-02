import type { ReactNode } from "react";
import { SEAT_NAMES } from "@/engine/types";
import "./seat.css";

export interface SeatChipProps {
  seat: number;
  /** Shown after the seat colour name, e.g. a player name. */
  label?: ReactNode;
  /** Hide the colour name and show only the label. */
  hideSeatName?: boolean;
  active?: boolean;
  dark?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** A seat colour dot with its name (Clay, Tide, Pollen, Iris). */
export function SeatChip({ seat, label, hideSeatName, active, dark, size = "md", className }: SeatChipProps) {
  const name = SEAT_NAMES[seat] ?? `Seat ${seat + 1}`;
  return (
    <span
      className={["seatchip", `seatchip--${size}`, active && "is-active", dark && "is-dark", className].filter(Boolean).join(" ")}
      style={{ ["--seat" as string]: `var(--seat-${seat})`, ["--seat-ink" as string]: `var(--seat-${seat}-ink)` }}
    >
      <span className="seatchip__dot" aria-hidden="true" />
      {!hideSeatName && <span className="seatchip__name">{name}</span>}
      {label && <span className="seatchip__label">{label}</span>}
    </span>
  );
}
