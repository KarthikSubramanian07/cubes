import type { ReactNode } from "react";
import { useInView } from "@/app/useInView";
import "./glyph.css";
import "./doodle.css";

export interface MiniCell {
  x: number;
  y: number;
  /** Seat index 0..3 for owned cells, cores and ghosts. */
  seat?: number;
  kind?: "placed" | "core" | "ghost" | "bad" | "node" | "scar" | "ash" | "fog";
}

export type MiniMark =
  /** A pencil circle around a grid point (cell corner). */
  | { kind: "corner"; x: number; y: number; ok?: boolean }
  /** A scribbled stroke along one side of a cell. */
  | { kind: "edge"; x: number; y: number; side: "t" | "r" | "b" | "l"; ok?: boolean }
  /** A pencil ring around a whole cell. */
  | { kind: "ring"; x: number; y: number; ok?: boolean };

export interface MiniBoardProps {
  cols: number;
  rows: number;
  cell?: number;
  cells: readonly MiniCell[];
  marks?: readonly MiniMark[];
  /** Accessible description of the diagram. */
  label: string;
  className?: string;
  children?: ReactNode;
}

function wob(a: number, b: number): number {
  const s = Math.sin(a * 91.7 + b * 47.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2;
}

/** Rule diagrams: a small board with cells, cores, ghosts and pencil marks. */
export function MiniBoard({ cols, rows, cell = 28, cells, marks = [], label, className, children }: MiniBoardProps) {
  const [ref, inView] = useInView<SVGSVGElement>({ threshold: 0.3 });
  const pad = 10;
  const W = cols * cell + pad * 2;
  const H = rows * cell + pad * 2;
  const g = Math.max(1.5, cell * 0.08);
  const r = cell * 0.16;
  const px = (x: number) => pad + x * cell;
  const py = (y: number) => pad + y * cell;

  const lines: ReactNode[] = [];
  for (let x = 1; x < cols; x++) lines.push(<line key={`v${x}`} className="miniboard__grid" x1={px(x)} y1={pad} x2={px(x)} y2={pad + rows * cell} />);
  for (let y = 1; y < rows; y++) lines.push(<line key={`h${y}`} className="miniboard__grid" x1={pad} y1={py(y)} x2={pad + cols * cell} y2={py(y)} />);

  return (
    <svg
      ref={ref}
      className={["miniboard", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      data-animate="true"
      data-inview={inView}
    >
      <rect className="miniboard__bg" x={pad - 0.5} y={pad - 0.5} width={cols * cell + 1} height={rows * cell + 1} rx={6} />
      {lines}
      {cells.map((c, i) => {
        const style = { ["--c" as string]: c.seat !== undefined ? `var(--seat-${c.seat})` : "var(--ink)" };
        const x = px(c.x) + g / 2;
        const y = py(c.y) + g / 2;
        const s = cell - g;
        switch (c.kind) {
          case "core":
            return (
              <g key={i} style={style}>
                <rect className="miniboard__core" x={x} y={y} width={s} height={s} rx={r} />
                <circle className="miniboard__core-dot" cx={x + s / 2} cy={y + s / 2} r={s * 0.16} />
                <rect className="miniboard__core-ring" x={x - 3} y={y - 3} width={s + 6} height={s + 6} rx={r + 3} />
              </g>
            );
          case "ghost":
            return <rect key={i} className="miniboard__ghost" style={style} x={x + 1} y={y + 1} width={s - 2} height={s - 2} rx={r} />;
          case "bad":
            return <rect key={i} className="miniboard__bad" x={x + 1} y={y + 1} width={s - 2} height={s - 2} rx={r} />;
          case "node":
            return (
              <g key={i}>
                <rect className="miniboard__node" x={x + s * 0.22} y={y + s * 0.22} width={s * 0.56} height={s * 0.56} rx={2} transform={`rotate(45 ${x + s / 2} ${y + s / 2})`} />
                <circle className="miniboard__node-dot" cx={x + s / 2} cy={y + s / 2} r={s * 0.1} />
              </g>
            );
          case "scar":
            return <rect key={i} className="miniboard__scar" x={x} y={y} width={s} height={s} rx={r} />;
          case "ash":
            return <rect key={i} className="miniboard__ash" x={px(c.x)} y={py(c.y)} width={cell} height={cell} />;
          case "fog":
            return <rect key={i} className="miniboard__fog" x={px(c.x)} y={py(c.y)} width={cell} height={cell} />;
          default:
            return <rect key={i} className="miniboard__cell miniboard__cell--placed" style={style} x={x} y={y} width={s} height={s} rx={r} />;
        }
      })}
      {marks.map((m, i) => {
        const cls = ["miniboard__mark", m.ok && "miniboard__mark--ok"].filter(Boolean).join(" ");
        const style = { ["--i" as string]: i };
        if (m.kind === "corner") {
          const cx = px(m.x);
          const cy = py(m.y);
          const rx = cell * 0.5;
          const ry = cell * 0.44;
          const d = `M${cx + rx * 0.35} ${cy - ry * 1.02} C ${cx - rx * 0.9} ${cy - ry * 1.15}, ${cx - rx * 1.18} ${cy + ry * 0.2}, ${cx - rx * 0.55} ${cy + ry * 0.82} C ${cx + rx * 0.05} ${cy + ry * 1.3}, ${cx + rx * 1.2} ${cy + ry * 0.7}, ${cx + rx * 1.05} ${cy - ry * 0.25} C ${cx + rx * 0.95} ${cy - ry * 0.9}, ${cx + rx * 0.2} ${cy - ry * 1.2}, ${cx - rx * 0.45} ${cy - ry * 0.95}`;
          return <path key={i} className={cls} style={style} d={d} pathLength={1} />;
        }
        if (m.kind === "ring") {
          const cx = px(m.x) + cell / 2;
          const cy = py(m.y) + cell / 2;
          const rr = cell * 0.7;
          const d = `M${cx + rr * 0.2} ${cy - rr} C ${cx - rr * 1.3} ${cy - rr}, ${cx - rr * 1.1} ${cy + rr * 1.1}, ${cx + rr * 0.1} ${cy + rr * 0.98} C ${cx + rr * 1.25} ${cy + rr * 0.9}, ${cx + rr * 1.15} ${cy - rr * 0.85}, ${cx - rr * 0.2} ${cy - rr * 0.92}`;
          return <path key={i} className={cls} style={style} d={d} pathLength={1} />;
        }
        // edge: a short zigzag along one cell side
        const x0 = px(m.x);
        const y0 = py(m.y);
        const pts: [number, number][] =
          m.side === "t"
            ? [[x0, y0], [x0 + cell, y0]]
            : m.side === "b"
              ? [[x0, y0 + cell], [x0 + cell, y0 + cell]]
              : m.side === "l"
                ? [[x0, y0], [x0, y0 + cell]]
                : [[x0 + cell, y0], [x0 + cell, y0 + cell]];
        const [[ax, ay], [bx, by]] = pts as [[number, number], [number, number]];
        const horiz = ay === by;
        const n = 5;
        let d = `M${ax} ${ay}`;
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const amp = (k % 2 ? 1 : -1) * cell * 0.13 + wob(k, ax) * 0.8;
          d += horiz ? ` L${ax + (bx - ax) * t} ${ay + amp}` : ` L${ax + amp} ${ay + (by - ay) * t}`;
        }
        return <path key={i} className={cls} style={style} d={d} pathLength={1} />;
      })}
      {children}
    </svg>
  );
}
