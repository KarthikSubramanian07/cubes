export type QualityTier = "low" | "medium" | "high";

export interface QualityEnv {
  dpr: number;
  cores: number;
  /** navigator.deviceMemory in GB, when the browser exposes it. */
  memory?: number;
  /** Unmasked WebGL renderer string, when available. */
  renderer?: string;
  mobile: boolean;
  saveData?: boolean;
}

export interface QualitySettings {
  dpr: [number, number];
  msaa: number;
  bloomLevels: number;
  bloomIntensity: number;
  sparks: number;
  shards: number;
  dust: number;
  fogLayers: number;
  /** Taps used by the floor shader to blur light spilling from pieces. */
  floorTaps: number;
  grain: boolean;
  beams: boolean;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    dpr: [1, 1.25],
    msaa: 0,
    bloomLevels: 4,
    bloomIntensity: 0.7,
    sparks: 384,
    shards: 96,
    dust: 90,
    fogLayers: 1,
    floorTaps: 1,
    grain: false,
    beams: true,
  },
  medium: {
    dpr: [1, 1.75],
    msaa: 0,
    bloomLevels: 6,
    bloomIntensity: 0.8,
    sparks: 1024,
    shards: 192,
    dust: 220,
    fogLayers: 2,
    floorTaps: 5,
    grain: true,
    beams: true,
  },
  high: {
    dpr: [1, 2],
    msaa: 4,
    bloomLevels: 8,
    bloomIntensity: 0.85,
    sparks: 2048,
    shards: 384,
    dust: 420,
    fogLayers: 3,
    floorTaps: 9,
    grain: true,
    beams: true,
  },
};

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const DESKTOP_HIGH = /nvidia|geforce|rtx|gtx|quadro|radeon\s*(rx|pro|vii)|apple m\d|apple gpu|arc\(tm\)|intel\(r\) arc/i;
const MOBILE_HIGH = /apple gpu|adreno.*\b(7[3-9]\d|8\d\d)\b|mali-g(7[1-9]|71\d|72\d)|immortalis|xclipse/i;
const INTEGRATED = /intel|hd graphics|uhd graphics|iris|mali-[t4]|adreno.*\b([1-5]\d\d)\b|powervr|videocore/i;

/** Pick a render tier from coarse device signals. Pure; see readQualityEnv for the browser side. */
export function detectQuality(env: QualityEnv): QualityTier {
  const r = env.renderer ?? "";
  if (env.saveData) return "low";
  if (r && SOFTWARE.test(r)) return "low";
  if (env.cores > 0 && env.cores <= 2) return "low";
  if (env.memory !== undefined && env.memory <= 2) return "low";

  if (env.mobile) {
    if (env.cores <= 4 || (env.memory !== undefined && env.memory <= 3)) return "low";
    if (r && INTEGRATED.test(r) && !MOBILE_HIGH.test(r)) return "low";
    return "medium";
  }

  if (r && DESKTOP_HIGH.test(r)) return "high";
  if (r && INTEGRATED.test(r)) return env.dpr > 1.5 ? "medium" : env.cores >= 8 ? "high" : "medium";
  if (env.cores >= 8) return "high";
  return "medium";
}

/** Read the WebGL renderer string with a throwaway context. Returns undefined when blocked. */
export function readRendererString(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return undefined;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const value = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readQualityEnv(): QualityEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { dpr: 1, cores: 4, mobile: false };
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent);
  return {
    dpr: window.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency || 4,
    memory: nav.deviceMemory,
    renderer: readRendererString(),
    mobile: mobileUA || (coarse && nav.maxTouchPoints > 1),
    saveData: nav.connection?.saveData === true,
  };
}

let detected: QualityTier | null = null;

/** Detect once per page load; the probe context is not free. */
export function autoQuality(): QualityTier {
  detected ??= detectQuality(readQualityEnv());
  return detected;
}

export function downgrade(tier: QualityTier): QualityTier {
  return tier === "high" ? "medium" : "low";
}
