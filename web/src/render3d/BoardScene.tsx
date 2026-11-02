import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Color, type Group } from "three";
import { OWNER, type View } from "@/engine/types";
import { cellToWorld, coordsOf, layoutOf } from "./coords";
import { diffViews } from "./diff";
import { FxEngine } from "./fxEngine";
import { glassGeometry, pieceSpec, slabDepth } from "./geometry";
import { NIGHT, seatColor, seatGlow } from "./palette";
import { autoQuality, downgrade, QUALITY, type QualitySettings, type QualityTier } from "./quality";
import { Backdrop } from "./scene/Backdrop";
import { CameraRig, type RigApi } from "./scene/CameraRig";
import { Cage } from "./scene/Cage";
import { Fog } from "./scene/Fog";
import { Fx } from "./scene/Fx";
import { Gems } from "./scene/Gems";
import { Ghost } from "./scene/Ghost";
import { Island } from "./scene/Island";
import { KeyNudge } from "./scene/KeyNudge";
import { Overlays } from "./scene/Overlays";
import { Physics } from "./scene/Physics";
import type { PhysicsWorld } from "./physics";
import { Picker } from "./scene/Picker";
import { Pieces } from "./scene/Pieces";
import { Post } from "./scene/Post";
import { createShared, type SceneShared } from "./scene/shared";
import { useDisposable } from "./scene/useDisposable";
import type { BoardSceneProps } from "./types";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const DOUBLE_TAP_MS = 320;

/**
 * The Night board. Renders 2D boards (d = 1) as glass tiles on a tilted slab
 * and 3D lattices (gravity stacks and orbit) as glass cubes over a floating
 * island. Animates only what changed between consecutive Views.
 */
export function BoardScene(props: BoardSceneProps): JSX.Element {
  const [autoTier, setAutoTier] = useState<QualityTier>(() => props.quality ?? autoQuality());
  const tier = props.quality ?? autoTier;
  const q = QUALITY[tier];
  const reduced = props.reducedMotion ?? prefersReducedMotion();
  const rig = useRef<RigApi>(null);
  const shared = useMemo(createShared, []);
  const lastMiss = useRef(0);
  const { onHover } = props;

  return (
    <div
      className={props.className}
      data-quality={tier}
      style={{ position: "relative", width: "100%", height: "100%", touchAction: "none", background: NIGHT.background }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        const g = shared.gesture;
        g.pointers.add(e.pointerId);
        if (g.pointers.size > 1) g.multi = true;
      }}
      onPointerUp={(e) => releasePointer(shared, e.pointerId)}
      onPointerCancel={(e) => releasePointer(shared, e.pointerId)}
      onPointerLeave={(e) => {
        releasePointer(shared, e.pointerId);
        shared.pointer.active = false;
        shared.hover = null;
        onHover(null);
      }}
    >
      <Canvas
        dpr={q.dpr}
        flat
        gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
        camera={{ fov: 36, near: 0.6, far: 700, position: [0, 18, 22] }}
        onPointerMissed={(e) => {
          // Double click / double tap on empty space recentres the camera.
          if (e.type === "dblclick") {
            rig.current?.recenter();
            return;
          }
          if (e.type !== "click") return;
          const now = performance.now();
          if (now - lastMiss.current < DOUBLE_TAP_MS) {
            rig.current?.recenter();
            lastMiss.current = 0;
          } else {
            lastMiss.current = now;
          }
        }}
      >
        <SceneRoot {...props} q={q} tier={tier} reduced={reduced} shared={shared} rigRef={rig} onSlow={props.quality ? undefined : () => setAutoTier(downgrade)} />
      </Canvas>
    </div>
  );
}

function releasePointer(shared: SceneShared, id: number): void {
  const g = shared.gesture;
  // Clear `multi` only after the gesture's last finger lifts and the up event has been seen by the picker.
  g.pointers.delete(id);
  if (g.pointers.size === 0) queueMicrotask(() => (g.multi = false));
}

interface SceneRootProps extends BoardSceneProps {
  q: QualitySettings;
  tier: QualityTier;
  reduced: boolean;
  shared: SceneShared;
  rigRef: React.RefObject<RigApi | null>;
  onSlow?: () => void;
}

