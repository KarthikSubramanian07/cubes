import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Points,
  TetrahedronGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import type { Vec3 } from "@/engine/types";
import type { QualitySettings } from "./quality";
import {
  cellFxMaterial,
  flareMaterial,
  moteMaterial,
  ringMaterial,
  shardMaterial,
  sparkMaterial,
  type TimedMaterial,
} from "./materials";
import { NIGHT, linear } from "./palette";

type V3 = [number, number, number];

/** A ring buffer of GPU-animated instances: spawning writes one slot, the shader does the rest. */
class InstancePool {
  readonly geometry: InstancedBufferGeometry;
  readonly mesh: Mesh;
  private readonly attrs: Record<string, InstancedBufferAttribute> = {};
  private cursor = 0;

  constructor(
    base: BufferGeometry,
    material: TimedMaterial,
    readonly capacity: number,
    layout: Record<string, number>,
  ) {
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    for (const [name, size] of Object.entries(layout)) {
      const data = new Float32Array(capacity * size);
      if (name === "aParams") for (let i = 0; i < capacity; i++) data[i * size] = -1e5; // long dead
      const a = new InstancedBufferAttribute(data, size);
      g.setAttribute(name, a);
      this.attrs[name] = a;
    }
    g.instanceCount = capacity;
    this.geometry = g;
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }

  spawn(values: Record<string, ArrayLike<number>>): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    for (const [name, v] of Object.entries(values)) {
      const a = this.attrs[name];
      if (!a) continue;
      const arr = a.array as Float32Array;
      for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = v[k] ?? 0;
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

class SparkPool {
  readonly points: Points;
  private readonly geo = new BufferGeometry();
  private readonly origin: Float32Array;
  private readonly vel: Float32Array;
  private readonly params: Float32Array;
  private readonly color: Float32Array;
  private cursor = 0;

  constructor(
    readonly capacity: number,
    material: TimedMaterial,
  ) {
    this.origin = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.params[i * 3] = -1e5;
    this.geo.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geo.setAttribute("aOrigin", new BufferAttribute(this.origin, 3));
    this.geo.setAttribute("aVel", new BufferAttribute(this.vel, 3));
    this.geo.setAttribute("aParams", new BufferAttribute(this.params, 3));
    this.geo.setAttribute("aColor", new BufferAttribute(this.color, 3));
    this.points = new Points(this.geo, material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
  }

  spawn(o: V3, v: V3, birth: number, life: number, size: number, c: Color): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.origin.set(o, i * 3);
    this.vel.set(v, i * 3);
    this.params[i * 3] = birth;
    this.params[i * 3 + 1] = life;
    this.params[i * 3 + 2] = size;
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
  }

  flush(): void {
    for (const n of ["aOrigin", "aVel", "aParams", "aColor"]) this.geo.getAttribute(n).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

interface Mote {
  start: Vector3;
  ctrl: Vector3;
  t0: number;
  dur: number;
  color: Color;
  size: number;
}

class MotePool {
  readonly points: Points;
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly state: Float32Array;
  private readonly col: Float32Array;
  private readonly motes: (Mote | null)[];
  private cursor = 0;
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    readonly capacity: number,
    material: TimedMaterial,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.state = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 3);
    this.motes = new Array(capacity).fill(null);
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aState", new BufferAttribute(this.state, 4));
    this.geo.setAttribute("aColor", new BufferAttribute(this.col, 3));
    this.points = new Points(this.geo, material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 10;
  }

  spawn(m: Mote): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.motes[i] = m;
    this.col[i * 3] = m.color.r;
    this.col[i * 3 + 1] = m.color.g;
    this.col[i * 3 + 2] = m.color.b;
    this.geo.getAttribute("aColor").needsUpdate = true;
  }

  get active(): boolean {
    return this.motes.some((m) => m !== null);
  }

  update(time: number, camera: Camera, ndc: [number, number]): void {
    if (!this.active) return;
    this.target.set(ndc[0], ndc[1], 0.35).unproject(camera);
    for (let i = 0; i < this.capacity; i++) {
      const m = this.motes[i];
      if (!m) continue;
      const k = (time - m.t0) / m.dur;
      if (k >= 1) {
        this.motes[i] = null;
        this.state[i * 4] = 0;
        continue;
      }
      if (k < 0) {
        this.state[i * 4] = 0;
        continue;
      }
      const e = k * k * (3 - 2 * k);
      // quadratic bezier start -> ctrl -> HUD target
      const a = (1 - e) * (1 - e);
      const b = 2 * (1 - e) * e;
      const c = e * e;
      this.tmp.set(
        m.start.x * a + m.ctrl.x * b + this.target.x * c,
        m.start.y * a + m.ctrl.y * b + this.target.y * c,
        m.start.z * a + m.ctrl.z * b + this.target.z * c,
      );
      this.pos[i * 3] = this.tmp.x;
      this.pos[i * 3 + 1] = this.tmp.y;
      this.pos[i * 3 + 2] = this.tmp.z;
      this.state[i * 4] = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.85) / 0.15));
      this.state[i * 4 + 1] = m.size * (1 - 0.6 * e);
    }
    this.geo.getAttribute("position").needsUpdate = true;
    this.geo.getAttribute("aState").needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

export interface FloorFlare {
  x: number;
  z: number;
  t0: number;
  strength: number;
  color: Color;
}

export interface FxConfig {
  quality: QualitySettings;
  is2D: boolean;
  /** Geometry of a placed piece (tile or cube), used for storm debris of owned cells. */
  pieceGeometry: BufferGeometry;
  /** Half extents of the piece, for cell overlays. */
  pieceHalf: V3;
  slabDepth: number;
  pixelRatio: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function randUnit(out: V3 = [0, 0, 0]): V3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out[0] = s * Math.cos(t);
  out[1] = u;
  out[2] = s * Math.sin(t);
  return out;
}

const WHITE = new Color(1, 1, 1);
const tmpColor = new Color();

/**
 * Owns every transient effect. Spawning is cheap (writes a few floats); the
 * shaders integrate motion from birth times, so idle frames cost nothing on
 * the CPU. Only node motes are animated on the CPU (they chase the camera).
 */
export class FxEngine {
  readonly objects: Object3D[] = [];
  readonly materials: TimedMaterial[] = [];
  readonly floorFlares: FloorFlare[] = [];
  shakeT0 = -100;
  shakeAmp = 0;
  reduced = false;
  /** NDC point the node motes fly to (the HUD charge counter). */
  moteTarget: [number, number] = [-0.86, 0.82];

