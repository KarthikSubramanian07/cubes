import { PATTERNS, buzz } from "./haptics";

describe("buzz", () => {
  it("vibrates with the named pattern where the API exists", () => {
    const calls: unknown[] = [];
    const nav = { vibrate: (p: number | number[]) => (calls.push(p), true) } as Pick<Navigator, "vibrate">;
    expect(buzz("shatter", nav)).toBe(true);
    expect(calls).toEqual([PATTERNS.shatter]);
  });
  it("does nothing without the API", () => {
    expect(buzz("place", {} as Pick<Navigator, "vibrate">)).toBe(false);
    expect(buzz("place", undefined)).toBe(false);
  });
});
