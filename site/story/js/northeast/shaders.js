const common = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uData;
uniform sampler2D uMask;
uniform sampler2D uShelf;
uniform float uL0;
uniform float uL1;
uniform float uMix;
uniform vec2 uGrid;
uniform float uRelief;
uniform float uTime;
uniform vec2 uSpread;

vec4 field(vec2 uv) {
  vec2 t = (uv * (uGrid - 1.0) + 0.5) / uGrid;
  return mix(texture(uData, vec3(t, uL0)), texture(uData, vec3(t, uL1)), uMix);
}

vec4 fieldLod(vec2 uv) {
  vec2 t = (uv * (uGrid - 1.0) + 0.5) / uGrid;
  return mix(textureLod(uData, vec3(t, uL0), 0.0), textureLod(uData, vec3(t, uL1), 0.0), uMix);
}

float edgeFade(vec2 uv) {
  return smoothstep(0.0, 0.07, min(uv.x, 1.0 - uv.x)) * smoothstep(0.0, 0.09, min(uv.y, 1.0 - uv.y));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}

float uncertainty(float spread) {
  return smoothstep(uSpread.x, uSpread.y, spread);
}
`;

export const terrainVert = /* glsl */ `
${common}
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormal;

float heightAt(vec2 uv) {
  float land = textureLod(uShelf, uv, 0.0).r;
  float t = fieldLod(uv).r;
  return uRelief * (0.15 + 0.85 * clamp((t - 25.0) / 55.0, 0.0, 1.0)) * land * edgeFade(uv);
}

uniform vec2 uSize;

void main() {
  vUv = uv;
  vec3 p = position;
  float h = heightAt(uv);
  p.y = h;
  vec2 e = 1.5 / uGrid;
  float hx = heightAt(uv + vec2(e.x, 0.0)) - heightAt(uv - vec2(e.x, 0.0));
  float hz = heightAt(uv + vec2(0.0, e.y)) - heightAt(uv - vec2(0.0, e.y));
  vec3 tx = vec3(2.0 * e.x * uSize.x, hx, 0.0);
  vec3 tz = vec3(0.0, hz, -2.0 * e.y * uSize.y);
  vNormal = normalize(cross(tx, tz));
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const terrainFrag = /* glsl */ `
${common}
uniform sampler2D uRamp;
uniform vec3 uBg;
uniform float uIso;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormal;

void main() {
  vec4 f = field(vUv);
  float temp = f.r;
  float u = uncertainty(f.g);
  float land = texture(uMask, vUv).r;

  vec3 base = texture(uRamp, vec2(clamp(temp / 100.0, 0.0, 1.0), 0.5)).rgb;
  vec3 n = normalize(vNormal);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.35));
  float diff = 0.62 + 0.5 * max(dot(n, L), 0.0);
  vec3 col = base * diff;

  float iso = temp / 5.0;
  float wIso = fwidth(iso);
  float dIso = abs(fract(iso + 0.5) - 0.5);
  float isoLine = (1.0 - smoothstep(0.0, wIso * 1.25, dIso)) * smoothstep(0.6, 0.15, wIso);
  col = mix(col, col * 0.86, isoLine * uIso * (1.0 - u) * land);

  float landK = smoothstep(0.35, 0.65, land);
  if (landK < 0.999) {
    vec3 deep = vec3(0.018, 0.035, 0.075);
    vec3 ocean = mix(deep, base * 0.42, 0.28);
    float swell = vnoise(vPos.xz * 5.0 + vec2(uTime * 0.12, -uTime * 0.07)) * 0.6
      + vnoise(vPos.xz * 11.0 - vec2(uTime * 0.09, uTime * 0.05)) * 0.4;
    ocean += vec3(0.02, 0.04, 0.07) * swell;
    col = mix(ocean, col, landK);
  }

  float shelf = texture(uShelf, vUv).r;
  float glow = smoothstep(0.0, 0.5, shelf) * (1.0 - smoothstep(0.35, 0.65, land));
  col += vec3(0.25, 0.45, 0.7) * glow * 0.22 * (1.0 - 0.7 * u);

  if (u > 0.002) {
    float drift = uTime * 0.06;
    float n1 = fbm(vPos.xz * 1.1 + vec2(drift, drift * 0.4));
    float n2 = fbm(vPos.xz * 3.6 - vec2(drift * 1.7, -drift * 0.9) + n1 * 1.5);
    float shimmer = 0.5 + 0.5 * sin(uTime * 1.3 + n2 * 9.0);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * 0.95 + 0.02, u * 0.92);
    vec3 fogCol = vec3(0.50, 0.53, 0.58) * (0.72 + 0.42 * n2) + 0.05 * shimmer * u;
    float fogAmt = u * (0.42 + 0.48 * n1 + 0.1 * shimmer);
    col = mix(col, fogCol, clamp(fogAmt, 0.0, 0.95));
  }

  col = mix(uBg, col, edgeFade(vUv));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 160.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const cloudVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cloudFrag = /* glsl */ `
${common}
uniform float uLayer;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vPos;

void main() {
  vec4 f = field(vUv);
  float u = uncertainty(f.g);
  float rain = smoothstep(0.08, 1.6, f.b);
  float fade = edgeFade(vUv) * uOpacity;
  if (fade < 0.002 || u + rain < 0.02) discard;
  float drift = uTime * (0.035 + uLayer * 0.02);
  vec2 q = vPos.xz * (0.9 + uLayer * 0.7) + vec2(drift, drift * 0.3) + uLayer * 13.7;
  float n = fbm(q + fbm(q * 0.7 - drift) * 1.4);
  float cover = clamp(u * 1.05 + rain * 0.55, 0.0, 1.0);
  float d = smoothstep(1.0 - cover * 0.95, 1.18 - cover * 0.6, n + cover * 0.35);
  vec3 col = mix(vec3(0.70, 0.73, 0.78), vec3(0.42, 0.45, 0.52), rain * (1.0 - u));
  float a = d * (0.28 + 0.4 * cover) * fade;
  gl_FragColor = vec4(col, a);
}
`;
