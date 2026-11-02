/** Board helpers shared by the controller and HUD: neighbours, attach points, targets. */
import { FLAG, OWNER, cellCoords, cellIndex, type GameConfig, type View } from "@/engine/types";

function wrap(v: number, n: number, torus: boolean): number | null {
  if (torus) return ((v % n) + n) % n;
  return v < 0 || v >= n ? null : v;
}

function neighbours(cfg: GameConfig, i: number, kind: "face" | "link"): number[] {
  const dims = cfg.dims;
  const [x, y, z] = cellCoords(dims, i);
  const torus = cfg.topology === "torus";
  const three = dims[2] > 1;
  const out: number[] = [];
  for (let dz = three ? -1 : 0; dz <= (three ? 1 : 0); dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (m === 0) continue;
        if ((m === 1) !== (kind === "face")) continue;
        const nx = wrap(x + dx, dims[0], torus);
        const ny = wrap(y + dy, dims[1], torus);
        const nz = z + dz;
        if (nx === null || ny === null || nz < 0 || nz >= dims[2]) continue;
        const j = cellIndex(dims, nx, ny, nz);
        if (j !== i && !out.includes(j)) out.push(j);
      }
    }
  }
  return out;
}

const cache = new Map<string, { face: number[][]; link: number[][] }>();

export function neighbourTables(cfg: GameConfig): { face: number[][]; link: number[][] } {
  const k = `${cfg.dims.join("x")}:${cfg.topology}`;
  let t = cache.get(k);
  if (!t) {
    const n = cfg.dims[0] * cfg.dims[1] * cfg.dims[2];
    t = { face: [], link: [] };
    for (let i = 0; i < n; i++) {
      t.face.push(neighbours(cfg, i, "face"));
      t.link.push(neighbours(cfg, i, "link"));
    }
    cache.set(k, t);
  }
  return t;
}

const isSeat = (o: number) => o >= 1 && o <= 4;

function lightsWith(cfg: GameConfig, seat: number, owner: number): boolean {
  if (!isSeat(owner)) return false;
  const o = owner - 1;
  return o === seat || (cfg.sharedLight && cfg.teams && o % 2 === seat % 2);
}

/** Empty cells where a shard of `seat` could hook on at a corner. */
export function attachPoints(view: View, seat: number): number[] {
  const cfg = view.config;
  const { face, link } = neighbourTables(cfg);
  const own = seat + 1;
  const out: number[] = [];
  for (let i = 0; i < view.cells.length; i++) {
    if (view.cells[i] !== OWNER.EMPTY) continue;
    if (face[i]!.some((f) => view.cells[f] === own)) continue;
    if (link[i]!.some((l) => lightsWith(cfg, seat, view.cells[l]!))) out.push(i);
  }
  return out;
}

/** Cells `seat` may Shatter: visible, non-allied, non-Core light with nothing on top. */
export function shatterTargets(view: View, seat: number): number[] {
  const cfg = view.config;
  const dims = cfg.dims;
  const out: number[] = [];
  for (let i = 0; i < view.cells.length; i++) {
    const o = view.cells[i]!;
    if (!isSeat(o)) continue;
    const victim = o - 1;
    if (victim === seat || (cfg.teams && victim % 2 === seat % 2)) continue;
    const f = view.flags[i]!;
    if (f & FLAG.CORE || !(f & FLAG.VISIBLE)) continue;
    if (cfg.gravity) {
      const [x, y, z] = cellCoords(dims, i);
      if (z + 1 < dims[2] && view.cells[cellIndex(dims, x, y, z + 1)] !== OWNER.EMPTY) continue;
    }
    out.push(i);
  }
  return out;
}

/** Cells newly lit between two views (for the "last placed" mark when events are redacted). */
export function diffPlaced(prev: View | null, next: View): number[] {
  if (!prev || prev.cells.length !== next.cells.length) return [];
  const out: number[] = [];
  for (let i = 0; i < next.cells.length; i++) {
    if (prev.cells[i] === OWNER.EMPTY && isSeat(next.cells[i]!)) out.push(i);
  }
  return out;
}
