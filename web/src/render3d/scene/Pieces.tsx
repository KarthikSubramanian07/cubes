import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { CylinderGeometry, InstancedBufferAttribute, Matrix4, type BufferGeometry, type InstancedMesh } from "three";
import { FLAG, OWNER, type View } from "@/engine/types";
import { TILE_W, cellToWorld, coordsOf, type BoardLayout } from "../coords";
import type { DiffResult } from "../diff";
import { coreSpec, glassGeometry, pieceSpec } from "../geometry";
import { beamMaterial, glassMaterial } from "../materials";
import { NIGHT, linear, seatColor, seatGlow } from "../palette";
import type { BoardMarks } from "../types";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};

function withInstanceAttrs<G extends BufferGeometry>(g: G, cap: number): G {
  g.setAttribute("aData", new InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  g.setAttribute("aColor", new InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute("aGlow", new InstancedBufferAttribute(new Float32Array(cap), 1));
  return g;
}

function hash01(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

interface Birth {
  t: number;
  fade: boolean;
}

export interface PiecesProps {
  view: View;
  L: BoardLayout;
  diff: DiffResult;
  layerCut: number | null;
  marks: BoardMarks | undefined;
  reducedMotion: boolean;
  beams: boolean;
}

/** Every owned cube, scar and core monolith on the board: two instanced draws plus up to four beams. */
export function Pieces({ view, L, diff, layerCut, marks, reducedMotion, beams }: PiecesProps) {
  const clock = useThree((s) => s.clock);
  const cap = L.w * L.h * L.d;
  const pSpec = useMemo(() => pieceSpec(L.is2D), [L.is2D]);
  const cSpec = useMemo(() => coreSpec(L.is2D), [L.is2D]);
  const pGeo = useDisposable(() => withInstanceAttrs(glassGeometry(pSpec), cap), [pSpec, cap]);
  const cGeo = useDisposable(() => withInstanceAttrs(glassGeometry(cSpec), 8), [cSpec]);
  const pMat = useDisposable(
    () => glassMaterial(pSpec.half, pSpec.core, { drop: L.is2D ? 2.4 : 3.0, core: L.is2D ? 1.5 : 1.7, rim: 1.05 }),
    [pSpec, L.is2D],
  );
  const cMat = useDisposable(
    () => glassMaterial(cSpec.half, cSpec.core, { drop: L.is2D ? 2.4 : 3.0, core: 2.4, rim: 1.5 }),
    [cSpec, L.is2D],
  );
  const pMesh = useRef<InstancedMesh>(null);
  const cMesh = useRef<InstancedMesh>(null);
  const births = useRef(new Map<number, Birth>());

  // Record birth times for whatever just changed. Runs once per diff.
  useLayoutEffect(() => {
    const b = births.current;
    if (diff.reset) {
      b.clear();
      return;
    }
    const now = clock.elapsedTime;
    for (const e of diff.events) {
      if (e.kind === "place") e.cells.forEach((c, k) => b.set(c, { t: now + k * 0.045, fade: false }));
      else if (e.kind === "reveal") e.cells.forEach((c) => b.set(c, { t: now + Math.random() * 0.2, fade: true }));
      else if (e.kind === "shatter") b.set(e.cell, { t: now + 0.35, fade: true });
    }
    for (const [c, v] of b) if (now - v.t > 6) b.delete(c);
  }, [diff, clock]);

  const cores = useMemo(() => {
    const out: { cell: number; seat: number; stale: boolean }[] = [];
    for (let i = 0; i < view.cells.length; i++) {
      const o = view.cells[i]!;
      if (o >= 1 && o <= 4 && (view.flags[i]! & FLAG.CORE) !== 0) {
        if (layerCut !== null && coordsOf(L, i)[2] > layerCut) continue;
        out.push({ cell: i, seat: o - 1, stale: (view.flags[i]! & FLAG.STALE) !== 0 });
      }
    }
    return out;
  }, [view, L, layerCut]);

  useLayoutEffect(() => {
    const pm = pMesh.current;
    const cm = cMesh.current;
    if (!pm || !cm) return;
    const last = new Set(marks?.lastPlaced ?? []);
    const targets = new Set(marks?.targets ?? []);
    const b = births.current;
    const m = new Matrix4();
    const p: [number, number, number] = [0, 0, 0];
    const scar = linear(NIGHT.scar);
    let pk = 0;
    let ck = 0;
    const write = (mesh: InstancedMesh, geo: BufferGeometry, k: number, i: number, kind: number, seat: number, centreY: number) => {
      cellToWorld(L, i, p);
      if (L.is2D) p[1] = centreY;
      if (L.is2D && kind === 0) {
        // Stretch a tile to meet each side neighbour of the same piece, so a
        // piece reads as one block of glass. A seat's own pieces never share
        // a side, so a same-seat side neighbour is always the same piece.
        const x = i % L.w;
        const same = (j: number) => {
          const o = view.cells[j];
          return o === seat + 1 && (view.flags[j]! & FLAG.CORE) === 0;
        };
        const half = TILE_W / 2;
        const l = x > 0 && same(i - 1) ? 0.5 : half;
        const r = x < L.w - 1 && same(i + 1) ? 0.5 : half;
        const t = i >= L.w && same(i - L.w) ? 0.5 : half;
        const b = i + L.w < L.w * L.h && same(i + L.w) ? 0.5 : half;
        m.makeScale((l + r) / TILE_W, 1, (t + b) / TILE_W);
        m.setPosition(p[0] + (r - l) / 2, p[1], p[2] + (b - t) / 2);
      } else m.makeTranslation(p[0], p[1], p[2]);
      mesh.setMatrixAt(k, m);
      const f = view.flags[i]!;
      const birth = b.get(i);
      const bits = (f & FLAG.STALE ? 1 : 0) | (last.has(i) ? 2 : 0) | (targets.has(i) ? 4 : 0) | (birth?.fade ? 8 : 0);
      const data = geo.getAttribute("aData") as InstancedBufferAttribute;
      const color = geo.getAttribute("aColor") as InstancedBufferAttribute;
      const glow = geo.getAttribute("aGlow") as InstancedBufferAttribute;
      data.setXYZW(k, reducedMotion || !birth ? -1000 : birth.t, kind, bits, hash01(i));
      const c = kind === 1 ? scar : seatColor(seat);
      color.setXYZ(k, c.r, c.g, c.b);
      glow.setX(k, kind === 1 ? 1 : seatGlow(seat));
    };
    for (let i = 0; i < view.cells.length; i++) {
      const o = view.cells[i]!;
      const isSeat = o >= 1 && o <= 4;
      if (!isSeat && o !== OWNER.SCAR) continue;
      if (layerCut !== null && coordsOf(L, i)[2] > layerCut) continue;
      if (isSeat && view.flags[i]! & FLAG.CORE) {
        if (ck < 8) write(cm, cGeo, ck++, i, 2, o - 1, cSpec.centreY);
      } else {
        write(pm, pGeo, pk++, i, isSeat ? 0 : 1, o - 1, pSpec.centreY);
      }
    }
    for (const [mesh, geo, k] of [
      [pm, pGeo, pk],
      [cm, cGeo, ck],
    ] as const) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      for (const n of ["aData", "aColor", "aGlow"]) geo.getAttribute(n).needsUpdate = true;
    }
  }, [view, diff, marks, layerCut, L, reducedMotion, pGeo, cGeo, pSpec, cSpec]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const mat of [pMat, cMat]) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uMotion!.value = reducedMotion ? 0 : 1;
    }
  });

  return (
    <group>
      <instancedMesh ref={pMesh} args={[pGeo, pMat, cap]} frustumCulled={false} raycast={noRaycast} />
      <instancedMesh ref={cMesh} args={[cGeo, cMat, 8]} frustumCulled={false} raycast={noRaycast} />
      {beams &&
        cores.map((c) => (
          <Beam key={c.cell} L={L} cell={c.cell} seat={c.seat} stale={c.stale} top={L.is2D ? cSpec.size[1] : 0.45} />
        ))}
    </group>
  );
}

const BEAM_H = 30;

function Beam({ L, cell, seat, stale, top }: { L: BoardLayout; cell: number; seat: number; stale: boolean; top: number }) {
  const geo = useDisposable(() => {
    const g = new CylinderGeometry(L.is2D ? 0.16 : 0.12, L.is2D ? 0.2 : 0.14, BEAM_H, 20, 1, true);
    g.translate(0, BEAM_H / 2, 0);
    return g;
  }, [L.is2D]);
  const strength = (L.is2D ? 1.1 : 0.55) * (stale ? 0.4 : 1) * seatGlow(seat);
  const mat = useDisposable(() => beamMaterial(seatColor(seat), strength, BEAM_H), [seat, strength]);
  const pos = useMemo(() => {
    const p = cellToWorld(L, cell);
    return [p[0], L.is2D ? top : p[1] + top, p[2]] as [number, number, number];
  }, [L, cell, top]);
  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime;
  });
  return <mesh geometry={geo} material={mat} position={pos} frustumCulled={false} raycast={noRaycast} renderOrder={5} />;
}
