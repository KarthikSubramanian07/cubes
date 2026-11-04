import { useMemo } from "react";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Path,
  Shape,
} from "three";
import type { View } from "@/engine/types";
import type { Loop } from "@/render2d/outline";
import type { BoardLayout } from "../coords";
import { insetLoop, loopArea, pieceGroups, ribbon, type PieceGroup } from "../pieceOutline";
import { seatColor, seatGlow } from "../palette";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** How far the border sits inside the squares' outer edge (tiles stop at 0.06). */
const INSET = 0.025;
/** Height of the shared base the tiles stand on. */
const PLATE_H = 0.13;
/** Width of the bright border line. */
const LINE_W = 0.055;

interface Bucket {
  seat: number;
  stale: boolean;
  loops: Loop[];
}

function bucketsOf(groups: PieceGroup[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const g of groups) {
    const key = `${g.seat}|${g.stale ? 1 : 0}`;
    let b = map.get(key);
    if (!b) map.set(key, (b = { seat: g.seat, stale: g.stale, loops: [] }));
    // Inset per piece, keeping each piece's loops together for hole matching.
    b.loops.push(...g.loops.map((l) => insetLoop(l, INSET)));
  }
  return [...map.values()];
}

/** Board units to world X/Z: square x spans [x, x+1] and is centred on x - ox. */
function toWorld(L: BoardLayout, x: number, y: number): [number, number] {
  return [x - 0.5 - L.ox, y - 0.5 - L.oz];
}

function plateGeometry(L: BoardLayout, loops: Loop[]): ExtrudeGeometry {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) < 0);
  const shapes = outers.map((l) => {
    const s = new Shape();
    l.forEach(([x, y], k) => {
      const [wx, wz] = toWorld(L, x, y);
      if (k === 0) s.moveTo(wx, wz);
      else s.lineTo(wx, wz);
    });
    s.closePath();
    return { s, loop: l };
  });
  for (const h of holes) {
    // A hole belongs to the outer loop whose box contains it.
    const [hx, hy] = h[0]!;
    const owner = shapes.find(({ loop }) => {
      const xs = loop.map((v) => v[0]);
      const ys = loop.map((v) => v[1]);
      return hx > Math.min(...xs) && hx < Math.max(...xs) && hy > Math.min(...ys) && hy < Math.max(...ys);
    });
    if (!owner) continue;
    const p = new Path();
    h.forEach(([x, y], k) => {
      const [wx, wz] = toWorld(L, x, y);
      if (k === 0) p.moveTo(wx, wz);
      else p.lineTo(wx, wz);
    });
    p.closePath();
    owner.s.holes.push(p);
  }
  const g = new ExtrudeGeometry(
    shapes.map((x) => x.s),
    { depth: PLATE_H, bevelEnabled: false, curveSegments: 1 },
  );
  // Shape XY becomes world XZ; the extrusion runs down, so lift it onto the floor.
  g.rotateX(Math.PI / 2);
  g.translate(0, PLATE_H + 0.002, 0);
  return g;
}

function ribbonGeometry(L: BoardLayout, loops: Loop[]): BufferGeometry {
  const flat = ribbon(loops, LINE_W);
  const pos = new Float32Array((flat.length / 2) * 3);
  for (let k = 0, j = 0; k < flat.length; k += 2, j += 3) {
    const [wx, wz] = toWorld(L, flat[k]!, flat[k + 1]!);
    pos[j] = wx;
    pos[j + 1] = PLATE_H + 0.006;
    pos[j + 2] = wz;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return g;
}

function scaled(c: Color, k: number): Color {
  return c.clone().multiplyScalar(k);
}

/** Each 2D piece as one object: a coloured base joining its tiles and a glowing border around it. */
export function PieceOutlines({ view, L }: { view: View; L: BoardLayout }) {
  const buckets = useMemo(() => bucketsOf(pieceGroups(view)), [view]);
  return (
    <group>
      {buckets.map((b) => (
        <SeatOutline key={`${b.seat}|${b.stale}`} L={L} bucket={b} />
      ))}
    </group>
  );
}

function SeatOutline({ L, bucket }: { L: BoardLayout; bucket: Bucket }) {
  const { seat, stale, loops } = bucket;
  const plate = useDisposable(() => plateGeometry(L, loops), [L, loops]);
  const line = useDisposable(() => ribbonGeometry(L, loops), [L, loops]);
  const dim = stale ? 0.35 : 1;
  const glow = seatGlow(seat);
  const base = seatColor(seat);
  const capMat = useDisposable(
    () => new MeshBasicMaterial({ color: scaled(base, 0.85 * dim), side: DoubleSide, transparent: true, opacity: 0.92 }),
    [seat, dim],
  );
  const sideMat = useDisposable(() => new MeshBasicMaterial({ color: scaled(base, 0.9 * glow * dim), side: DoubleSide, toneMapped: false }), [seat, dim, glow]);
  const lineMat = useDisposable(
    () => new MeshBasicMaterial({ color: scaled(base, 2.2 * glow * dim), side: DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    [seat, dim, glow],
  );
  const mats = useMemo(() => [capMat, sideMat], [capMat, sideMat]);
  return (
    <group>
      <mesh geometry={plate} material={mats} raycast={noRaycast} renderOrder={1} />
      <mesh geometry={line} material={lineMat} raycast={noRaycast} renderOrder={2} />
    </group>
  );
}
