import { BOX_EDGE, NOISE, OUTPUT } from "./chunks";

/* Ghost preview: holographic wireframe with scanlines. */
export const ghostVertex = /* glsl */ `
uniform vec3 uJitter;
uniform float uTime;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 p = position;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  w.xyz += uJitter;
  vObj = position;
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const ghostFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHalf;
uniform float uTime;
uniform float uValid;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
${NOISE}
${BOX_EDGE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);
  float edge = boxEdgeDist(vObj, uHalf);
  float rim = 1.0 - smoothstep(0.0, 0.03, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 0.12, edge);
  float scan = smoothstep(0.6, 1.0, sin(vWorld.y * 42.0 - uTime * 6.0) * 0.5 + 0.5);
  float sweep = smoothstep(0.92, 1.0, fract(vWorld.y * 0.9 - uTime * 0.8));
  float flick = uValid > 0.5 ? 1.0 : 0.7 + 0.3 * step(0.5, hash12(vec2(floor(uTime * 22.0), 1.0)));
  vec3 col = uColor * (rim * 3.0 + rimSoft * 0.12 + 0.022 + scan * 0.1 + sweep * 0.42 + fres * 0.22) * flick;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/* Fog of war: drifting haze over cells out of sight. */
export const fogVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const fogFragment = /* glsl */ `
uniform sampler2D uFog;
uniform vec2 uSize;
uniform float uLayer;
uniform float uLayers;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform vec3 uColor;
varying vec3 vWorld;
${NOISE}
void main() {
  vec2 c = vWorld.xz + uSize * 0.5;
  vec2 uv = vec2(c.x / uSize.x, (clamp(c.y, 0.5, uSize.y - 0.5) + uLayer * uSize.y) / (uSize.y * uLayers));
  float m = texture2D(uFog, uv).r;
  if (m < 0.01) discard;
  vec2 drift = vec2(uTime * 0.045, uTime * 0.028) + uSeed * 7.3;
  float n = fbm(c * 0.42 + drift);
  float n2 = fbm(c * 1.1 - drift * 1.7 + 3.1);
  float density = m * (0.35 + 0.65 * smoothstep(0.2, 0.8, n));
  vec3 col = uColor * (0.7 + 0.9 * n2) + vec3(0.07, 0.065, 0.075) * smoothstep(0.55, 0.9, n2);
  float edge = 1.0 - abs(m - 0.5) * 2.0;
  col += vec3(0.20, 0.15, 0.10) * pow(edge, 3.0) * 0.6;
  gl_FragColor = vec4(col, density * uOpacity);
  ${OUTPUT}
}
`;

/* Core beacon: a column of light rising into the sky. */
export const beamVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vH = uv.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
uniform float uHeight;
varying vec3 vWorld;
varying vec3 vN;
varying float vH;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vec3(vN.x, 0.0, vN.z));
  vec3 Vh = normalize(vec3(V.x, 0.0, V.z));
  float facing = abs(dot(N, Vh));
  float core = pow(facing, 10.0);
  float halo = pow(facing, 2.0) * 0.35;
  float h = vH * uHeight;
  float fall = exp(-h * 0.42) * smoothstep(0.0, 0.3, h);
  float bands = 0.8 + 0.2 * sin(h * 1.6 - uTime * 2.4);
  vec3 col = (uColor * halo + mix(uColor, vec3(1.0), 0.35) * core) * fall * bands * uStrength;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/* Node crystals and attach diamonds: spinning, bobbing faceted gems. aData: x phase, y kind (0 node, 1 attach). */
export const gemVertex = /* glsl */ `
attribute vec2 aData;
uniform float uTime;
uniform float uMotion;
varying vec3 vN;
varying vec3 vWorld;
varying float vKind;
varying float vPhase;
void main() {
  float ph = aData.x;
  float a = uTime * (aData.y > 0.5 ? 1.6 : 0.9) * uMotion + ph * 6.28;
  float c = cos(a);
  float s = sin(a);
  mat3 rot = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  vec3 p = rot * position;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  w.y += sin(uTime * 1.8 + ph * 6.28) * 0.05 * uMotion;
  vWorld = w.xyz;
  vN = normalize(mat3(instanceMatrix) * (rot * normal));
  vKind = aData.y;
  vPhase = ph;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const gemFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSeat;
varying vec3 vN;
varying vec3 vWorld;
varying float vKind;
varying float vPhase;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(N, V));
  float fres = pow(1.0 - ndv, 2.0);
  vec3 col;
  if (vKind < 0.5) {
    float pulse = 0.75 + 0.25 * sin(uTime * 2.4 + vPhase * 6.28);
    vec3 pearl = vec3(1.0, 0.86, 0.62);
    vec3 irid = 0.5 + 0.5 * cos(6.28 * (vec3(0.0, 0.33, 0.67) + ndv * 0.8 + uTime * 0.05));
    col = mix(pearl, irid, 0.25) * (0.9 + 1.4 * fres) * pulse * 1.5;
  } else {
    float pulse = 0.7 + 0.3 * sin(uTime * 3.0 + vPhase * 6.28);
    col = mix(uSeat, vec3(1.0), 0.2) * (0.8 + fres * 1.4) * pulse * 1.35;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/* Background: a warm dark dome with a faint nebular breath. */
export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragment = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float horizon = 1.0 - abs(d.y);
  vec3 col = vec3(0.0052, 0.0047, 0.0040);
  col += vec3(0.010, 0.0075, 0.0055) * pow(horizon, 3.0);
  vec2 q = vec2(atan(d.z, d.x) * 1.6, d.y * 3.0);
  float n = fbm(q * 1.3 + vec2(uTime * 0.004, 0.0));
  col += vec3(0.012, 0.007, 0.004) * smoothstep(0.45, 0.85, n) * horizon;
  col += vec3(0.002, 0.006, 0.006) * smoothstep(0.55, 0.9, fbm(q * 2.1 + 9.0)) * horizon;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/* Dust motes drifting through the void. */
export const dustVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixel;
uniform float uMotion;
uniform vec3 uBox;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * uMotion;
  p.y = mod(p.y + t * (0.05 + aSeed.x * 0.12) + uBox.y, uBox.y * 2.0) - uBox.y;
  p.x += sin(t * 0.2 + aSeed.y * 6.28) * 0.6;
  p.z += cos(t * 0.17 + aSeed.z * 6.28) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed.w * 1.8) + aSeed.x * 40.0);
  float edge = 1.0 - smoothstep(uBox.y * 0.75, uBox.y, abs(p.y));
  vA = (0.25 + 0.75 * tw) * edge;
  gl_PointSize = (1.0 + aSeed.w * 2.4) * uPixel * (40.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const dustFragment = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * a * vA * 0.55, 1.0);
  ${OUTPUT}
}
`;

/* Faint lattice: cage edges and orbit points. */
export const latticeVertex = /* glsl */ `
uniform float uPixel;
varying float vD;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vD = -mv.z;
  gl_PointSize = 2.2 * uPixel * (30.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const latticeFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uPoints;
varying float vD;
void main() {
  float a = 1.0;
  if (uPoints > 0.5) {
    float d = length(gl_PointCoord - 0.5);
    a = smoothstep(0.5, 0.1, d);
  }
  gl_FragColor = vec4(uColor * a, 1.0);
  ${OUTPUT}
}
`;
