import { HeroBoard } from "./HeroBoard";

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SLOT: <HeroScene/>                                                        │
 * │ Today this renders HeroBoard, a cheap SVG sim (no three.js, ~0 KB extra). │
 * │ A lazy three.js scene (web/src/render3d) can replace it later: keep the   │
 * │ square aspect box, render HeroBoard as the Suspense fallback, and gate it │
 * │ behind prefers-reduced-motion and a WebGL check.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function HeroScene() {
  return (
    <div className="hero-scene" data-slot="hero-scene">
      <HeroBoard />
    </div>
  );
}
