/**
 * The red-pencil layer over the board: Caveat notes with arrows that draw
 * themselves to the exact cell they mean, plus circles, stars, crosses and
 * dashed outlines. Positions come from the Paper board's own layout maths,
 * so the pencil always lands on the right square at any size.
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Vec3 } from "@/engine/types";
import { makeLayout, viewBoxOf } from "@/render2d/geometry";
import type { Note, NoteDir } from "./lesson";

const DIRS: Record<NoteDir, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [0.78, -0.78],
  nw: [-0.78, -0.78],
  se: [0.78, 0.78],
  sw: [-0.78, 0.78],
};

export interface Frame {
  width: number;
  height: number;
  /** Cell centre in stage pixels, or null for 3D boards (no projection). */
  cell(i: number): [number, number] | null;
  cellSize: number;
}

/** Stage-pixel geometry of a Paper board that fills a `width` × `height` box. */
export function paperFrame(dims: Vec3, width: number, height: number): Frame {
  const layout = makeLayout(dims[0], dims[1]);
  const vb = viewBoxOf(layout);
  const s = Math.min(width / vb.width, height / vb.height);
  const ox = (width - vb.width * s) / 2;
  const oy = (height - vb.height * s) / 2;
  return {
    width,
    height,
    cellSize: layout.unit * s,
    cell: (i) => {
      const x = i % dims[0];
      const y = Math.floor(i / dims[0]) % dims[1];
      return [ox + ((x + 0.5) * layout.unit - vb.x) * s, oy + ((y + 0.5) * layout.unit - vb.y) * s];
    },
  };
}

