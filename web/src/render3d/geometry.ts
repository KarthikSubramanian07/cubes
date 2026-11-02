import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CUBE, TILE_H, TILE_W } from "./coords";

type V3 = [number, number, number];

export interface GlassSpec {
  size: V3;
  half: V3;
  core: V3;
  radius: number;
  /** World Y of the piece centre relative to its cell origin (2D: on the slab). */
  centreY: number;
}

function spec(size: V3, core: V3, radius: number, centreY: number): GlassSpec {
  return { size, half: [size[0] / 2, size[1] / 2, size[2] / 2], core, radius, centreY };
}

export function pieceSpec(is2D: boolean): GlassSpec {
  return is2D ? spec([TILE_W, TILE_H, TILE_W], [0.21, 0.08, 0.21], 0.075, TILE_H / 2) : spec([CUBE, CUBE, CUBE], [0.19, 0.19, 0.19], 0.085, 0);
}

/** The Core monolith: a tall pillar in 2D, an amplified cube in 3D. */
export function coreSpec(is2D: boolean): GlassSpec {
  return is2D ? spec([0.7, 1.25, 0.7], [0.13, 0.48, 0.13], 0.08, 1.25 / 2) : spec([CUBE, CUBE, CUBE], [0.26, 0.26, 0.26], 0.085, 0);
}

export function glassGeometry(s: GlassSpec): RoundedBoxGeometry {
  return new RoundedBoxGeometry(s.size[0], s.size[1], s.size[2], 3, s.radius);
}

/** Depth of the island slab under the board. */
export function slabDepth(is2D: boolean): number {
  return is2D ? 0.7 : 0.9;
}
