import type { View } from "@/engine/types";
import { soloResult } from "./result";

const view = (winners: number[], scores: number[]) => ({ winners, scores, seats: scores.map((score) => ({ score })) }) as unknown as View;

describe("soloResult", () => {
  const seats = [
    { kind: "human" as const, name: "You" },
    { kind: "bot" as const, name: "Ember", level: "ember" as const },
    { kind: "bot" as const, name: "Nova", level: "nova" as const },
  ];
  it("credits a win against the strongest bot at the table", () => {
    expect(soloResult({ seats, view: view([0], [44, 30, 41]) })).toEqual({ level: "nova", outcome: "win", score: 44 });
  });
  it("tells a tie from a loss", () => {
    expect(soloResult({ seats, view: view([0, 2], [40, 1, 40]) })?.outcome).toBe("tie");
    expect(soloResult({ seats, view: view([2], [10, 1, 40]) })?.outcome).toBe("loss");
  });
  it("ignores pass-and-play and bots-only games", () => {
    expect(soloResult({ seats: [seats[0]!, { kind: "human", name: "B" }], view: view([0], [1, 0]) })).toBeNull();
    expect(soloResult({ seats: [seats[1]!, seats[2]!], view: view([0], [1, 0]) })).toBeNull();
  });
});
