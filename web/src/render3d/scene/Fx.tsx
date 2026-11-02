import { useFrame } from "@react-three/fiber";
import type { FxEngine } from "../fxEngine";

/** Mounts the FX engine's pooled objects and ticks it. */
export function Fx({ engine }: { engine: FxEngine }) {
  useFrame((s) => engine.update(s.clock.elapsedTime, s.camera));
  return (
    <group>
      {engine.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
