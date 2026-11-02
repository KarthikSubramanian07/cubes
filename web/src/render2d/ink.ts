/**
 * A tiny deterministic "hand-drawn" stroke generator.
 *
 * Everything here is pure: the same points and seed always produce the same
 * SVG path string, so strokes never jitter between renders. Seeds are derived
 * from cell indices by the callers.
 *
 * Two kinds of output:
 *  - `inkStroke`: a filled outline of a pen line with varying width (pressure,
 *    tapered ends). Looks like a fineliner. Use with `fill`, no stroke.
 *  - `sketchLine`: the wobbled centre line as a smooth path. Use with `stroke`
 *    when you want dashes or a draw-on animation (pencil work).
 */

export type Pt = readonly [number, number];

/* ------------------------------------------------------------------ random */

/** mulberry32: small, fast, good enough for visual noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix any number of integers into one 32-bit seed. */
export function hashSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (Math.trunc(p) >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Smooth 1D value noise in [-1, 1] over arc length. */
export function valueNoise(rand: () => number, length: number, wavelength: number): (s: number) => number {
  const wl = Math.max(wavelength, 1e-6);
  const n = Math.ceil(Math.max(length, 0) / wl) + 3;
  const knots = new Float64Array(n);
  for (let i = 0; i < n; i++) knots[i] = rand() * 2 - 1;
  return (s: number) => {
    const u = Math.max(0, s) / wl;
    const i = Math.min(Math.floor(u), n - 2);
    const f = Math.min(u - i, 1);
    const t = f * f * (3 - 2 * f);
    return knots[i]! + (knots[i + 1]! - knots[i]!) * t;
  };
}

/* ------------------------------------------------------------------ geometry */

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (p: Pt) => `${r1(p[0])} ${r1(p[1])}`;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Resample a polyline so no segment is longer than `step`, keeping every original vertex. */
export function resample(points: readonly Pt[], step: number): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

function arcLengths(pts: readonly Pt[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return s;
}

/** Unit normals (left-hand, y-down screen space) using averaged neighbouring directions. */
function normals(pts: readonly Pt[]): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out.push([-dy, dx]);
  }
  return out;
}

/**
 * Smooth path through points: straight to the first midpoint, then quadratic
 * curves using each vertex as the control point. Corners round off a little,
 * like a real pen.
 */
