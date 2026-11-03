import { condition, localHourOf } from "../util.js";

const SKIES = {
  night: { clear: ["#081129", "#1c2a52"], partly: ["#111a33", "#2b3756"], cloudy: ["#191e29", "#343b49"], wet: ["#141922", "#2c3340"] },
  dawn: { clear: ["#2b3d78", "#e9926a"], partly: ["#3a4670", "#c98f7a"], cloudy: ["#454c60", "#8f8582"], wet: ["#353c4c", "#6c6f7a"] },
  day: { clear: ["#2a6fc4", "#8ec5f2"], partly: ["#3f74ad", "#a7c4e0"], cloudy: ["#59677a", "#a2acb9"], wet: ["#3d4757", "#6f7b8b"] },
};

const KIND = {
  sunny: "clear", "clear-night": "clear", partly: "partly", "partly-night": "partly",
  cloudy: "cloudy", drizzle: "wet", rain: "wet", storm: "wet",
};

export function skyColors(cond, hour) {
  const phase = hour < 5.5 || hour >= 19.5 ? "night" : hour < 7.5 || hour >= 17.5 ? "dawn" : "day";
  return SKIES[phase][KIND[cond] ?? "clear"];
}

export function skyGradient(cond, hour) {
  const [a, b] = skyColors(cond, hour);
  return `linear-gradient(180deg, ${a} 0%, ${b} 100%)`;
}

export function nowState(data, lead) {
  const date = data.timeAt(lead);
  const hour = localHourOf(date);
  const t = data.statsAt("t2m", lead).p50;
  const rain = data.statsAt("precip", lead).p50;
  const cloud = data.statsAt("cloud", lead).p50;
  const wind = data.statsAt("wind", lead).p50;
  return { date, hour, t, rain, cloud, wind, cond: condition(cloud, rain, hour) };
}

/** member precip + median cloud -> condition, so tiles disagree on sky as well as numbers */
export function memberCondition(data, precip, lead, hour) {
  return condition(data.statsAt("cloud", lead).p50, precip, hour);
}

/** NWS wind chill below 50F, heat index above 80F */
export function feelsLike(tF, windMph, dewF) {
  if (tF <= 50 && windMph > 3) {
    const v = windMph ** 0.16;
    return 35.74 + 0.6215 * tF - 35.75 * v + 0.4275 * tF * v;
  }
  if (tF >= 80 && dewF != null) {
    const rh = 100 * Math.exp((17.625 * ((dewF - 32) / 1.8)) / (243.04 + (dewF - 32) / 1.8))
      / Math.exp((17.625 * ((tF - 32) / 1.8)) / (243.04 + (tF - 32) / 1.8));
    const T = tF;
    return -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 6.83783e-3 * T * T
      - 5.481717e-2 * rh * rh + 1.22874e-3 * T * T * rh + 8.5282e-4 * T * rh * rh - 1.99e-6 * T * T * rh * rh;
  }
  return tF;
}

export function compass(u, v) {
  const deg = (Math.atan2(-u, -v) * 180) / Math.PI;
  const from = (deg + 360) % 360;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return { deg: from, name: names[Math.round(from / 45) % 8] };
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** fraction of members wetter than `mm` mm/h anywhere in [lead, lead + hours] */
export function rainChance(data, lead, hours = 12, mm = 0.1) {
  const rows = data.members.precip;
  let hits = 0;
  for (const row of rows) {
    for (let h = 0; h <= hours; h += 1) {
      if (data.at(row, lead + h) >= mm) { hits += 1; break; }
    }
  }
  return hits / rows.length;
}

export const rainColor = (() => {
  const s = d3.scaleLinear().domain([0, 0.15, 1, 3, 8]).range(["#1a2232", "#24406a", "#2f74d0", "#5fb8ff", "#d9f1ff"])
    .interpolate(d3.interpolateLab).clamp(true);
  return (mm) => s(mm);
})();

export const windColor = (() => {
  const s = d3.scaleLinear().domain([0, 5, 12, 20, 32]).range(["#17232b", "#1d4a4f", "#23877a", "#7fcf6b", "#f2ec7a"])
    .interpolate(d3.interpolateLab).clamp(true);
  return (mph) => s(mph);
})();

/** relative luminance 0..1 of an "rgb(...)" or "#rrggbb" color */
export function luminance(color) {
  const c = d3.rgb(color);
  const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export const smoothTo = (cur, target, dt, rate = 10) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
