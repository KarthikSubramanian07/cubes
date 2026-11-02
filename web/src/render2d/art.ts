/**
 * Path recipes for everything drawn on the Paper board. Each function is pure
 * and seeded by cell indices, so the same board always draws the same strokes.
 * Expensive per-shard art is cached by shard key.
 */
import { blobLoop, blobPath, circlePoints, hashSeed, hatchSegments, inkStroke, loopAsStroke, mulberry32, sketchLine, splatPath, starPoints, zigzag, type Pt, type Rect } from "./ink";
import type { Loop } from "./outline";

export type Quality = "low" | "medium" | "high";

/** Marker streak direction per seat, so seats differ by texture as well as colour. */
export const SEAT_STREAK_ANGLE = [-Math.PI / 4, Math.PI / 4, 0, Math.PI / 2];

const scaleLoop = (loop: Loop, unit: number): Pt[] => loop.map(([x, y]) => [x * unit, y * unit] as Pt);

/** Rotate a loop so tracing starts at a seeded vertex (overshoots land in different places). */
function rotate<T>(arr: readonly T[], k: number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  const s = ((k % n) + n) % n;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

export interface ShardArt {
  /** Watercolour wash layers (filled). */
  washes: string[];
  /** Straight union path, for clipping. */
  clip: string;
  /** Marker streaks (stroked), clipped to the shard. */
  streaks: string;
  /** A heavier set of streaks. */
  streaks2: string;
  /** Main ink outline (filled). */
  ink: string;
  /** Second, lighter pass of the pen (filled). */
  ink2: string;
  /** Pencil outline for remembered shards (stroked). */
  pencil: string;
  bbox: Rect;
  centroid: Pt;
}

const cache = new Map<string, ShardArt>();
const CACHE_MAX = 1500;

export function shardArt(
  key: string,
  cells: readonly number[],
  loops: readonly Loop[],
  w: number,
  seat: number,
  unit: number,
  inkScale: number,
  quality: Quality,
): ShardArt {
  const ck = `${key}@${unit}:${inkScale}:${quality}`;
  const hit = cache.get(ck);
  if (hit) return hit;

  const seed = hashSeed(cells[0] ?? 0, seat + 1);
  const rand = mulberry32(seed);
  const scaled = loops.map((l) => scaleLoop(l, unit));

  // Bounding box and centroid in user units.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    const x = c % w;
    const y = Math.floor(c / w);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
    sx += x + 0.5;
    sy += y + 0.5;
  }
  const bbox: Rect = { x: minX * unit, y: minY * unit, w: (maxX - minX) * unit, h: (maxY - minY) * unit };
  const centroid: Pt = [(sx / cells.length) * unit, (sy / cells.length) * unit];

  // Watercolour: a few deformed, translucent layers. The first bleeds slightly
  // past the line, the later ones sit a little inside it and pool unevenly.
  const layers = quality === "low" ? 1 : quality === "medium" ? 2 : 3;
  const washes: string[] = [];
  for (let k = 0; k < layers; k++) {
    // Layer 0 bleeds past the ink; later layers sit inside it at uneven depths,
    // so the rim and middle pick up different amounts of pigment.
    const inset = k === 0 ? -unit * 0.055 : unit * (0.05 + 0.09 * rand() + 0.04 * k);
    washes.push(
      scaled
        .map((l) =>
          blobLoop(l, {
            seed: hashSeed(seed, 11 + k),
            amp: unit * (0.045 + 0.03 * k),
            step: unit * 0.24,
            wavelength: unit * (0.55 + 0.6 * rand()),
            inset,
          }),
        )
        .join(""),
    );
  }

  const clip = scaled.map((l) => "M" + l.map((p) => `${p[0]} ${p[1]}`).join("L") + "Z").join("");

  // Marker streaks across the bounding box (clipped later). Two passes with
  // different pressure; each stroke starts and stops a little unevenly.
  let streaks = "";
  let streaks2 = "";
  if (quality !== "low") {
    const pad = unit * 0.3;
    const r: Rect = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + 2 * pad, h: bbox.h + 2 * pad };
    const segs = hatchSegments(r, SEAT_STREAK_ANGLE[seat % 4]!, unit * 0.21, hashSeed(seed, 3), unit * 0.035);
    segs.forEach((sg, i) => {
      const lr = mulberry32(hashSeed(seed, 200 + i));
      if (lr() < 0.12) return;
      const [a, b] = sg;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t0 = Math.min(0.45, (lr() * unit * 0.5) / len);
      const t1 = 1 - Math.min(0.45, (lr() * unit * 0.5) / len);
      const p0: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const d = sketchLine([p0, p1], { seed: hashSeed(seed, 100 + i), amp: unit * 0.03, step: unit * 0.3, wavelength: unit * 0.9 });
      if (lr() < 0.35) streaks2 += d;
      else streaks += d;
    });
  }

  const ink = scaled
    .map((l, li) =>
      inkStroke(loopAsStroke(rotate(l, seed + li), unit * 0.22), {
        seed: hashSeed(seed, 21 + li),
        width: 2.05 * inkScale,
        amp: unit * 0.028,
        wavelength: unit * 1.1,
        step: unit * 0.2,
        overshoot: unit * 0.14,
        pressure: 0.35,
        taper: unit * 0.4,
        taperMin: 0.45,
      }),
    )
    .join("");
  const ink2 =
    quality === "low"
      ? ""
      : scaled
          .map((l, li) =>
            inkStroke(loopAsStroke(rotate(l, seed + li + 2), 0), {
              seed: hashSeed(seed, 41 + li),
              width: 0.9 * inkScale,
              amp: unit * 0.05,
              wavelength: unit * 0.9,
              step: unit * 0.2,
              pressure: 0.5,
              taper: unit * 0.8,
              taperMin: 0.1,
            }),
          )
          .join("");
  const pencil = scaled
    .map((l, li) => sketchLine(loopAsStroke(rotate(l, seed + li), unit * 0.1), { seed: hashSeed(seed, 61 + li), amp: unit * 0.03, step: unit * 0.25, wavelength: unit }))
    .join("");

  const art: ShardArt = { washes, clip, streaks, streaks2, ink, ink2, pencil, bbox, centroid };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(ck, art);
  return art;
}

