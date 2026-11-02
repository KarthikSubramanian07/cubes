export { BoardScene } from "./BoardScene";
export type { BoardGhost, BoardMarks, BoardSceneProps, CameraPreset, HoverInfo, SelectInfo } from "./types";
export { autoQuality, detectQuality, QUALITY, type QualityTier, type QualitySettings } from "./quality";
export { diffViews, type AnimEvent, type DiffResult } from "./diff";
export { resolveHover, type HoverTarget, type PickHit } from "./hover";
export { cellToWorld, layoutOf, worldToCell, type BoardLayout } from "./coords";
export { SEAT_HEX } from "./palette";
