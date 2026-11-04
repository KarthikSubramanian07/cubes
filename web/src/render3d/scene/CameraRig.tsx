import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Box3, Matrix4, Vector3, type PerspectiveCamera } from "three";
import { boardCorners, fitDistance, poseDirection, presetPose } from "../camera";
import { boardCenter, boardRadius, type BoardLayout } from "../coords";
import type { CameraPreset } from "../types";
import type { SceneShared } from "./shared";

export interface RigApi {
  recenter(): void;
}

const { ACTION } = CameraControlsImpl;

export function CameraRig({
  L,
  preset,
  reducedMotion,
  shared,
  ref,
}: {
  L: BoardLayout;
  preset: CameraPreset;
  reducedMotion: boolean;
  /** While the pointer is over the board the camera holds still, so the board never slides under the cursor. */
  shared?: SceneShared;
  ref?: Ref<RigApi>;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = width / Math.max(1, height);
  const drift = useRef({ applied: 0, lastInteract: performance.now() / 1000 });
  const first = useRef(true);
  const r = boardRadius(L);
  const pose = presetPose(L.is2D, preset, aspect);
  const target = boardCenter(L);
  const fit = fitDistance(boardCorners(L, target), pose, camera.fov, aspect, L.is2D ? 0.92 : 0.86);

  const goTo = useCallback(
    (animate: boolean) => {
      const c = controls.current;
      if (!c) return;
      const [tx, ty, tz] = target;
      const [dx, dy, dz] = poseDirection(pose);
      drift.current.applied = 0;
      void c.setLookAt(tx + dx * fit, ty + dy * fit, tz + dz * fit, tx, ty, tz, animate);
    },
    [pose, target, fit],
  );

  useImperativeHandle(ref, () => ({ recenter: () => goTo(true) }), [goTo]);

  // Re-frame when the preset or board changes, or the viewport flips orientation.
  const portrait = aspect < 1;
  useEffect(() => {
    goTo(!first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, L, portrait]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const pad = 2;
    c.setBoundary(new Box3(new Vector3(-L.w / 2 - pad, -1, -L.h / 2 - pad), new Vector3(L.w / 2 + pad, (L.is2D ? 1 : L.d) + pad, L.h / 2 + pad)));
  }, [L]);

  // When the camera moves under a still pointer (smoothing, a recentre),
  // re-aim the hover so the ghost always sits under the cursor.
  const events = useThree((s) => s.events);
  const lastCam = useRef(new Matrix4());
  useFrame(() => {
    if (!shared?.pointer.active) return;
    if (!lastCam.current.equals(camera.matrixWorld)) {
      lastCam.current.copy(camera.matrixWorld);
      events.update?.();
    }
  });

  useFrame((s) => {
    const c = controls.current;
    if (!c || reducedMotion) return;
    if (shared?.pointer.active) {
      drift.current.lastInteract = performance.now() / 1000;
      return;
    }
    const now = s.clock.elapsedTime;
    const idle = performance.now() / 1000 - drift.current.lastInteract;
    const amp = Math.min(1, Math.max(0, (idle - 4) / 5));
    const off = amp * 0.075 * Math.sin(now * 0.1);
    const delta = off - drift.current.applied;
    if (Math.abs(delta) > 1e-6) {
      void c.rotate(delta, 0, false);
      drift.current.applied = off;
    }
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.3}
      draggingSmoothTime={0.1}
      minDistance={Math.max(3, r * 0.45)}
      maxDistance={Math.max(fit * 2.2, r * 3)}
      minPolarAngle={0}
      maxPolarAngle={L.is2D ? 1.32 : 1.68}
      dollySpeed={0.6}
      truckSpeed={1.2}
      mouseButtons={{ left: ACTION.ROTATE, middle: ACTION.DOLLY, right: ACTION.TRUCK, wheel: ACTION.DOLLY }}
      touches={{ one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_DOLLY_TRUCK, three: ACTION.TOUCH_TRUCK }}
      onControlStart={() => {
        drift.current.applied = 0;
        drift.current.lastInteract = performance.now() / 1000;
      }}
      onControl={() => {
        drift.current.lastInteract = performance.now() / 1000;
      }}
    />
  );
}
