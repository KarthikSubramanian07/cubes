/** Shared GLSL helpers. Written GLSL1-style; three.js upgrades to GLSL 3 on WebGL2. */

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
// Distance to the nearest Voronoi cell border (for cracks).
float voronoiEdge(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash13(i + g), hash13(i + g + 19.7), hash13(i + g + 41.3));
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}
`;

/** Distance from a surface point to the nearest box edge, given half extents. */
export const BOX_EDGE = /* glsl */ `
float boxEdgeDist(vec3 p, vec3 halfSize) {
  vec3 e = halfSize - abs(p);
  float mn = min(e.x, min(e.y, e.z));
  float mx = max(e.x, max(e.y, e.z));
  return e.x + e.y + e.z - mn - mx;
}
float boxCornerDist(vec3 p, vec3 halfSize) {
  vec3 e = halfSize - abs(p);
  return max(e.x, max(e.y, e.z));
}
vec2 boxHit(vec3 ro, vec3 rd, vec3 h) {
  vec3 m = 1.0 / rd;
  vec3 n = m * ro;
  vec3 k = abs(m) * h;
  vec3 t1 = -n - k;
  vec3 t2 = -n + k;
  float tN = max(max(t1.x, t1.y), t1.z);
  float tF = min(min(t2.x, t2.y), t2.z);
  if (tN > tF || tF < 0.0) return vec2(-1.0);
  return vec2(tN, tF);
}
`;

/** Rodrigues rotation. */
export const ROTATE = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
`;

export const OUTPUT = /* glsl */ `
#include <colorspace_fragment>
`;
