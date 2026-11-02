import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { DataTexture, LinearFilter, PlaneGeometry, RedFormat, UnsignedByteType } from "three";
import { FLAG, OWNER, type View } from "@/engine/types";
import { TILE_H, type BoardLayout } from "../coords";
import { fogMaterial, type TimedMaterial } from "../materials";
import { linear } from "../palette";
import { useDisposable } from "./useDisposable";

const noRaycast = () => {};
const FOG_COLOR = "#4a4440";

/** Drifting haze over every cell the viewer cannot currently see. */
export function Fog({ view, L, layers, layerCut }: { view: View; L: BoardLayout; layers: number; layerCut: number | null }) {
  const tex = useDisposable(() => {
    const t = new DataTexture(new Uint8Array(L.w * L.h * L.d), L.w, L.h * L.d, RedFormat, UnsignedByteType);
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [L.w, L.h, L.d]);
  const geo = useDisposable(() => new PlaneGeometry(L.w, L.h).rotateX(-Math.PI / 2), [L.w, L.h]);

  // 2D: a few stacked sheets for parallax depth. 3D: one sheet per visible layer.
  const sheets = useMemo(() => {
    if (L.is2D) {
      const hs = [0.1, 0.38, 0.7].slice(0, Math.max(1, layers));
      return hs.map((y, k) => ({ y, layer: 0, seed: k, opacity: 0.9 / hs.length + 0.14 }));
    }
    const top = layerCut === null ? L.d - 1 : layerCut;
    return Array.from({ length: top + 1 }, (_, z) => ({ y: z + 0.5, layer: z, seed: z, opacity: 0.32 }));
  }, [L, layers, layerCut]);

  const mats = useMemo<TimedMaterial[]>(
    () =>
      sheets.map((s) => {
        const m = fogMaterial(tex, [L.w, L.h], L.d, linear(FOG_COLOR));
        m.uniforms.uLayer!.value = s.layer;
        m.uniforms.uSeed!.value = s.seed;
        m.uniforms.uOpacity!.value = s.opacity;
        return m;
      }),
    [sheets, tex, L],
  );
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  useLayoutEffect(() => {
    const d = tex.image.data as Uint8Array;
    for (let i = 0; i < view.cells.length; i++) {
      const o = view.cells[i]!;
      const hidden = o !== OWNER.VOID && o !== OWNER.ASH && !(view.flags[i]! & FLAG.VISIBLE);
      d[i] = hidden ? 255 : 0;
    }
    tex.needsUpdate = true;
  }, [view, tex]);

  useFrame((s) => {
    for (const m of mats) m.uniforms.uTime.value = s.clock.elapsedTime;
  });

  return (
    <group>
      {sheets.map((s, k) => (
        <mesh
          key={k}
          geometry={geo}
          material={mats[k]}
          position={[0, L.is2D ? s.y + (k === 0 ? 0 : TILE_H * 0.2) : s.y, 0]}
          raycast={noRaycast}
          renderOrder={20 + k}
        />
      ))}
    </group>
  );
}
