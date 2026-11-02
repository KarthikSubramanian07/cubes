import { initEngineForTests } from "@/engine/testing";
import { getPreset } from "@/engine/engine";
import { PRESETS, presetConfig } from "./presets";

beforeAll(initEngineForTests);

describe("play hub presets match the Rust engine", () => {
  for (const p of PRESETS) {
    for (const seats of p.seats) {
      it(`${p.name} with ${seats} seats`, () => {
        expect(presetConfig(p.name, seats)).toEqual(getPreset(p.name, seats));
      });
    }
  }
});
