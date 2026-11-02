/**
 * Real rigid-body physics for the Night board, powered by Rapier (a Rust
 * physics engine compiled to WebAssembly, like the game's own engine).
 *
 * The board itself is static: one collider per floor column and one per
 * placed tile or cube, kept in sync with the View. Effects spawn dynamic
 * debris that falls, bounces, tumbles off the island and fades out:
 * shattered cubes, storm-broken rings, landing chips, misfire phantoms and
 * the winner's confetti. Rapier loads lazily, so the board never waits for it.
 */
import type * as RapierNS from "@dimforge/rapier3d-compat";
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import { OWNER, type View } from "@/engine/types";
import { CELL, CUBE, TILE_H, TILE_W, cellToWorld, coordsOf, type BoardLayout } from "./coords";

type Rapier = typeof RapierNS;

let loading: Promise<Rapier> | null = null;

/** Load and initialise Rapier once. Resolves to null if it can't load. */
export function loadRapier(): Promise<Rapier | null> {
  loading ??= import("@dimforge/rapier3d-compat").then(async (m) => {
    await m.init();
    return m;
  });
  return loading.catch(() => null);
}

type V3 = [number, number, number];

interface Debris {
  body: RapierNS.RigidBody;
  born: number;
  life: number;
  size: V3;
  color: Color;
  /** Bodies that fall off the island fade early. */
  dead: boolean;
}

export interface BurstOptions {
  count: number;
  speed: number;
  up: number;
  size: [min: number, max: number];
  life: number;
  spin?: number;
  /** Multiplier applied to the colour, above 1 for a bloom glow. */
  glow?: number;
}

const FIXED = 1 / 60;
const VOID_Y = -24;

/** Deterministic-enough jitter without allocating. */
function rand(a = 0, b = 1): number {
  return a + Math.random() * (b - a);
}

export class PhysicsWorld {
  readonly capacity: number;
  private readonly world: RapierNS.World;
  private readonly floor = new Map<number, RapierNS.Collider>();
  private readonly solids = new Map<number, RapierNS.Collider>();
  private readonly debris: Debris[] = [];
  private acc = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();

  constructor(
    private readonly R: Rapier,
    private readonly L: BoardLayout,
    capacity = 420,
  ) {
    this.capacity = capacity;
    this.world = new R.World({ x: 0, y: -26, z: 0 });
  }

  get count(): number {
    return this.debris.length;
  }

  /** Make the static colliders match the board: floor per column, a solid per tile/cube. */
  sync(view: View): void {
    const L = this.L;
    const R = this.R;
    const want = new Set<number>();
    const floorWant = new Set<number>();
    const p: V3 = [0, 0, 0];
    for (let i = 0; i < view.cells.length; i++) {
      const o = view.cells[i]!;
      const [, , z] = coordsOf(L, i);
      if (z === 0 && o !== OWNER.VOID && o !== OWNER.ASH) floorWant.add(i);
      if ((o >= 1 && o <= 4) || o === OWNER.SCAR) want.add(i);
    }
    for (const [i, col] of this.floor) if (!floorWant.has(i)) (this.world.removeCollider(col, false), this.floor.delete(i));
    for (const i of floorWant) {
      if (this.floor.has(i)) continue;
      cellToWorld(L, i, p);
      const desc = R.ColliderDesc.cuboid(CELL / 2, 0.3, CELL / 2).setTranslation(p[0], -0.3, p[2]).setFriction(0.8);
      this.floor.set(i, this.world.createCollider(desc));
    }
    for (const [i, col] of this.solids) if (!want.has(i)) (this.world.removeCollider(col, false), this.solids.delete(i));
    for (const i of want) {
      if (this.solids.has(i)) continue;
      cellToWorld(L, i, p);
      const desc = L.is2D
        ? R.ColliderDesc.cuboid(TILE_W / 2, TILE_H / 2, TILE_W / 2).setTranslation(p[0], TILE_H / 2, p[2])
        : R.ColliderDesc.cuboid(CUBE / 2, CUBE / 2, CUBE / 2).setTranslation(p[0], p[1], p[2]);
      this.solids.set(i, this.world.createCollider(desc.setFriction(0.7).setRestitution(0.2)));
    }
  }

