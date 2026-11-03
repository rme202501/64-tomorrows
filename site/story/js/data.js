const base = new URL("../data/", import.meta.url);

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

export async function loadStory() {
  const raw = await (await fetch(new URL("story.json", base))).json();
  const leads = raw.leads_h;
  const init = new Date(raw.meta.init_time);
  const valid = raw.valid.map((s) => new Date(s));
  const maxLead = leads[leads.length - 1];
  const nMembers = raw.meta.n_members;

  const story = {
    raw,
    meta: raw.meta,
    leads,
    valid,
    init,
    maxLead,
    nMembers,
    series: raw.series,
    members: raw.members,
    spread: raw.spread,
    daily: raw.daily,
    localHour: raw.local_hour,

    /** linear interpolation of any per-lead array at a fractional lead hour */
    at(arr, leadH) { return interp(leads, arr, leadH); },

    /** {mean,p10,...,p90} of a series at a lead hour */
    statsAt(variable, leadH) {
      const s = raw.series[variable];
      const out = {};
      for (const k of Object.keys(s)) out[k] = interp(leads, s[k], leadH);
      return out;
    },

    /** the 64 member values of t2m | precip | wind at a lead hour */
    membersAt(variable, leadH) {
      return raw.members[variable].map((m) => interp(leads, m, leadH));
    },

    /** the Date for a (fractional) lead hour */
    timeAt(leadH) { return new Date(+init + leadH * 3600e3); },

    /** lead hour for a Date */
    leadOf(date) { return (+date - +init) / 3600e3; },

    /** lead hour, clamped to the data, `days` days after the first local morning */
    leadForDay(days, localHour = 8) {
      const first = valid[0];
      const local = new Date(first.toLocaleString("en-US", { timeZone: raw.meta.tz }));
      const offsetH = (+first - +local) / 3600e3;
      const morning = new Date(local);
      morning.setHours(localHour, 0, 0, 0);
      const target = +morning + offsetH * 3600e3 + days * 86400e3;
      return Math.max(leads[0], Math.min(maxLead, (target - +init) / 3600e3));
    },

    /** index of the nearest stored lead */
    nearestIndex(leadH) {
      let best = 0;
      for (let k = 1; k < leads.length; k++) if (Math.abs(leads[k] - leadH) < Math.abs(leads[best] - leadH)) best = k;
      return best;
    },
  };
  return story;
}

let nePromise;
/** Northeast grids: { meta, fields: { t2m_spread, t2m_p50, precip_p90 } with frame(t) and at(t,i,j) } */
export function loadNortheast() {
  nePromise ??= (async () => {
    const meta = await (await fetch(new URL("ne_meta.json", base))).json();
    const fields = {};
    await Promise.all(Object.entries(meta.fields).map(async ([name, f]) => {
      const buf = await (await fetch(new URL(`ne_${name}.bin`, base))).arrayBuffer();
      const rawI = new Int16Array(buf);
      const values = new Float32Array(rawI.length);
      for (let k = 0; k < rawI.length; k++) values[k] = rawI[k] === -32768 ? NaN : rawI[k] * f.scale + f.offset;
      const [nT, nLat, nLon] = f.shape;
      const size = nLat * nLon;
      fields[name] = {
        nT, nLat, nLon, values, min: f.min, max: f.max,
        frame: (t) => values.subarray(t * size, (t + 1) * size),
        at: (t, i, j) => values[t * size + i * nLon + j],
      };
    }));
    return { meta, fields };
  })();
  return nePromise;
}

let geoPromise;
/** US state outlines + land, from the classic site's topojson */
export function loadGeo() {
  geoPromise ??= Promise.all([
    d3.json(new URL("../../data/geo/states-10m.json", import.meta.url).href),
    d3.json(new URL("../../data/geo/countries-50m.json", import.meta.url).href),
  ]).then(([us, world]) => ({
    states: topojson.feature(us, us.objects.states),
    stateMesh: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
    land: topojson.feature(world, world.objects.land),
  }));
  return geoPromise;
}
