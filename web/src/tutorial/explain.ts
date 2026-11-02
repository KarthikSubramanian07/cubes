/**
 * Why doesn't this shard fit? The engine says no; this says why, in a
 * sentence, and names the one cell to point the pencil at. Checks run in the
 * engine's order so the message matches what the rules actually tripped on.
 */
import { neighbourTables } from "@/game/board";
import { FLAG, OWNER, cellCoords, cellIndex, type View } from "@/engine/types";

export type Problem = "offboard" | "occupied" | "scar" | "unsupported" | "face-core" | "face" | "no-link" | "too-far" | "elsewhere";

export interface Explanation {
  problem: Problem;
  /** The cell the note points at. */
  cell: number;
  text: string;
}

const isSeat = (o: number) => o >= 1 && o <= 4;

function chebyshevBall(view: View, cell: number, r: number): number[] {
  const dims = view.config.dims;
  const [x, y, z] = cellCoords(dims, cell);
  const out: number[] = [];
  const three = dims[2] > 1;
  for (let dz = three ? -r : 0; dz <= (three ? r : 0); dz++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= dims[0] || ny >= dims[1] || nz >= dims[2]) continue;
        const j = cellIndex(dims, nx, ny, nz);
        if (j !== cell) out.push(j);
      }
  return out;
}

/**
 * Explain an invalid placement of `cells` for `seat`. Returns null when the
 * cells are actually fine by the rules (the caller then says why the lesson
 * wants something else).
 */
export function explainPlacement(view: View, seat: number, cells: number[] | null, opts: { leap?: boolean; anchor?: number } = {}): Explanation | null {
  const cfg = view.config;
  const own = seat + 1;
  const three = cfg.dims[2] > 1;
  if (!cells || cells.length === 0) {
    return { problem: "offboard", cell: opts.anchor ?? 0, text: "that hangs off the edge of the board" };
  }
  for (const c of cells) {
    const o = view.cells[c]!;
    if (o === OWNER.EMPTY) continue;
    if (o === OWNER.SCAR) return { problem: "scar", cell: c, text: "that's a scar. dead ground, nobody builds there" };
    if (o === own) return { problem: "occupied", cell: c, text: "you already live there" };
    if (isSeat(o)) return { problem: "occupied", cell: c, text: "someone already lives there" };
    return { problem: "occupied", cell: c, text: "that cell is taken" };
  }
  const { face, link } = neighbourTables(cfg);
  if (cfg.gravity) {
    const [w, h] = cfg.dims;
    for (const c of cells) {
      if (c < w * h) continue;
      const below = c - w * h;
      const ob = view.cells[below]!;
      if (!(isSeat(ob) || ob === OWNER.SCAR || cells.includes(below))) {
        return { problem: "unsupported", cell: c, text: "every cube needs something underneath it" };
      }
    }
  }
  for (const c of cells) {
    for (const f of face[c]!) {
      if (view.cells[f] !== own) continue;
      if (view.flags[f]! & FLAG.CORE) {
        return { problem: "face-core", cell: f, text: `that touches your Core along a ${three ? "face" : "side"}. corners only.` };
      }
      if (cfg.gravity && f === c - cfg.dims[0] * cfg.dims[1]) {
        return { problem: "face", cell: f, text: "you can't stack on your own cubes. climb on theirs." };
      }
      return { problem: "face", cell: f, text: `flat against your own light along a ${three ? "face" : "side"}. never.` };
    }
  }
  const lights = (o: number) => o === own;
  if (opts.leap) {
    const ok = cells.some((c) => chebyshevBall(view, c, 2).some((b) => !cells.includes(b) && lights(view.cells[b]!)));
    if (!ok) return { problem: "too-far", cell: cells[0]!, text: "too far. a leap reaches two cells from your light" };
    return null;
  }
  const linked = cells.some((c) => link[c]!.some((n) => lights(view.cells[n]!)));
  if (!linked) return { problem: "no-link", cell: cells[0]!, text: "it must touch one of your pieces at a corner" };
  return null;
}