const cellRect = (i: number, w: number, unit: number, inset = 0): Rect => ({
  x: (i % w) * unit + inset,
  y: Math.floor(i / w) * unit + inset,
  w: unit - 2 * inset,
  h: unit - 2 * inset,
});

const cellCentre = (i: number, w: number, unit: number): Pt => [((i % w) + 0.5) * unit, (Math.floor(i / w) + 0.5) * unit];

/** Pencil dots at lattice points touching a playable cell. One stroked path (round caps). */
export function gridDots(playable: Uint8Array, w: number, h: number, unit: number): { small: string; big: string } {
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && playable[x + w * y] === 1;
  let small = "";
  let big = "";
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (!(has(x, y) || has(x - 1, y) || has(x, y - 1) || has(x - 1, y - 1))) continue;
      // Skip dots that sit on the board's outer border (the ink covers them).
      if (!(has(x, y) && has(x - 1, y) && has(x, y - 1) && has(x - 1, y - 1))) continue;
      const rand = mulberry32(hashSeed(x, y, 5));
      const px = x * unit + (rand() - 0.5) * unit * 0.03;
      const py = y * unit + (rand() - 0.5) * unit * 0.03;
      const seg = `M${px.toFixed(1)} ${py.toFixed(1)}h0.01`;
      if (x % 5 === 0 && y % 5 === 0) big += seg;
      else small += seg;
    }
  }
  return { small, big };
}

/** The board's hand-inked border, drawn twice. */
export function boardBorder(loops: readonly Loop[], unit: number, inkScale: number): { main: string; second: string } {
  let main = "";
  let second = "";
  loops.forEach((loop, li) => {
    const pts = scaleLoop(loop, unit);
    const seed = hashSeed(loop[0]?.[0] ?? 0, loop[0]?.[1] ?? 0, li, 77);
    main += inkStroke(loopAsStroke(rotate(pts, seed), unit * 0.4), {
      seed,
      width: 2.6 * inkScale,
      amp: unit * 0.035,
      wavelength: unit * 2.4,
      step: unit * 0.3,
      overshoot: unit * 0.25,
      pressure: 0.3,
      taper: unit * 0.8,
      taperMin: 0.3,
    });
    second += inkStroke(loopAsStroke(rotate(pts, seed + 3), unit * 0.6), {
      seed: hashSeed(seed, 1),
      width: 1.1 * inkScale,
      amp: unit * 0.07,
      wavelength: unit * 1.8,
      step: unit * 0.3,
      overshoot: unit * 0.4,
      pressure: 0.6,
      taper: unit * 1.5,
      taperMin: 0.1,
    });
  });
  return { main, second };
}