  private readonly sparks: SparkPool;
  private readonly rings: InstancePool;
  private readonly flares: InstancePool;
  private readonly shards: InstancePool;
  private readonly slabs: InstancePool;
  private readonly glass: InstancePool;
  private readonly cells: InstancePool;
  private readonly motes: MotePool;
  private readonly ownedGeometry: BufferGeometry[] = [];
  private flareCursor = 0;
  private readonly cfg: FxConfig;

  constructor(cfg: FxConfig) {
    this.cfg = cfg;
    const q = cfg.quality;
    const floor = cfg.is2D ? 0.02 : 0.02;

    const sparkMat = sparkMaterial(cfg.pixelRatio, floor);
    this.sparks = new SparkPool(q.sparks, sparkMat);

    const quad = new PlaneGeometry(1, 1);
    this.ownedGeometry.push(quad);
    const ringMat = ringMaterial();
    this.rings = new InstancePool(quad, ringMat, 24, { aCenter: 3, aParams: 3, aColor: 3 });
    const flareMat = flareMaterial();
    this.flares = new InstancePool(quad, flareMat, 24, { aPos: 3, aParams: 3, aColor: 3 });
    this.flares.mesh.renderOrder = 9;

    const shardMat = shardMaterial(0);
    const tetra = new TetrahedronGeometry(0.2, 0);
    const slab = new BoxGeometry(0.98, cfg.slabDepth, 0.98);
    this.ownedGeometry.push(tetra, slab);
    const rigid = { aOrigin: 3, aVel: 3, aSpin: 4, aParams: 4, aColor: 3 };
    this.shards = new InstancePool(tetra, shardMat, q.shards, rigid);
    this.slabs = new InstancePool(slab, shardMat, 160, rigid);
    this.glass = new InstancePool(cfg.pieceGeometry, shardMat, 160, rigid);

    const box = new BoxGeometry(cfg.pieceHalf[0] * 2 + 0.06, cfg.pieceHalf[1] * 2 + 0.06, cfg.pieceHalf[2] * 2 + 0.06);
    this.ownedGeometry.push(box);
    const cellMat = cellFxMaterial([cfg.pieceHalf[0] + 0.03, cfg.pieceHalf[1] + 0.03, cfg.pieceHalf[2] + 0.03]);
    this.cells = new InstancePool(box, cellMat, 128, { aPos: 3, aParams: 3, aColor: 3 });

    const moteMat = moteMaterial(cfg.pixelRatio);
    this.motes = new MotePool(128, moteMat);

    this.materials.push(sparkMat, ringMat, flareMat, shardMat, cellMat, moteMat);
    this.objects.push(
      this.sparks.points,
      this.rings.mesh,
      this.flares.mesh,
      this.shards.mesh,
      this.slabs.mesh,
      this.glass.mesh,
      this.cells.mesh,
      this.motes.points,
    );
  }

