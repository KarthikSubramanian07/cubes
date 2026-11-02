import { cellName, centreCell, clientToCell, clientToUser, columnLabel, makeLayout, pixelsPerUnit, stepFocus, userToCell, viewBoxOf } from "./geometry";

describe("hover math", () => {
  const l = makeLayout(20, 20, 40);
  const vb = viewBoxOf(l);

  test("viewBox includes the margin", () => {
    expect(vb.x).toBe(-l.pad);
    expect(vb.width).toBe(800 + 2 * l.pad);
  });

  test("square container maps corners exactly", () => {
    const rect = { left: 100, top: 50, width: vb.width, height: vb.height };
    expect(clientToUser(100, 50, rect, vb)).toEqual([vb.x, vb.y]);
    const [x, y] = clientToUser(100 + l.pad + 20, 50 + l.pad + 20, rect, vb);
    expect(x).toBeCloseTo(20);
    expect(y).toBeCloseTo(20);
  });

  test("letterboxed wide container centres the board horizontally", () => {
    const rect = { left: 0, top: 0, width: vb.width * 2, height: vb.height };
    // The board occupies the middle half; its left edge starts at width/4.
    const [x] = clientToUser(vb.width / 2, 10, rect, vb);
    expect(x).toBeCloseTo(vb.x);
    expect(clientToCell(vb.width / 2 + l.pad + 5, l.pad + 5, rect, l)).toBe(0);
  });

  test("scaled-down container still hits the right cell", () => {
    const s = 0.5;
    const rect = { left: 10, top: 10, width: vb.width * s, height: vb.height * s };
    // Centre of cell (3, 7).
    const cx = 10 + (l.pad + 3.5 * 40) * s;
    const cy = 10 + (l.pad + 7.5 * 40) * s;
    expect(clientToCell(cx, cy, rect, l)).toBe(3 + 20 * 7);
  });

  test("margin and void cells return null", () => {
    expect(userToCell(-5, 10, l)).toBeNull();
    expect(userToCell(10, 801, l)).toBeNull();
    expect(userToCell(10, 10, l, (i) => i !== 0)).toBeNull();
    expect(userToCell(Number.NaN, 10, l)).toBeNull();
  });

  test("zero-size rect is safe", () => {
    expect(clientToCell(5, 5, { left: 0, top: 0, width: 0, height: 0 }, l)).toBeNull();
  });

  test("pixelsPerUnit uses the limiting side", () => {
    expect(pixelsPerUnit(vb.width, vb.height * 3, l)).toBeCloseTo(1);
  });
});

describe("keyboard focus", () => {
  const all = () => true;

  test("moves and stops at edges on flat boards", () => {
    expect(stepFocus(0, "right", 5, 5, all)).toBe(1);
    expect(stepFocus(0, "left", 5, 5, all)).toBe(0);
    expect(stepFocus(0, "up", 5, 5, all)).toBe(0);
    expect(stepFocus(0, "down", 5, 5, all)).toBe(5);
  });

  test("wraps on a torus", () => {
    expect(stepFocus(0, "left", 5, 5, all, true)).toBe(4);
    expect(stepFocus(0, "up", 5, 5, all, true)).toBe(20);
  });

  test("skips void cells", () => {
    const playable = (i: number) => i !== 1 && i !== 2;
    expect(stepFocus(0, "right", 5, 5, playable)).toBe(3);
    // Nothing playable to the left of a void run ending at the edge.
    expect(stepFocus(3, "left", 5, 5, playable)).toBe(0);
    expect(stepFocus(3, "left", 5, 5, (i) => i === 3)).toBe(3);
  });

  test("centre cell avoids void", () => {
    expect(centreCell(5, 5, all)).toBe(12);
    expect(centreCell(5, 5, (i) => i !== 12)).not.toBe(12);
  });
});

test("labels", () => {
  expect(columnLabel(0)).toBe("A");
  expect(columnLabel(25)).toBe("Z");
  expect(columnLabel(26)).toBe("AA");
  expect(cellName(2 + 20 * 6, 20)).toBe("C7");
});
