import { describe, expect, it } from "vitest";
import { detectQuality, downgrade, QUALITY } from "./quality";

describe("detectQuality", () => {
  it("drops to low for software rendering, data saver and tiny devices", () => {
    expect(detectQuality({ dpr: 1, cores: 8, mobile: false, renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))" })).toBe("low");
    expect(detectQuality({ dpr: 1, cores: 8, mobile: false, renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" })).toBe("low");
    expect(detectQuality({ dpr: 2, cores: 8, mobile: false, saveData: true })).toBe("low");
    expect(detectQuality({ dpr: 1, cores: 2, mobile: false })).toBe("low");
    expect(detectQuality({ dpr: 2, cores: 8, memory: 2, mobile: false })).toBe("low");
  });

  it("gives discrete and Apple GPUs the high tier on desktop", () => {
    expect(detectQuality({ dpr: 2, cores: 8, mobile: false, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" })).toBe("high");
    expect(detectQuality({ dpr: 1, cores: 12, mobile: false, renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)" })).toBe("high");
  });

  it("keeps integrated GPUs on high-DPI screens at medium", () => {
    expect(detectQuality({ dpr: 2, cores: 8, mobile: false, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)" })).toBe("medium");
    expect(detectQuality({ dpr: 1, cores: 8, mobile: false, renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)" })).toBe("high");
  });

  it("caps phones at medium and drops weak ones to low", () => {
    expect(detectQuality({ dpr: 3, cores: 6, memory: 6, mobile: true, renderer: "Apple GPU" })).toBe("medium");
    expect(detectQuality({ dpr: 2, cores: 8, memory: 4, mobile: true, renderer: "Adreno (TM) 740" })).toBe("medium");
    expect(detectQuality({ dpr: 2, cores: 4, mobile: true, renderer: "Mali-G52" })).toBe("low");
    expect(detectQuality({ dpr: 2, cores: 8, memory: 3, mobile: true })).toBe("low");
  });

  it("falls back on core count when the renderer is hidden", () => {
    expect(detectQuality({ dpr: 1, cores: 16, mobile: false })).toBe("high");
    expect(detectQuality({ dpr: 1, cores: 4, mobile: false })).toBe("medium");
  });
});

describe("quality settings", () => {
  it("scale monotonically from low to high", () => {
    const keys = ["sparks", "shards", "dust", "bloomLevels", "floorTaps"] as const;
    for (const k of keys) {
      expect(QUALITY.low[k]).toBeLessThanOrEqual(QUALITY.medium[k]);
      expect(QUALITY.medium[k]).toBeLessThanOrEqual(QUALITY.high[k]);
    }
    expect(QUALITY.low.dpr[1]).toBeLessThan(QUALITY.high.dpr[1]);
  });
  it("downgrades one step at a time and bottoms out", () => {
    expect(downgrade("high")).toBe("medium");
    expect(downgrade("medium")).toBe("low");
    expect(downgrade("low")).toBe("low");
  });
});
