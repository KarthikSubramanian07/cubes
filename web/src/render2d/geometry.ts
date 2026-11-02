/**
 * Board layout and pointer/keyboard math for the 2D renderer. Pure functions,
 * no DOM, so they can be unit tested directly.
 */

/** User units per cell in the SVG viewBox. */
export const UNIT = 40;

export interface Layout {
  w: number;
  h: number;
  unit: number;
  /** Margin around the board (user units) for labels and wrap arrows. */
  pad: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function makeLayout(w: number, h: number, unit = UNIT): Layout {
  return { w, h, unit, pad: unit * 1.15 };
}

export function viewBoxOf(l: Layout): ViewBox {
  return { x: -l.pad, y: -l.pad, width: l.w * l.unit + 2 * l.pad, height: l.h * l.unit + 2 * l.pad };
}

/**
 * Map a client point to SVG user space for an <svg> with this viewBox and the
 * default preserveAspectRatio (xMidYMid meet).
 */
export function clientToUser(clientX: number, clientY: number, rect: ClientRect, vb: ViewBox): [number, number] {
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  if (!(scale > 0)) return [Number.NaN, Number.NaN];
  const ox = rect.left + (rect.width - vb.width * scale) / 2;
  const oy = rect.top + (rect.height - vb.height * scale) / 2;
  return [vb.x + (clientX - ox) / scale, vb.y + (clientY - oy) / scale];
}

/** User-space point → cell index, or null when off the board or on a void cell. */
export function userToCell(ux: number, uy: number, l: Layout, playable?: (i: number) => boolean): number | null {
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;
  const x = Math.floor(ux / l.unit);
  const y = Math.floor(uy / l.unit);
  if (x < 0 || y < 0 || x >= l.w || y >= l.h) return null;
  const i = x + l.w * y;
  if (playable && !playable(i)) return null;
  return i;
}

/** Client point → cell, combining the two steps above. */
export function clientToCell(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  l: Layout,
  playable?: (i: number) => boolean,
): number | null {
  const [ux, uy] = clientToUser(clientX, clientY, rect, viewBoxOf(l));
  return userToCell(ux, uy, l, playable);
}

/** Pixels per user unit for a container of this size. */
export function pixelsPerUnit(cw: number, ch: number, l: Layout): number {
  const vb = viewBoxOf(l);
  return Math.max(0, Math.min(cw / vb.width, ch / vb.height));
}

export type Dir = "up" | "down" | "left" | "right";

/**
 * Move a keyboard cursor one cell, skipping void cells in that direction.
 * On a torus it wraps; otherwise it stops at the edge (returns the same cell).
 */
export function stepFocus(cell: number, dir: Dir, w: number, h: number, playable: (i: number) => boolean, torus = false): number {
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  let x = cell % w;
  let y = Math.floor(cell / w);
  const limit = Math.max(w, h);
  for (let n = 0; n < limit; n++) {
    x += dx;
    y += dy;
    if (torus) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else if (x < 0 || y < 0 || x >= w || y >= h) {
      return cell;
    }
    const i = x + w * y;
    if (i === cell) return cell;
    if (playable(i)) return i;
  }
  return cell;
}

/** Column label: A..Z, then AA, AB, ... */
export function columnLabel(x: number): string {
  let s = "";
  let n = x;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Human cell name, e.g. "C7" (column letter, 1-based row from the top). */
export function cellName(cell: number, w: number): string {
  return `${columnLabel(cell % w)}${Math.floor(cell / w) + 1}`;
}

/** The playable cell nearest the board centre (a sensible initial cursor). */
export function centreCell(w: number, h: number, playable: (i: number) => boolean): number {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let best = 0;
  let bestD = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (!playable(i)) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}