/** Cross-hatching for scars, plus a scratchy box. */
export function scarArt(cells: readonly number[], w: number, unit: number, inkScale: number): { hatch: string; box: string } {
  let hatch = "";
  let box = "";
  for (const i of cells) {
    const r = cellRect(i, w, unit, unit * 0.1);
    const seed = hashSeed(i, 251);
    const segs = [...hatchSegments(r, Math.PI / 4, unit * 0.14, seed, unit * 0.015), ...hatchSegments(r, -Math.PI / 4, unit * 0.17, seed + 1, unit * 0.02)];
    segs.forEach((s, k) => {
      hatch += inkStroke(s, { seed: hashSeed(seed, k), width: 0.95 * inkScale, amp: unit * 0.01, step: unit * 0.2, wavelength: unit * 0.5, pressure: 0.4, taper: unit * 0.1, taperMin: 0.3 });
    });
    const b = cellRect(i, w, unit, unit * 0.06);
    const corners: Pt[] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
    box += inkStroke(loopAsStroke(rotate(corners, seed), unit * 0.12), { seed: seed + 9, width: 1.2 * inkScale, amp: unit * 0.02, step: unit * 0.2, wavelength: unit * 0.6, overshoot: unit * 0.08 });
  }
  return { hatch, box };
}

/** Eraser smudges for storm ash: graphite smears, rubbed highlights and crumbs. */
export function ashArt(cells: readonly number[], w: number, unit: number): { smear: string; rub: string; crumbs: string } {
  let smear = "";
  let rub = "";
  let crumbs = "";
  for (const i of cells) {
    const [cx, cy] = cellCentre(i, w, unit);
    const seed = hashSeed(i, 252);
    const rand = mulberry32(seed);
    // Graphite dragged around by the eraser: uneven, overlapping smears.
    const blobs = rand() < 0.5 ? 1 : 2;
    for (let k = 0; k < blobs; k++) {
      smear += blobPath(
        cx + (rand() - 0.5) * unit * 0.5,
        cy + (rand() - 0.5) * unit * 0.5,
        unit * (0.35 + rand() * 0.4),
        unit * (0.22 + rand() * 0.25),
        hashSeed(seed, k),
        0.45,
      );
    }
    // Eraser passes: a short back-and-forth scrub on some cells, any angle.
    if (rand() < 0.3) {
      const a = rand() * Math.PI;
      const len = unit * (0.35 + rand() * 0.35);
      const passes = 3 + Math.floor(rand() * 3);
      const pts: Pt[] = [];
      for (let k = 0; k <= passes; k++) {
        const along = (k % 2 === 0 ? -0.5 : 0.5) * len;
        const across = (k / passes - 0.5) * unit * 0.3;
        pts.push([cx + Math.cos(a) * along - Math.sin(a) * across, cy + Math.sin(a) * along + Math.cos(a) * across]);
      }
      rub += sketchLine(pts, { seed: seed + 3, amp: unit * 0.02, step: unit * 0.1, wavelength: unit * 0.3 });
    }
    if (rand() < 0.22) {
      const kx = cx + (rand() - 0.5) * unit * 0.8;
      const ky = cy + (rand() - 0.5) * unit * 0.8;
      crumbs += sketchLine(circlePoints(kx, ky, unit * (0.03 + rand() * 0.03), seed + 5, 2.4), { seed: seed + 6, amp: unit * 0.008, step: unit * 0.02 });
    }
  }
  return { smear, rub, crumbs };
}

