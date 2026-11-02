import { BOX_EDGE, NOISE, OUTPUT } from "./chunks";

/**
 * Instanced glass cubes, tiles, scars and core monoliths.
 *
 * The inner core is a parallax-correct emissive box: each fragment casts the
 * view ray through the shell and measures how much of the inner box it
 * crosses, so the glow sits *inside* the glass from every angle with no extra
 * geometry. Drop-in, squash and birth flash run on the GPU from a per-instance
 * birth time, so the CPU only touches buffers when the board changes.
 *
 * aData: x birth time, y kind (0 piece, 1 scar, 2 core), z flag bits, w seed.
 * flag bits: 1 stale, 2 last placed, 4 shatter target, 8 fade-in (no drop).
 */
export const glassVertex = /* glsl */ `
attribute vec4 aData;
attribute vec3 aColor;
attribute float aGlow;
uniform float uTime;
uniform float uDrop;
uniform vec3 uHalf;
uniform float uMotion;
varying vec3 vObj;
varying vec3 vObjCam;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vColor;
varying vec4 vData;
varying float vGlow;
varying float vAge;

void main() {
  float age = uTime - aData.x;
  int flags = int(aData.z + 0.5);
  bool fade = (flags & 8) != 0;
  vec3 scl = vec3(1.0);
  vec3 off = vec3(0.0);
  if (age < 1.5 && uMotion > 0.5) {
    if (age < 0.0) {
      scl = vec3(0.0);
    } else if (fade) {
      float k = clamp(age / 0.35, 0.0, 1.0);
      scl = vec3(k * k * (3.0 - 2.0 * k));
    } else {
      float fall = clamp(age / 0.24, 0.0, 1.0);
      off.y = uDrop * (1.0 - fall * fall);
      float land = max(age - 0.24, 0.0);
      float sq = (age > 0.24) ? exp(-8.0 * land) * sin(land * 26.0) * 0.22 : -0.08 * fall;
      scl = vec3(1.0 + sq * 0.5, 1.0 - sq, 1.0 + sq * 0.5);
      off.y -= (1.0 - scl.y) * uHalf.y;
    }
  }
  vec3 p = position * scl + off;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 inst = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vObj = position;
  vObjCam = (cameraPosition - inst - off) / max(scl, vec3(0.001));
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vWorld = world.xyz;
  vColor = aColor;
  vData = aData;
  vGlow = aGlow;
  vAge = age;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const glassFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uHalf;
uniform vec3 uCoreHalf;
uniform float uCore;
uniform float uRim;
varying vec3 vObj;
varying vec3 vObjCam;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vColor;
varying vec4 vData;
varying float vGlow;
varying float vAge;
${NOISE}
${BOX_EDGE}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  int kind = int(vData.y + 0.5);
  int flags = int(vData.z + 0.5);
  bool stale = (flags & 1) != 0;
  bool last = (flags & 2) != 0;
  bool target = (flags & 4) != 0;

  float edge = boxEdgeDist(vObj, uHalf);
  float rim = 1.0 - smoothstep(0.0, 0.032, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 0.14, edge);

  vec3 rd = normalize(vObj - vObjCam);
  vec3 base = vColor;
  float glow = vGlow;
  float key = 0.5 + 0.5 * dot(N, normalize(vec3(0.35, 1.0, 0.25)));
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, normalize(vec3(-0.35, 1.0, 0.45))), 0.0), 28.0);
  vec3 col;

  if (kind == 1) {
    // Scar: smoked, cracked dead glass with a faint ember in the fractures.
    float crack = voronoiEdge(vObj * 4.2 + vData.w * 13.0);
    float lines = 1.0 - smoothstep(0.0, 0.07, crack);
    float flicker = 0.65 + 0.35 * vnoise(vec2(uTime * 1.3, vData.w * 40.0));
    col = vec3(0.018, 0.016, 0.02) * (0.6 + 0.8 * key);
    col += vec3(0.9, 0.22, 0.06) * lines * 0.55 * flicker;
    col += vec3(0.30, 0.26, 0.24) * rim * 0.35;
    col += vec3(0.25, 0.22, 0.2) * fres * 0.35;
    col += vec3(0.6, 0.55, 0.5) * spec * 0.25;
  } else {
    vec2 hc = boxHit(vObjCam, rd, uCoreHalf);
    float thick = hc.x < -0.5 ? 0.0 : max(hc.y - max(hc.x, 0.0), 0.0);
    float core = 1.0 - exp(-thick * 6.0);
    vec3 toC = -vObj;
    float along = dot(toC, rd);
    float dist = length(toC - rd * along);
    float halo = exp(-dist * dist * 22.0);

    col = base * (0.035 + 0.075 * key);
    float coreGain = uCore * glow;
    if (kind == 2) {
      // Core monolith: energy bands rising through it.
      float band = smoothstep(0.75, 1.0, fract(vObj.y * 1.6 - uTime * 0.55));
      coreGain *= 1.25;
      col += base * band * 0.9 * glow;
    }
    col += base * core * coreGain;
    col += base * halo * 0.2 * glow;
    vec3 rimCol = mix(base, vec3(1.0), 0.18);
    col += rimCol * rim * uRim * glow;
    col += base * rimSoft * 0.07;
    col += mix(base, vec3(1.0), 0.25) * fres * 0.2;
    col += vec3(1.0, 0.93, 0.82) * spec * 0.4;
    if (last) col += rimCol * rimSoft * (0.35 + 0.35 * sin(uTime * 4.0));
  }

  if (vAge >= 0.0 && vAge < 2.0) {
    float flash = exp(-vAge * 5.0);
    col += mix(base, vec3(1.0), 0.6) * flash * 1.6;
  }

  if (target) {
    float pulse = 0.55 + 0.45 * sin(uTime * 7.0);
    col += vec3(1.0, 0.28, 0.12) * rim * pulse * 2.2;
  }

  if (stale) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(l) * vec3(0.95, 0.92, 1.0), col, 0.22) * 0.5;
    col *= 0.85 + 0.15 * sin(vWorld.y * 90.0 + uTime * 2.0);
    col = min(col, vec3(0.8));
  }

  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;
