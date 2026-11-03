import * as THREE from "three";

const HASH = /* glsl */ `
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h31(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

/** building / city material: procedural lit windows plus floodlit white trims at night */
export function patchBuildings(material, shared) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.uniforms.uLit = shared.uLit;
    sh.uniforms.uGlow = shared.uGlow;
    sh.uniforms.uDay = shared.uDay;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 aWin;
varying vec2 vWin;
varying vec3 vWPos;
varying vec3 vWN;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWin = aWin;
vec4 wpos4 = vec4(transformed, 1.0);
vec3 wn3 = objectNormal;
#ifdef USE_INSTANCING
wpos4 = instanceMatrix * wpos4;
wn3 = mat3(instanceMatrix) * wn3;
#endif
wpos4 = modelMatrix * wpos4;
vWPos = wpos4.xyz;
vWN = normalize(mat3(modelMatrix) * wn3);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uLit;
uniform float uGlow;
uniform float uDay;
varying vec2 vWin;
varying vec3 vWPos;
varying vec3 vWN;
${HASH}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
if (vWin.x > 0.5 && abs(vWN.y) < 0.5) {
  vec2 tg = normalize(vec2(-vWN.z, vWN.x));
  vec2 q = vec2(dot(vWPos.xz, tg) / 1.05, (vWPos.y - 0.2) / 1.15);
  vec2 f = fract(q);
  vec2 fw = max(fwidth(q), vec2(1e-4));
  float wx = smoothstep(0.3 - fw.x, 0.3 + fw.x, f.x) * (1.0 - smoothstep(0.7 - fw.x, 0.7 + fw.x, f.x));
  float wy = smoothstep(0.22 - fw.y, 0.22 + fw.y, f.y) * (1.0 - smoothstep(0.76 - fw.y, 0.76 + fw.y, f.y));
  float lod = smoothstep(0.3, 0.75, max(fw.x, fw.y));
  float m = mix(wx * wy, 0.12, lod) * step(0.3, q.y);
  float plane = floor(dot(vWPos.xz, vWN.xz) * 0.5);
  float hs = h21(floor(q) + vec2(plane * 7.13, plane * 3.71));
  float lit = mix(step(hs, uLit), uLit, lod);
  vec3 warm = mix(vec3(1.0, 0.55, 0.24), vec3(1.0, 0.78, 0.5), fract(hs * 17.3));
  warm = mix(warm, vec3(0.55, 0.7, 1.0), step(0.93, fract(hs * 31.7)) * 0.7);
  vec3 glassDay = mix(vec3(0.06, 0.08, 0.11), vec3(0.25, 0.32, 0.42), clamp(vWN.y + 0.5, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, glassDay, m * 0.78);
  totalEmissiveRadiance += warm * m * lit * uNight * 1.9 * (1.0 - lod * 0.45);
}
totalEmissiveRadiance += diffuseColor.rgb * vWin.y * uGlow * smoothstep(-1.0, 22.0, vWPos.y) * vec3(1.0, 0.93, 0.82);`);
  };
  material.customProgramCacheKey = () => "buildings";
}

/** tree material: wind lean, sway and leaf flutter in the vertex shader */
export function patchTrees(material, shared, key) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = shared.uWind;
    sh.uniforms.uWindDir = shared.uWindDir;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip = instanceMatrix[3].xyz;
float ph = dot(ip.xz, vec2(0.37, 0.21));
float hh = max(position.y, 0.0);
float bend = hh * hh;
float w = uWind;
float gust = 0.55 + 0.45 * sin(uTime * 0.35 + ip.x * 0.013 - ip.z * 0.009);
float osc = sin(uTime * (1.1 + w * 0.035) + ph) * 0.65 + sin(uTime * (2.3 + w * 0.05) + ph * 1.7) * 0.35;
float flutter = sin(uTime * 11.0 + ph * 3.1 + position.x * 5.0 + position.z * 3.0);
float lean = w * 0.0008 + w * w * 0.00004;
float amp = (w * 0.0012 + w * w * 0.00005) * gust;
vec2 off = uWindDir * bend * (lean + amp * osc);
off += vec2(uWindDir.y, -uWindDir.x) * bend * amp * 0.35 * sin(uTime * 1.7 + ph * 2.3);
transformed.xz += off;
transformed.y -= dot(off, off) * 0.25;
transformed += normal * flutter * min(w, 45.0) * 0.001 * hh;
#endif`);
  };
  material.customProgramCacheKey = () => `trees-${key}`;
}

