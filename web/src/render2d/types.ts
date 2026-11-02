import type { View } from "@/engine/types";

/** A pointer/keyboard target on the board. `normal` is only set by 3D renderers. */
export interface HoverTarget {
  cell: number;
  normal?: [number, number, number];
}

export interface SelectTarget {
  cell: number;
  button: number;
  shift: boolean;
}

export interface BoardMarks {
  /** Cells where a new shard could link (corner candidates). */
  attach?: number[];
  /** Cells that can be targeted (e.g. by a Shatter). */
  targets?: number[];
  /** Cells of the most recent placement. */
  lastPlaced?: number[];
  /** Cells revealed by a misfire. */
  misfire?: number[];
}

/** Shared props for every board renderer (2D Paper, 3D Night), so they are swappable. */
export interface BoardSceneProps {
  view: View;
  ghost: { cells: number[]; seat: number; valid: boolean } | null;
  marks?: BoardMarks;
  selectedSeat?: number | null;
  onHover(target: HoverTarget | null): void;
  onSelect(target: SelectTarget): void;
  quality?: "low" | "medium" | "high";
  reducedMotion?: boolean;
  /** Ignored in 2D. */
  layerCut?: number | null;
  /** Ignored in 2D. */
  cameraPreset?: "iso" | "top" | "side";
}