/** Doodled stars for empty nodes, with a couple of sparkle ticks. */
export function nodeArt(cells: readonly number[], w: number, unit: number, inkScale: number): { stars: string; ticks: string } {
  let stars = "";
  let ticks = "";
  for (const i of cells) {
    const [cx, cy] = cellCentre(i, w, unit);
    const seed = hashSeed(i, 1);
    const rand = mulberry32(seed);
    stars += inkStroke(starPoints(cx, cy + unit * 0.02, unit * 0.27, seed), {
      seed: seed + 1,
      width: 1.25 * inkScale,
      amp: unit * 0.012,
      step: unit * 0.12,
      wavelength: unit * 0.4,
      pressure: 0.4,
      taper: unit * 0.15,
      taperMin: 0.35,
    });
    const base = -Math.PI / 4 + (rand() - 0.5) * 0.6;
    for (let k = 0; k < 3; k++) {
      const a = base + (k - 1) * 0.55;
      const r0 = unit * 0.36;
      const r1 = unit * (0.44 + rand() * 0.04);
      ticks += sketchLine(
        [
          [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0],
          [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1],
        ],
        { seed: seed + 10 + k, amp: 0.2 },
      );
    }
  }
  return { stars, ticks };
}

/** A small filled star marking a node someone has taken. */
export function takenNodeStar(cell: number, w: number, unit: number): string {
  const [cx, cy] = cellCentre(cell, w, unit);
  const seed = hashSeed(cell, 2);
  const rand = mulberry32(seed);
  const pts: Pt[] = [];
  const rot = -Math.PI / 2 + (rand() - 0.5) * 0.3;
  for (let k = 0; k < 10; k++) {
    const a = rot + (k * Math.PI) / 5;
    const r = (k % 2 === 0 ? 0.2 : 0.085) * unit * (0.9 + rand() * 0.2);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L") + "Z";
}

/** The hand-inked circle around a Core monogram. */
export function coreRing(cell: number, w: number, unit: number, inkScale: number): string {
  const [cx, cy] = cellCentre(cell, w, unit);
  const seed = hashSeed(cell, 3);
  return inkStroke(circlePoints(cx, cy, unit * 0.36, seed, 1.15), {
    seed: seed + 1,
    width: 1.5 * inkScale,
    amp: unit * 0.01,
    step: unit * 0.08,
    wavelength: unit * 0.5,
    pressure: 0.45,
    taper: unit * 0.35,
    taperMin: 0.2,
  });
}

/** Soft pencil shading tile for fog (stroked lines inside a pattern tile). */
export function fogTile(size: number, unit: number): string {
  let d = "";
  const segs = hatchSegments({ x: -size * 0.1, y: -size * 0.1, w: size * 1.2, h: size * 1.2 }, -Math.PI / 3, unit * 0.11, 31, unit * 0.025);
  segs.forEach((s, k) => {
    d += sketchLine(s, { seed: hashSeed(k, 31), amp: unit * 0.015, step: unit * 0.5, wavelength: unit * 1.5 });
  });
  return d;
}

/** Fogged region edge, slightly wobbly, filled. */
export function fogShape(loops: readonly Loop[], unit: number): string {
  return loops
    .map((l, li) => blobLoop(scaleLoop(l, unit), { seed: hashSeed(li, 404), amp: unit * 0.08, step: unit * 0.35, wavelength: unit * 1.1, inset: unit * 0.04 }))
    .join("");
}

/** Which unknown fog cells get a "?" doodle: sparse and deterministic. */
export function questionCells(unknown: readonly number[], w: number): { cell: number; rot: number; size: number }[] {
  const out: { cell: number; rot: number; size: number }[] = [];
  const taken = new Set<number>();
  for (const i of unknown) {
    const r = mulberry32(hashSeed(i, 63))();
    if (r > 0.13) continue;
    // Keep doodles apart: no neighbour (incl. diagonal) already has one.
    const x = i % w;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (taken.has(i + dx + dy * w) && Math.abs((i + dx) % w - x) <= 1) near = true;
    if (near) continue;
    taken.add(i);
    const rand = mulberry32(hashSeed(i, 64));
    out.push({ cell: i, rot: (rand() - 0.5) * 34, size: 0.5 + rand() * 0.25 });
  }
  return out;
}

/** Tiny crop-mark ticks in each corner of a cell. */
export function attachTicks(cells: readonly number[], w: number, unit: number): string {
  let d = "";
  for (const i of cells) {
    const r = cellRect(i, w, unit, unit * 0.16);
    const len = unit * 0.16;
    const seed = hashSeed(i, 9);
    const corners: [Pt, Pt, Pt][] = [
      [[r.x, r.y + len], [r.x, r.y], [r.x + len, r.y]],
      [[r.x + r.w - len, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + len]],
      [[r.x + r.w, r.y + r.h - len], [r.x + r.w, r.y + r.h], [r.x + r.w - len, r.y + r.h]],
      [[r.x + len, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h - len]],
    ];
    corners.forEach((c, k) => {
      d += sketchLine(c, { seed: seed + k, amp: unit * 0.012, step: unit * 0.08, overshoot: unit * 0.02 });
    });
  }
  return d;
}

/** A loose red-pencil ring for targetable cells. */
export function targetRings(cells: readonly number[], w: number, unit: number): string {
  let d = "";
  for (const i of cells) {
    const [cx, cy] = cellCentre(i, w, unit);
    d += sketchLine(circlePoints(cx, cy, unit * 0.4, hashSeed(i, 12), 1.25), { seed: hashSeed(i, 13), amp: unit * 0.01, step: unit * 0.1 });
  }
  return d;
}

/** Red ink splats for misfires. */
export function misfireSplats(cells: readonly number[], w: number, unit: number): string {
  return cells.map((i) => splatPath(...cellCentre(i, w, unit), unit * 0.3, hashSeed(i, 66))).join("");
}

/** A "new!" underline flourish below a set of cells. Returns the stroke and where to put the label. */
export function newFlourish(cells: readonly number[], w: number, h: number, unit: number): { d: string; label: Pt; anchor: "start" | "end" } | null {
  if (cells.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    const x = c % w;
    const y = Math.floor(c / w);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  const seed = hashSeed(cells[0]!, cells.length, 71);
  const rand = mulberry32(seed);
  const y = maxY * unit + unit * 0.14;
  const x0 = minX * unit + unit * 0.05;
  const x1 = maxX * unit - unit * 0.05;
  const toRight = maxX < w - 2 || minX < 2;
  // Swoosh: underline, then a little loop that flicks up toward the label.
  const pts: Pt[] = toRight
    ? [
        [x0, y + unit * 0.02],
        [(x0 + x1) / 2, y + unit * (0.06 + rand() * 0.04)],
        [x1, y + unit * 0.02],
        [x1 + unit * 0.22, y - unit * 0.06],
        [x1 + unit * 0.3, y - unit * 0.2],
      ]
    : [
        [x1, y + unit * 0.02],
        [(x0 + x1) / 2, y + unit * (0.06 + rand() * 0.04)],
        [x0, y + unit * 0.02],
        [x0 - unit * 0.22, y - unit * 0.06],
        [x0 - unit * 0.3, y - unit * 0.2],
      ];
  const d = sketchLine(pts, { seed, amp: unit * 0.015, step: unit * 0.12, wavelength: unit * 0.6 });
  const nearBottom = maxY >= h;
  const label: Pt = toRight ? [x1 + unit * 0.32, y - unit * (nearBottom ? 0.05 : 0.18)] : [x0 - unit * 0.32, y - unit * (nearBottom ? 0.05 : 0.18)];
  return { d, label, anchor: toRight ? "start" : "end" };
}

/** Dashed pencil outline for the ghost (stroked). */
export function ghostOutline(loops: readonly Loop[], unit: number, seed: number): string {
  return loops
    .map((l, li) => sketchLine(loopAsStroke(scaleLoop(l, unit), unit * 0.12), { seed: hashSeed(seed, li, 88), amp: unit * 0.018, step: unit * 0.2, wavelength: unit * 0.8 }))
    .join("");
}

/** Red-pencil scribble across each horizontal run of ghost cells. */
export function ghostScribble(cells: readonly number[], w: number, unit: number): string {
  const sorted = [...cells].sort((a, b) => a - b);
  let d = "";
  let runStart = -1;
  let prev = -2;
  const flush = (a: number, b: number) => {
    const x0 = a % w;
    const y = Math.floor(a / w);
    const len = b - a + 1;
    const r: Rect = { x: x0 * unit + unit * 0.06, y: y * unit + unit * 0.08, w: len * unit - unit * 0.12, h: unit * 0.84 };
    d += sketchLine(zigzag(r, hashSeed(a, 90), Math.max(5, Math.round(len * 3.5))), { seed: hashSeed(a, 91), amp: unit * 0.02, step: unit * 0.12, wavelength: unit * 0.4 });
  };
  for (const c of sorted) {
    if (c === prev + 1 && c % w !== 0) {
      prev = c;
      continue;
    }
    if (runStart >= 0) flush(runStart, prev);
    runStart = c;
    prev = c;
  }
  if (runStart >= 0) flush(runStart, prev);
  return d;
}

/** A light single wash for the ghost. */
export function ghostWash(loops: readonly Loop[], unit: number, seed: number): string {
  return loops.map((l, li) => blobLoop(scaleLoop(l, unit), { seed: hashSeed(seed, li, 89), amp: unit * 0.03, step: unit * 0.3, inset: unit * 0.03 })).join("");
}

/** Pencil square around one cell (hover). */
export function cellBox(cell: number, w: number, unit: number, inset: number, seed: number): string {
  const r = cellRect(cell, w, unit, inset);
  const pts: Pt[] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  return sketchLine(loopAsStroke(pts, unit * 0.1), { seed, amp: unit * 0.015, step: unit * 0.15, overshoot: unit * 0.04 });
}

/** Viewfinder brackets around the keyboard cursor. */
export function focusBrackets(cell: number, w: number, unit: number, inkScale: number): string {
  const r = cellRect(cell, w, unit, -unit * 0.08);
  const len = unit * 0.3;
  const seed = hashSeed(cell, 15);
  const corners: [Pt, Pt, Pt][] = [
    [[r.x, r.y + len], [r.x, r.y], [r.x + len, r.y]],
    [[r.x + r.w - len, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + len]],
    [[r.x + r.w, r.y + r.h - len], [r.x + r.w, r.y + r.h], [r.x + r.w - len, r.y + r.h]],
    [[r.x + len, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h - len]],
  ];
  return corners
    .map((c, k) => inkStroke(c, { seed: seed + k, width: 2.2 * inkScale, amp: unit * 0.008, step: unit * 0.08, pressure: 0.3, taper: unit * 0.1, taperMin: 0.4 }))
    .join("");
}

/** Edge-gluing chevrons for torus boards (one on top/bottom edges, two on left/right). */
export function torusArrows(w: number, h: number, unit: number): string {
  const W = w * unit;
  const H = h * unit;
  const s = unit * 0.28;
  const off = unit * 0.5;
  let d = "";
  const chevron = (x: number, y: number, dir: "right" | "down", seed: number) => {
    const pts: Pt[] = dir === "right" ? [[x - s * 0.6, y - s], [x + s * 0.4, y], [x - s * 0.6, y + s]] : [[x - s, y - s * 0.6], [x, y + s * 0.4], [x + s, y - s * 0.6]];
    d += sketchLine(pts, { seed, amp: unit * 0.01, step: unit * 0.1 });
  };
  const arrow = (a: Pt, b: Pt, seed: number) => {
    d += sketchLine([a, b], { seed, amp: unit * 0.02, step: unit * 0.15, wavelength: unit * 0.5 });
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const hl = unit * 0.16;
    d += sketchLine(
      [
        [b[0] - Math.cos(ang - 0.5) * hl, b[1] - Math.sin(ang - 0.5) * hl],
        b,
        [b[0] - Math.cos(ang + 0.5) * hl, b[1] - Math.sin(ang + 0.5) * hl],
      ],
      { seed: seed + 1, amp: 0.3 },
    );
  };
  // Gluing marks on the border.
  for (const x of [W * 0.5]) {
    chevron(x, 0, "right", 1);
    chevron(x, H, "right", 2);
  }
  for (const y of [H * 0.5]) {
    chevron(0, y - s * 0.6, "down", 3);
    chevron(0, y + s * 0.6, "down", 4);
    chevron(W, y - s * 0.6, "down", 5);
    chevron(W, y + s * 0.6, "down", 6);
  }
  // Little "out here, in there" arrows in the margin.
  // Sit them on cell boundaries so they pass between the coordinate labels.
  for (const t of [0.25, 0.75]) {
    const x = Math.round(w * t) * unit;
    const y = Math.round(h * t) * unit;
    arrow([x, -unit * 0.12], [x, -off - unit * 0.2], 10 + t * 10);
    arrow([x, H + off + unit * 0.2], [x, H + unit * 0.12], 20 + t * 10);
    arrow([-unit * 0.12, y], [-off - unit * 0.2, y], 30 + t * 10);
    arrow([W + off + unit * 0.2, y], [W + unit * 0.12, y], 40 + t * 10);
  }
  return d;
}