function SceneRoot(props: SceneRootProps) {
  const { view, ghost, marks, selectedSeat, onHover, onSelect, cameraPreset, moteTarget, q, reduced, shared } = props;
  const [w, h, d] = view.config.dims;
  const L = useMemo(() => layoutOf([w, h, d]), [w, h, d]);
  const layerCut = L.is2D ? null : (props.layerCut ?? null);
  const seat = selectedSeat ?? view.seat ?? 0;
  const gl = useThree((s) => s.gl);
  const clock = useThree((s) => s.clock);

  const prev = useRef<View | null>(null);
  // Real rigid-body debris (Rapier). Off with reduced motion or on the low tier.
  const physics = useRef<PhysicsWorld | null>(null);
  const physicsOn = !reduced && props.tier !== "low";
  const diff = useMemo(() => diffViews(prev.current, view), [view]);

  const pSpec = useMemo(() => pieceSpec(L.is2D), [L.is2D]);
  const pieceGeo = useDisposable(() => glassGeometry(pSpec), [pSpec]);
  const fx = useDisposable(
    () =>
      new FxEngine({
        quality: q,
        is2D: L.is2D,
        pieceGeometry: pieceGeo,
        pieceHalf: pSpec.half,
        slabDepth: slabDepth(L.is2D),
        pixelRatio: gl.getPixelRatio(),
      }),
    [q, L.is2D, pieceGeo, pSpec],
  );
  shared.fx = fx;
  fx.reduced = reduced;
  if (moteTarget) fx.moteTarget = moteTarget;

  // Turn the diff into effects, once per new View.
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (diff.reset || !before) return;
    const now = clock.elapsedTime;
    const at = (c: number) => {
      const p = cellToWorld(L, c);
      if (L.is2D) p[1] = pSpec.centreY;
      return p;
    };
    const top = L.is2D ? 0.42 : 0.5;
    const ph = physics.current;
    // Colliders first, so new debris lands on (or falls through) the new board.
    ph?.sync(view);
    for (const e of diff.events) {
      switch (e.kind) {
        case "place": {
          fx.place(e.cells.map(at), seatColor(e.seat), now, seatGlow(e.seat), 0);
          // Little chips kicked up where the shard lands.
          if (ph) {
            const p = e.cells.map(at).reduce((a, v) => [a[0] + v[0] / e.cells.length, a[1] + v[1] / e.cells.length, a[2] + v[2] / e.cells.length], [0, 0, 0]);
            ph.burst([p[0], p[1] + top, p[2]], seatColor(e.seat), now + 0.18, { count: L.is2D ? 5 : 7, speed: 2.4, up: 3.2, size: [0.06, 0.13], life: 1.5, glow: 2.4, spin: 14 });
          }
          break;
        }
        case "shatter": {
          const c = e.victim >= 0 ? seatColor(e.victim) : seatColor(seat);
          fx.shatter(at(e.cell), c, now);
          // The cube breaks into real fragments that bounce and tumble.
          if (ph) {
            const p = at(e.cell);
            ph.burst([p[0], p[1] + top, p[2]], c, now, { count: 18, speed: 4.4, up: 7, size: [0.16, 0.36], life: 3.6, glow: 1.5, spin: 12 });
          }
          break;
        }
        case "storm":
          fx.storm(
            e.cells.map((c, i) => ({
              at: at(c),
              floor: coordsOf(L, c)[2] === 0,
              owner: (e.seats[i] ?? -1) >= 0 ? seatColor(e.seats[i]!) : before.cells[c] === OWNER.SCAR ? seatColor(seat).clone().multiplyScalar(0.1) : null,
            })),
            now,
            [0, 0],
          );
          // The ring breaks loose and tumbles off the island into the void.
          if (ph) {
            const ash = new Color(0x2c251d);
            e.cells.forEach((c, i) => {
              const [x, , z] = coordsOf(L, c);
              const owner = e.seats[i] ?? -1;
              if (owner < 0 && z !== 0) return;
              const p = at(c);
              const out = Math.hypot(p[0], p[2]) || 1;
              const kick: [number, number, number] = [(p[0] / out) * 1.8, 1.2 + Math.random(), (p[2] / out) * 1.8];
              ph.block(owner >= 0 ? p : [p[0], -0.3, p[2]], owner >= 0 ? seatColor(owner).clone().multiplyScalar(1.1) : ash, now + (x % 3) * 0.06, kick, 3.6, owner >= 0 ? 1 : 0.96);
            });
          }
          break;
        case "misfire":
          fx.misfire(e.cells.map(at), now);
          // A phantom of the shard drops in, hits what was hiding there and bounces off.
          if (ph) {
            const red = new Color(1.6, 0.35, 0.25);
            for (const c of e.cells) {
              const p = at(c);
              ph.block([p[0], p[1] + 2.4, p[2]], red, now, [Math.random() - 0.5, -2, Math.random() - 0.5], 1.6, 0.9);
            }
          }
          break;
        case "reveal":
          fx.reveal(e.cells.map(at), now);
          break;
        case "node":
          fx.node(at(e.cell), seatColor(e.seat), now + 0.24);
          break;
        case "remove":
          fx.remove(e.cells.map(at), e.seats.map((s) => seatColor(s)), now);
          break;
      }
    }
    // The winner's colours rain down and pile up on the board.
    if (ph && before.phase === "playing" && view.phase === "over" && view.winners?.length) {
      ph.confetti(view.winners.map((w) => seatColor(w)), now + 0.3, L.is2D ? 80 : 110);
    }
  }, [diff, view, fx, clock, L, pSpec, seat]);

  useEffect(() => fx.setPixelRatio(gl.getPixelRatio()));

  // Board shake for impacts.
  const root = useRef<Group>(null);
  useFrame((s) => {
    const g = root.current;
    if (!g) return;
    const age = s.clock.elapsedTime - fx.shakeT0;
    if (age >= 0 && age < 0.7) {
      const a = fx.shakeAmp * Math.exp(-age * 7);
      g.position.set(Math.sin(age * 71) * a, Math.sin(age * 53 + 1) * a * 0.5, Math.cos(age * 67) * a);
    } else if (g.position.lengthSq() > 0) {
      g.position.set(0, 0, 0);
    }
  });

  const span = Math.max(w, h, L.is2D ? 1 : d);
  const fogOn = view.config.fog !== null;

  return (
    <>
      <color attach="background" args={[NIGHT.background]} />
      <CameraRig ref={props.rigRef} L={L} preset={cameraPreset ?? "iso"} reducedMotion={reduced} />
      <Backdrop dust={q.dust} span={span} reducedMotion={reduced} />
      <group ref={root}>
        <Island view={view} L={L} marks={marks} seat={seat} taps={q.floorTaps} shared={shared} />
        <Pieces view={view} L={L} diff={diff} layerCut={layerCut} marks={marks} reducedMotion={reduced} beams={q.beams} />
        <Gems view={view} L={L} attach={marks?.attach} seat={seat} layerCut={layerCut} reducedMotion={reduced} />
        {!L.is2D && <Cage view={view} L={L} layerCut={layerCut} points={!view.config.gravity} />}
        <Overlays marks={marks} L={L} />
        {fogOn && <Fog view={view} L={L} layers={q.fogLayers} layerCut={layerCut} />}
        <Ghost ghost={ghost} view={view} L={L} reducedMotion={reduced} />
        <Fx engine={fx} />
        <Physics view={view} L={L} enabled={physicsOn} worldRef={physics} />
        <Picker view={view} L={L} layerCut={layerCut} shared={shared} onHover={onHover} onSelect={onSelect} />
        <KeyNudge view={view} L={L} seat={seat} layerCut={layerCut} shared={shared} onHover={onHover} />
      </group>
      <Post q={q} />
      {props.onSlow && <FrameWatch onSlow={props.onSlow} />}
    </>
  );
}

/** Auto-quality: step down a tier when the frame rate stays low. */
function FrameWatch({ onSlow }: { onSlow: () => void }) {
  const acc = useRef({ t: 0, frames: 0, warm: 0, cooldown: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    if (document.hidden) return;
    a.warm += dt;
    if (a.warm < 3) return;
    a.t += Math.min(dt, 0.25);
    a.frames++;
    if (a.t >= 2.5) {
      const fps = a.frames / a.t;
      a.t = 0;
      a.frames = 0;
      if (fps < 38 && a.warm > a.cooldown) {
        a.cooldown = a.warm + 4;
        onSlow();
      }
    }
  });
  return null;
}
