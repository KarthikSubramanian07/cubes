import { useThree } from "@react-three/fiber";
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry } from "three";
import { OWNER, type View } from "@/engine/types";
import { cellToWorld, type BoardLayout } from "../coords";
import { latticeMaterial } from "../materials";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** 3D readability: a faint bounding cage, a slice frame, and lattice points for free-floating games. */
export function Cage({ view, L, layerCut, points }: { view: View; L: BoardLayout; layerCut: number | null; points: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const top = layerCut === null ? L.d : layerCut + 1;
  const edges = useDisposable(() => {
    const g = new EdgesGeometry(new BoxGeometry(L.w + 0.06, L.d, L.h + 0.06));
    g.translate(0, L.d / 2, 0);
    return g;
  }, [L.w, L.h, L.d]);
  const slice = useDisposable(() => new EdgesGeometry(new BoxGeometry(L.w + 0.2, 0.0001, L.h + 0.2)), [L.w, L.h]);
  const edgeMat = useDisposable(() => latticeMaterial(new Color(0.05, 0.042, 0.032), false, dpr), [dpr]);
  const sliceMat = useDisposable(() => latticeMaterial(new Color(0.35, 0.26, 0.16), false, dpr), [dpr]);
  const pointMat = useDisposable(() => latticeMaterial(new Color(0.11, 0.09, 0.07), true, dpr), [dpr]);

  const pointGeo = useDisposable(() => {
    const g = new BufferGeometry();
    const out: number[] = [];
    const p: [number, number, number] = [0, 0, 0];
    if (points) {
      for (let i = 0; i < view.cells.length; i++) {
        if (view.cells[i] !== OWNER.EMPTY) continue;
        const z = Math.floor(i / (L.w * L.h));
        if (layerCut !== null && z > layerCut) continue;
        cellToWorld(L, i, p);
        out.push(p[0], p[1], p[2]);
      }
    }
    g.setAttribute("position", new BufferAttribute(new Float32Array(out), 3));
    return g;
  }, [view, L, layerCut, points]);

  return (
    <group>
      <lineSegments geometry={edges} material={edgeMat} raycast={noRaycast} />
      {layerCut !== null && <lineSegments geometry={slice} material={sliceMat} position={[0, top, 0]} raycast={noRaycast} />}
      {points && <points geometry={pointGeo} material={pointMat} raycast={noRaycast} />}
    </group>
  );
}
