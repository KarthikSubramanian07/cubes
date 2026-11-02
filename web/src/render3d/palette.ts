import { Color } from "three";

/** Seat colours in seat order: Clay, Tide, Pollen, Iris (sRGB hex). */
export const SEAT_HEX = ["#e2683c", "#2a9d8f", "#e9b949", "#7c6cf2"] as const;

/**
 * Per-seat glow gain. Tide and Iris are darker hues, so their emissive cores
 * need more energy to read as equally bright next to Clay and Pollen.
 */
export const SEAT_GLOW = [1.0, 1.45, 0.82, 1.35] as const;

export const NIGHT = {
  background: "#0f0e0c",
  slab: "#16130f",
  slabEdge: "#2a241c",
  grid: "#8a7a62",
  ember: "#ff7a2e",
  danger: "#ff4a2a",
  node: "#fff1d0",
  scar: "#1b1a1d",
  fog: "#2b2723",
  underglow: "#e2683c",
} as const;

const cache = new Map<string, Color>();

/** Linear-space colour (three converts sRGB hex to the linear working space). */
export function linear(hex: string): Color {
  let c = cache.get(hex);
  if (!c) {
    c = new Color(hex);
    cache.set(hex, c);
  }
  return c;
}

export function seatHex(seat: number): string {
  return SEAT_HEX[((seat % 4) + 4) % 4]!;
}

export function seatColor(seat: number): Color {
  return linear(seatHex(seat));
}

export function seatGlow(seat: number): number {
  return SEAT_GLOW[((seat % 4) + 4) % 4]!;
}
