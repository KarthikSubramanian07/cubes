import { BOX_EDGE, NOISE, OUTPUT, ROTATE } from "./chunks";

/* Sparks: GPU-integrated particles. aParams: x birth, y life, z size. */
export const sparkVertex = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aParams;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixel;
uniform float uFloor;
varying vec3 vColor;
varying float vFade;
void main() {
  float t = uTime - aParams.x;
  float life = aParams.y;
  if (t < 0.0 || t > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = aOrigin + aVel * (1.0 - exp(-3.2 * t)) / 3.2;
  p.y -= 1.9 * t * t;
  p.y = max(p.y, uFloor);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float k = t / life;
  vFade = (1.0 - k) * (1.0 - k);
  vColor = aColor;
  gl_PointSize = aParams.z * uPixel * (1.0 - 0.5 * k) * (60.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const sparkFragment = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * a * a * vFade * 3.2, 1.0);
  ${OUTPUT}
}
`;

/* Shockwave rings lying on the floor. aParams: x birth, y max radius, z life. */
export const ringVertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aParams;
attribute vec3 aColor;
uniform float uTime;
varying vec2 vP;
varying vec3 vColor;
varying vec3 vParams;
void main() {
  float t = uTime - aParams.x;
  float alive = step(0.0, t) * step(t, aParams.z);
  vec3 p = aCenter + vec3(position.x, 0.0, position.y) * aParams.y * 2.0 * alive;
  vP = position.xy * aParams.y * 2.0;
  vColor = aColor;
  vParams = vec3(t, aParams.y, aParams.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const ringFragment = /* glsl */ `
varying vec2 vP;
varying vec3 vColor;
varying vec3 vParams;
void main() {
  float t = vParams.x;
  float k = clamp(t / vParams.z, 0.0, 1.0);
  float radius = vParams.y * (1.0 - pow(1.0 - k, 3.0));
  float r = length(vP);
  float w = 0.06 + 0.25 * k;
  float ring = exp(-pow((r - radius) / w, 2.0));
  float inner = smoothstep(radius, 0.0, r) * 0.18 * (1.0 - k);
  float fade = 1.0 - k;
  gl_FragColor = vec4(vColor * (ring * 2.4 + inner) * fade, 1.0);
  ${OUTPUT}
}
`;

/* Camera-facing light flares. aParams: x birth, y size, z life. */
export const flareVertex = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aParams;
attribute vec3 aColor;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vK;
void main() {
  float t = uTime - aParams.x;
  float alive = step(0.0, t) * step(t, aParams.z);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = aParams.y * alive * (0.6 + 0.4 * clamp(t * 8.0, 0.0, 1.0));
  vec3 p = aPos + (right * position.x + up * position.y) * s;
  vUv = position.xy;
  vColor = aColor;
  vK = clamp(t / aParams.z, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const flareFragment = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vK;
void main() {
  vec2 p = vUv * 2.0;
  float r = length(p);
  float core = exp(-r * r * 28.0) * 3.0;
  float soft = exp(-r * r * 5.0) * 0.5;
  float streak = exp(-abs(p.y) * 60.0) * exp(-abs(p.x) * 2.5) * 1.2;
  streak += exp(-abs(p.x) * 70.0) * exp(-abs(p.y) * 4.0) * 0.5;
  float fade = pow(1.0 - vK, 2.0);
  vec3 c = mix(vColor, vec3(1.0), 0.45);
  gl_FragColor = vec4(c * (core + soft + streak) * fade, 1.0);
  ${OUTPUT}
}
`;

/*
 * Rigid fragments: glass shards from a shatter, slab chunks and glass from the storm.
 * aParams: x birth, y size, z mode (0 glass bounce, 1 slab chunk falls, 2 glass falls), w hold time.
 * aSpin: xyz axis, w angular speed.
 */
export const shardVertex = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aSpin;
attribute vec4 aParams;
attribute vec3 aColor;
uniform float uTime;
uniform float uFloor;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vColor;
varying vec3 vLocal;
varying float vT;
varying float vMode;
varying float vHold;
${ROTATE}
void main() {
  float t = uTime - aParams.x;
  float mode = aParams.z;
  float hold = aParams.w;
  float life = mode < 0.5 ? 1.6 : 2.6 + hold;
  if (t < 0.0 || t > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float tm = max(t - hold, 0.0);
  vec3 axis = normalize(aSpin.xyz);
  float ang = aSpin.w * tm;
  float shrink = 1.0 - smoothstep(life - 0.45, life, t);
  vec3 lp = rotateAxis(position * aParams.y * shrink, axis, ang);
  vec3 nn = rotateAxis(normal, axis, ang);
  vec3 p = aOrigin;
  if (t < hold) {
    // rumble in place before the fall
    float j = 0.025 * (t / max(hold, 0.001));
    p += vec3(sin(t * 91.0 + aOrigin.x * 7.0), 0.0, cos(t * 83.0 + aOrigin.z * 5.0)) * j;
  } else if (mode < 0.5) {
    float g = 9.0;
    float vy = aVel.y;
    float y0 = aOrigin.y - uFloor;
    float tc = (vy + sqrt(max(vy * vy + 2.0 * g * y0, 0.0))) / g;
    if (tm < tc) {
      p = aOrigin + vec3(aVel.x, 0.0, aVel.z) * tm;
      p.y = aOrigin.y + vy * tm - 0.5 * g * tm * tm;
    } else {
      float vb = (g * tc - vy) * 0.32;
      float tb = tm - tc;
      vec3 hit = aOrigin + vec3(aVel.x, 0.0, aVel.z) * tc;
      p = hit + vec3(aVel.x, 0.0, aVel.z) * 0.45 * tb;
      p.y = uFloor + max(vb * tb - 0.5 * g * tb * tb, 0.0);
    }
  } else {
    p = aOrigin + aVel * tm;
    p.y -= 4.9 * tm * tm;
  }
  vec4 w = vec4(p + lp, 1.0);
  vWorld = w.xyz;
  vN = nn;
  vLocal = position;
  vColor = aColor;
  vT = t;
  vMode = mode;
  vHold = hold;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const shardFragment = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vColor;
varying vec3 vLocal;
varying float vT;
varying float vMode;
varying float vHold;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.5);
  vec3 col;
  if (vMode > 0.5 && vMode < 1.5) {
    // slab chunk: dark rock with glowing fractures that cool as it falls
    float crack = voronoiEdge(vLocal * 3.5 + vec3(vWorld.x, 0.0, vWorld.z) * 0.37);
    float lines = 1.0 - smoothstep(0.0, 0.08, crack);
    float heat = vT < vHold ? 0.4 + 0.6 * (vT / max(vHold, 0.001)) : exp(-(vT - vHold) * 1.4);
    col = vec3(0.02, 0.016, 0.012) + vec3(0.06, 0.045, 0.03) * max(N.y, 0.0);
    col += vec3(1.0, 0.38, 0.08) * lines * heat * 2.6;
    col += vec3(1.0, 0.45, 0.12) * fres * heat * 0.4;
  } else {
    float heat = exp(-max(vT - vHold, 0.0) * 2.2);
    col = vColor * (0.10 + 0.55 * fres);
    col += mix(vColor, vec3(1.0), 0.12) * heat * (vMode > 1.5 ? 0.9 : 1.6);
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/*
 * Cell overlays: misfire glitch, storm heat, reveal wash, shatter targets.
 * aParams: x birth, y life (<0 = forever), z mode (0 glitch, 1 heat, 2 reveal, 3 target brackets).
 */
export const cellFxVertex = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aParams;
attribute vec3 aColor;
uniform float uTime;
uniform vec3 uHalf;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vP;
void main() {
  float t = uTime - aParams.x;
  float life = aParams.y;
  bool alive = t >= 0.0 && (life < 0.0 || t <= life);
  vec3 p = position;
  float mode = aParams.z;
  if (mode < 0.5) {
    // horizontal glitch slices
    float slice = floor((position.y + uHalf.y) * 7.0);
    float j = step(0.55, fract(sin(slice * 12.9 + floor(uTime * 24.0)) * 43758.5));
    p.x += (j - 0.5) * 0.18 * sin(uTime * 60.0 + slice);
  } else if (mode > 2.5) {
    p *= 1.0 + 0.05 * sin(uTime * 6.0);
  }
  vec4 w = vec4(aPos + p * (alive ? 1.0 : 0.0), 1.0);
  vObj = position;
  vWorld = w.xyz;
  vN = normal;
  vColor = aColor;
  vP = vec3(t, life, mode);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const cellFxFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uHalf;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vP;
${NOISE}
${BOX_EDGE}
void main() {
  float t = vP.x;
  float life = vP.y;
  float mode = vP.z;
  float k = life > 0.0 ? clamp(t / life, 0.0, 1.0) : 0.0;
  float edge = boxEdgeDist(vObj, uHalf);
  float rim = 1.0 - smoothstep(0.0, 0.05, edge);
  vec3 col = vec3(0.0);
  if (mode < 0.5) {
    float flick = step(0.35, hash12(vec2(floor(uTime * 30.0), floor(vWorld.y * 20.0))));
    float scan = 0.5 + 0.5 * sin(vWorld.y * 120.0 - uTime * 40.0);
    col = vColor * (rim * 2.5 + 0.35 + scan * 0.3) * flick * (1.0 - k);
  } else if (mode < 1.5) {
    float crack = voronoiEdge(vWorld * 3.0);
    float lines = 1.0 - smoothstep(0.0, 0.07, crack);
    float ramp = smoothstep(0.0, 0.6, k) * (1.0 - smoothstep(0.75, 1.0, k));
    col = vColor * (lines * 2.2 + rim * 0.8 + 0.15) * ramp;
  } else if (mode < 2.5) {
    col = vColor * (rim * 1.2 + 0.25) * pow(1.0 - k, 2.0);
  } else {
    float corner = boxCornerDist(vObj, uHalf);
    float bracket = rim * (1.0 - step(0.2, corner));
    float pulse = 0.65 + 0.35 * sin(uTime * 6.0);
    col = vColor * bracket * 2.6 * pulse;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/* Motes flying to the HUD: positions are written by the CPU. */
export const moteVertex = /* glsl */ `
attribute vec4 aState;
attribute vec3 aColor;
uniform float uPixel;
varying vec3 vColor;
varying float vA;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vColor = aColor;
  vA = aState.x;
  gl_PointSize = aState.y * uPixel * (60.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const moteFragment = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.3) * a * a * vA * 3.0, 1.0);
  ${OUTPUT}
}
`;
