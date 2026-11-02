import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { InstancedBufferAttribute, ShaderMaterial, type InstancedMesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { View } from "@/engine/types";
import type { BoardLayout } from "../coords";
import { PhysicsWorld, loadRapier } from "../physics";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

/** Debris shading: a fixed key light for shape, a rim that catches the bloom. */
function debrisMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vColor;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vColor;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vec3 n = normalize(vN);
        float key = max(dot(n, normalize(vec3(0.35, 1.0, 0.25))), 0.0);
        float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.4);
        // A glowing core in the middle of each face, like the glass on the board.
        vec3 a = abs(vLocal);
        float across = a.x > a.y && a.x > a.z ? max(a.y, a.z) : a.y > a.z ? max(a.x, a.z) : max(a.x, a.y);
        float core = 1.0 - smoothstep(0.1, 0.36, across);
        vec3 c = vColor * (0.2 + 0.55 * key) + vColor * rim * 1.0 + vColor * core * 0.95;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

export interface PhysicsProps {
  view: View;
  L: BoardLayout;
  enabled: boolean;
  /** Filled in once Rapier has loaded; effects use it to spawn debris. */
  worldRef: React.RefObject<PhysicsWorld | null>;
}

/**
 * Real rigid-body debris on the board. Rapier loads in idle time after the
 * board is up; until then (or with reduced motion) the GPU effects alone play.
 */
export function Physics({ view, L, enabled, worldRef }: PhysicsProps) {
  const [world, setWorld] = useState<PhysicsWorld | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let made: PhysicsWorld | null = null;
    const start = () =>
      void loadRapier().then((R) => {
        if (!alive || !R) return;
        made = new PhysicsWorld(R, L);
        made.sync(viewRef.current);
        setWorld(made);
      });
    const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = idle ? idle(start, { timeout: 2500 }) : window.setTimeout(start, 700);
    return () => {
      alive = false;
      if (!idle) window.clearTimeout(handle);
      made?.dispose();
      setWorld(null);
    };
  }, [enabled, L]);

  useEffect(() => {
    worldRef.current = world;
    return () => {
      worldRef.current = null;
    };
  }, [world, worldRef]);

  useEffect(() => {
    world?.sync(view);
  }, [world, view]);

  const cap = world?.capacity ?? 1;
  const geo = useDisposable(() => new RoundedBoxGeometry(1, 1, 1, 2, 0.14), []);
  const mat = useDisposable(debrisMaterial, []);
  const mesh = useRef<InstancedMesh>(null);

  // Per-instance colour from the start, so the shader compiles with it.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.count = 0;
  }, [world, cap]);

  useFrame((s, dt) => {
    const m = mesh.current;
    if (!world || !m) return;
    world.step(dt, s.clock.elapsedTime, m);
  });

  if (!world) return null;
  return <instancedMesh ref={mesh} args={[geo, mat, cap]} frustumCulled={false} raycast={noRaycast} />;
}
