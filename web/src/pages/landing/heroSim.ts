import { SHARDS, type Cell2 } from "@/ui/shards";

/**
 * A tiny, honest rules sim used only for the landing-page animation and the
 * game-shell placeholder: corner link, no face contact with your own light,
 * one of each shard per seat. It is not the engine (crates/engine is); it just
 * has to produce boards that look like real games.
 */

export interface SimPlacement {
  seat: number;
  cells: Cell2[];
  /** Grid points where this shard corner-touches its own light. */
  links: Cell2[];
  shard: string;
}

export interface SimResult {
  size: number;
  cores: Cell2[];
  placements: SimPlacement[];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(cells: Cell2[]): Cell2[] {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as Cell2).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** All distinct rotations and reflections. */
export function orientations(cells: readonly Cell2[]): Cell2[][] {
  const out = new Map<string, Cell2[]>();
  let cur = cells.map((c) => [c[0], c[1]] as Cell2);
  for (let flip = 0; flip < 2; flip++) {
    for (let r = 0; r < 4; r++) {
      const n = normalize(cur);
      out.set(n.map((c) => c.join(",")).join(";"), n);
      cur = cur.map(([x, y]) => [-y, x] as Cell2);
    }
    cur = cur.map(([x, y]) => [-x, y] as Cell2);
  }
  return [...out.values()];
}

const ORIENTS = SHARDS.map((s) => ({ id: s.id, size: s.cells.length, orients: orientations(s.cells) }));

const ORTHO: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function simulate({ size = 14, seats = 4, seed = 7, maxPly = 400 }: { size?: number; seats?: number; seed?: number; maxPly?: number } = {}): SimResult {
  const rand = rng(seed);
  const owner = new Int8Array(size * size).fill(-1);
  const inset = 1;
  const corePoints: Cell2[] = [
    [inset, inset],
    [size - 1 - inset, size - 1 - inset],
    [size - 1 - inset, inset],
    [inset, size - 1 - inset],
  ];
  const cores: Cell2[] = corePoints.slice(0, Math.min(4, Math.max(2, seats)));
  cores.forEach(([x, y], s) => (owner[y * size + x] = s));

  const remaining = cores.map(() => new Set(ORIENTS.map((o) => o.id)));
  const dark = cores.map(() => false);
  const placements: SimPlacement[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? -2 : owner[y * size + x]!);
  const touchesOwnFace = (x: number, y: number, s: number) => ORTHO.some(([dx, dy]) => at(x + dx, y + dy) === s);
  const c = (size - 1) / 2;

  let turn = 0;
  for (let ply = 0; ply < maxPly && dark.some((d) => !d); ply++) {
    const s = turn % cores.length;
    turn++;
    if (dark[s]) continue;

    // Every legal placement covers at least one anchor: an empty cell diagonal to our light, with no face contact.
    const anchors: Cell2[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (at(x, y) === -1 && !touchesOwnFace(x, y, s) && DIAG.some(([dx, dy]) => at(x + dx, y + dy) === s)) anchors.push([x, y]);

    let best: { cells: Cell2[]; id: string; score: number } | null = null;
    for (const o of ORIENTS) {
      if (!remaining[s]!.has(o.id)) continue;
      for (const shape of o.orients) {
        const tried = new Set<number>();
        for (const [ax, ay] of anchors) {
          for (const [kx, ky] of shape) {
            const ox = ax - kx;
            const oy = ay - ky;
            const key = (oy + size) * 4 * size + (ox + size);
            if (tried.has(key)) continue;
            tried.add(key);
            let ok = true;
            let dist = 0;
            for (const [dx, dy] of shape) {
              const x = ox + dx;
              const y = oy + dy;
              if (at(x, y) !== -1 || touchesOwnFace(x, y, s)) {
                ok = false;
                break;
              }
              dist += Math.abs(x - c) + Math.abs(y - c);
            }
            if (!ok) continue;
            const score = o.size * 10 - (dist / shape.length) * 0.9 + rand() * 7;
            if (!best || score > best.score) best = { cells: shape.map(([dx, dy]) => [ox + dx, oy + dy] as Cell2), id: o.id, score };
          }
        }
      }
    }
    if (!best) {
      dark[s] = true;
      continue;
    }
    const links: Cell2[] = [];
    for (const [x, y] of best.cells)
      for (const [ex, ey] of DIAG) if (at(x + ex, y + ey) === s) links.push([x + (ex > 0 ? 1 : 0), y + (ey > 0 ? 1 : 0)]);
    for (const [x, y] of best.cells) owner[y * size + x] = s;
    remaining[s]!.delete(best.id);
    placements.push({ seat: s, cells: best.cells, links, shard: best.id });
  }
  return { size, cores, placements };
}