export const SkyShader = {
  uniforms: {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uMoon: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uFog: { value: new THREE.Color() },
    uGlowI: { value: 0 },
    uSunI: { value: 0 },
    uStars: { value: 0 },
    uMoonI: { value: 0 },
    uCloud: { value: 0 },
    uCloudDark: { value: 0 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uCloudOff: { value: new THREE.Vector2() },
    uCityGlow: { value: 0 },
    uTime: { value: 0 },
    uMembers: { value: null },
    uU: { value: 0 },
    uN: { value: 64 },
    uVP: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
  },
  vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform vec3 uSun, uMoon, uZenith, uHorizon, uGlow, uFog, uCloudLit, uCloudShade;
uniform float uGlowI, uSunI, uStars, uMoonI, uCloud, uCloudDark, uCityGlow, uTime, uU, uN;
uniform sampler2D uMembers;
uniform mat4 uVP;
uniform vec3 uCamPos;
uniform vec2 uCloudOff;
varying vec3 vDir;
${HASH}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec4 mem = vec4(0.0);
  float jit = 0.5;
  float seam = 0.0;
  float sx = 0.5;
  if (uU > 0.001) {
    vec4 cp = uVP * vec4(uCamPos + d * 1000.0, 1.0);
    sx = cp.x / max(abs(cp.w), 1e-3) * 0.5 + 0.5 + h * 0.08;
    float x = sx * uN - 0.5;
    float i0 = floor(x);
    float f = fract(x);
    float feather = mix(0.46, 0.22, uU);
    float wb = smoothstep(0.5 - feather, 0.5 + feather, f);
    float k0 = mod(i0, 64.0);
    float k1 = mod(i0 + 1.0, 64.0);
    mem = mix(texture2D(uMembers, vec2((k0 + 0.5) / 64.0, 0.5)), texture2D(uMembers, vec2((k1 + 0.5) / 64.0, 0.5)), wb);
    jit = mix(h11(k0 * 3.17 + 0.3), h11(k1 * 3.17 + 0.3), wb);
    seam = 1.0 - smoothstep(0.0, 0.05, abs(f - 0.5));
  }
  float hj = h - (jit - 0.5) * 0.14 * uU;
  float t = pow(clamp(hj, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  vec2 sxz = normalize(uSun.xz + 1e-5);
  vec2 dxz = normalize(d.xz + 1e-5);
  float side = max(dot(sxz, dxz), 0.0);
  float band = exp(-max(h, 0.0) * 6.0);
  col += uGlow * uGlowI * band * (0.25 + 0.75 * pow(side, 3.0));
  float mu = max(dot(d, uSun), 0.0);
  col += uGlow * (pow(mu, 12.0) * 0.6 + pow(mu, 200.0) * 2.0) * uSunI;
  col += uGlow * smoothstep(0.99955, 0.9998, mu) * 30.0 * uSunI;
  col += vec3(1.0, 0.6, 0.3) * uCityGlow * exp(-max(h, 0.0) * 9.0) * 0.045;

  if (uStars > 0.001 && h > 0.0) {
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float hs = h31(cell);
    if (hs > 0.985) {
      vec3 c = cell + 0.5 + (vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 4.1)) - 0.5) * 0.6;
      float dist = length(sp - c);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hs * 6.0) + hs * 80.0);
      float mag = pow((hs - 0.985) / 0.015, 2.5);
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.32, 0.0, dist) * mag * tw * 3.0 * uStars * smoothstep(0.0, 0.25, h);
    }
  }

  if (uMoonI > 0.001) {
    float md = dot(d, uMoon);
    float r = 0.0165;
    float ang = acos(clamp(md, -1.0, 1.0));
    if (ang < r * 1.2) {
      vec3 up = abs(uMoon.y) > 0.99 ? vec3(1, 0, 0) : vec3(0, 1, 0);
      vec3 ex = normalize(cross(up, uMoon));
      vec3 ey = cross(uMoon, ex);
      vec2 l = vec2(dot(d, ex), dot(d, ey)) / r;
      float rr = dot(l, l);
      if (rr < 1.0) {
        vec3 n = normalize(l.x * ex + l.y * ey - sqrt(1.0 - rr) * uMoon);
        float lam = smoothstep(-0.05, 0.15, dot(n, uSun));
        float mare = 0.82 + 0.18 * vnoise(l * 3.0 + 4.0);
        float edge = smoothstep(1.0, 0.92, rr);
        col = mix(col, vec3(1.0, 0.97, 0.9) * 2.4 * mare, lam * edge * uMoonI);
      }
    }
    col += vec3(0.6, 0.7, 0.9) * pow(max(md, 0.0), 300.0) * 0.25 * uMoonI;
  }

  float wet = mem.a * smoothstep(0.1, 0.6, uU);
  if (h > -0.02 && (uCloud > 0.001 || wet > 0.01)) {
    vec2 uv = d.xz / (max(h, 0.0) + 0.09) * 0.55 + uCloudOff;
    float n = fbm(uv * 0.9);
    float cov = mix(mix(0.72, 0.28, uCloud), 0.22, wet);
    float dens = smoothstep(cov, cov + 0.22, n);
    float detail = fbm(uv * 2.6 + 3.0);
    float lit = clamp(0.55 + (n - detail) * 1.4 + pow(mu, 4.0) * 0.4, 0.0, 1.2);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc = mix(cc, uCloudShade * 0.6, max(uCloudDark, wet * 0.8));
    float fade = smoothstep(-0.02, 0.18, h);
    float a = dens * fade * min(1.0, max(uCloud, wet) * 1.6 + 0.2);
    col = mix(col, cc, a);
    float ov = max(uCloud * uCloud, wet * 0.8);
    col = mix(col, mix(uHorizon, uCloudShade, 0.6), ov * 0.55 * fade);
  }
  if (uU > 0.001) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * (mem.rgb * 1.9 - 0.05), 0.5 * smoothstep(0.0, 0.7, uU));
    col += mem.rgb * (0.01 + 0.03 * smoothstep(0.0, 0.5, h)) * uU * (1.0 - uSunI * 0.5);
    vec2 rp = vec2(sx * 420.0, h * 26.0 + uTime * 1.6);
    float lane = floor(rp.x);
    float drop = step(0.8, h11(lane * 1.31)) * smoothstep(0.0, 0.4, fract(rp.y + h11(lane) * 9.0)) * smoothstep(1.0, 0.7, fract(rp.y + h11(lane) * 9.0));
    col += vec3(0.65, 0.75, 0.9) * drop * wet * (0.03 + lum * 0.12);
    col += vec3(0.9, 0.95, 1.0) * seam * uU * uU * (0.012 + lum * 0.06);
  }

  float below = smoothstep(0.03, -0.12, h);
  col = mix(col, uFog, below);
  col = mix(col, uFog, exp(-max(h, 0.0) * 28.0) * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`,
};

export const WaterShader = {
  name: "RiverShader",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uWind: { value: 0 },
    uRain: { value: 0 },
    uDeep: { value: new THREE.Color("#0b1520") },
    uSky: { value: new THREE.Color() },
    ...THREE.UniformsLib.fog,
  },
  vertexShader: /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
  fragmentShader: /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime, uWind, uRain;
uniform vec3 uDeep, uSky;
varying vec4 vUv;
varying vec3 vWPos;
#include <fog_pars_fragment>
${HASH}
vec2 ripples(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 g = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    float hs = h21(c);
    if (hs > uRain) continue;
    vec2 o = c + vec2(h21(c + 3.1), h21(c + 7.7));
    float ph = fract(t * 0.9 + hs * 7.0);
    vec2 dv = p - o;
    float dd = length(dv);
    float ring = sin((dd - ph * 1.2) * 30.0) * smoothstep(0.12, 0.0, abs(dd - ph * 1.2)) * (1.0 - ph);
    g += dv / max(dd, 1e-3) * ring;
  }
  return g;
}
void main() {
  vec2 p = vWPos.xz;
  float t = uTime;
  float calm = 0.35 + min(uWind, 40.0) * 0.03;
  vec2 g = vec2(0.0);
  g += vec2(0.15, 1.0) * cos(dot(p, vec2(0.08, 0.9)) + t * 1.3) * 0.5;
  g += vec2(-0.3, 1.0) * cos(dot(p, vec2(-0.25, 1.7)) + t * 1.9) * 0.3;
  g += vec2(0.4, 1.0) * cos(dot(p, vec2(0.5, 2.9)) - t * 2.3) * 0.2;
  g += (vec2(vnoise(p * 0.7 + t * 0.4), vnoise(p * 0.7 - t * 0.35 + 9.0)) - 0.5) * 1.2;
  g *= calm;
  if (uRain > 0.001) g += ripples(p * 0.9, t) * 0.8;
  vec3 V = normalize(cameraPosition - vWPos);
  float fres = 0.08 + 0.92 * pow(1.0 - max(V.y, 0.0), 4.0);
  vec4 uv = vUv;
  uv.x += g.x * 0.004 * uv.w;
  uv.y += g.y * 0.009 * uv.w;
  vec3 refl = texture2DProj(tDiffuse, uv).rgb * 0.4;
  refl += texture2DProj(tDiffuse, uv + vec4(0.0, 0.012 * uv.w, 0.0, 0.0)).rgb * 0.22;
  refl += texture2DProj(tDiffuse, uv - vec4(0.0, 0.012 * uv.w, 0.0, 0.0)).rgb * 0.22;
  refl += texture2DProj(tDiffuse, uv + vec4(0.0, 0.028 * uv.w, 0.0, 0.0)).rgb * 0.08;
  refl += texture2DProj(tDiffuse, uv - vec4(0.0, 0.028 * uv.w, 0.0, 0.0)).rgb * 0.08;
  vec3 body = mix(uDeep, uSky * 0.35, 0.3);
  vec3 col = mix(body, refl * color, clamp(fres * 0.9 + 0.25, 0.0, 0.92));
  col += uSky * pow(max(g.y * 0.5, 0.0), 3.0) * 0.06;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`,
};

