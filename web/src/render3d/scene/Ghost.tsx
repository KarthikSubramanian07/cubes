import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, Matrix4, Vector3, type Color, type Group, type InstancedMesh } from "three";
import { OWNER, type View } from "@/engine/types";
import { cellToWorld, coordsOf, indexOf, TILE_H, type BoardLayout } from "../coords";
import { ghostMaterial } from "../materials";
import { NIGHT, linear, seatColor } from "../palette";
import type { BoardGhost } from "../types";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};
const CAP = 32;

/**
 * Holographic preview of the shard under the pointer. Valid: seat colour,
 * scanlines. Invalid: red-orange flicker, jitter and a short "no" shake.
 * In 3D, plumb lines and footprints show where each cube would rest.
 */
export function Ghost({ ghost, view, L, reducedMotion }: { ghost: BoardGhost | null; view: View; L: BoardLayout; reducedMotion: boolean }) {
  const half: [number, number, number] = L.is2D ? [0.48, TILE_H / 2 + 0.04, 0.48] : [0.5, 0.5, 0.5];
  const geo = useDisposable(() => new BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2), [L.is2D]);
  const mat = useDisposable(() => ghostMaterial(half), [L.is2D]);
  const plumbGeo = useDisposable(() => new BoxGeometry(1, 1, 1), []);
  const plumbMat = useDisposable(() => ghostMaterial([0.5, 0.5, 0.5]), []);
  const mesh = useRef<InstancedMesh>(null);
  const plumb = useRef<InstancedMesh>(null);
  const shakeT0 = useRef(-10);
  const key = ghost ? `${ghost.cells.join(",")}|${ghost.valid}` : "";
  const prevKey = useRef("");

  const cells = useMemo(() => (ghost ? ghost.cells.slice(0, CAP) : []), [ghost]);

  // The ghost glides between targets on a critically damped spring instead of
  // snapping: when it moves, keep it where it was and let the offset relax.
  const glide = useRef<Group>(null);
  const offset = useRef(new Vector3());
  const vel = useRef(new Vector3());
  const lastCentre = useRef<Vector3 | null>(null);

  useLayoutEffect(() => {
    const m = mesh.current;
    const pl = plumb.current;
    if (!m || !pl) return;
    const mx = new Matrix4();
    const p: [number, number, number] = [0, 0, 0];
    cells.forEach((c, k) => {
      cellToWorld(L, c, p);
      if (L.is2D) p[1] = TILE_H / 2;
      m.setMatrixAt(k, mx.makeTranslation(p[0], p[1], p[2]));
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;

    if (cells.length) {
      const centre = new Vector3();
      for (const c of cells) {
        cellToWorld(L, c, p);
        centre.x += p[0] / cells.length;
        centre.y += p[1] / cells.length;
        centre.z += p[2] / cells.length;
      }
      const last = lastCentre.current;
      if (last && !reducedMotion && last.distanceTo(centre) < 8) offset.current.add(last.sub(centre));
      lastCentre.current = centre;
    } else {
      lastCentre.current = null;
      offset.current.set(0, 0, 0);
      vel.current.set(0, 0, 0);
    }

    // 3D: drop a plumb line + footprint from each cube to whatever would hold it.
    let k = 0;
    if (!L.is2D) {
      const set = new Set(cells);
      for (const c of cells) {
        const [x, y, z] = coordsOf(L, c);
        if (z > 0 && set.has(indexOf(L, x, y, z - 1))) continue;
        let rest = 0;
        for (let zz = z - 1; zz >= 0; zz--) {
          const o = view.cells[indexOf(L, x, y, zz)]!;
          if (o !== OWNER.EMPTY && o !== OWNER.ASH && o !== OWNER.VOID) {
            rest = zz + 1;
            break;
          }
        }
        cellToWorld(L, c, p);
        const gap = z - rest;
        if (gap > 0 && k < CAP * 2) {
          pl.setMatrixAt(k++, mx.makeScale(0.04, gap, 0.04).setPosition(p[0], rest + gap / 2, p[2]));
        }
        if (k < CAP * 2) pl.setMatrixAt(k++, mx.makeScale(0.92, 0.015, 0.92).setPosition(p[0], rest + 0.01, p[2]));
      }
    }
    pl.count = k;
    pl.instanceMatrix.needsUpdate = true;

    if (key !== prevKey.current) {
      if (ghost && !ghost.valid) shakeT0.current = performance.now() / 1000;
      prevKey.current = key;
    }
  }, [cells, L, view, key, ghost, reducedMotion]);

  useFrame((s, delta) => {
    const t = s.clock.elapsedTime;
    const g = glide.current;
    if (g) {
      const dt = Math.min(delta, 1 / 30);
      const x = offset.current;
      const v = vel.current;
      // k = 420, critically damped: c = 2 * sqrt(k).
      v.addScaledVector(x, -420 * dt).multiplyScalar(Math.max(0, 1 - 41 * dt));
      x.addScaledVector(v, dt);
      if (x.lengthSq() < 1e-6 && v.lengthSq() < 1e-6) x.set(0, 0, 0);
      const bob = L.is2D || reducedMotion ? 0 : Math.sin(t * 3.1) * 0.035;
      g.position.set(x.x, x.y + bob, x.z);
    }
    const color = ghost ? (ghost.valid ? seatColor(ghost.seat) : linear(NIGHT.danger)) : linear(NIGHT.danger);
    for (const material of [mat, plumbMat]) {
      const u = material.uniforms;
      u.uTime.value = t;
      (u.uColor!.value as Color).copy(color).multiplyScalar(material === plumbMat ? 0.5 : 1);
      u.uValid!.value = ghost?.valid ? 1 : 0;
      if (ghost && !ghost.valid && !reducedMotion) {
        const age = performance.now() / 1000 - shakeT0.current;
        const shake = Math.sin(age * 55) * 0.09 * Math.exp(-age * 9);
        (u.uJitter!.value as Vector3).set(shake + (Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02);
      } else {
        (u.uJitter!.value as Vector3).set(0, 0, 0);
      }
    }
  });

  return (
    <group visible={!!ghost}>
      <group ref={glide}>
        <instancedMesh ref={mesh} args={[geo, mat, CAP]} frustumCulled={false} raycast={noRaycast} renderOrder={30} />
      </group>
      <instancedMesh ref={plumb} args={[plumbGeo, plumbMat, CAP * 2]} frustumCulled={false} raycast={noRaycast} renderOrder={29} />
    </group>
  );
}
