import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { QualitySettings } from "../quality";

/**
 * HDR pipeline: only values pushed above 1.0 (emissive cores, rims, sparks)
 * bloom. Tone mapping happens here because the composer disables it on the renderer.
 */
export function Post({ q }: { q: QualitySettings }) {
  const bloom = (
    <Bloom
      mipmapBlur
      luminanceThreshold={1}
      luminanceSmoothing={0.3}
      intensity={q.bloomIntensity}
      radius={0.72}
      levels={q.bloomLevels}
    />
  );
  const tone = <ToneMapping mode={ToneMappingMode.NEUTRAL} />;
  const vignette = <Vignette offset={0.32} darkness={0.68} />;
  if (q.grain) {
    return (
      <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
        {bloom}
        {tone}
        {vignette}
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.18} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      {bloom}
      {tone}
      {vignette}
    </EffectComposer>
  );
}
