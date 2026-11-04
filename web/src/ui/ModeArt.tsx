import type { ReactNode } from "react";
import type { PresetName } from "@/engine/types";
import "./mode-art.css";
import { pieceShapes } from "./piecePath";

const C = 8; // cell px
const OX = 12;
const OY = 6;

type Cell = [x: number, y: number, seat: number];

function Grid({ cols, rows, ox = OX, oy = OY }: { cols: number; rows: number; ox?: number; oy?: number }) {
  const lines: ReactNode[] = [];
  for (let x = 0; x <= cols; x++) lines.push(<line key={`v${x}`} x1={ox + x * C} y1={oy} x2={ox + x * C} y2={oy + rows * C} />);
  for (let y = 0; y <= rows; y++) lines.push(<line key={`h${y}`} x1={ox} y1={oy + y * C} x2={ox + cols * C} y2={oy + y * C} />);
  return <g className="ma__grid">{lines}</g>;
}

function Cells({ cells, ox = OX, oy = OY }: { cells: Cell[]; ox?: number; oy?: number }) {
  // Each piece is one solid shape; a round-joined stroke of the same colour softens its corners.
  return (
    <g>
      {pieceShapes(cells, 12, C, 1.1, ox, oy).map((p, i) => (
        <g key={i} className="ma__piece" style={{ ["--c" as string]: `var(--seat-${p.seat})` }}>
          <path className="ma__piece-body" d={p.d} />
          {p.seams && <path className="ma__piece-seam" d={p.seams} />}
        </g>
      ))}
    </g>
  );
}

function Node({ x, y }: { x: number; y: number }) {
  const cx = OX + x * C + C / 2;
  const cy = OY + y * C + C / 2;
  return <rect className="ma__node" x={cx - 2.4} y={cy - 2.4} width={4.8} height={4.8} transform={`rotate(45 ${cx} ${cy})`} />;
}

const shape = (seat: number, pts: [number, number][]): Cell[] => pts.map(([x, y]) => [x, y, seat]);

function iso(i: number, j: number, k: number, a: number, ox: number, oy: number) {
  const x = ox + (i - j) * a * 0.866;
  const y = oy + (i + j) * a * 0.5 - k * a;
  return { x, y };
}

function Cube({ i, j, k, seat, a = 9, ox = 60, oy = 30, wire }: { i: number; j: number; k: number; seat?: number; a?: number; ox?: number; oy?: number; wire?: boolean }) {
  const p = iso(i, j, k, a, ox, oy);
  const w = a * 0.866;
  const top = `M${p.x} ${p.y - a} l${w} ${a / 2} l${-w} ${a / 2} l${-w} ${-a / 2} Z`;
  const left = `M${p.x - w} ${p.y - a / 2} l${w} ${a / 2} l0 ${a} l${-w} ${-a / 2} Z`;
  const right = `M${p.x + w} ${p.y - a / 2} l${-w} ${a / 2} l0 ${a} l${w} ${-a / 2} Z`;
  const style = { ["--c" as string]: seat === undefined ? "var(--faint)" : `var(--seat-${seat})` };
  return (
    <g className={wire ? "ma__cube ma__cube--wire" : "ma__cube"} style={style}>
      <path className="ma__cube-l" d={left} />
      <path className="ma__cube-r" d={right} />
      <path className="ma__cube-t" d={top} />
    </g>
  );
}

/** Iso cubes, painted back to front. Each entry: [i, j, k, seat]. */
function Cubes({ list, a = 9, oy = 30, floor }: { list: [number, number, number, number][]; a?: number; oy?: number; floor?: number }) {
  const sorted = [...list].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]) || p[2] - q[2]);
  const w = a * 0.866;
  return (
    <>
      {floor !== undefined && (
        <path
          className="ma__floor"
          d={`M60 ${oy} L ${60 + floor * w} ${oy + (floor * a) / 2} L 60 ${oy + floor * a} L ${60 - floor * w} ${oy + (floor * a) / 2} Z`}
        />
      )}
      {sorted.map(([i, j, k, seat]) => (
        <Cube key={`${i}${j}${k}`} i={i} j={j} k={k} seat={seat} a={a} oy={oy} />
      ))}
    </>
  );
}