  setPixelRatio(px: number): void {
    for (const m of this.materials) if (m.uniforms.uPixel) m.uniforms.uPixel.value = px;
  }

  private floorFlare(x: number, z: number, t0: number, strength: number, color: Color): void {
    const slot = this.flareCursor;
    this.flareCursor = (this.flareCursor + 1) % 4;
    this.floorFlares[slot] = { x, z, t0, strength, color: color.clone() };
  }

  private burst(at: V3, color: Color, t0: number, count: number, speed: number, up = 1): void {
    if (this.reduced) return;
    const dir: V3 = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      randUnit(dir);
      dir[1] = Math.abs(dir[1]) * up + 0.25;
      const s = rand(0.4, 1) * speed;
      tmpColor.copy(color).lerp(WHITE, Math.random() * 0.55);
      this.sparks.spawn(
        [at[0] + rand(-0.3, 0.3), at[1], at[2] + rand(-0.3, 0.3)],
        [dir[0] * s, dir[1] * s * 1.2, dir[2] * s],
        t0 + Math.random() * 0.05,
        rand(0.45, 1.05),
        rand(1.4, 3.4),
        tmpColor,
      );
    }
    this.sparks.flush();
  }

  private flare(at: V3, color: Color, t0: number, size: number, life = 0.5): void {
    this.flares.spawn({ aPos: at, aParams: [t0, size, life], aColor: [color.r, color.g, color.b] });
  }

  private ring(at: V3, color: Color, t0: number, radius: number, life = 0.75): void {
    if (this.reduced) return;
    this.rings.spawn({ aCenter: at, aParams: [t0, radius, life], aColor: [color.r, color.g, color.b] });
  }

  /** Cubes landing: shockwave, sparks and a flare once the drop completes. */
  place(cells: Vec3[], color: Color, t0: number, glow: number, floorY: number): void {
    if (!cells.length) return;
    const land = t0 + (this.reduced ? 0 : 0.24);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let minY = Infinity;
    for (const c of cells) {
      cx += c[0];
      cy += c[1];
      cz += c[2];
      minY = Math.min(minY, c[1]);
    }
    cx /= cells.length;
    cy /= cells.length;
    cz /= cells.length;
    const lit = tmpColor.copy(color).multiplyScalar(glow).clone();
    const groundY = this.cfg.is2D ? floorY : Math.max(floorY, minY - 0.45);
    this.ring([cx, groundY + 0.015, cz], lit, land, 1.4 + cells.length * 0.35);
    this.flare([cx, cy + 0.4, cz], lit, land, 2.0 + cells.length * 0.25);
    this.floorFlare(cx, cz, land, 1.0, lit);
    const per = Math.max(4, Math.round(this.cfg.quality.sparks / 110));
    cells.forEach((c, k) => this.burst([c[0], c[1] + 0.1, c[2]], lit, land + k * 0.04, per, 3.2));
  }

