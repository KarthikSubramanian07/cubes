import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector2, Vector3, Vector4, type Texture } from "three";
import { glassFragment, glassVertex } from "./shaders/glass";
import { floorFragment, floorVertex, glowFragment, glowVertex, skirtFragment, skirtVertex } from "./shaders/island";
import {
  cellFxFragment,
  cellFxVertex,
  flareFragment,
  flareVertex,
  moteFragment,
  moteVertex,
  ringFragment,
  ringVertex,
  shardFragment,
  shardVertex,
  sparkFragment,
  sparkVertex,
} from "./shaders/fx";
import {
  beamFragment,
  beamVertex,
  dustFragment,
  dustVertex,
  fogFragment,
  fogVertex,
  gemFragment,
  gemVertex,
  ghostFragment,
  ghostVertex,
  latticeFragment,
  latticeVertex,
  skyFragment,
  skyVertex,
} from "./shaders/misc";

type V3 = [number, number, number];

/** Every material we make carries a uTime uniform; the scene ticks them all in one place. */
export type TimedMaterial = ShaderMaterial & { uniforms: { uTime: { value: number } } };

function additive(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.blending = AdditiveBlending;
  m.depthWrite = false;
  return m;
}

export function glassMaterial(half: V3, coreHalf: V3, opts: { drop: number; core: number; rim: number }): TimedMaterial {
  return new ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    uniforms: {
      uTime: { value: 0 },
      uDrop: { value: opts.drop },
      uHalf: { value: new Vector3(...half) },
      uCoreHalf: { value: new Vector3(...coreHalf) },
      uCore: { value: opts.core },
      uRim: { value: opts.rim },
      uMotion: { value: 1 },
    },
  }) as TimedMaterial;
}

export function floorMaterial(mask: Texture, own: Texture, size: [number, number], taps: number): TimedMaterial {
  return new ShaderMaterial({
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
    uniforms: {
      uTime: { value: 0 },
      uMask: { value: mask },
      uOwn: { value: own },
      uSize: { value: new Vector2(...size) },
      uPointer: { value: new Vector4(0, 0, 0, 0) },
      uSeat: { value: new Color(1, 1, 1) },
      uTaps: { value: taps },
      uFlares: { value: [0, 1, 2, 3].map(() => new Vector4(0, 0, -100, 0)) },
      uFlareColors: { value: [0, 1, 2, 3].map(() => new Color(0, 0, 0)) },
    },
  }) as TimedMaterial;
}

export function skirtMaterial(depth: number, glow: Color): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: skirtVertex,
    fragmentShader: skirtFragment,
    uniforms: { uDepth: { value: depth }, uGlow: { value: glow.clone() } },
  });
}

export function underglowMaterial(color: Color, strength: number): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: { uTime: { value: 0 }, uColor: { value: color.clone() }, uStrength: { value: strength } },
    }),
  ) as TimedMaterial;
}

export function sparkMaterial(pixel: number, floor: number): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      uniforms: { uTime: { value: 0 }, uPixel: { value: pixel }, uFloor: { value: floor } },
    }),
  ) as TimedMaterial;
}

export function ringMaterial(): TimedMaterial {
  return additive(
    new ShaderMaterial({ vertexShader: ringVertex, fragmentShader: ringFragment, uniforms: { uTime: { value: 0 } } }),
  ) as TimedMaterial;
}

export function flareMaterial(): TimedMaterial {
  const m = additive(
    new ShaderMaterial({ vertexShader: flareVertex, fragmentShader: flareFragment, uniforms: { uTime: { value: 0 } } }),
  );
  m.depthTest = false;
  return m as TimedMaterial;
}

export function shardMaterial(floor: number): TimedMaterial {
  return new ShaderMaterial({
    vertexShader: shardVertex,
    fragmentShader: shardFragment,
    uniforms: { uTime: { value: 0 }, uFloor: { value: floor } },
  }) as TimedMaterial;
}

export function cellFxMaterial(half: V3): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: cellFxVertex,
      fragmentShader: cellFxFragment,
      uniforms: { uTime: { value: 0 }, uHalf: { value: new Vector3(...half) } },
    }),
  ) as TimedMaterial;
}

export function moteMaterial(pixel: number): TimedMaterial {
  const m = additive(
    new ShaderMaterial({ vertexShader: moteVertex, fragmentShader: moteFragment, uniforms: { uTime: { value: 0 }, uPixel: { value: pixel } } }),
  );
  m.depthTest = false;
  return m as TimedMaterial;
}

export function ghostMaterial(half: V3): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: ghostVertex,
      fragmentShader: ghostFragment,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(1, 1, 1) },
        uHalf: { value: new Vector3(...half) },
        uJitter: { value: new Vector3() },
        uValid: { value: 1 },
      },
    }),
  ) as TimedMaterial;
}

export function fogMaterial(tex: Texture, size: [number, number], layers: number, color: Color): TimedMaterial {
  const m = new ShaderMaterial({
    vertexShader: fogVertex,
    fragmentShader: fogFragment,
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: tex },
      uSize: { value: new Vector2(...size) },
      uLayer: { value: 0 },
      uLayers: { value: layers },
      uSeed: { value: 0 },
      uOpacity: { value: 0.5 },
      uColor: { value: color.clone() },
    },
  });
  m.transparent = true;
  m.depthWrite = false;
  return m as TimedMaterial;
}

export function beamMaterial(color: Color, strength: number, height: number): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: { uTime: { value: 0 }, uColor: { value: color.clone() }, uStrength: { value: strength }, uHeight: { value: height } },
    }),
  ) as TimedMaterial;
}

export function gemMaterial(): TimedMaterial {
  return new ShaderMaterial({
    vertexShader: gemVertex,
    fragmentShader: gemFragment,
    uniforms: { uTime: { value: 0 }, uSeat: { value: new Color(1, 1, 1) }, uMotion: { value: 1 } },
  }) as TimedMaterial;
}

export function skyMaterial(): TimedMaterial {
  const m = new ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: { uTime: { value: 0 } } });
  m.depthWrite = false;
  m.side = BackSide;
  return m as TimedMaterial;
}

export function dustMaterial(pixel: number, box: V3): TimedMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: { uTime: { value: 0 }, uPixel: { value: pixel }, uMotion: { value: 1 }, uBox: { value: new Vector3(...box) } },
    }),
  ) as TimedMaterial;
}

export function latticeMaterial(color: Color, points: boolean, pixel: number): ShaderMaterial {
  return additive(
    new ShaderMaterial({
      vertexShader: latticeVertex,
      fragmentShader: latticeFragment,
      uniforms: { uColor: { value: color.clone() }, uPoints: { value: points ? 1 : 0 }, uPixel: { value: pixel } },
    }),
  );
}