/** Small deterministic jitter so every pencil mark is a little different, but stable across renders. */
function rand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** A loose pencil loop around a point: starts late, overshoots, never quite closes. */
export function circlePath(cx: number, cy: number, r: number, seed: string): string {
  const rnd = rand(seed);
  const start = -2.3 + rnd() * 0.5;
  const sweep = Math.PI * 2 + 0.55;
  const pts: [number, number][] = [];
  const n = 14;
  for (let k = 0; k <= n; k++) {
    const t = start + (sweep * k) / n;
    const rr = r * (1 + (rnd() - 0.5) * 0.12 + (k / n) * 0.08);
    pts.push([cx + Math.cos(t) * rr * 1.08, cy + Math.sin(t) * rr * 0.94]);
  }
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[Math.max(0, k - 1)]!;
    const p1 = pts[k]!;
    const p2 = pts[k + 1]!;
    const p3 = pts[Math.min(pts.length - 1, k + 2)]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0]!)} ${f(c1[1]!)}, ${f(c2[0]!)} ${f(c2[1]!)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

export function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5 + (k % 3 === 0 ? 0.04 : -0.03);
    const rr = k % 2 === 0 ? r : r * 0.44;
    pts.push(`${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join(" L ")} Z`;
}

function crossPath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy - r * 0.9)} C ${f(cx - r * 0.2)} ${f(cy - r * 0.1)}, ${f(cx + r * 0.3)} ${f(cy + r * 0.4)}, ${f(cx + r * 0.95)} ${f(cy + r)} M${f(cx + r * 0.9)} ${f(cy - r)} C ${f(cx + r * 0.2)} ${f(cy - r * 0.2)}, ${f(cx - r * 0.3)} ${f(cy + r * 0.3)}, ${f(cx - r)} ${f(cy + r * 0.92)}`;
}

/** Dashed boundary around a set of cells (only the edges facing outside the set). */
export function outlinePath(cells: number[], frame: Frame, dims: Vec3): string {
  const set = new Set(cells);
  const w = dims[0];
  const half = frame.cellSize / 2;
  let d = "";
  for (const c of cells) {
    const p = frame.cell(c);
    if (!p) continue;
    const [x, y] = p;
    const cx = c % w;
    const n = (dx: number, dy: number) => {
      const nx = cx + dx;
      if (nx < 0 || nx >= w) return false;
      return set.has(c + dx + dy * w);
    };
    if (!n(0, -1)) d += `M${f(x - half)} ${f(y - half)} H${f(x + half)} `;
    if (!n(0, 1)) d += `M${f(x - half)} ${f(y + half)} H${f(x + half)} `;
    if (!n(-1, 0)) d += `M${f(x - half)} ${f(y - half)} V${f(y + half)} `;
    if (!n(1, 0)) d += `M${f(x + half)} ${f(y - half)} V${f(y + half)} `;
  }
  return d;
}

interface Placed {
  note: Note;
  text: [number, number];
  /** Text alignment relative to its anchor. */
  ax: -1 | 0 | 1;
  ay: -1 | 0 | 1;
  arrow: string | null;
  head: string | null;
  mark: string | null;
  outline: string | null;
}

function arrowFor(from: [number, number], to: [number, number], seed: string): { body: string; head: string } {
  const rnd = rand(seed);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const bend = (rnd() > 0.5 ? 1 : -1) * len * 0.22;
  const mx = from[0] + dx / 2 - (dy / len) * bend;
  const my = from[1] + dy / 2 + (dx / len) * bend;
  const body = `M${f(from[0])} ${f(from[1])} Q ${f(mx)} ${f(my)}, ${f(to[0])} ${f(to[1])}`;
  // Arrowhead along the curve's final tangent.
  const tx = to[0] - mx;
  const ty = to[1] - my;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const size = Math.min(11, Math.max(7, len * 0.22));
  const rot = (a: number): [number, number] => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
  const [ax, ay] = rot(0.5);
  const [bx, by] = rot(-0.48);
  const head = `M${f(to[0] - ax * size)} ${f(to[1] - ay * size)} L ${f(to[0])} ${f(to[1])} L ${f(to[0] - bx * size * 0.9)} ${f(to[1] - by * size * 0.9)}`;
  return { body, head };
}

function place(note: Note, frame: Frame, dims: Vec3): Placed {
  const [vx, vy] = DIRS[note.dir];
  const ax = (vx > 0 ? 1 : vx < 0 ? -1 : 0) as -1 | 0 | 1;
  const ay = (vy > 0 ? 1 : vy < 0 ? -1 : 0) as -1 | 0 | 1;
  const c = note.cell !== undefined ? frame.cell(note.cell) : null;
  if (!c) {
    // Free note pinned near a corner/edge of the stage, pointing inward.
    const pad = Math.max(14, Math.min(frame.width, frame.height) * 0.05);
    const x = ax > 0 ? frame.width - pad : ax < 0 ? pad : frame.width / 2;
    const y = ay > 0 ? frame.height - pad : ay < 0 ? pad : frame.height / 2;
    return { note, text: [x, y], ax: (-ax || 0) as -1 | 0 | 1, ay: (-ay || 0) as -1 | 0 | 1, arrow: null, head: null, mark: null, outline: null };
  }
  const cs = frame.cellSize;
  const reach = (note.reach ?? 1.6) * cs + 18;
  const anchor: [number, number] = [c[0] + vx * reach, c[1] + vy * reach];
  const start: [number, number] = [anchor[0] - vx * 6, anchor[1] - vy * 6];
  const end: [number, number] = [c[0] + vx * cs * 0.55, c[1] + vy * cs * 0.55];
  const { body, head } = arrowFor(start, end, note.id);
  let mark: string | null = null;
  if (note.mark === "circle") mark = circlePath(c[0], c[1], cs * 0.68, note.id);
  else if (note.mark === "star") mark = starPath(c[0], c[1], cs * 0.42);
  else if (note.mark === "cross") mark = crossPath(c[0], c[1], cs * 0.26);
  const outline = note.outline ? outlinePath(note.outline.cells, frame, dims) : null;
  return { note, text: anchor, ax, ay, arrow: body, head, mark, outline };
}

export interface AnnotationsProps {
  notes: Note[];
  frame: Frame | null;
  dims: Vec3;
  /** Remount key: change it to redraw every stroke (new chapter, new step). */
  stamp: string;
  /** A rule just said no: shown above everything, with a wiggle. */
  error?: Note | null;
  errorKey?: number;
}

export function Annotations({ notes, frame, dims, stamp, error, errorKey }: AnnotationsProps) {
  const placed = useMemo(() => (frame ? notes.map((n) => place(n, frame, dims)) : []), [notes, frame, dims]);
  const err = useMemo(() => (frame && error ? place(error, frame, dims) : null), [error, frame, dims]);
  if (!frame) return null;
  return (
    <div className="ln-annot" aria-hidden="true" data-dim={err ? "true" : undefined}>
      <svg className="ln-annot__svg" width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`}>
        {placed.map((p, i) => (
          <g key={`${stamp}:${p.note.id}`} className={`ln-ink tone-${p.note.tone ?? "accent"}`} style={{ ["--i" as string]: i }}>
            {p.outline && (
              <path d={p.outline} className={`ln-outline tone-${p.note.outline!.tone}`} />
            )}
            {p.mark && <path d={p.mark} className={`ln-mark ln-mark--${p.note.mark}`} pathLength={1} />}
            {p.arrow && <path d={p.arrow} className="ln-stroke" pathLength={1} />}
            {p.head && <path d={p.head} className="ln-stroke ln-stroke--head" pathLength={1} />}
          </g>
        ))}
        {err && (
          <g key={`err:${errorKey}`} className="ln-ink ln-ink--error tone-accent">
            {err.mark && <path d={err.mark} className={`ln-mark ln-mark--${err.note.mark}`} pathLength={1} />}
            {err.arrow && <path d={err.arrow} className="ln-stroke" pathLength={1} />}
            {err.head && <path d={err.head} className="ln-stroke ln-stroke--head" pathLength={1} />}
          </g>
        )}
      </svg>
      {placed.map((p, i) => (
        <NoteText key={`${stamp}:${p.note.id}`} p={p} frame={frame} i={i} />
      ))}
      {err && <NoteText key={`err:${errorKey}`} p={err} frame={frame} i={0} error />}
    </div>
  );
}

