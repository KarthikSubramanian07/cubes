/**
 * The Paper board's SVG layers, bottom to top. Each is memoised so hovering
 * (which only changes the ghost) never regenerates shard art.
 */
import { memo, useMemo } from "react";
import {
  ashArt,
  attachTicks,
  boardBorder,
  coreRing,
  fogShape,
  ghostOutline,
  ghostScribble,
  ghostWash,
  gridDots,
  misfireSplats,
  newFlourish,
  nodeArt,
  questionCells,
  scarArt,
  shardArt,
  takenNodeStar,
  targetRings,
  torusArrows,
  type Quality,
} from "./art";
import { columnLabel, type Layout } from "./geometry";
import { hashSeed, hatchSegments, sketchLine } from "./ink";
import { traceLoops } from "./outline";
import { GRAPHITE, INK, PAPER, PAPER_LIGHT, PENCIL, RED_INK, RED_PENCIL, SEAT_DEEP, SEAT_INITIALS, SEAT_INK, seatColor } from "./palette";
import type { Scene } from "./scene";
import type { BoardMarks } from "./types";

interface LayerProps {
  uid: string;
  scene: Scene;
  layout: Layout;
  inkScale: number;
}

const BLEND = { mixBlendMode: "multiply" } as const;

/* ------------------------------------------------------------------ defs */

