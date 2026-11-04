import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { BoxGeometry, Matrix4, MeshBasicMaterial, PlaneGeometry, type InstancedMesh } from "three";
import { OWNER, type View } from "@/engine/types";
import { cellToWorld, coordsOf, TILE_H, type BoardLayout } from "../coords";
import { resolveHover, sameTarget, type HoverTarget, type PickHit } from "../hover";
import type { SceneShared } from "./shared";
import { useDisposable } from "./useDisposable";

export interface PickerProps {
  view: View;
  L: BoardLayout;
  layerCut: number | null;
  shared: SceneShared;
  onHover(t: HoverTarget | null): void;
  onSelect(t: { cell: number; button: number; shift: boolean }): void;
}

const TAP_SLOP = 8; // px, touch
const CLICK_SLOP = 12; // px, mouse and pen
const TAP_MS = 600; // touch
const CLICK_MS = 1500; // mouse and pen

/**
 * Invisible pick geometry plus pointer handling. A press only counts as a
 * select when it barely moved, so orbiting the camera never places pieces.
 */
export function Picker({ view, L, layerCut, shared, onHover, onSelect }: PickerProps) {
  const hidden = useDisposable(() => new MeshBasicMaterial({ visible: false }), []);
  const planeGeo = useDisposable(() => new PlaneGeometry(L.w, L.h).rotateX(-Math.PI / 2), [L.w, L.h]);
  const boxGeo = useDisposable(() => new BoxGeometry(1, 1, 1), []);
  const boxes = useRef<InstancedMesh>(null);
  const boxCells = useRef<number[]>([]);
  const down = useRef<{ x: number; y: number; t: number; button: number; touch: boolean } | null>(null);
  const pendingOut = useRef(false);
  const cap = L.is2D ? 1 : L.w * L.h * L.d;

  // 3D: slice view in free-floating games picks on the cut layer, otherwise the floor.
  const planeLevel = !L.is2D && layerCut !== null && !view.config.gravity ? layerCut : 0;
  const planeY = L.is2D ? TILE_H * 0.6 : planeLevel;

  useLayoutEffect(() => {
    const m = boxes.current;
    if (!m || L.is2D) return;
    const mx = new Matrix4();
    const p: [number, number, number] = [0, 0, 0];
    const list: number[] = [];
    for (let i = 0; i < view.cells.length; i++) {
      const o = view.cells[i]!;
      if (o === OWNER.EMPTY || o === OWNER.VOID || o === OWNER.ASH) continue;
      if (layerCut !== null && coordsOf(L, i)[2] > layerCut) continue;
      cellToWorld(L, i, p);
      m.setMatrixAt(list.length, mx.makeTranslation(p[0], p[1], p[2]));
      list.push(i);
    }
    boxCells.current = list;
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [view, L, layerCut]);

  // The board changed under a still pointer (a bot moved, a piece landed): re-aim.
  const events = useThree((s) => s.events);
  useEffect(() => {
    if (shared.pointer.active) events.update?.();
  }, [view, layerCut, events, shared]);

  const handlers = useMemo(() => {
    const hitOf = (e: ThreeEvent<PointerEvent>): PickHit | null => {
      if (e.object === boxes.current && e.instanceId !== undefined) {
        const cell = boxCells.current[e.instanceId];
        const n = e.face?.normal;
        if (cell === undefined || !n) return null;
        return { kind: "cell", cell, normal: [n.x, n.y, n.z] };
      }
      return { kind: "plane", point: [e.point.x, e.point.y, e.point.z], level: planeLevel };
    };
    const targetOf = (e: ThreeEvent<PointerEvent>) => resolveHover(L, view.cells, hitOf(e), { layerCut });
    const hover = (t: HoverTarget | null) => {
      if (!sameTarget(t, shared.hover)) {
        shared.hover = t;
        onHover(t);
      }
    };
    return {
      onPointerMove(e: ThreeEvent<PointerEvent>) {
        e.stopPropagation();
        pendingOut.current = false;
        shared.pointer.x = e.point.x;
        shared.pointer.y = e.point.y;
        shared.pointer.z = e.point.z;
        shared.pointer.active = true;
        if (e.pointerType === "touch" && e.buttons) return; // dragging the camera
        hover(targetOf(e));
      },
      onPointerOut() {
        pendingOut.current = true;
        queueMicrotask(() => {
          if (!pendingOut.current) return;
          shared.pointer.active = false;
          hover(null);
        });
      },
      onPointerDown(e: ThreeEvent<PointerEvent>) {
        e.stopPropagation();
        down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, t: performance.now(), button: e.nativeEvent.button, touch: e.pointerType === "touch" };
      },
      onPointerUp(e: ThreeEvent<PointerEvent>) {
        e.stopPropagation();
        const d = down.current;
        down.current = null;
        if (!d || shared.gesture.multi) return;
        const moved = Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y);
        if (moved > (d.touch ? TAP_SLOP : CLICK_SLOP) || performance.now() - d.t > (d.touch ? TAP_MS : CLICK_MS)) return;
        const t = targetOf(e);
        if (!t) return;
        hover(t);
        onSelect({ cell: t.cell, button: d.button, shift: e.nativeEvent.shiftKey });
      },
    };
  }, [L, view.cells, layerCut, planeLevel, shared, onHover, onSelect]);

  return (
    <group {...handlers}>
      <mesh geometry={planeGeo} material={hidden} position={[0, planeY, 0]} />
      {!L.is2D && <instancedMesh ref={boxes} args={[boxGeo, hidden, cap]} />}
    </group>
  );
}
