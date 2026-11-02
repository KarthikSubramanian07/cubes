import { initEngineForTests } from "@/engine/testing";
import { getKit } from "@/engine/engine";
import type { GameScreenProps } from "./GameScreen";
import { logLine } from "./GameScreen";

beforeAll(initEngineForTests);

function props(): GameScreenProps {
  return {
    title: "Duel",
    kit: getKit("shards"),
    seats: [
      { name: "Ana", kind: "human" },
      { name: "Flare", kind: "bot", level: "flare" },
    ],
  } as unknown as GameScreenProps;
}

describe("margin log lines", () => {
  it("names the shard that was laid", () => {
    const p = props();
    const f = p.kit.pieces.findIndex((x) => x.name === "F");
    expect(logLine(p, { type: "placed", seat: 0, piece: f, cells: [1, 2], leap: false, spark: false, hidden: false })).toEqual({
      text: "Ana laid the F",
      seat: 0,
      kind: "quiet",
    });
  });

  it("calls out surges and keeps fogged moves vague", () => {
    const p = props();
    expect(logLine(p, { type: "placed", seat: 1, piece: p.kit.sparkIndex, cells: [3], leap: true, spark: true, hidden: false })?.text).toBe(
      "Flare leapt in with a spark",
    );
    expect(logLine(p, { type: "placed", seat: 1, piece: 65535, cells: [], leap: false, spark: false, hidden: true })?.text).toBe(
      "Flare moved somewhere in the fog",
    );
  });

  it("reports the moments that matter", () => {
    const p = props();
    expect(logLine(p, { type: "shattered", seat: 0, cell: 4, victim: 1 })?.text).toBe("Ana shattered Flare's light");
    expect(logLine(p, { type: "dark", seat: 1 })?.text).toBe("Flare went dark");
    expect(logLine(p, { type: "storm", level: 1, cells: [] })).toEqual({ text: "the storm took the edge", seat: null });
    expect(logLine(p, { type: "gameOver", scores: [40, 40], winners: [0, 1] })?.text).toBe("a tie. shared light");
  });
});
