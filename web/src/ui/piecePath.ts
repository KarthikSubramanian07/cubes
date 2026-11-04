/**
 * SVG outlines for whole pieces in the small board pictures (home page hero,
 * mode cards), so they read as pieces the way the game draws them, not as
 * loose squares. Side-touching squares of one colour are one piece.
 */
import { components, traceLoops } from "@/render2d/outline";
import { insetLoop } from "@/render3d/pieceOutline";

export interface PieceOutline {
  seat: number;
  d: string;
}

/**
 * One path per piece. `cells` are [x, y, seat]; `cell` is the square size in
 * px, `inset` how far the outline sits inside the squares' edge, and `ox`/`oy`
 * the board's top-left corner.
 */
export function pieceOutlines(cells: readonly (readonly [number, number, number])[], cols: number, cell: number, inset: number, ox = 0, oy = 0): PieceOutline[] {
  const bySeat = new Map<number, number[]>();
  for (const [x, y, s] of cells) {
    const list = bySeat.get(s) ?? [];
    list.push(x + y * cols);
    bySeat.set(s, list);
  }
  const out: PieceOutline[] = [];
  for (const [seat, list] of [...bySeat].sort((a, b) => a[0] - b[0])) {
    for (const comp of components(list, cols)) {
      let d = "";
      for (const loop of traceLoops(comp, cols)) {
        const pts = insetLoop(loop, inset / cell);
        d += "M" + pts.map(([x, y]) => `${(ox + x * cell).toFixed(2)} ${(oy + y * cell).toFixed(2)}`).join("L") + "Z";
      }
      out.push({ seat, d });
    }
  }
  return out;
}
