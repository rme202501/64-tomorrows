import * as THREE from "three";

const STOPS = [
  { alt: -90, zenith: "#02050e", horizon: "#0a1428", glow: "#16203e", fog: "#08101f", light: "#8fa6d8", lightI: 0, hemiSky: "#2c4372", hemiGround: "#0e1118", hemiI: 0.85, exposure: 1.05 },
  { alt: -16, zenith: "#030813", horizon: "#0c1a34", glow: "#1a2648", fog: "#0a1428", light: "#8fa6d8", lightI: 0, hemiSky: "#2e4574", hemiGround: "#0e1118", hemiI: 0.85, exposure: 1.05 },
  { alt: -9, zenith: "#0a1634", horizon: "#22355f", glow: "#4b3e66", fog: "#18233f", light: "#9cb1e0", lightI: 0, hemiSky: "#3a5584", hemiGround: "#12141c", hemiI: 0.8, exposure: 1.05 },
  { alt: -4, zenith: "#1a3470", horizon: "#5a6d9c", glow: "#c98476", fog: "#3e4d78", light: "#b9a0c0", lightI: 0, hemiSky: "#5a6fa0", hemiGround: "#1d1d26", hemiI: 0.7, exposure: 1.0 },
  { alt: 0, zenith: "#2e4f8c", horizon: "#d99a7f", glow: "#ff9a52", fog: "#a08e98", light: "#ff8c4a", lightI: 0.9, hemiSky: "#8a92b8", hemiGround: "#3a2a26", hemiI: 0.85, exposure: 0.95 },
  { alt: 5, zenith: "#3f70b4", horizon: "#f2c595", glow: "#ffb265", fog: "#c9b4a2", light: "#ffae66", lightI: 2.4, hemiSky: "#a7b9d6", hemiGround: "#4a3a2e", hemiI: 1.0, exposure: 0.9 },
  { alt: 14, zenith: "#3570c4", horizon: "#d9dde3", glow: "#ffe0b0", fog: "#bfcfdf", light: "#ffe2bd", lightI: 3.0, hemiSky: "#b6cde8", hemiGround: "#4d4a40", hemiI: 1.15, exposure: 0.85 },
  { alt: 35, zenith: "#2a62bc", horizon: "#bcd2e8", glow: "#fff2dc", fog: "#b9cde0", light: "#fff0da", lightI: 3.6, hemiSky: "#bcd3ee", hemiGround: "#55524a", hemiI: 1.2, exposure: 0.82 },
  { alt: 90, zenith: "#2660bc", horizon: "#b2cce8", glow: "#fff6ea", fog: "#b2cae2", light: "#fff4e6", lightI: 3.7, hemiSky: "#bcd3ee", hemiGround: "#57544c", hemiI: 1.2, exposure: 0.8 },
];

const KEYS = ["zenith", "horizon", "glow", "fog", "light", "hemiSky", "hemiGround"];
const parsed = STOPS.map((s) => {
  const o = { alt: s.alt, lightI: s.lightI, hemiI: s.hemiI, exposure: s.exposure };
  for (const k of KEYS) o[k] = new THREE.Color(s[k]);
  return o;
});

export function createPalette() {
  const out = { lightI: 0, hemiI: 0, exposure: 1 };
  for (const k of KEYS) out[k] = new THREE.Color();
  return out;
}

/** interpolate the day palette for a sun altitude (degrees) into `out` (linear colors) */
export function samplePalette(alt, out) {
  let i = 0;
  while (i < parsed.length - 2 && alt > parsed[i + 1].alt) i++;
  const a = parsed[i];
  const b = parsed[i + 1];
  let t = (alt - a.alt) / (b.alt - a.alt);
  t = Math.max(0, Math.min(1, t));
  t = t * t * (3 - 2 * t);
  for (const k of KEYS) out[k].copy(a[k]).lerp(b[k], t);
  out.lightI = a.lightI + (b.lightI - a.lightI) * t;
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  return out;
}
