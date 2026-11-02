import { cellCoords, cellIndex } from "@/engine/types";

test("cell index round-trips", () => {
  const dims: [number, number, number] = [8, 6, 4];
  for (let i = 0; i < 8 * 6 * 4; i++) {
    const [x, y, z] = cellCoords(dims, i);
    expect(cellIndex(dims, x, y, z)).toBe(i);
  }
});
