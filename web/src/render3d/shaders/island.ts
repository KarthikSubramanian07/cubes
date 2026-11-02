import { NOISE, OUTPUT } from "./chunks";

/**
 * The board surface: dark glossy slab, holographic grid that brightens near
 * the pointer and attach points, light spill from pieces (a cheap stand-in for
 * reflections), contact darkening, node halos, crumbling storm edges.
 *
 * uMask (nearest): r playable, g ash, b attach, a node.
 * uOwn  (linear):  rgb seat colour of the floor-level piece, a occupancy.
 */
export const floorVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const floorFragment = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uOwn;
uniform vec2 uSize;
uniform vec4 uPointer;
uniform vec3 uSeat;
uniform float uTime;
uniform float uTaps;
uniform vec4 uFlares[4];
uniform vec3 uFlareColors[4];
varying vec3 vWorld;
${NOISE}

vec4 maskAt(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uSize.x || cell.y >= uSize.y) return vec4(0.0);
  return texture2D(uMask, (cell + 0.5) / uSize);
}

void main() {
  vec2 c = vWorld.xz + uSize * 0.5;
  vec2 cell = floor(c);
  vec2 f = fract(c);
  vec4 m = maskAt(cell);
  if (m.r < 0.5 && m.g < 0.5) discard;

  vec3 V = normalize(cameraPosition - vWorld);
  vec2 fw = fwidth(c);

  // Storm ash: the floor has crumbled away, leaving a jagged, smouldering lip.
  if (m.r < 0.5) {
    float lip = 1.0;
    vec4 nL = maskAt(cell + vec2(-1.0, 0.0));
    vec4 nR = maskAt(cell + vec2(1.0, 0.0));
    vec4 nD = maskAt(cell + vec2(0.0, -1.0));
    vec4 nU = maskAt(cell + vec2(0.0, 1.0));
    if (nL.r > 0.5) lip = min(lip, f.x);
    if (nR.r > 0.5) lip = min(lip, 1.0 - f.x);
    if (nD.r > 0.5) lip = min(lip, f.y);
    if (nU.r > 0.5) lip = min(lip, 1.0 - f.y);
    float jag = 0.12 + 0.22 * fbm(c * 3.1);
    if (lip > jag) discard;
    float edgeGlow = smoothstep(jag - 0.08, jag, lip);
    float flick = 0.6 + 0.4 * vnoise(c * 4.0 + uTime * 0.8);
    vec3 ash = vec3(0.012, 0.010, 0.009);
    ash += vec3(1.0, 0.36, 0.08) * edgeGlow * flick * 0.9;
    gl_FragColor = vec4(ash, 1.0);
    ${OUTPUT}
    return;
  }

  vec3 col = vec3(0.0085, 0.0072, 0.0058);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  col += vec3(0.045, 0.036, 0.028) * fres;

  // Light spill and contact darkening from pieces standing on the floor.
  vec2 uv = c / uSize;
  vec2 texel = 1.0 / uSize;
  vec4 spill = texture2D(uOwn, uv);
  if (uTaps > 1.5) {
    vec4 acc = spill * 2.0;
    float wsum = 2.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uTaps - 1.0) break;
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a)) * texel * (i < 4 ? 0.9 : 1.6);
      acc += texture2D(uOwn, uv + o);
      wsum += 1.0;
    }
    spill = acc / wsum;
  }
  col *= 1.0 - spill.a * 0.45;
  col += spill.rgb * 0.16;

  // Holographic grid.
  vec2 g = abs(f - 0.5);
  float lx = 1.0 - smoothstep(0.0, fw.x * 1.3, 0.5 - g.x);
  float ly = 1.0 - smoothstep(0.0, fw.y * 1.3, 0.5 - g.y);
  float line = max(lx, ly);
  float cornerD = length(vec2(0.5) - g);
  float dotm = 1.0 - smoothstep(0.035, 0.035 + fw.x * 1.5, cornerD);
  float pd = length(vWorld.xz - uPointer.xz);
  float near = exp(-pd * pd * 0.14) * uPointer.w;
  float att = texture2D(uMask, uv).b;
  float sweep = exp(-pow(fract((vWorld.x * 0.6 + vWorld.z) * 0.035 - uTime * 0.045) - 0.5, 2.0) * 220.0);
  vec3 lineCol = vec3(0.032, 0.026, 0.019) * (1.0 + 5.0 * near + 1.2 * sweep);
  lineCol += uSeat * att * 0.25;
  col += lineCol * line;
  col += vec3(0.09, 0.072, 0.052) * dotm * (0.6 + 3.0 * near);

  // Attach cells: a soft breathing well in the seat colour.
  if (m.b > 0.5) {
    float box = max(g.x, g.y);
    float well = smoothstep(0.5, 0.18, box);
    float br = 0.55 + 0.45 * sin(uTime * 2.6 + (cell.x + cell.y) * 0.7);
    col += uSeat * well * 0.10 * br;
    col += uSeat * (1.0 - smoothstep(0.0, 0.025, abs(box - 0.36))) * 0.55 * br;
  }

  // Node halo.
  if (m.a > 0.5) {
    float r = length(f - 0.5);
    float pulse = 0.6 + 0.4 * sin(uTime * 2.2 + cell.x);
    col += vec3(1.0, 0.86, 0.6) * (1.0 - smoothstep(0.0, 0.02, abs(r - 0.33))) * 0.7 * pulse;
    col += vec3(1.0, 0.78, 0.48) * exp(-r * r * 14.0) * 0.07 * (0.7 + 0.3 * pulse);
  }

  // Island rim: the slab edge catches the light.
  float rim = 0.0;
  if (maskAt(cell + vec2(-1.0, 0.0)).r < 0.5) rim = max(rim, 1.0 - smoothstep(0.0, 0.05, f.x));
  if (maskAt(cell + vec2(1.0, 0.0)).r < 0.5) rim = max(rim, 1.0 - smoothstep(0.0, 0.05, 1.0 - f.x));
  if (maskAt(cell + vec2(0.0, -1.0)).r < 0.5) rim = max(rim, 1.0 - smoothstep(0.0, 0.05, f.y));
  if (maskAt(cell + vec2(0.0, 1.0)).r < 0.5) rim = max(rim, 1.0 - smoothstep(0.0, 0.05, 1.0 - f.y));
  col += vec3(0.42, 0.30, 0.19) * rim * 0.55;

  // Placement light flares washing over the slab.
  for (int i = 0; i < 4; i++) {
    vec4 fl = uFlares[i];
    float age = uTime - fl.z;
    if (age < 0.0 || age > 1.2) continue;
    float d = length(vWorld.xz - fl.xy);
    col += uFlareColors[i] * exp(-d * d * 0.25) * exp(-age * 4.0) * fl.w * 0.5;
  }

  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/** Island sides: per-column slabs fading into the dark, with a lit top bevel. */
export const skirtVertex = /* glsl */ `
uniform float uDepth;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const skirtFragment = /* glsl */ `
uniform float uDepth;
uniform vec3 uGlow;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  float t = clamp(-vWorld.y / uDepth, 0.0, 1.0);
  vec3 col = mix(vec3(0.030, 0.024, 0.018), vec3(0.004, 0.0035, 0.003), pow(t, 0.6));
  col += vec3(0.30, 0.21, 0.13) * (1.0 - smoothstep(0.03, 0.08, -vWorld.y)) * 0.6;
  float strata = smoothstep(0.92, 1.0, sin(vWorld.y * 18.0) * 0.5 + 0.5);
  col += vec3(0.02, 0.015, 0.01) * strata * (1.0 - t);
  col += uGlow * pow(t, 3.0) * 0.12;
  if (vN.y < -0.5) col = uGlow * 0.05;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/** Soft additive underglow pool beneath the floating island. */
export const glowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const glowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = exp(-r * r * 6.0) * smoothstep(1.0, 0.55, r) * (0.85 + 0.15 * sin(uTime * 0.6));
  gl_FragColor = vec4(uColor * a * uStrength, 1.0);
  ${OUTPUT}
}
`;
