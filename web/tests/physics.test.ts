// @vitest-environment node
import { Color, InstancedMesh, BoxGeometry, MeshBasicMaterial, Vector3, Matrix4, Quaternion } from "three";
import { OWNER, type View } from "@/engine/types";
import { layoutOf } from "@/render3d/coords";
import { PhysicsWorld, loadRapier } from "@/render3d/physics";

const dims: [number, number, number] = [6, 6, 4];
const L = layoutOf(dims);

function view(cells: number[]): View {
  return { config: { dims } as View["config"], cells, flags: cells.map(() => 0) } as unknown as View;
}

function positions(mesh: InstancedMesh): Vector3[] {
  const out: Vector3[] = [];
  const m = new Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const p = new Vector3();
    m.decompose(p, new Quaternion(), new Vector3());
    out.push(p);
  }
  return out;
}

function run(world: PhysicsWorld, mesh: InstancedMesh, seconds: number, from = 0): number {
  let t = from;
  for (let i = 0; i < seconds * 60; i++) world.step(1 / 60, (t += 1 / 60), mesh);
  return t;
}

describe("board physics", () => {
  it("debris lands on the floor and rests there", async () => {
    const R = await loadRapier();
    expect(R).not.toBeNull();
    const world = new PhysicsWorld(R!, L, 64);
    world.sync(view(new Array(6 * 6 * 4).fill(OWNER.EMPTY)));
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 64);
    world.burst([0, 3, 0], new Color(1, 0.5, 0.2), 0, { count: 6, speed: 0.5, up: 0, size: [0.2, 0.25], life: 10 });
    run(world, mesh, 3);
    const ps = positions(mesh);
    expect(ps).toHaveLength(6);
    // Resting on the floor (top at y = 0), not fallen through it.
    for (const p of ps) expect(p.y).toBeGreaterThan(0);
    for (const p of ps) expect(p.y).toBeLessThan(0.5);
    world.dispose();
  });

  it("debris falls into the void where the storm took the floor, and is retired", async () => {
    const R = (await loadRapier())!;
    const world = new PhysicsWorld(R, L, 64);
    const cells = new Array(6 * 6 * 4).fill(OWNER.ASH);
    world.sync(view(cells));
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 64);
    world.block([0, 1, 0], new Color(0.3, 0.3, 0.3), 0, [0, 0, 0], 20);
    expect(world.count).toBe(1);
    run(world, mesh, 4);
    expect(world.count).toBe(0);
    world.dispose();
  });

  it("stacks on placed cubes in 3D", async () => {
    const R = (await loadRapier())!;
    const world = new PhysicsWorld(R, L, 64);
    const cells = new Array(6 * 6 * 4).fill(OWNER.EMPTY);
    // A two-cube tower in column (2, 2).
    cells[2 + 6 * 2] = 1;
    cells[2 + 6 * 2 + 36] = 1;
    world.sync(view(cells));
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 64);
    const [x, z] = [(2 - L.ox) * 1, (2 - L.oz) * 1];
    world.burst([x, 4, z], new Color(1, 1, 1), 0, { count: 1, speed: 0, up: 0, size: [0.2, 0.2], life: 10, spin: 0 });
    run(world, mesh, 3);
    const [p] = positions(mesh);
    // On top of the tower (two cubes high), not on the floor beside it.
    expect(p!.y).toBeGreaterThan(1.8);
    world.dispose();
  });

  it("never exceeds its capacity: the oldest debris makes way", async () => {
    const R = (await loadRapier())!;
    const world = new PhysicsWorld(R, L, 10);
    world.sync(view(new Array(6 * 6 * 4).fill(OWNER.EMPTY)));
    world.confetti([new Color(1, 0, 0)], 0, 25);
    expect(world.count).toBe(10);
    world.dispose();
  });
});