  /** A cube fractures into tumbling shards and leaves a scar. */
  shatter(at: Vec3, color: Color, t0: number): void {
    const lit = color.clone().multiplyScalar(1.2);
    this.flare([at[0], at[1] + 0.2, at[2]], lit, t0, 3.2, 0.55);
    this.floorFlare(at[0], at[2], t0, 1.3, lit);
    this.cell(at, linear(NIGHT.ember), t0, 0.5, 2);
    this.shake(t0, 0.09);
    if (this.reduced) return;
    const n = Math.max(10, Math.round(this.cfg.quality.shards / 12));
    const dir: V3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      randUnit(dir);
      const o: V3 = [at[0] + dir[0] * 0.25, at[1] + dir[1] * 0.25, at[2] + dir[2] * 0.25];
      const s = rand(1.5, 3.6);
      const axis = randUnit();
      this.shards.spawn({
        aOrigin: o,
        aVel: [dir[0] * s, Math.abs(dir[1]) * s + 2.2, dir[2] * s],
        aSpin: [axis[0], axis[1], axis[2], rand(5, 15)],
        aParams: [t0, rand(0.55, 1.3), 0, 0],
        aColor: [lit.r, lit.g, lit.b],
      });
    }
    this.burst([at[0], at[1], at[2]], lit, t0, 24, 4.5);
    this.ring([at[0], this.cfg.is2D ? 0.015 : Math.max(0.015, at[1] - 0.45), at[2]], linear(NIGHT.ember), t0, 2.2, 0.6);
  }

  /**
   * The storm takes a ring: cells crack and glow, rumble, then fall away.
   * `owners` holds the linear colour of whatever stood on the cell, or null.
   */
  storm(cells: { at: Vec3; floor: boolean; owner: Color | null }[], t0: number, centre: [number, number]): void {
    this.shake(t0 + 0.5, 0.06);
    const heat = linear(NIGHT.ember);
    const depth = this.cfg.slabDepth;
    for (const c of cells) {
      const ang = Math.atan2(c.at[2] - centre[1], c.at[0] - centre[0]);
      const hold = 0.45 + ((ang + Math.PI) / (Math.PI * 2)) * 0.5 + Math.random() * 0.08;
      if (c.floor) this.cell([c.at[0], this.cfg.is2D ? this.cfg.pieceHalf[1] : c.at[1], c.at[2]], heat, t0, hold + 0.15, 1);
      if (this.reduced) continue;
      const out: V3 = [c.at[0] - centre[0], 0, c.at[2] - centre[1]];
      const len = Math.hypot(out[0], out[2]) || 1;
      out[0] /= len;
      out[2] /= len;
      const axis = randUnit();
      if (c.floor) {
        this.slabs.spawn({
          aOrigin: [c.at[0], -depth / 2, c.at[2]],
          aVel: [out[0] * rand(0.2, 0.7), rand(-0.3, 0.2), out[2] * rand(0.2, 0.7)],
          aSpin: [axis[0], axis[1], axis[2], rand(0.6, 2.2)],
          aParams: [t0, 1, 1, hold],
          aColor: [heat.r, heat.g, heat.b],
        });
      }
      if (c.owner) {
        const o = c.owner;
        this.glass.spawn({
          aOrigin: [c.at[0], c.at[1], c.at[2]],
          aVel: [out[0] * rand(0.3, 0.9), rand(0.0, 0.6), out[2] * rand(0.3, 0.9)],
          aSpin: [axis[2], axis[0], axis[1], rand(0.8, 2.6)],
          aParams: [t0, 1, 2, hold],
          aColor: [o.r, o.g, o.b],
        });
      }
    }
  }

  misfire(cells: Vec3[], t0: number): void {
    const danger = linear(NIGHT.danger);
    for (const c of cells) {
      this.cell(c, danger, t0, 0.95, 0);
      this.burst(c, danger, t0, 6, 1.6);
    }
    this.shake(t0, 0.05);
  }

  reveal(cells: Vec3[], t0: number): void {
    const wash = new Color(0.6, 0.62, 0.7);
    for (const c of cells.slice(0, 64)) this.cell(c, wash, t0 + Math.random() * 0.2, 0.6, 2);
  }

  remove(cells: Vec3[], colors: Color[], t0: number): void {
    cells.forEach((c, i) => this.burst(c, colors[i] ?? WHITE, t0, 5, 1.2));
  }

  /** A node is collected: a burst of pearl motes streams to the HUD charge counter. */
  node(at: Vec3, seatColor: Color, t0: number): void {
    const pearl = linear(NIGHT.node);
    this.flare([at[0], at[1] + 0.3, at[2]], pearl, t0 + 0.2, 2.6, 0.6);
    this.ring([at[0], this.cfg.is2D ? 0.02 : at[1] - 0.4, at[2]], pearl, t0 + 0.2, 1.2, 0.6);
    if (this.reduced) return;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const d = randUnit();
      const c = i % 3 === 0 ? seatColor.clone().lerp(WHITE, 0.3) : pearl.clone();
      this.motes.spawn({
        start: new Vector3(at[0] + d[0] * 0.2, at[1] + 0.2 + Math.abs(d[1]) * 0.2, at[2] + d[2] * 0.2),
        ctrl: new Vector3(at[0] + d[0] * 2.2, at[1] + 2.5 + Math.random() * 2, at[2] + d[2] * 2.2),
        t0: t0 + 0.2 + i * 0.025,
        dur: rand(0.85, 1.25),
        color: c,
        size: rand(2.2, 4.2),
      });
    }
  }

  private cell(at: Vec3, color: Color, t0: number, life: number, mode: number): void {
    this.cells.spawn({ aPos: at, aParams: [t0, life, mode], aColor: [color.r, color.g, color.b] });
  }

  shake(t0: number, amp: number): void {
    if (this.reduced) return;
    this.shakeT0 = t0;
    this.shakeAmp = amp;
  }

  update(time: number, camera: Camera): void {
    for (const m of this.materials) m.uniforms.uTime.value = time;
    this.motes.update(time, camera, this.moteTarget);
  }

  dispose(): void {
    this.sparks.dispose();
    this.motes.dispose();
    for (const p of [this.rings, this.flares, this.shards, this.slabs, this.glass, this.cells]) p.dispose();
    for (const g of this.ownedGeometry) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
