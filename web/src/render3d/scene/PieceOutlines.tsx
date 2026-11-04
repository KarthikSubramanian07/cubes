import { useMemo } from "react";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshBasicMaterial } from "three";
import type { View } from "@/engine/types";
import type { Loop } from "@/render2d/outline";
import { TILE_W, type BoardLayout } from "../coords";
import { insetLoop, pieceGroups, ribbon, type PieceGroup } from "../pieceOutline";
import { seatColor, seatGlow } from "../palette";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** Width of the glowing line traced around each piece's foot. */
const LINE_W = 0.04;
/** The tiles' outer edge sits this far inside the square; the line hugs it. */
const INSET = (1 - TILE_W) / 2 - LINE_W / 2 - 0.004;
const LIFT = 0.004;

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
    b.loops.push(...g.loops.map((l) => insetLoop(l, INSET)));
  }
  return [...map.values()];
}

function ribbonGeometry(L: BoardLayout, loops: Loop[]): BufferGeometry {
  const flat = ribbon(loops, LINE_W);
  const pos = new Float32Array((flat.length / 2) * 3);
  for (let k = 0, j = 0; k < flat.length; k += 2, j += 3) {
    pos[j] = flat[k]! - 0.5 - L.ox;
    pos[j + 1] = LIFT;
    pos[j + 2] = flat[k + 1]! - 0.5 - L.oz;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return g;
}

/** A thin glowing line around the foot of each 2D piece, tracing its whole shape. */
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
  const line = useDisposable(() => ribbonGeometry(L, loops), [L, loops]);
  const k = (stale ? 0.5 : 1.6) * seatGlow(seat);
  const mat = useDisposable(
    () => new MeshBasicMaterial({ color: new Color().copy(seatColor(seat)).multiplyScalar(k), side: DoubleSide, toneMapped: false }),
    [seat, k],
  );
  return <mesh geometry={line} material={mat} raycast={noRaycast} renderOrder={2} />;
}