export function smoothD(pts: readonly Pt[], move = true): string {
  if (pts.length === 0) return "";
  const head = move ? `M${fmt(pts[0]!)}` : `L${fmt(pts[0]!)}`;
  if (pts.length === 1) return head;
  if (pts.length === 2) return `${head}L${fmt(pts[1]!)}`;
  let d = head;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    d += `Q${fmt(p)} ${fmt(i === pts.length - 2 ? q : mid)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ wobble */

export interface WobbleOpts {
  seed: number;
  /** Max perpendicular drift (user units). */
  amp?: number;
  /** Wavelength of the drift along the line (user units). */
  wavelength?: number;
  /** Resample spacing (user units). */
  step?: number;
  /** Extend both ends by up to this much, like a pen that overshoots. */
  overshoot?: number;
  /** Small per-point tremor as a fraction of amp. */
  tremor?: number;
}

/** Jitter a polyline with smooth seeded noise. */
export function wobble(points: readonly Pt[], o: WobbleOpts): Pt[] {
  if (points.length < 2) return points.slice();
  const rand = mulberry32(o.seed);
  const amp = o.amp ?? 1;
  const step = o.step ?? 8;
  const src = points.slice();
  const os = o.overshoot ?? 0;
  if (os > 0) {
    const [a, b] = [src[0]!, src[1]!];
    const la = dist(a, b) || 1;
    const ea = os * (0.35 + 0.65 * rand());
    src[0] = [a[0] - ((b[0] - a[0]) / la) * ea, a[1] - ((b[1] - a[1]) / la) * ea];
    const [y, z] = [src[src.length - 2]!, src[src.length - 1]!];
    const lz = dist(y, z) || 1;
    const ez = os * (0.35 + 0.65 * rand());
    src[src.length - 1] = [z[0] + ((z[0] - y[0]) / lz) * ez, z[1] + ((z[1] - y[1]) / lz) * ez];
  }
  const pts = resample(src, step);
  const s = arcLengths(pts);
  const total = s[s.length - 1] ?? 0;
  const drift = valueNoise(rand, total, o.wavelength ?? 40);
  const tremor = (o.tremor ?? 0.18) * amp;
  const ns = normals(pts);
  return pts.map((p, i) => {
    const off = drift(s[i]!) * amp + (rand() * 2 - 1) * tremor;
    const n = ns[i]!;
    return [p[0] + n[0] * off, p[1] + n[1] * off] as Pt;
  });
}

/* ------------------------------------------------------------------ strokes */

export interface StrokeOpts extends WobbleOpts {
  /** Nominal pen width (user units). */
  width: number;
  /** Fraction of the line (from each end, in user units) over which width tapers. */
  taper?: number;
  /** Minimum width at tapered ends as a fraction of `width`. */
  taperMin?: number;
  /** Pressure variation amplitude (0..1). */
  pressure?: number;
}

/** A pen line with varying width, returned as a filled outline path. */
export function inkStroke(points: readonly Pt[], o: StrokeOpts): string {
  const pts = wobble(points, o);
  if (pts.length < 2) return "";
  const rand = mulberry32(hashSeed(o.seed, 7));
  const s = arcLengths(pts);
  const total = s[s.length - 1] || 1;
  const press = valueNoise(rand, total, (o.wavelength ?? 40) * 1.7);
  const taper = o.taper ?? Math.min(total * 0.3, o.width * 6);
  const tmin = o.taperMin ?? 0.35;
  const pv = o.pressure ?? 0.3;
  const ns = normals(pts);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const si = s[i]!;
    const edge = taper > 0 ? Math.min(1, si / taper, (total - si) / taper) : 1;
    const ramp = tmin + (1 - tmin) * Math.sin((Math.max(0, edge) * Math.PI) / 2);
    const w = Math.max(0.05, o.width * ramp * (1 + pv * press(si))) / 2;
    const p = pts[i]!;
    const n = ns[i]!;
    left.push([p[0] + n[0] * w, p[1] + n[1] * w]);
    right.push([p[0] - n[0] * w, p[1] - n[1] * w]);
  }
  right.reverse();
  const capEnd = r1(Math.max(0.05, dist(left[left.length - 1]!, right[0]!) / 2));
  const capStart = r1(Math.max(0.05, dist(right[right.length - 1]!, left[0]!) / 2));
  return (
    smoothD(left) +
    `A${capEnd} ${capEnd} 0 0 1 ${fmt(right[0]!)}` +
    smoothD(right, false) +
    `A${capStart} ${capStart} 0 0 1 ${fmt(left[0]!)}Z`
  );
}

/** Wobbled centre line as a smooth open path (for stroked pencil work). */
export function sketchLine(points: readonly Pt[], o: WobbleOpts): string {
  return smoothD(wobble(points, o));
}

/**
 * A closed polygon drawn the way a person traces a shape: start at a vertex,
 * go round, and finish a little past the start instead of closing perfectly.
 */
export function loopAsStroke(loop: readonly Pt[], closeOvershoot: number): Pt[] {
  if (loop.length < 2) return loop.slice();
  const pts = [...loop, loop[0]!];
  if (closeOvershoot > 0) {
    const a = loop[0]!;
    const b = loop[1]!;
    const l = dist(a, b) || 1;
    const e = Math.min(closeOvershoot, l * 0.6);
    pts.push([a[0] + ((b[0] - a[0]) / l) * e, a[1] + ((b[1] - a[1]) / l) * e]);
  }
  return pts;
}

/** A filled organic closed shape (wash edge, smudge). Points are displaced along their normals. */
export function blobLoop(loop: readonly Pt[], o: { seed: number; amp: number; step: number; wavelength?: number; inset?: number }): string {
  if (loop.length < 3) return "";
  const rand = mulberry32(o.seed);
  const closed = [...loop, loop[0]!];
  const pts = resample(closed, o.step);
  pts.pop(); // drop duplicated start
  const n = pts.length;
  const s = arcLengths([...pts, pts[0]!]);
  const total = s[s.length - 1] || 1;
  const noise = valueNoise(rand, total, o.wavelength ?? o.step * 3);
  // Make the noise periodic by blending the tail into the head.
  const periodic = (si: number) => {
    const blend = Math.min(1, (total - si) / (o.wavelength ?? o.step * 3));
    return noise(si) * blend + noise(0) * (1 - blend);
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[(i + 1) % n]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const off = periodic(s[i]!) * o.amp - (o.inset ?? 0);
    // For clockwise (y-down) loops, (dy, -dx) points outward (left of travel on screen).
    const p = pts[i]!;
    out.push([p[0] + dy * off, p[1] - dx * off]);
  }
  return closedSmoothD(out);
}

/** Smooth closed path through points (quadratic through midpoints). */
export function closedSmoothD(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n < 3) return "";
  const mid = (i: number): Pt => {
    const a = pts[i % n]!;
    const b = pts[(i + 1) % n]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  let d = `M${fmt(mid(0))}`;
  for (let i = 1; i <= n; i++) d += `Q${fmt(pts[i % n]!)} ${fmt(mid(i))}`;
  return d + "Z";
}

/* ------------------------------------------------------------------ hatching */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Liang–Barsky: clip segment ab to rect. Returns null when fully outside. */
export function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - r.x, r.x + r.w - a[0], a[1] - r.y, r.y + r.h - a[1]];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t1 - t0 < 1e-9) return null;
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

/**
 * Parallel hatch lines across a rect at `angle` (radians), `spacing` apart.
 * Lines sit on a global lattice (offset from the origin), so neighbouring
 * rects hatched with the same angle and spacing line up.
 */
export function hatchSegments(r: Rect, angle: number, spacing: number, seed: number, jitter = 0): [Pt, Pt][] {
  const rand = mulberry32(seed);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Normal direction; lines are { p : p·n = c }.
  const nx = -dy;
  const ny = dx;
  const corners: Pt[] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ];
  const cs = corners.map((c) => c[0] * nx + c[1] * ny);
  const cmin = Math.min(...cs);
  const cmax = Math.max(...cs);
  const reach = r.w + r.h;
  const out: [Pt, Pt][] = [];
  for (let k = Math.ceil(cmin / spacing); k * spacing <= cmax; k++) {
    const c = k * spacing + (rand() * 2 - 1) * jitter;
    const ox = nx * c;
    const oy = ny * c;
    // Project rect centre onto the line to get a good midpoint.
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const t = (cx - ox) * dx + (cy - oy) * dy;
    const mx = ox + dx * t;
    const my = oy + dy * t;
    const seg = clipSegment([mx - dx * reach, my - dy * reach], [mx + dx * reach, my + dy * reach], r);
    if (seg) out.push(seg);
  }
  return out;
}

/** A back-and-forth scribble across a rect (pencil cross-out). */
export function zigzag(r: Rect, seed: number, passes: number): Pt[] {
  const rand = mulberry32(seed);
  const pts: Pt[] = [];
  for (let i = 0; i <= passes; i++) {
    const t = i / passes;
    const y = r.y + r.h * (0.1 + 0.8 * t) + (rand() - 0.5) * r.h * 0.08;
    const x = i % 2 === 0 ? r.x + r.w * (0.04 + rand() * 0.1) : r.x + r.w * (0.86 + rand() * 0.1);
    pts.push([x, y]);
  }
  return pts;
}

/* ------------------------------------------------------------------ glyphs */

/** A one-stroke doodled star (pentagram), the way people draw stars in margins. */
export function starPoints(cx: number, cy: number, r: number, seed: number): Pt[] {
  const rand = mulberry32(seed);
  const rot = -Math.PI / 2 + (rand() - 0.5) * 0.35;
  const verts: Pt[] = [];
  for (let k = 0; k < 5; k++) {
    const a = rot + (k * 2 * Math.PI * 2) / 5;
    const rr = r * (0.88 + rand() * 0.2);
    verts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return [...verts, [verts[0]![0] + (rand() - 0.5) * r * 0.15, verts[0]![1] + (rand() - 0.5) * r * 0.15]];
}

/** A hand-drawn circle: a little more than one turn, radius wandering. */
export function circlePoints(cx: number, cy: number, r: number, seed: number, turns = 1.12): Pt[] {
  const rand = mulberry32(seed);
  const start = rand() * Math.PI * 2;
  const n = Math.max(16, Math.round(28 * turns));
  const wob = valueNoise(rand, n, 6);
  const squash = 0.92 + rand() * 0.12;
  const tilt = rand() * Math.PI;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * turns * Math.PI * 2;
    // Spiral slightly outward so the overlap doesn't sit on top of the start.
    const rr = r * (1 + wob(i) * 0.05 + (i / n) * 0.07);
    const ex = Math.cos(a) * rr;
    const ey = Math.sin(a) * rr * squash;
    pts.push([cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]);
  }
  return pts;
}

/** An irregular blob around a centre (smudges, splats). Returns a closed path. */
export function blobPath(cx: number, cy: number, rx: number, ry: number, seed: number, irregularity = 0.25, spikes = 0): string {
  const rand = mulberry32(seed);
  const n = 14 + Math.round(rand() * 6);
  const rot = rand() * Math.PI;
  const wob = valueNoise(rand, n, 3);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let k = 1 + wob(i) * irregularity;
    if (spikes > 0 && rand() < spikes) k *= 1.35 + rand() * 0.5;
    const ex = Math.cos(a) * rx * k;
    const ey = Math.sin(a) * ry * k;
    pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
  }
  return closedSmoothD(pts);
}

/** An ink splat: a spiky blob plus a few droplets. */
export function splatPath(cx: number, cy: number, r: number, seed: number): string {
  const rand = mulberry32(seed);
  let d = blobPath(cx, cy, r, r * (0.8 + rand() * 0.3), hashSeed(seed, 1), 0.3, 0.3);
  const drops = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < drops; i++) {
    const a = rand() * Math.PI * 2;
    const dd = r * (1.35 + rand() * 0.7);
    const rr = r * (0.08 + rand() * 0.14);
    d += blobPath(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rr, rr * (0.8 + rand() * 0.4), hashSeed(seed, 10 + i), 0.2);
  }
  return d;
}
