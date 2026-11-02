import type { View } from "@/engine/types";
import type { QualityTier } from "./quality";

export interface BoardGhost {
  cells: number[];
  seat: number;
  valid: boolean;
}

export interface BoardMarks {
  /** Empty cells where the selected seat may link (corner touch). */
  attach?: number[];
  /** Cells that can be targeted right now (e.g. Shatter targets). */
  targets?: number[];
  /** Cells placed by the most recent move. */
  lastPlaced?: number[];
  /** Cells revealed by a misfire. */
  misfire?: number[];
}

export interface HoverInfo {
  cell: number;
  /** 3D: board-space step (z up) from the face under the pointer to `cell`. */
  normal?: [number, number, number];
}

export interface SelectInfo {
  cell: number;
  button: number;
  shift: boolean;
}

export type CameraPreset = "iso" | "top" | "side";

export interface BoardSceneProps {
  view: View;
  ghost: BoardGhost | null;
  marks?: BoardMarks;
  /** Whose turn / perspective; tints attach marks and the grid. Defaults to view.seat. */
  selectedSeat?: number | null;
  onHover(target: HoverInfo | null): void;
  onSelect(target: SelectInfo): void;
  /** Render tier. Omit to auto-detect (and auto-downgrade if frames drop). */
  quality?: QualityTier;
  reducedMotion?: boolean;
  /** 3D: hide cells with z > layerCut (slice view). */
  layerCut?: number | null;
  cameraPreset?: CameraPreset;
  /** NDC point node motes fly to (the HUD charge counter). Defaults to the top-left corner. */
  moteTarget?: [number, number];
  /** Optional class for the wrapping element. */
  className?: string;
}
