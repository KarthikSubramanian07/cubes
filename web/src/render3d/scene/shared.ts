import type { FxEngine } from "../fxEngine";

/** Mutable per-scene state shared between components without re-rendering. */
export interface SceneShared {
  pointer: { x: number; y: number; z: number; active: boolean };
  fx: FxEngine | null;
  /** Live pointer count on the canvas; a gesture that ever had two fingers never selects. */
  gesture: { pointers: Set<number>; multi: boolean };
}

export function createShared(): SceneShared {
  return { pointer: { x: 0, y: 0, z: 0, active: false }, fx: null, gesture: { pointers: new Set(), multi: false } };
}
