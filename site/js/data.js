const fieldCache = new Map();
let manifestPromise;
let pointsPromise;
let geoPromise;

export function manifest() {
  manifestPromise ??= d3.json("data/manifest.json").then((m) => {
    m.nLat = m.lat.length;
    m.nLon = m.lon.length;
    m.init = new Date(m.init_time.slice(0, 19) + "Z");
    m.validTimes = m.leads_h.map((h) => new Date(+m.init + h * 3600e3));
    return m;
  });
  return manifestPromise;
}

export function points() {
  pointsPromise ??= d3.json("data/points.json");
  return pointsPromise;
}

export function field(name) {
  if (!fieldCache.has(name)) {
    fieldCache.set(name, (async () => {
      const m = await manifest();
      const meta = m.fields[name];
      const buf = await (await fetch(`data/fields/${name}.bin`)).arrayBuffer();
      const raw = new Int16Array(buf);
      const values = new Float32Array(raw.length);
      for (let k = 0; k < raw.length; k++) {
        values[k] = raw[k] === -32768 ? NaN : raw[k] * meta.scale + meta.offset;
      }
      const [nT, nLat, nLon] = meta.shape;
      const size = nLat * nLon;
      return {
        nT, nLat, nLon, values,
        frame: (t) => values.subarray(t * size, (t + 1) * size),
        at: (t, i, j) => values[t * size + i * nLon + j],
      };
    })());
  }
  return fieldCache.get(name);
}

export function geo() {
  geoPromise ??= Promise.all([
    d3.json("data/geo/states-10m.json"),
    d3.json("data/geo/countries-50m.json"),
  ]).then(([us, world]) => ({
    states: topojson.feature(us, us.objects.states),
    stateMesh: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
    countries: topojson.feature(world, world.objects.countries),
    land: topojson.feature(world, world.objects.land),
  }));
  return geoPromise;
}

export function nearestIndex(arr, x) {
  let best = 0;
  for (let k = 1; k < arr.length; k++) if (Math.abs(arr[k] - x) < Math.abs(arr[best] - x)) best = k;
  return best;
}

export function bilinear(f, m, t, lat, lon) {
  const fi = (lat - m.lat[0]) / (m.lat[1] - m.lat[0]);
  const fj = (lon - m.lon[0]) / (m.lon[1] - m.lon[0]);
  const i0 = Math.max(0, Math.min(m.nLat - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(m.nLon - 2, Math.floor(fj)));
  const a = Math.max(0, Math.min(1, fi - i0));
  const b = Math.max(0, Math.min(1, fj - j0));
  return (1 - a) * (1 - b) * f.at(t, i0, j0) + (1 - a) * b * f.at(t, i0, j0 + 1)
    + a * (1 - b) * f.at(t, i0 + 1, j0) + a * b * f.at(t, i0 + 1, j0 + 1);
}

export const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

export function valueAtPercentile(qs, p) {
  const sorted = qs.slice().sort((a, b) => a - b);
  if (p <= QUANTILES[0]) {
    const slope = (sorted[1] - sorted[0]) / (QUANTILES[1] - QUANTILES[0]);
    return sorted[0] - slope * (QUANTILES[0] - p);
  }
  if (p >= QUANTILES[4]) {
    const slope = (sorted[4] - sorted[3]) / (QUANTILES[4] - QUANTILES[3]);
    return sorted[4] + slope * (p - QUANTILES[4]);
  }
  let k = 0;
  while (p > QUANTILES[k + 1]) k++;
  const f = (p - QUANTILES[k]) / (QUANTILES[k + 1] - QUANTILES[k]);
  return sorted[k] + f * (sorted[k + 1] - sorted[k]);
}
