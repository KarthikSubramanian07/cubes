import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getKit, getPreset } from "@/engine/engine";
import type { Vec3 } from "@/engine/types";
import { cellCoords } from "@/engine/types";
import { anchorFor, cellsAt, fitsNear, grabOffset, snapPlacement, transformOrient } from "./placement";

beforeAll(initEngineForTests);

describe("transformOrient", () => {
  it("four rotations return to the start for every 2D shard", () => {
    const kit = getKit("shards");
    kit.pieces.forEach((p, i) => {
      for (let o = 0; o < p.orients.length; o++) {
        let cur = o;
        for (let k = 0; k < 4; k++) cur = transformOrient(kit, i, cur, "rotate");
        expect(cur).toBe(o);
        expect(transformOrient(kit, i, transformOrient(kit, i, o, "flip"), "flip")).toBe(o);
        expect(transformOrient(kit, i, transformOrient(kit, i, o, "rotate"), "rotateBack")).toBe(o);
      }
    });
  });

  it("rotation and flip reach every orientation", () => {
    const kit = getKit("shards");
    kit.pieces.forEach((p, i) => {
      const seen = new Set<number>();
      let frontier = [0];
      while (frontier.length) {
        const next: number[] = [];
        for (const o of frontier) {
          if (seen.has(o)) continue;
          seen.add(o);
          next.push(transformOrient(kit, i, o, "rotate"), transformOrient(kit, i, o, "flip"));
        }
        frontier = next;
      }
      expect(seen.size).toBe(p.orients.length);
    });
  });

  it("3D rotations reach every orientation of every cube shard", () => {
    const kit = getKit("cubes");
    kit.pieces.forEach((p, i) => {
      const seen = new Set<number>();
      let frontier = [0];
      while (frontier.length) {
        const next: number[] = [];
        for (const o of frontier) {
          if (seen.has(o)) continue;
          seen.add(o);
          next.push(
            transformOrient(kit, i, o, "rotate"),
            transformOrient(kit, i, o, "pitch"),
            transformOrient(kit, i, o, "roll"),
          );
        }
        frontier = next;
      }
      expect(seen.size).toBe(p.orients.length);
    });
  });
});

describe("anchoring", () => {
  it("grabs the cell nearest the centroid", () => {
    const plus: Vec3[] = [[1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 2, 0]];
    expect(grabOffset(plus)).toEqual([1, 1, 0]);
  });

  it("puts the grab cell on the target", () => {
    const dims: Vec3 = [10, 10, 1];
    const plus: Vec3[] = [[1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 2, 0]];
    const at = anchorFor(dims, plus, 5 + 10 * 5);
    expect(at).toEqual([4, 4, 0]);
    expect(cellsAt(dims, plus, at)).toContain(55);
    expect(cellsAt(dims, plus, [-1, 0, 0])).toBeNull();
    expect(cellsAt(dims, plus, [-1, 0, 0], true)).not.toBeNull();
  });

  it("snaps to a legal placement covering the hovered cell", () => {
    const g = LocalGame.create(getPreset("duel", 2), 4);
    const legal = g.legal(0);
    const p = legal.find((l) => l.cells.length === 5)!;
    const snapped = snapPlacement(legal, p.piece, p.orient, p.cells[0]!, p.at);
    expect(snapped).toEqual(p);
    expect(snapPlacement(legal, p.piece, p.orient, 9999, null)).toBeNull();
    g.free();
  });
});

describe("3D aiming", () => {
  // Hovering right next to your own Core in Stack targets a cell that shares
  // a face with it, which no legal placement can ever cover.
  it("snaps to a nearby fit when the hovered cell can never be covered", () => {
    const config = getPreset("stack", 2);
    const g = LocalGame.create(config, 7);
    const view = g.view(0);
    const legal = g.legal(0);
    const dims = config.dims;
    const [cx, cy, cz] = cellCoords(dims, view.seats[0]!.core);
    const besideCore = cx + 1 + dims[0] * (cy + dims[1] * cz);
    const piece = legal[0]!.piece;
    const orient = legal.find((p) => p.piece === piece)!.orient;
    expect(legal.some((p) => p.cells.includes(besideCore))).toBe(false);
    expect(snapPlacement(legal, piece, orient, besideCore, null)).toBeNull();
    const snapped = snapPlacement(legal, piece, orient, besideCore, null, { dims, radius: 2 });
    expect(snapped).not.toBeNull();
    expect(snapped!.piece).toBe(piece);
    expect(snapped!.orient).toBe(orient);
    g.free();
  });

  it("only changes orientation when allowed", () => {
    const config = getPreset("stack", 2);
    const g = LocalGame.create(config, 7);
    const legal = g.legal(0);
    const piece = legal[0]!.piece;
    const orients = new Set(legal.filter((p) => p.piece === piece).map((p) => p.orient));
    const missing = config.kit === "cubes" ? [...Array(30).keys()].find((o) => !orients.has(o)) : undefined;
    if (missing !== undefined) {
      const target = legal[0]!.cells[0]!;
      expect(snapPlacement(legal, piece, missing, target, null, { dims: config.dims, radius: 2 })).toBeNull();
      const any = snapPlacement(legal, piece, missing, target, null, { dims: config.dims, radius: 2, allowOrientChange: true });
      expect(any?.piece).toBe(piece);
    }
    g.free();
  });

  it("lists every fit of a shard, nearest the cursor first", () => {
    const config = getPreset("orbit", 2);
    const g = LocalGame.create(config, 3);
    const legal = g.legal(0);
    const piece = legal[0]!.piece;
    const core = g.view(0).seats[0]!.core;
    const list = fitsNear(legal, piece, config.dims, core);
    expect(list.length).toBe(legal.filter((p) => p.piece === piece).length);
    const d = (i: number) => {
      const t = cellCoords(config.dims, core);
      const c = list[i]!.cells.map((x) => cellCoords(config.dims, x));
      const m = [0, 1, 2].map((k) => c.reduce((a, v) => a + v[k]!, 0) / c.length);
      return Math.hypot(m[0]! - t[0], m[1]! - t[1], m[2]! - t[2]);
    };
    for (let i = 1; i < list.length; i++) expect(d(i)).toBeGreaterThanOrEqual(d(i - 1) - 1e-9);
    expect(fitsNear(legal, piece, config.dims, null)).toEqual(legal.filter((p) => p.piece === piece));
    g.free();
  });
});