export const Defs = memo(function Defs({ uid, unit, quality }: { uid: string; unit: number; quality: Quality }) {
  return (
    <defs>
      {quality === "high" && (
        <filter id={`${uid}-wc`} x="-3%" y="-3%" width="106%" height="106%" colorInterpolationFilters="sRGB">
          {/* Warp the edges a touch, darken the rim where pigment pools, add paper grain. */}
          <feTurbulence type="fractalNoise" baseFrequency={0.03} numOctaves={2} seed={7} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={unit * 0.1} xChannelSelector="R" yChannelSelector="G" result="bled" />
          <feGaussianBlur in="bled" stdDeviation={unit * 0.07} result="soft" />
          <feComposite in="bled" in2="soft" operator="arithmetic" k1={0} k2={1.75} k3={-0.75} k4={0} result="edged" />
          <feTurbulence type="fractalNoise" baseFrequency={0.65} numOctaves={2} seed={3} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -1.1 1.35" result="grainMask" />
          <feComposite in="edged" in2="grainMask" operator="in" />
        </filter>
      )}
      {quality !== "low" && (
        <filter id={`${uid}-smudge`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={unit * 0.09} />
        </filter>
      )}
      {quality !== "low" && (
        <filter id={`${uid}-soft`} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={unit * 0.014} />
        </filter>
      )}
      <radialGradient id={`${uid}-bleedgrad`}>
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.7" stopColor="#fff" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
});

/* ------------------------------------------------------------------ base */

/** Board paper, pencil dots, storm ash. */
export const BoardBase = memo(function BoardBase({ uid, scene, sk, layout, inkScale, quality }: LayerProps & { sk: string; quality: Quality }) {
  const { w, h, unit } = layout;
  const fill = useMemo(
    () => scene.boardLoops.map((l) => "M" + l.map(([x, y]) => `${x * unit} ${y * unit}`).join("L") + "Z").join(""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sk, unit],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dots = useMemo(() => gridDots(scene.playable, w, h, unit), [sk, unit]);
  const ashKey = scene.ash.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ash = useMemo(() => ashArt(scene.ash, w, unit), [ashKey, w, unit]);
  const dotW = unit * 0.065 * Math.min(inkScale, 1.6);
  return (
    <g>
      <defs>
        <clipPath id={`${uid}-board`}>
          <path d={fill} />
        </clipPath>
      </defs>
      <path d={fill} fill={PAPER_LIGHT} fillOpacity={0.65} />
      <path d={dots.small} stroke={GRAPHITE} strokeOpacity={0.4} strokeWidth={dotW} strokeLinecap="round" fill="none" />
      <path d={dots.big} stroke={GRAPHITE} strokeOpacity={0.55} strokeWidth={dotW * 1.7} strokeLinecap="round" fill="none" />
      {scene.ash.length > 0 && (
        <g clipPath={`url(#${uid}-board)`}>
          <path d={ash.smear} fill={PENCIL} fillOpacity={quality === "low" ? 0.18 : 0.3} filter={quality === "low" ? undefined : `url(#${uid}-smudge)`} />
          <path d={ash.rub} stroke={PAPER_LIGHT} strokeOpacity={0.55} strokeWidth={unit * 0.12} strokeLinejoin="round" strokeLinecap="round" fill="none" filter={quality === "low" ? undefined : `url(#${uid}-soft)`} />
          <path d={ash.crumbs} stroke={PENCIL} strokeOpacity={0.7} strokeWidth={1.1 * inkScale} fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ pieces */

export const Pieces = memo(function Pieces({
  uid,
  scene,
  layout,
  inkScale,
  quality,
  fresh,
}: LayerProps & { quality: Quality; fresh: Set<number> }) {
  const { w, unit } = layout;
  const arts = useMemo(
    () =>
      scene.shards.map((s, i) => ({
        s,
        i,
        a: shardArt(s.key, s.cells, s.loops, w, s.seat, unit, inkScale, quality),
        fresh: fresh.size > 0 && s.cells.some((c) => fresh.has(c)),
      })),
    [scene, w, unit, inkScale, quality, fresh],
  );
  const live = arts.filter((x) => !x.s.stale);
  const mem = arts.filter((x) => x.s.stale);

  const scarKey = scene.scars.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scars = useMemo(() => scarArt(scene.scars, w, unit, inkScale), [scarKey, w, unit, inkScale]);
  const nodeKey = scene.nodes.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => nodeArt(scene.nodes, w, unit, inkScale), [nodeKey, w, unit, inkScale]);

  const maskFor = (x: (typeof arts)[number]) => (x.fresh ? `url(#${uid}-m${x.i})` : undefined);
  const textScale = Math.min(inkScale, 1.3);

  return (
    <g>
      <defs>
        {quality !== "low" &&
          live.map((x) => (
            <clipPath id={`${uid}-c${x.i}`} key={`c${x.s.key}`}>
              <path d={x.a.clip} />
            </clipPath>
          ))}
        {live
          .filter((x) => x.fresh)
          .map((x) => {
            const r = Math.hypot(x.a.bbox.w, x.a.bbox.h) * 0.75 + unit * 0.4;
            return (
              <mask id={`${uid}-m${x.i}`} key={`m${x.s.key}`} maskUnits="userSpaceOnUse" x={x.a.bbox.x - unit} y={x.a.bbox.y - unit} width={x.a.bbox.w + 2 * unit} height={x.a.bbox.h + 2 * unit}>
                <circle className="pb-bleed" cx={x.a.centroid[0]} cy={x.a.centroid[1]} r={r} fill={`url(#${uid}-bleedgrad)`} />
              </mask>
            );
          })}
      </defs>

      {/* Remembered shards: faded wash and a pencil outline. */}
      {mem.length > 0 && (
        <g style={BLEND}>
          {mem.map((x) => (
            <g key={x.s.key}>
              <path d={x.a.washes[0]} fill={seatColor(x.s.seat)} fillOpacity={0.24} />
              <path d={x.a.pencil} fill="none" stroke={GRAPHITE} strokeOpacity={0.7} strokeWidth={1.1 * inkScale} strokeDasharray={`${unit * 0.12} ${unit * 0.07}`} strokeLinecap="round" />
            </g>
          ))}
        </g>
      )}

      {/* Watercolour washes. */}
      <g style={BLEND} filter={quality === "high" ? `url(#${uid}-wc)` : undefined}>
        {live.map((x) => (
          <g key={x.s.key} mask={maskFor(x)}>
            {x.a.washes.map((d, k) => (
              <path key={k} d={d} fill={seatColor(x.s.seat)} fillOpacity={k === 0 ? 0.46 : 0.24} />
            ))}
          </g>
        ))}
      </g>

      {/* Marker streaks, one direction per seat. */}
      {quality !== "low" && (
        <g style={BLEND}>
          {live.map((x) => (
            <g key={x.s.key} clipPath={`url(#${uid}-c${x.i})`} mask={maskFor(x)}>
              <path d={x.a.streaks} fill="none" stroke={SEAT_DEEP[x.s.seat]} strokeOpacity={0.13} strokeWidth={unit * 0.15} strokeLinecap="round" />
              {x.a.streaks2 && <path d={x.a.streaks2} fill="none" stroke={SEAT_DEEP[x.s.seat]} strokeOpacity={0.22} strokeWidth={unit * 0.12} strokeLinecap="round" />}
            </g>
          ))}
        </g>
      )}

      {/* Scars: inked cross-hatching. */}
      {scene.scars.length > 0 && (
        <g>
          <path d={scars.hatch} fill={INK} fillOpacity={0.72} />
          <path d={scars.box} fill={INK} fillOpacity={0.85} />
        </g>
      )}

      {/* Taken nodes: a small star in the owner's ink. */}
      {scene.takenNodes.map((t) => (
        <path key={`t${t.cell}`} d={takenNodeStar(t.cell, w, unit)} fill={SEAT_INK[t.seat]} fillOpacity={0.55} />
      ))}

      {/* Ink outlines. */}
      {live.map((x) => (
        <g key={x.s.key} className={x.fresh ? "pb-ink-in" : undefined}>
          {x.a.ink2 && <path d={x.a.ink2} fill={SEAT_INK[x.s.seat]} fillOpacity={0.4} />}
          <path d={x.a.ink} fill={SEAT_INK[x.s.seat]} />
        </g>
      ))}

      {/* Cores: circled monogram. */}
      {scene.cores.map((c) => {
        const cx = ((c.cell % w) + 0.5) * unit;
        const cy = (Math.floor(c.cell / w) + 0.5) * unit;
        return (
          <g key={`core${c.cell}`}>
            <path d={coreRing(c.cell, w, unit, inkScale)} fill={SEAT_INK[c.seat]} />
            <text
              x={cx}
              y={cy + unit * 0.03}
              className="pb-hand"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={unit * 0.58 * textScale}
              fontWeight={700}
              fill={SEAT_INK[c.seat]}
              transform={`rotate(${((hashSeed(c.cell) % 13) - 6).toFixed(0)} ${cx} ${cy})`}
            >
              {SEAT_INITIALS[c.seat]}
            </text>
          </g>
        );
      })}

      {/* Open nodes: doodled stars. */}
      {scene.nodes.length > 0 && (
        <g>
          <path d={nodes.stars} fill={INK} fillOpacity={0.85} />
          <path d={nodes.ticks} stroke={INK} strokeOpacity={0.6} strokeWidth={1.1 * inkScale} strokeLinecap="round" fill="none" />
        </g>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ fog */

export const Fog = memo(function Fog({ uid, scene, layout, inkScale, quality }: LayerProps & { quality: Quality }) {
  const { w, h, unit } = layout;
  const fogKey = scene.fog.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shape = useMemo(() => fogShape(scene.fogLoops, unit), [fogKey, unit]);
  const hatch = useMemo(() => {
    const segs = hatchSegments({ x: -unit, y: -unit, w: (w + 2) * unit, h: (h + 2) * unit }, -Math.PI / 3, unit * 0.115, 31, unit * 0.02);
    let a = "";
    let b = "";
    segs.forEach((s, k) => {
      const d = sketchLine(s, { seed: hashSeed(k, 31), amp: unit * 0.02, step: unit * 0.6, wavelength: unit * 2 });
      if (k % 3 === 0) b += d;
      else a += d;
    });
    return { a, b };
  }, [w, h, unit]);
  const unknownKey = scene.unknown.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const qs = useMemo(() => questionCells(scene.unknown, w), [unknownKey, w]);
  if (scene.fog.length === 0) return null;
  return (
    <g>
      <defs>
        {quality === "low" ? (
          <clipPath id={`${uid}-fog`}>
            <path d={shape} />
          </clipPath>
        ) : (
          <>
            <filter id={`${uid}-feather`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={unit * 0.22} />
            </filter>
            <mask id={`${uid}-fog`} maskUnits="userSpaceOnUse" x={-unit} y={-unit} width={(w + 2) * unit} height={(h + 2) * unit}>
              <path d={shape} fill="#fff" filter={`url(#${uid}-feather)`} />
            </mask>
          </>
        )}
      </defs>
      <g {...(quality === "low" ? { clipPath: `url(#${uid}-fog)` } : { mask: `url(#${uid}-fog)` })}>
        <rect x={-unit} y={-unit} width={(w + 2) * unit} height={(h + 2) * unit} fill={PAPER} fillOpacity={0.5} />
        <g filter={quality === "low" ? undefined : `url(#${uid}-soft)`} style={BLEND}>
          <path d={hatch.a} fill="none" stroke={GRAPHITE} strokeOpacity={0.26} strokeWidth={1.0 * inkScale} strokeLinecap="round" />
          <path d={hatch.b} fill="none" stroke={GRAPHITE} strokeOpacity={0.4} strokeWidth={1.25 * inkScale} strokeLinecap="round" />
        </g>
      </g>
      <g className="pb-hand" fill={GRAPHITE} fillOpacity={0.62}>
        {qs.map((q) => {
          const cx = ((q.cell % w) + 0.5) * unit;
          const cy = (Math.floor(q.cell / w) + 0.5) * unit;
          return (
            <text key={q.cell} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={unit * q.size * Math.min(inkScale, 1.4)} fontWeight={600} transform={`rotate(${q.rot.toFixed(1)} ${cx} ${cy})`}>
              ?
            </text>
          );
        })}
      </g>
    </g>
  );
});

/* ------------------------------------------------------------------ frame */

/** Hand-inked border, coordinate labels and torus wrap marks. */
export const BoardFrame = memo(function BoardFrame({ scene, sk, layout, inkScale, cellPx }: LayerProps & { sk: string; cellPx: number }) {
  const { w, h, unit, pad } = layout;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const border = useMemo(() => boardBorder(scene.boardLoops, unit, inkScale), [sk, unit, inkScale]);
  const arrows = useMemo(() => (scene.torus ? torusArrows(w, h, unit) : ""), [scene.torus, w, h, unit]);
  const every = cellPx >= 22 ? 1 : cellPx >= 11 ? 2 : 4;
  const fs = unit * 0.4 * Math.min(Math.max(inkScale, 1), 1.6);
  const cols = [];
  for (let x = 0; x < w; x += every) cols.push(x);
  const rows = [];
  for (let y = 0; y < h; y += every) rows.push(y);
  return (
    <g>
      <path d={border.second} fill={INK} fillOpacity={0.3} />
      <path d={border.main} fill={INK} fillOpacity={0.9} />
      {arrows && <path d={arrows} fill="none" stroke={GRAPHITE} strokeOpacity={0.55} strokeWidth={1.2 * inkScale} strokeLinecap="round" strokeLinejoin="round" />}
      <g className="pb-hand" fill={GRAPHITE} fillOpacity={0.7} fontSize={fs} fontWeight={500}>
        {cols.map((x) => (
          <text key={`x${x}`} x={(x + 0.5) * unit} y={-pad * 0.42} textAnchor="middle" dominantBaseline="central">
            {columnLabel(x).toLowerCase()}
          </text>
        ))}
        {rows.map((y) => (
          <text key={`y${y}`} x={-pad * 0.5} y={(y + 0.5) * unit} textAnchor="middle" dominantBaseline="central">
            {y + 1}
          </text>
        ))}
      </g>
      {scene.torus && (
        <text className="pb-hand" x={w * unit + pad * 0.2} y={h * unit + pad * 0.62} textAnchor="end" dominantBaseline="central" fill={GRAPHITE} fillOpacity={0.75} fontSize={fs * 1.1} transform={`rotate(-3 ${w * unit} ${h * unit + pad * 0.62})`}>
          edges wrap
        </text>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ marks */

export const Marks = memo(function Marks({
  scene,
  layout,
  inkScale,
  marks,
  selectedSeat,
  reducedMotion,
}: Omit<LayerProps, "uid"> & { marks?: BoardMarks; selectedSeat: number | null; reducedMotion: boolean }) {
  const { w, h, unit } = layout;
  const attachKey = marks?.attach?.join(",") ?? "";
  const targetKey = marks?.targets?.join(",") ?? "";
  const misKey = marks?.misfire?.join(",") ?? "";
  const lastKey = marks?.lastPlaced?.join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attach = useMemo(() => (marks?.attach?.length ? attachTicks(marks.attach, w, unit) : ""), [attachKey, w, unit]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => (marks?.targets?.length ? targetRings(marks.targets, w, unit) : ""), [targetKey, w, unit]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const splats = useMemo(() => (marks?.misfire?.length ? misfireSplats(marks.misfire, w, unit) : ""), [misKey, w, unit]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flourish = useMemo(() => (marks?.lastPlaced?.length ? newFlourish(marks.lastPlaced, w, h, unit) : null), [lastKey, w, h, unit]);
  void scene;
  const tickColor = selectedSeat != null ? SEAT_INK[selectedSeat]! : GRAPHITE;
  return (
    <g>
      {attach && <path d={attach} fill="none" stroke={tickColor} strokeOpacity={0.85} strokeWidth={1.35 * inkScale} strokeLinecap="round" strokeLinejoin="round" />}
      {targets && <path d={targets} fill="none" stroke={RED_PENCIL} strokeOpacity={0.85} strokeWidth={1.4 * inkScale} strokeLinecap="round" />}
      {splats && (
        <g key={misKey} className={reducedMotion ? undefined : "pb-pop"}>
          <path d={splats} fill={RED_INK} fillOpacity={0.82} />
        </g>
      )}
      {flourish && (
        <g key={lastKey} className={reducedMotion ? undefined : "pb-new"} opacity={reducedMotion ? 0.85 : undefined}>
          <path d={flourish.d} fill="none" stroke={PAPER_LIGHT} strokeOpacity={0.9} strokeWidth={5 * inkScale} strokeLinecap="round" />
          <path d={flourish.d} pathLength={1} className="pb-draw" fill="none" stroke={RED_INK} strokeWidth={2 * inkScale} strokeLinecap="round" />
          <text
            x={flourish.label[0]}
            y={flourish.label[1]}
            className="pb-hand"
            textAnchor={flourish.anchor}
            dominantBaseline="central"
            fontSize={unit * 0.66 * Math.min(inkScale, 1.4)}
            fontWeight={700}
            fill={RED_INK}
            stroke={PAPER_LIGHT}
            strokeWidth={unit * 0.14}
            strokeLinejoin="round"
            paintOrder="stroke"
            transform={`rotate(-8 ${flourish.label[0]} ${flourish.label[1]})`}
          >
            new!
          </text>
        </g>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ ghost */

export const Ghost = memo(function Ghost({
  layout,
  inkScale,
  ghost,
}: Omit<LayerProps, "uid" | "scene"> & { scene?: Scene; ghost: { cells: number[]; seat: number; valid: boolean } | null }) {
  const { w, h, unit } = layout;
  const key = ghost ? `${ghost.seat}:${ghost.valid}:${ghost.cells.join(",")}` : "";
  const art = useMemo(() => {
    if (!ghost) return null;
    const cells = ghost.cells.filter((c) => c >= 0 && c < w * h);
    if (cells.length === 0) return null;
    const loops = traceLoops(cells, w);
    const seed = hashSeed(Math.min(...cells), cells.length);
    return {
      wash: ghostWash(loops, unit, seed),
      outline: ghostOutline(loops, unit, seed),
      scribble: ghost.valid ? "" : ghostScribble(cells, w, unit),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, w, h, unit]);
  if (!ghost || !art) return null;
  const dash = `${unit * 0.15} ${unit * 0.1}`;
  if (ghost.valid) {
    return (
      <g pointerEvents="none" data-ghost="valid">
        <path d={art.wash} fill={seatColor(ghost.seat)} fillOpacity={0.34} style={BLEND} />
        <path d={art.outline} fill="none" stroke={SEAT_INK[ghost.seat]} strokeOpacity={0.9} strokeWidth={1.5 * inkScale} strokeDasharray={dash} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g pointerEvents="none" data-ghost="invalid">
      <path d={art.wash} fill={RED_PENCIL} fillOpacity={0.07} />
      <path d={art.scribble} fill="none" stroke={RED_PENCIL} strokeOpacity={0.75} strokeWidth={1.2 * inkScale} strokeLinecap="round" strokeLinejoin="round" />
      <path d={art.outline} fill="none" stroke={RED_PENCIL} strokeOpacity={0.9} strokeWidth={1.4 * inkScale} strokeDasharray={dash} strokeLinecap="round" />
    </g>
  );
});
