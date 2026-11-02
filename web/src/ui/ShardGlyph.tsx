import type { Cell2 } from "./shards";
import "./glyph.css";

export interface ShardGlyphProps {
  cells: readonly Cell2[];
  /** Pixels per cell. */
  size?: number;
  /** Any CSS colour; defaults to ink. Use `var(--seat-N)` for seats. */
  color?: string;
  /** A wobbly pencil line around the shape. */
  outline?: boolean;
  outlineColor?: string;
  /** Outline only, no fill (a shard you might place). */
  ghost?: boolean;
  /** Luminous variant for the night register. */
  glow?: boolean;
  /**
   * Draw inside a square frame this many cells wide, centred, so every shard in a set
   * shares one scale and the SVG can be sized freely with CSS.
   */
  frame?: number;
  /** Accessible name. Without one the glyph is decorative. */
  title?: string;
  className?: string;
}

/** Deterministic wobble so a glyph is the same every render. */
function wob(a: number, b: number, k: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 1.6;
}

/** Boundary edges of a polyomino as pencil strokes, pushed `pad` px outward, slightly overshot. */
function outlinePath(cells: readonly Cell2[], s: number, pad: number, ox: number, oy: number): string {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  const segs: string[] = [];
  const over = 2.2;
  for (const [x, y] of cells) {
    const L = ox + x * s - pad;
    const R = ox + (x + 1) * s + pad;
    const T = oy + y * s - pad;
    const B = oy + (y + 1) * s + pad;
    const add = (x1: number, y1: number, x2: number, y2: number, k: number) => {
      const dx = Math.sign(x2 - x1) * over;
      const dy = Math.sign(y2 - y1) * over;
      const mx = (x1 + x2) / 2 + wob(x, y, k) * 0.6;
      const my = (y1 + y2) / 2 + wob(y, x, k) * 0.6;
      segs.push(
        `M${(x1 - dx + wob(x, y, k + 1)).toFixed(1)} ${(y1 - dy + wob(y, x, k + 2)).toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${(x2 + dx + wob(x, y, k + 3)).toFixed(1)} ${(y2 + dy + wob(y, x, k + 4)).toFixed(1)}`,
      );
    };
    if (!has(x, y - 1)) add(ox + x * s - (has(x - 1, y) ? 0 : pad), T, ox + (x + 1) * s + (has(x + 1, y) ? 0 : pad), T, 1);
    if (!has(x + 1, y)) add(R, oy + y * s - (has(x, y - 1) ? 0 : pad), R, oy + (y + 1) * s + (has(x, y + 1) ? 0 : pad), 2);
    if (!has(x, y + 1)) add(ox + (x + 1) * s + (has(x + 1, y) ? 0 : pad), B, ox + x * s - (has(x - 1, y) ? 0 : pad), B, 3);
    if (!has(x - 1, y)) add(L, oy + (y + 1) * s + (has(x, y + 1) ? 0 : pad), L, oy + y * s - (has(x, y - 1) ? 0 : pad), 4);
  }
  return segs.join(" ");
}

/** Renders a polyomino from cell offsets as a small crisp SVG. */
export function ShardGlyph({
  cells,
  size = 14,
  color = "var(--ink)",
  outline,
  outlineColor = "var(--accent)",
  ghost,
  glow,
  frame,
  title,
  className,
}: ShardGlyphProps) {
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const pad = outline ? Math.max(5, size * 0.38) : glow ? size * 0.4 : 1;
  const fw = frame ? Math.max(frame, w) : w;
  const fh = frame ? Math.max(frame, h) : h;
  const W = fw * size + pad * 2;
  const H = fh * size + pad * 2;
  const ox = pad + ((fw - w) * size) / 2;
  const oy = pad + ((fh - h) * size) / 2;
  const gap = Math.max(1, size * 0.09);
  const r = Math.max(1.2, size * 0.16);
  return (
    <svg
      className={["glyph", glow && "glyph--glow", ghost && "glyph--ghost", className].filter(Boolean).join(" ")}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ ["--glyph" as string]: color }}
    >
      {cells.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          className="glyph__cell"
          x={ox + x * size + gap / 2}
          y={oy + y * size + gap / 2}
          width={size - gap}
          height={size - gap}
          rx={r}
        />
      ))}
      {outline && (
        <path className="glyph__outline" d={outlinePath(cells, size, pad * 0.55, ox, oy)} style={{ stroke: outlineColor }} />
      )}
    </svg>
  );
}
