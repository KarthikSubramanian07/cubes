import { useEffect, useMemo, useRef, useState } from "react";
import { SEAT_NAMES } from "@/engine/types";
import { simulate, type SimResult } from "./heroSim";
import "./hero-board.css";
import { pieceShapes } from "@/ui/piecePath";

const SEEDS = [11, 23, 5, 42, 77];
const STEP_MS = 520;
const HOLD_MS = 3200;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface HeroBoardProps {
  size?: number;
  seats?: number;
  /** Freeze at a given ply (game shell placeholder, screenshots). */
  stillAt?: number;
  /** Fixed seed for the first round (later rounds cycle through a few). */
  seed?: number;
  showScores?: boolean;
  className?: string;
}

/**
 * The hero visual: a real-looking game playing itself on a night slab.
 * Every placement links to its own colour by a corner; the spark marks where.
 */
export function HeroBoard({ size = 14, seats = 4, stillAt, seed, showScores = true, className }: HeroBoardProps) {
  const [round, setRound] = useState(0);
  const sim: SimResult = useMemo(
    () => simulate({ size, seats, seed: round === 0 && seed !== undefined ? seed : SEEDS[round % SEEDS.length]! }),
    [size, seats, round, seed],
  );
  const total = sim.placements.length;
  const still = stillAt !== undefined || reducedMotion();
  const [ply, setPly] = useState(() => (still ? Math.min(stillAt ?? Math.round(total * 0.62), total) : 0));
  const visible = useRef(true);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (visible.current = !!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (still) return;
    const delay = ply === 0 ? 900 : ply >= total ? HOLD_MS : STEP_MS;
    const t = window.setTimeout(() => {
      if (document.hidden || !visible.current) return setWait((w) => w + 1);
      if (ply >= total) {
        setRound((r) => r + 1);
        setPly(0);
      } else setPly(ply + 1);
    }, delay);
    return () => window.clearTimeout(t);
  }, [ply, still, total, wait]);

  const cell = 20;
  const pad = 14;
  const W = size * cell + pad * 2;
  const shown = sim.placements.slice(0, ply);
  const last = ply > 0 && ply <= total ? sim.placements[ply - 1] : undefined;
  const scores = sim.cores.map((_, s) => shown.filter((p) => p.seat === s).reduce((n, p) => n + p.cells.length, 0));
  const current = sim.placements[ply]?.seat ?? last?.seat ?? 0;

  // Each placement is one piece: a single solid shape with soft corners and faint seams.
  const pieces = shown.map((p, i) => {
    const o = pieceShapes(p.cells.map(([x, y]) => [x, y, p.seat] as const), size, cell, 2.6, pad, pad)[0];
    if (!o) return null;
    const [cx, cy] = p.cells.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0]).map((v) => pad + (v / p.cells.length + 0.5) * cell);
    return (
      <g
        key={`${i}-${p.seat}`}
        className={p === last ? "hb__piece is-new" : "hb__piece"}
        style={{ ["--seat" as string]: `var(--seat-${p.seat})`, transformOrigin: `${cx}px ${cy}px` }}
      >
        <path className="hb__piece-body" d={o.d} />
        {o.seams && <path className="hb__piece-seam" d={o.seams} />}
      </g>
    );
  });

  return (
    <div ref={hostRef} className={["hb", className].filter(Boolean).join(" ")} data-fading={ply >= total && !still}>
      <svg className="hb__svg theme-night" viewBox={`0 0 ${W} ${W}`} role="img" aria-label="A four-player game of cubes playing itself: coloured shards spread across a dark grid, each one touching its own colour only at a corner.">
        <defs>
          <filter id="hb-bloom" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <pattern id="hb-grid" width={cell} height={cell} patternUnits="userSpaceOnUse" x={pad} y={pad}>
            <path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" className="hb__gridline" />
          </pattern>
          <radialGradient id="hb-vignette" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#1d1a16" />
            <stop offset="100%" stopColor="#0c0b09" />
          </radialGradient>
        </defs>
        <rect className="hb__slab" x="0.5" y="0.5" width={W - 1} height={W - 1} rx="18" fill="url(#hb-vignette)" />
        <rect x={pad} y={pad} width={size * cell} height={size * cell} fill="url(#hb-grid)" />
        <rect className="hb__frame" x={pad} y={pad} width={size * cell} height={size * cell} />
        <g className="hb__bloom" filter="url(#hb-bloom)">{pieces}</g>
        <g>{pieces}</g>
        {sim.cores.map(([x, y], s) => (
          <g key={s} className="hb__core" style={{ ["--seat" as string]: `var(--seat-${s})` }}>
            <rect x={pad + x * cell + 1} y={pad + y * cell + 1} width={cell - 2} height={cell - 2} rx={4} />
            <circle cx={pad + x * cell + cell / 2} cy={pad + y * cell + cell / 2} r={3.2} />
          </g>
        ))}
        {last && (
          <g key={ply} className="hb__links">
            {last.links.map(([x, y], i) => (
              <path
                key={i}
                className="hb__spark"
                d={`M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z`}
                transform={`translate(${pad + x * cell} ${pad + y * cell})`}
              />
            ))}
          </g>
        )}
      </svg>
      {showScores && (
        <ol className="hb__scores" aria-label="Cells held">
          {sim.cores.map((_, s) => (
            <li key={s} className={s === current && !still ? "is-turn" : undefined} style={{ ["--seat" as string]: `var(--seat-${s})` }}>
              <span className="hb__dot" aria-hidden="true" />
              <span className="hb__name">{SEAT_NAMES[s]}</span>
              <span className="hb__score num">{String(scores[s]).padStart(2, "0")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