  private spawn(at: V3, size: V3, color: Color, life: number, vel: V3, spin: V3, now: number, restitution = 0.35): void {
    if (this.debris.length >= this.capacity) this.retire(0);
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(at[0], at[1], at[2])
        .setLinvel(vel[0], vel[1], vel[2])
        .setAngvel({ x: spin[0], y: spin[1], z: spin[2] })
        .setLinearDamping(0.05)
        .setAngularDamping(0.25)
        .setCcdEnabled(size[1] < 0.2),
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setRestitution(restitution).setFriction(0.6).setDensity(1.2),
      body,
    );
    this.debris.push({ body, born: now, life, size, color: color.clone(), dead: false });
  }

  /** A spray of small chips from a point (shatter fragments, landing chips). */
  burst(at: V3, color: Color, now: number, o: BurstOptions): void {
    const glow = o.glow ?? 1;
    for (let k = 0; k < o.count; k++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.35, 1) * o.speed;
      const s = rand(o.size[0], o.size[1]);
      const spin = o.spin ?? 10;
      this.spawn(
        [at[0] + rand(-0.15, 0.15), at[1] + rand(0, 0.2), at[2] + rand(-0.15, 0.15)],
        [s, s * rand(0.5, 1), s * rand(0.6, 1)],
        this.c.copy(color).multiplyScalar(glow),
        o.life * rand(0.75, 1.15),
        [Math.cos(a) * r, o.up * rand(0.6, 1.2), Math.sin(a) * r],
        [rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)],
        now,
      );
    }
  }

  /** A whole tile or cube breaking loose (storm, misfire phantom). */
  block(at: V3, color: Color, now: number, kick: V3, life = 3.4, scale = 1): void {
    const size: V3 = this.L.is2D ? [TILE_W * scale, TILE_H * scale, TILE_W * scale] : [CUBE * scale, CUBE * scale, CUBE * scale];
    this.spawn(at, size, color, life, kick, [rand(-3, 3), rand(-2, 2), rand(-3, 3)], now, 0.25);
  }

  /** Confetti cubes raining over the board for the winner. */
  confetti(colors: Color[], now: number, count = 90): void {
    const span = Math.max(this.L.w, this.L.h) * CELL * 0.5;
    for (let k = 0; k < count; k++) {
      const s = rand(0.16, 0.3);
      this.spawn(
        [rand(-span, span), rand(7, 16), rand(-span, span)],
        [s, s, s],
        this.c.copy(colors[k % colors.length]!).multiplyScalar(1.6),
        rand(4.5, 6.5),
        [rand(-1, 1), rand(-2, 0), rand(-1, 1)],
        [rand(-8, 8), rand(-8, 8), rand(-8, 8)],
        now + k * 0.012,
        0.45,
      );
    }
  }

  private retire(k: number): void {
    const d = this.debris[k]!;
    this.world.removeRigidBody(d.body);
    this.debris.splice(k, 1);
  }

  /** Advance the simulation and write the debris into an instanced mesh. */
  step(dt: number, now: number, mesh: InstancedMesh): void {
    this.acc = Math.min(this.acc + dt, FIXED * 4);
    while (this.acc >= FIXED) {
      this.world.step();
      this.acc -= FIXED;
    }
    let n = 0;
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k]!;
      const t = d.body.translation();
      if (now - d.born > d.life || t.y < VOID_Y) this.retire(k);
    }
    for (const d of this.debris) {
      const t = d.body.translation();
      const r = d.body.rotation();
      const age = now - d.born;
      // Shrink away over the last half second, and as it drops into the void.
      const tail = Math.min(1, Math.max(0, (d.life - age) / 0.5));
      const sink = t.y < -2 ? Math.max(0, 1 + (t.y + 2) / 10) : 1;
      const k = Math.max(0.001, tail * sink);
      this.p.set(t.x, t.y, t.z);
      this.q.set(r.x, r.y, r.z, r.w);
      this.s.set(d.size[0] * k, d.size[1] * k, d.size[2] * k);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(n, this.m);
      mesh.setColorAt(n, d.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.world.free();
    this.debris.length = 0;
    this.floor.clear();
    this.solids.clear();
  }
}
