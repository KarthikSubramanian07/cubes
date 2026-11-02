import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import type { View } from "@/engine/types";
import type { BoardLayout } from "../coords";
import { columnTop, nudge, type HoverTarget, type NudgeKey } from "../hover";
import type { SceneShared } from "./shared";

const KEYS = new Set<string>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);

function typing(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // Range inputs (the slice slider) own their arrow keys too.
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.getAttribute("role") === "application";
}

export interface KeyNudgeProps {
  view: View;
  L: BoardLayout;
  seat: number;
  layerCut: number | null;
  shared: SceneShared;
  onHover(t: HoverTarget | null): void;
}

/** Arrow keys walk the hover cursor across the board, relative to the camera. */
export function KeyNudge({ view, L, seat, layerCut, shared, onHover }: KeyNudgeProps) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const f = camera.getWorldDirection(new Vector3());
      const len = Math.hypot(f.x, f.z) || 1;
      const forward: [number, number] = [f.x / len, f.z / len];
      const right: [number, number] = [-forward[1], forward[0]];
      let from = shared.hover?.cell;
      let t: HoverTarget | null;
      if (from === undefined) {
        // First press: start next to your own Core.
        from = view.seats.find((s) => s.seat === seat)?.core ?? Math.floor(view.cells.length / 2);
        t = { cell: from, normal: [0, 0, 1] };
        if (!L.is2D && view.config.gravity) {
          const [x, y] = [from % L.w, Math.floor(from / L.w) % L.h];
          const z = columnTop(L, view.cells, x, y, layerCut);
          if (z !== null) t = { cell: x + L.w * (y + L.h * z), normal: [0, 0, 1] };
        }
        if (L.is2D) t = { cell: from };
      } else {
        t = nudge(L, view.cells, from, e.key as NudgeKey, { forward, right, gravity: view.config.gravity, layerCut });
      }
      e.preventDefault();
      if (!t) return;
      shared.hover = t;
      onHover(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, view, L, seat, layerCut, shared, onHover]);
  return null;
}
