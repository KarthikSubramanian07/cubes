import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import {
  BoxGeometry,
  DataTexture,
  LinearFilter,
  Matrix4,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  UnsignedByteType,
  type Color,
  type InstancedMesh,
  type Vector4,
} from "three";
import { FLAG, OWNER, type View } from "@/engine/types";
import { columnToWorld, indexOf, type BoardLayout } from "../coords";
import { slabDepth } from "../geometry";
import { floorMaterial, skirtMaterial, underglowMaterial } from "../materials";
import { NIGHT, linear, seatColor, seatGlow } from "../palette";
import type { BoardMarks } from "../types";
import type { SceneShared } from "./shared";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

function dataTexture(w: number, h: number, linearFilter: boolean): DataTexture {
  const t = new DataTexture(new Uint8Array(w * h * 4), w, h, RGBAFormat, UnsignedByteType);
  t.magFilter = linearFilter ? LinearFilter : NearestFilter;
  t.minFilter = linearFilter ? LinearFilter : NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export interface IslandProps {
  view: View;
  L: BoardLayout;
  marks: BoardMarks | undefined;
  seat: number;
  taps: number;
  shared: SceneShared;
}

/** The floating slab: glossy holographic floor, crumbling storm edges, dark sides and an underglow. */
export function Island({ view, L, marks, seat, taps, shared }: IslandProps) {
  const depth = slabDepth(L.is2D);
  const mask = useDisposable(() => dataTexture(L.w, L.h, false), [L.w, L.h]);
  const own = useDisposable(() => dataTexture(L.w, L.h, true), [L.w, L.h]);
  const floorGeo = useDisposable(() => new PlaneGeometry(L.w + 2, L.h + 2).rotateX(-Math.PI / 2), [L.w, L.h]);
  const floorMat = useDisposable(() => floorMaterial(mask, own, [L.w, L.h], taps), [mask, own, L.w, L.h, taps]);
  const skirtGeo = useDisposable(() => new BoxGeometry(1, depth, 1), [depth]);
  const skirtMat = useDisposable(() => skirtMaterial(depth, linear(NIGHT.underglow)), [depth]);
  const glowGeo = useDisposable(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const glowMat = useDisposable(() => underglowMaterial(linear(NIGHT.underglow), L.is2D ? 0.3 : 0.38), [L.is2D]);
  const skirt = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = mask.image.data as Uint8Array;
    const o = own.image.data as Uint8Array;
    const attach = new Set(marks?.attach ?? []);
    const s = skirt.current;
    const mat = new Matrix4();
    let k = 0;
    for (let y = 0; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        const c = indexOf(L, x, y, 0);
        const p = (x + y * L.w) * 4;
        const owner = view.cells[c]!;
        const playable = owner !== OWNER.VOID && owner !== OWNER.ASH;
        m[p] = playable ? 255 : 0;
        m[p + 1] = owner === OWNER.ASH ? 255 : 0;
        m[p + 2] = attach.has(c) ? 255 : 0;
        m[p + 3] = owner === OWNER.EMPTY && view.flags[c]! & FLAG.NODE ? 255 : 0;
        if (owner >= 1 && owner <= 4) {
          const col = seatColor(owner - 1);
          const g = seatGlow(owner - 1) * (view.flags[c]! & FLAG.STALE ? 0.25 : 1);
          o[p] = Math.min(255, col.r * 255 * g);
          o[p + 1] = Math.min(255, col.g * 255 * g);
          o[p + 2] = Math.min(255, col.b * 255 * g);
          o[p + 3] = 255;
        } else if (owner === OWNER.SCAR) {
          o[p] = 6;
          o[p + 1] = 2;
          o[p + 2] = 1;
          o[p + 3] = 200;
        } else {
          o[p] = o[p + 1] = o[p + 2] = o[p + 3] = 0;
        }
        if (playable && s) {
          const [wx, wz] = columnToWorld(L, x, y);
          mat.makeTranslation(wx, -depth / 2 - 0.035, wz);
          s.setMatrixAt(k++, mat);
        }
      }
    mask.needsUpdate = true;
    own.needsUpdate = true;
    if (s) {
      s.count = k;
      s.instanceMatrix.needsUpdate = true;
    }
  }, [view, marks, L, mask, own, depth, skirtGeo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const u = floorMat.uniforms;
    u.uTime.value = t;
    const ptr = shared.pointer;
    (u.uPointer!.value as Vector4).set(ptr.x, ptr.y, ptr.z, ptr.active ? 1 : 0);
    (u.uSeat!.value as Color).copy(seatColor(seat));
    const flares = shared.fx?.floorFlares ?? [];
    const fv = u.uFlares!.value as Vector4[];
    const fc = u.uFlareColors!.value as Color[];
    for (let i = 0; i < 4; i++) {
      const f = flares[i];
      if (f) {
        fv[i]!.set(f.x, f.z, f.t0, f.strength);
        fc[i]!.copy(f.color);
      }
    }
    glowMat.uniforms.uTime.value = t;
  });

  const span = Math.max(L.w, L.h);
  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} raycast={noRaycast} renderOrder={0} />
      <instancedMesh ref={skirt} args={[skirtGeo, skirtMat, L.w * L.h]} frustumCulled={false} raycast={noRaycast} />
      <mesh
        geometry={glowGeo}
        material={glowMat}
        position={[0, -depth - 0.9, 0]}
        scale={[span * 1.9, 1, span * 1.9]}
        raycast={noRaycast}
        renderOrder={-1}
      />
    </group>
  );
}
