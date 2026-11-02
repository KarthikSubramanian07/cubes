import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { InstancedBufferAttribute, Matrix4, OctahedronGeometry, type InstancedMesh } from "three";
import { FLAG, OWNER, type View } from "@/engine/types";
import { cellToWorld, coordsOf, type BoardLayout } from "../coords";
import { gemMaterial } from "../materials";
import { seatColor } from "../palette";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** Node charge crystals and attach-point diamonds, one instanced draw. */
export function Gems({
  view,
  L,
  attach,
  seat,
  layerCut,
  reducedMotion,
}: {
  view: View;
  L: BoardLayout;
  attach: number[] | undefined;
  seat: number;
  layerCut: number | null;
  reducedMotion: boolean;
}) {
  const cap = L.w * L.h * L.d;
  const geo = useDisposable(() => {
    const g = new OctahedronGeometry(1, 0);
    g.setAttribute("aData", new InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    return g;
  }, [cap]);
  const mat = useDisposable(() => gemMaterial(), []);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const data = geo.getAttribute("aData") as InstancedBufferAttribute;
    const mx = new Matrix4();
    const p: [number, number, number] = [0, 0, 0];
    let k = 0;
    const visible = (i: number) => layerCut === null || coordsOf(L, i)[2] <= layerCut;
    for (let i = 0; i < view.cells.length; i++) {
      if (view.cells[i] !== OWNER.EMPTY || !(view.flags[i]! & FLAG.NODE) || !visible(i)) continue;
      cellToWorld(L, i, p);
      if (L.is2D) p[1] = 0.46;
      mx.makeScale(0.17, 0.26, 0.17).setPosition(p[0], p[1], p[2]);
      m.setMatrixAt(k, mx);
      data.setXY(k++, (i * 0.618) % 1, 0);
    }
    for (const i of attach ?? []) {
      if (view.cells[i] !== OWNER.EMPTY || !visible(i)) continue;
      cellToWorld(L, i, p);
      if (L.is2D) p[1] = 0.13;
      const s = L.is2D ? 0.075 : 0.09;
      mx.makeScale(s, s * 1.5, s).setPosition(p[0], p[1], p[2]);
      m.setMatrixAt(k, mx);
      data.setXY(k++, (i * 0.37) % 1, 1);
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    data.needsUpdate = true;
  }, [view, L, attach, layerCut, geo]);

  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime;
    mat.uniforms.uSeat!.value.copy(seatColor(seat));
    mat.uniforms.uMotion!.value = reducedMotion ? 0.15 : 1;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, cap]} frustumCulled={false} raycast={noRaycast} />;
}
