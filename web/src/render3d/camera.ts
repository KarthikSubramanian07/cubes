import type { Vec3 } from "@/engine/types";
import type { BoardLayout } from "./coords";
import type { CameraPreset } from "./types";

export interface Pose {
  polar: number;
  azimuth: number;
}

export function presetPose(is2D: boolean, preset: CameraPreset, aspect = 16 / 9): Pose {
  const portrait = aspect < 0.8;
  if (is2D) {
    if (preset === "top") return { polar: 0.0001, azimuth: 0 };
    if (preset === "side") return { polar: 1.12, azimuth: 0 };
    return { polar: portrait ? 0.6 : 0.78, azimuth: 0 };
  }
  if (preset === "top") return { polar: 0.0001, azimuth: 0 };
  if (preset === "side") return { polar: 1.42, azimuth: 0 };
  return { polar: portrait ? 0.9 : 0.98, azimuth: Math.PI / 4 };
}

/** Unit vector from the target towards the camera for a spherical pose (three.js Y-up convention). */
export function poseDirection(p: Pose): Vec3 {
  const s = Math.sin(p.polar);
  return [s * Math.sin(p.azimuth), Math.cos(p.polar), s * Math.cos(p.azimuth)];
}

/** Corners of the board's bounding box relative to the orbit target. */
export function boardCorners(L: BoardLayout, target: Vec3): Vec3[] {
  const y0 = L.is2D ? -0.2 : 0;
  const y1 = L.is2D ? 1.0 : L.d;
  const out: Vec3[] = [];
  for (const x of [-L.w / 2, L.w / 2])
    for (const y of [y0, y1]) for (const z of [-L.h / 2, L.h / 2]) out.push([x - target[0], y - target[1], z - target[2]]);
  return out;
}

/**
 * Smallest camera distance (from the target, along the pose direction) at
 * which every point fits inside a perspective frustum with the given margin
 * (0.9 leaves 10% breathing room on each side).
 */
export function fitDistance(points: Vec3[], pose: Pose, vfovDeg: number, aspect: number, margin = 0.9): number {
  const dir = poseDirection(pose);
  // Camera basis: forward looks from camera to target (-dir). right = forward × up(world), up = right × forward.
  const f: Vec3 = [-dir[0], -dir[1], -dir[2]];
  let worldUp: Vec3 = [0, 1, 0];
  if (Math.abs(f[1]) > 0.999) worldUp = [0, 0, -1];
  const r = norm(cross(f, worldUp));
  const u = cross(r, f);
  const tv = Math.tan((vfovDeg * Math.PI) / 360) * margin;
  const th = tv * aspect;
  let d = 0;
  for (const p of points) {
    const x = Math.abs(dot(p, r));
    const y = Math.abs(dot(p, u));
    const along = dot(p, dir);
    d = Math.max(d, x / th + along, y / tv + along);
  }
  return d;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
