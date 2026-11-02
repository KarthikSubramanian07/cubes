import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/engine/types";
import { boardCorners, fitDistance, poseDirection, presetPose } from "./camera";
import { boardCenter, layoutOf } from "./coords";

/** Project a point (relative to target) for a camera at distance d and check it lies in the frustum. */
function inFrustum(p: Vec3, dir: Vec3, d: number, vfov: number, aspect: number): boolean {
  const f: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const up0: Vec3 = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const r = normalize(cross(f, up0));
  const u = cross(r, f);
  const depth = d - dot(p, dir);
  const t = Math.tan((vfov * Math.PI) / 360);
  return depth > 0 && Math.abs(dot(p, r)) <= t * aspect * depth + 1e-6 && Math.abs(dot(p, u)) <= t * depth + 1e-6;
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe("camera framing", () => {
  for (const dims of [
    [20, 20, 1],
    [8, 8, 8],
    [7, 7, 7],
  ] as Vec3[]) {
    for (const preset of ["iso", "top", "side"] as const) {
      for (const aspect of [1440 / 900, 390 / 844]) {
        it(`fits ${dims.join("x")} ${preset} at aspect ${aspect.toFixed(2)}`, () => {
          const L = layoutOf(dims);
          const pts = boardCorners(L, boardCenter(L));
          const pose = presetPose(L.is2D, preset, aspect);
          const d = fitDistance(pts, pose, 36, aspect, 0.9);
          const dir = poseDirection(pose);
          for (const p of pts) expect(inFrustum(p, dir, d, 36, aspect)).toBe(true);
          // and it is tight: 15% closer and something falls out
          expect(pts.every((p) => inFrustum(p, dir, d * 0.85, 36, aspect))).toBe(false);
        });
      }
    }
  }

  it("needs more distance in portrait than landscape", () => {
    const L = layoutOf([20, 20, 1]);
    const pts = boardCorners(L, boardCenter(L));
    const pose = presetPose(true, "iso");
    expect(fitDistance(pts, pose, 36, 0.46)).toBeGreaterThan(fitDistance(pts, pose, 36, 1.6));
  });

  it("poses point the camera above the board", () => {
    for (const is2D of [true, false]) for (const p of ["iso", "top", "side"] as const) expect(poseDirection(presetPose(is2D, p))[1]).toBeGreaterThan(0);
  });
});
