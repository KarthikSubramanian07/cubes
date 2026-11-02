import type { ReactNode } from "react";
import "./game.css";

export interface GameShellProps {
  /** Room code, seats, scores, charge and turn indicator. */
  topBar: ReactNode;
  /** The board renderer mounts here (render2d / render3d). Fills the remaining space. */
  canvas: ReactNode;
  /** Your remaining shards. Right column on wide screens, bottom sheet on phones. */
  tray: ReactNode;
  /** Charge meter and surge buttons. */
  surges?: ReactNode;
  /** Hand-written HUD annotations, positioned over everything, pointer-events off. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * The in-game layout skeleton. Always in the night register. Purely structural:
 * it knows nothing about the engine, only where things go.
 *
 *  ┌──────────────── top bar ────────────────┐
 *  │                                │        │
 *  │            canvas              │  tray  │
 *  │                                │        │
 *  │ [surges]                       │        │
 *  └────────────────────────────────┴────────┘
 */
export function GameShell({ topBar, canvas, tray, surges, overlay, className }: GameShellProps) {
  return (
    <div className={["gs theme-night", className].filter(Boolean).join(" ")}>
      <header className="gs__top">{topBar}</header>
      <main className="gs__stage" id="main">
        <div className="gs__canvas" data-slot="canvas">
          {canvas}
        </div>
        {surges && (
          <div className="gs__surges" data-slot="surges">
            {surges}
          </div>
        )}
      </main>
      <aside className="gs__tray" data-slot="tray" aria-label="Your shards">
        {tray}
      </aside>
      {overlay && (
        <div className="gs__overlay" data-slot="overlay" aria-hidden="true">
          {overlay}
        </div>
      )}
    </div>
  );
}
