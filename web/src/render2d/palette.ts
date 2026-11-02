/** Colours for the Paper board. Seat colours follow docs/DESIGN.md. */

export const PAPER = "#f2eee5";
export const PAPER_LIGHT = "#f8f5ee";
export const PAPER_SHADOW = "#e6e0d3";
export const INK = "#28221e";
export const GRAPHITE = "#5f594f";
export const PENCIL = "#8a8378";
export const RED_PENCIL = "#c63d2f";
export const RED_INK = "#b8231b";

export const SEAT_COLORS = ["#e2683c", "#2a9d8f", "#e9b949", "#7c6cf2"] as const;
export const SEAT_INITIALS = ["C", "T", "P", "I"] as const;

/** Mix two #rrggbb colours. t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${v.toString(16).padStart(6, "0")}`;
}

/** Deep ink tinted with the seat colour, for outlines and monograms. */
export const SEAT_INK = SEAT_COLORS.map((c) => mix(c, INK, 0.62));
/** A slightly deeper pigment for watercolour edges and marker streaks. */
export const SEAT_DEEP = SEAT_COLORS.map((c) => mix(c, INK, 0.3));

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % 4) + 4) % 4]!;
}
