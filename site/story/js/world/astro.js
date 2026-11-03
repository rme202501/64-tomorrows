const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const E = RAD * 23.4397;
const SUN_DIST = 149598000;

export const LAT = 42.3744;
export const LON = -71.1169;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
const azimuth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

const sun = { dec: 0, ra: 0 };
const moon = { dec: 0, ra: 0, dist: 0 };

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  sun.dec = declination(L, 0);
  sun.ra = rightAscension(L, 0);
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  moon.dist = 385001 - 20905 * Math.cos(M);
  moon.ra = rightAscension(l, b);
  moon.dec = declination(l, b);
}

/** writes unit direction vectors (x east, y up, z south) for sun and moon into `out` */
export function skyState(ms, out) {
  const lw = RAD * -LON;
  const phi = RAD * LAT;
  const d = toDays(ms);
  const st = siderealTime(d, lw);

  sunCoords(d);
  let H = st - sun.ra;
  let az = azimuth(H, phi, sun.dec);
  let alt = altitude(H, phi, sun.dec);
  out.sunAlt = alt / RAD;
  out.sun.set(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));

  moonCoords(d);
  H = st - moon.ra;
  az = azimuth(H, phi, moon.dec);
  alt = altitude(H, phi, moon.dec);
  out.moonAlt = alt / RAD;
  out.moon.set(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));

  const cosPhi = Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra);
  const ph = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
  const inc = Math.atan2(SUN_DIST * Math.sin(ph), moon.dist - SUN_DIST * Math.cos(ph));
  out.moonFraction = (1 + Math.cos(inc)) / 2;
  return out;
}
