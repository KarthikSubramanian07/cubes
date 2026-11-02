import { initEngineForTests } from "@/engine/testing";
import { LocalGame, getKit, getPreset } from "@/engine/engine";
import type { Vec3 } from "@/engine/types";
import { anchorFor, cellsAt, grabOffset, snapPlacement, transformOrient } from "./placement";

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
