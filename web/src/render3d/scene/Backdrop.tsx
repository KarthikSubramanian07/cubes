import { useFrame, useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, SphereGeometry } from "three";
import { dustMaterial, skyMaterial } from "../materials";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** Warm deep space: a breathing dome and slow drifting dust. */
export function Backdrop({ dust, span, reducedMotion }: { dust: number; span: number; reducedMotion: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const skyGeo = useDisposable(() => new SphereGeometry(240, 32, 16), []);
  const sky = useDisposable(() => skyMaterial(), []);
  const box: [number, number, number] = [span * 1.6, span * 0.9, span * 1.6];
  const dustGeo = useDisposable(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(dust * 3);
    const seed = new Float32Array(dust * 4);
    for (let i = 0; i < dust; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * box[0];
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * box[1];
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * box[2];
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new BufferAttribute(seed, 4));
    return g;
  }, [dust, span]);
  const dustMat = useDisposable(() => dustMaterial(dpr, box), [dpr, span]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    sky.uniforms.uTime.value = t;
    dustMat.uniforms.uTime.value = t;
    dustMat.uniforms.uMotion!.value = reducedMotion ? 0 : 1;
  });

  return (
    <group>
      <mesh geometry={skyGeo} material={sky} raycast={noRaycast} renderOrder={-10} />
      <points geometry={dustGeo} material={dustMat} frustumCulled={false} raycast={noRaycast} />
    </group>
  );
}
