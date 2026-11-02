import { addDaily, addResult, dailyStreak, emptyStats, loadStats, saveStats, totals, verdict } from "./stats";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("stats", () => {
  it("counts results per bot and tracks the win streak", () => {
    let s = emptyStats();
    s = addResult(s, { level: "flare", outcome: "win", score: 40 });
    s = addResult(s, { level: "flare", outcome: "win", score: 52 });
    s = addResult(s, { level: "nova", outcome: "loss", score: 31 });
    expect(s.played).toBe(3);
    expect(s.best).toBe(52);
    expect(s.byLevel.flare).toEqual({ win: 2, loss: 0, tie: 0 });
    expect(s.byLevel.nova.loss).toBe(1);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(totals(s)).toEqual({ win: 2, loss: 1, tie: 0 });
  });

  it("round-trips through storage and survives junk", () => {
    const st = memory();
    const s = addResult(emptyStats(), { level: "ember", outcome: "tie", score: 20 });
    saveStats(s, st);
    expect(loadStats(st)).toEqual(s);
    st.setItem("cubes:stats:v1", "{nope");
    expect(loadStats(st)).toEqual(emptyStats());
    expect(loadStats(null)).toEqual(emptyStats());
  });

  it("keeps only the first daily attempt and counts the daily streak", () => {
    const r = { outcome: "win" as const, score: 50, opponent: 40, grid: "" };
    let s = emptyStats();
    s = addDaily(s, "2026-10-31", r);
    s = addDaily(s, "2026-11-01", r);
    s = addDaily(s, "2026-11-02", { ...r, outcome: "loss" });
    s = addDaily(s, "2026-11-02", r);
    expect(s.daily["2026-11-02"]!.outcome).toBe("loss");
    expect(dailyStreak(s, "2026-11-02")).toBe(3);
    // Not played yet today: yesterday's run still stands.
    expect(dailyStreak(s, "2026-11-03")).toBe(3);
    expect(dailyStreak(s, "2026-11-05")).toBe(0);
  });

  it("says something true about the matchup", () => {
    let s = emptyStats();
    s = addResult(s, { level: "nova", outcome: "loss", score: 1 });
    expect(verdict(s, "nova", "Nova")).toBeNull();
    s = addResult(s, { level: "nova", outcome: "loss", score: 1 });
    expect(verdict(s, "nova", "Nova")).toMatch(/0 for 2 against Nova/);
    s = addResult(s, { level: "nova", outcome: "win", score: 1 });
    expect(verdict(s, "nova", "Nova")).toBe("You and Nova: 1 win, 2 losses.");
  });
});
