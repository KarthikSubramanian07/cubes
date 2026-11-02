import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { BoxGeometry, InstancedBufferAttribute, type InstancedMesh } from "three";
import { cellToWorld, type BoardLayout } from "../coords";
import { pieceSpec } from "../geometry";
import { cellFxMaterial } from "../materials";
import { NIGHT, linear } from "../palette";
import type { BoardMarks } from "../types";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};
const CAP = 256;

/** Persistent marks: target brackets over shatterable cells, red glitch over misfire cells. */
export function Overlays({ marks, L }: { marks: BoardMarks | undefined; L: BoardLayout }) {
  const spec = pieceSpec(L.is2D);
  const half: [number, number, number] = [spec.half[0] + 0.06, spec.half[1] + 0.06, spec.half[2] + 0.06];
  const geo = useDisposable(() => {
    const g = new BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2);
    g.setAttribute("aPos", new InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("aParams", new InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("aColor", new InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
    return g;
  }, [L.is2D]);
  const mat = useDisposable(() => cellFxMaterial(half), [L.is2D]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const pos = geo.getAttribute("aPos") as InstancedBufferAttribute;
    const params = geo.getAttribute("aParams") as InstancedBufferAttribute;
    const color = geo.getAttribute("aColor") as InstancedBufferAttribute;
    const p: [number, number, number] = [0, 0, 0];
    let k = 0;
    const add = (cells: number[] | undefined, mode: number, hex: string) => {
      const c = linear(hex);
      for (const i of cells ?? []) {
        if (k >= CAP) return;
        cellToWorld(L, i, p);
        if (L.is2D) p[1] = spec.centreY;
        pos.setXYZ(k, p[0], p[1], p[2]);
        params.setXYZ(k, -100, -1, mode);
        color.setXYZ(k, c.r, c.g, c.b);
        k++;
      }
    };
    add(marks?.targets, 3, NIGHT.danger);
    add(marks?.misfire, 0, NIGHT.danger);
    m.count = k;
    pos.needsUpdate = params.needsUpdate = color.needsUpdate = true;
  }, [marks, L, geo, spec.centreY]);

  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, CAP]} frustumCulled={false} raycast={noRaycast} renderOrder={31} />;
}