export const RainShader = {
  uniforms: {
    uTime: { value: 0 },
    uDensity: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(70, 40, 70) },
    uWind: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
attribute vec4 aOff;
uniform float uTime, uDensity;
uniform vec3 uCam, uBox, uColor;
uniform vec2 uWind;
varying float vA;
void main() {
  if (aOff.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float speed = 18.0 + aOff.w * 6.0;
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = aOff.xyz * uBox + vel * uTime;
  vec3 wp = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 tail = wp - normalize(vel) * (0.9 + aOff.w * 0.6);
  vec4 vh = viewMatrix * vec4(wp, 1.0);
  vec4 vt = viewMatrix * vec4(tail, 1.0);
  vec4 c = mix(vh, vt, position.y);
  vec2 dir = normalize(vt.xy - vh.xy + vec2(1e-5, 0.0));
  c.xy += vec2(-dir.y, dir.x) * position.x * 0.025;
  gl_Position = projectionMatrix * c;
  float dist = length(vh.xyz);
  vA = (1.0 - position.y) * smoothstep(1.0, 4.0, dist) * smoothstep(uBox.x * 0.5, uBox.x * 0.2, dist);
}`,
  fragmentShader: /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA * 0.55);
}`,
};

export const FractureShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMembers: { value: null },
    uU: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCols: { value: 64 },
    uRows: { value: 1 },
    uDim: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uVig: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse, uMembers;
uniform float uU, uTime, uCols, uRows, uDim, uVig;
uniform vec2 uRes;
uniform vec3 uTint;
varying vec2 vUv;
${HASH}
void main() {
  vec2 uv = vUv;
  vec3 col;
  col = texture2D(tDiffuse, uv).rgb;
  if (uU > 0.002) {
    float u = uU;
    float go = u * 0.004 + u * u * 0.011 + u * 0.002 * sin(uTime * 0.31);
    vec3 ga = texture2D(tDiffuse, uv + vec2(go, go * 0.12)).rgb;
    vec3 gb = texture2D(tDiffuse, uv - vec2(go * 1.15, -go * 0.08)).rgb;
    float gw = 0.3 * smoothstep(0.0, 0.8, u);
    col = mix(col, (ga * vec3(1.08, 0.88, 0.74) + gb * vec3(0.76, 0.9, 1.1)) * 0.5, gw);
    col += max(ga, gb) * 0.06 * u;
    float sx = uv.x + (uv.y - 0.5) * 0.08;
    float x = sx * uCols - 0.5;
    float i0 = floor(x);
    float f = fract(x);
    float wb = smoothstep(0.04, 0.96, f);
    float k0 = mod(i0, 64.0);
    float k1 = mod(i0 + 1.0, 64.0);
    vec4 m = mix(texture2D(uMembers, vec2((k0 + 0.5) / 64.0, 0.5)), texture2D(uMembers, vec2((k1 + 0.5) / 64.0, 0.5)), wb);
    float mask = mix(0.12, 0.4, smoothstep(0.25, 1.0, uv.y)) * smoothstep(0.0, 0.6, u);
    col = mix(col, col * (m.rgb * 1.8 - 0.02), mask);
  }
  col *= uTint;
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, smoothstep(1.25, 0.25, length(q)), uVig);
  col *= 1.0 - uDim * 0.82;
  gl_FragColor = vec4(col, 1.0);
}`,
};
