/**
 * Whole-piece shapes for the small board pictures (home page hero, mode
 * cards), drawn the way the game shows pieces: one solid shape per piece with
 * faint seams between its squares, not loose squares. Side-touching squares
 * of one colour are one piece.
 */
import { components, traceLoops } from "@/render2d/outline";
import { insetLoop } from "@/render3d/pieceOutline";

export interface PieceShape {
  seat: number;
  /** The piece's outline, pulled in by `inset`. Stroke it with a round join to soften the corners. */
  d: string;
  /** Short lines along the shared sides between the piece's own squares. */
  seams: string;
}

const f = (n: number) => +n.toFixed(2);

/**
 * `cells` are [x, y, seat]; `cell` is the square size in px, `inset` how far
 * the outline sits inside the squares' edge, `ox`/`oy` the board's top-left.
 */
export function pieceShapes(cells: readonly (readonly [number, number, number])[], cols: number, cell: number, inset: number, ox = 0, oy = 0): PieceShape[] {
  const bySeat = new Map<number, number[]>();
  for (const [x, y, s] of cells) {
    const list = bySeat.get(s) ?? [];
    list.push(x + y * cols);
    bySeat.set(s, list);
  }
  const out: PieceShape[] = [];
  const gap = inset + cell * 0.12;
  for (const [seat, list] of [...bySeat].sort((a, b) => a[0] - b[0])) {
    for (const comp of components(list, cols)) {
      let d = "";
      for (const loop of traceLoops(comp, cols)) {
        const pts = insetLoop(loop, inset / cell);
        d += "M" + pts.map(([x, y]) => `${f(ox + x * cell)} ${f(oy + y * cell)}`).join("L") + "Z";
      }
      const set = new Set(comp);
      let seams = "";
      for (const i of comp) {
        const x = i % cols;
        const y = Math.floor(i / cols);
        const X = ox + (x + 1) * cell;
        const Y = oy + (y + 1) * cell;
        if (x < cols - 1 && set.has(i + 1)) seams += `M${f(X)} ${f(oy + y * cell + gap)}V${f(Y - gap)}`;
        if (set.has(i + cols)) seams += `M${f(ox + x * cell + gap)} ${f(Y)}H${f(X - gap)}`;
      }
      out.push({ seat, d, seams });
    }
  }
  return out;
}
