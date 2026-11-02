import { PRESETS, PRESET_CONFIGS, presetConfig } from "@/app/presets";
import { buildSetup, cleanName, describeConfig, setupPath } from "@/app/setup";

describe("presets", () => {
  test("every preset matches docs/DESIGN.md section 3", () => {
    expect(PRESET_CONFIGS.plane.dims).toEqual([20, 20, 1]);
    expect(presetConfig("plane", 2).dims).toEqual([14, 14, 1]);
    expect(PRESET_CONFIGS.duel).toMatchObject({ dims: [14, 14, 1], seats: 2, arena: true });
    expect(PRESET_CONFIGS.pure).toMatchObject({ dims: [20, 20, 1], arena: false, nodes: 0 });
    expect(PRESET_CONFIGS.fog).toMatchObject({ dims: [18, 18, 1], fog: 2, arena: true });
    expect(PRESET_CONFIGS.storm.storm).toMatchObject({ start: 6, every: 3 });
    expect(PRESET_CONFIGS.torus).toMatchObject({ dims: [18, 18, 1], topology: "torus" });
    expect(PRESET_CONFIGS.teams).toMatchObject({ seats: 4, teams: true, sharedLight: true });
    expect(PRESET_CONFIGS.stack).toMatchObject({ dims: [8, 8, 8], gravity: true, crowns: true, kit: "cubes" });
    expect(presetConfig("stack", 2).dims).toEqual([8, 8, 6]);
    expect(PRESET_CONFIGS.orbit).toMatchObject({ dims: [7, 7, 7], gravity: false, kit: "cubes" });
  });

  test("presetConfig returns a fresh copy", () => {
    const a = presetConfig("storm");
    a.dims[0] = 99;
    a.storm!.start = 99;
    expect(PRESET_CONFIGS.storm.dims[0]).toBe(20);
    expect(PRESET_CONFIGS.storm.storm!.start).toBe(6);
  });

  test("there are nine presets with unique names", () => {
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(9);
  });
});

describe("buildSetup", () => {
  test("bots game: seat 0 is the human, others default to flare", () => {
    const s = buildSetup({ kind: "bots", preset: "plane", seats: 3, name: "  Ada  " });
    expect(s.config.seats).toBe(3);
    expect(s.bots).toEqual([null, "flare", "flare"]);
    expect(s.name).toBe("Ada");
  });

  test("bots game keeps chosen levels but never botifies seat 0", () => {
    const s = buildSetup({ kind: "bots", preset: "duel", bots: ["nova", "ember"] });
    expect(s.bots).toEqual([null, "ember"]);
  });

  test("online rooms start with open seats, whatever the hub had for bots", () => {
    // The hub keeps a bot level per seat for its Versus bots mode; an online
    // room used to inherit those and seat Flare bots nobody asked for.
    const s = buildSetup({ kind: "online", preset: "plane", bots: [null, "flare", "flare", "flare"] });
    expect(s.bots).toEqual([null, null, null, null]);
  });

  test("local game has no bots", () => {
    const s = buildSetup({ kind: "local", preset: "plane", bots: [null, "nova", "nova", "nova"] });
    expect(s.bots).toEqual([null, null, null, null]);
  });

  test("Duel and Teams force their seat counts", () => {
    expect(buildSetup({ kind: "local", preset: "duel", seats: 4 }).config.seats).toBe(2);
    expect(buildSetup({ kind: "local", preset: "teams", seats: 2 }).config.seats).toBe(4);
  });

  test("two-seat Plane uses the small board", () => {
    expect(buildSetup({ kind: "local", preset: "plane", seats: 2 }).config.dims).toEqual([14, 14, 1]);
  });

  test("teams override forces four seats; shared light needs teams", () => {
    expect(buildSetup({ kind: "local", preset: "plane", seats: 4, overrides: { teams: true, sharedLight: true } }).config).toMatchObject({ seats: 4, teams: true, sharedLight: true });
    expect(buildSetup({ kind: "local", preset: "plane", overrides: { sharedLight: true } }).config.sharedLight).toBe(false);
  });

  test("knobs are clamped to sane values", () => {
    const c = buildSetup({
      kind: "local",
      preset: "plane",
      overrides: { fog: 40, storm: { start: 0, every: 0, minSpan: 1 }, turnSeconds: 3 },
    }).config;
    expect(c.fog).toBe(6);
    expect(c.storm).toEqual({ start: 1, every: 1, minSpan: 4 });
    expect(c.turnSeconds).toBe(10);
  });

  test("arena off zeroes nodes; 2D presets stay flat; 3D keeps cubes", () => {
    expect(buildSetup({ kind: "local", preset: "plane", overrides: { arena: false } }).config.nodes).toBe(0);
    expect(buildSetup({ kind: "local", preset: "fog", overrides: { dims: [12, 12, 5] } }).config.dims).toEqual([12, 12, 1]);
    expect(buildSetup({ kind: "local", preset: "orbit", overrides: { kit: "shards" } }).config.kit).toBe("cubes");
  });

  test("setupPath routes online setups to their room and the rest to /game/local", () => {
    expect(setupPath(buildSetup({ kind: "online", preset: "plane", roomCode: "K7QXM" }))).toBe("/r/K7QXM");
    expect(setupPath(buildSetup({ kind: "bots", preset: "plane" }))).toBe("/game/local");
  });

  test("cleanName trims, collapses whitespace, caps length and falls back", () => {
    expect(cleanName("  a   b ")).toBe("a b");
    expect(cleanName("")).toBe("Player");
    expect(cleanName("x".repeat(60))).toHaveLength(24);
  });

  test("describeConfig summarises the interesting bits", () => {
    const d = describeConfig(buildSetup({ kind: "local", preset: "storm" }).config);
    expect(d).toContain("20×20");
    expect(d).toContain("4 seats");
    expect(d.some((x) => x.startsWith("storm"))).toBe(true);
    expect(describeConfig(presetConfig("orbit"))).toContain("7×7×7");
  });
});