const ART: Record<PresetName, () => ReactNode> = {
  plane: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells
        cells={[
          ...shape(0, [[0, 0], [1, 1], [2, 1], [1, 2], [3, 2], [3, 3], [4, 3]]),
          ...shape(1, [[11, 8], [10, 7], [10, 6], [9, 7], [8, 5], [8, 4], [9, 5]]),
          ...shape(2, [[11, 0], [10, 1], [9, 1], [9, 2], [8, 3], [7, 3]]),
          ...shape(3, [[0, 8], [1, 7], [1, 6], [2, 6], [3, 5], [2, 4]]),
        ]}
      />
      <Node x={5} y={5} />
      <Node x={6} y={3} />
    </>
  ),
  duel: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells
        cells={[
          ...shape(0, [[0, 0], [1, 1], [1, 2], [2, 2], [3, 3], [4, 3], [4, 4], [5, 5], [6, 5], [7, 6]]),
          ...shape(1, [[11, 8], [10, 7], [10, 6], [9, 6], [8, 5], [8, 4], [7, 4], [6, 3], [7, 3], [5, 2], [6, 4]]),
        ]}
      />
      <Node x={3} y={6} />
      <Node x={8} y={2} />
    </>
  ),
  pure: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells
        cells={[
          ...shape(0, [[0, 0], [1, 0], [2, 1], [2, 2], [3, 3], [4, 3], [4, 4]]),
          ...shape(1, [[11, 8], [10, 8], [9, 7], [9, 6], [8, 5], [7, 5], [7, 4]]),
          ...shape(2, [[11, 0], [10, 1], [10, 2], [9, 3], [8, 3]]),
          ...shape(3, [[0, 8], [1, 7], [2, 7], [3, 6], [3, 5]]),
        ]}
      />
    </>
  ),
  fog: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells cells={shape(1, [[5, 4], [6, 3], [6, 5], [7, 5], [4, 3]])} />
      <Cells cells={[[1, 1, 0], [9, 7, 2]]} />
      <path className="ma__haze" d="M12 6 h96 v72 h-96 Z M44 18 h48 v48 h-48 Z" fillRule="evenodd" />
      <rect className="ma__sight" x={44} y={18} width={48} height={48} rx={3} />
      <text className="ma__q" x={16} y={21}>?</text>
      <text className="ma__q" x={92} y={76}>?</text>
    </>
  ),
  storm: () => (
    <>
      <Grid cols={12} rows={9} />
      <path className="ma__ash" d="M12 6 h96 v72 h-96 Z M20 14 h80 v56 h-80 Z" fillRule="evenodd" />
      <Cells
        cells={[
          ...shape(0, [[1, 1], [2, 2], [3, 2], [3, 3]]),
          ...shape(1, [[10, 7], [9, 6], [8, 6], [8, 5]]),
          ...shape(2, [[10, 1], [9, 2], [8, 2]]),
          ...shape(3, [[1, 7], [2, 6], [3, 6], [4, 5]]),
        ]}
      />
      <rect className="ma__storm-line" x={28} y={22} width={64} height={40} rx={2} />
    </>
  ),
  torus: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells cells={[...shape(1, [[11, 3], [11, 4], [0, 4], [1, 4]]), ...shape(0, [[5, 0], [5, 8], [6, 8], [4, 7]]), ...shape(2, [[7, 5], [8, 6]])]} />
      <path className="ma__wrap" d="M8 40 C 2 52, 2 64, 10 70 M112 40 C 118 28, 118 18, 110 12" />
      <path className="ma__wrap" d="M6 66 L 10 70.4 L 14.6 67 M107 15.8 L 110 12 L 114.6 14.6" />
    </>
  ),
  teams: () => (
    <>
      <Grid cols={12} rows={9} />
      <Cells
        cells={[
          ...shape(0, [[0, 0], [1, 1], [2, 1], [3, 2]]),
          ...shape(2, [[4, 2], [5, 3], [5, 4], [4, 4]]),
          ...shape(1, [[11, 8], [10, 7], [9, 7], [8, 6]]),
          ...shape(3, [[7, 6], [7, 5], [6, 5]]),
        ]}
      />
      <path className="ma__link" d="M42 18 C 50 12, 54 14, 54 22" />
    </>
  ),
  stack: () => (
    <>
      <Cubes
        oy={26}
        a={8.5}
        floor={6}
        list={[
          [2, 4, 0, 1], [3, 4, 0, 1], [2, 2, 0, 0], [3, 3, 0, 2], [3, 3, 1, 0], [4, 3, 0, 3],
          [3, 4, 1, 3], [3, 4, 2, 0], [4, 4, 0, 0], [4, 4, 1, 1], [1, 3, 0, 2], [2, 3, 0, 3],
        ]}
      />
    </>
  ),
  orbit: () => (
    <>
      <path className="ma__frame3d" d="M60 8 L 98 30 L 98 66 L 60 88 L 22 66 L 22 30 Z M60 8 L 60 44 M22 30 L 60 52 L 98 30 M60 52 L 60 88" />
      <Cubes oy={57} a={8} list={[[0, 0, 1, 3], [1, 0, 2, 0], [1, 1, 0, 1], [2, 1, 1, 2], [0, 2, 2, 1], [1, 2, 3, 0], [2, 2, 2, 3]]} />
    </>
  ),
};

/** A tiny illustration of a preset, drawn in the same pencil-and-ink language as the rules diagrams. */
export function ModeArt({ mode, className }: { mode: PresetName; className?: string }) {
  return (
    <svg className={["ma", className].filter(Boolean).join(" ")} viewBox="0 0 120 86" aria-hidden="true" focusable="false">
      {ART[mode]()}
    </svg>
  );
}