function NoteText({ p, frame, i, error = false }: { p: Placed; frame: Frame; i: number; error?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [nudge, setNudge] = useState<[number, number]>([0, 0]);
  const tx = p.ax > 0 ? "0%" : p.ax < 0 ? "-100%" : "-50%";
  const ty = p.ay > 0 ? "0%" : p.ay < 0 ? "-100%" : "-50%";

  // Keep the note on the stage: measure, then slide it back inside if it spills.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = p.text[0] + (p.ax > 0 ? 0 : p.ax < 0 ? -w : -w / 2);
    const top = p.text[1] + (p.ay > 0 ? 0 : p.ay < 0 ? -h : -h / 2);
    const m = 4;
    const nx = left < m ? m - left : left + w > frame.width - m ? frame.width - m - (left + w) : 0;
    const ny = top < m ? m - top : top + h > frame.height - m ? frame.height - m - (top + h) : 0;
    setNudge((cur) => (cur[0] === nx && cur[1] === ny ? cur : [nx, ny]));
  }, [p, frame]);

  const style: CSSProperties = {
    left: p.text[0] + nudge[0],
    top: p.text[1] + nudge[1],
    transform: `translate(${tx}, ${ty}) rotate(${error ? -2 : -3 + (i % 3)}deg)`,
    textAlign: p.ax > 0 ? "left" : p.ax < 0 ? "right" : "center",
    ["--i" as string]: i,
  };
  return (
    <span ref={ref} className={`ln-note tone-${p.note.tone ?? "accent"}${error ? " ln-note--error" : ""}`} style={style}>
      {p.note.text}
    </span>
  );
}
