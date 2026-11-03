export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));

/** progress of `p` inside the window [a, b], clamped to 0..1 */
export const seg = (p, a, b) => clamp((p - a) / (b - a));

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  in: (t) => t * t * t,
};

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** temperature (F) -> color on a cold-warm ramp shared by every chapter */
export const tempColor = (() => {
  const stops = [
    [0, "#3b4cc0"], [20, "#4a7fe0"], [35, "#6fb0ff"], [45, "#a8dcf0"],
    [55, "#f2e6b8"], [65, "#ffc15e"], [75, "#ff8a3d"], [85, "#f2504b"], [100, "#b3123f"],
  ];
  const xs = stops.map((s) => s[0]);
  const scale = d3.scaleLinear().domain(xs).range(stops.map((s) => s[1])).interpolate(d3.interpolateLab).clamp(true);
  return (f) => scale(f);
})();

export const VARS = {
  t2m: { label: "Temperature", short: "Temp", unit: "°", fmt: (v) => `${Math.round(v)}°` },
  precip: { label: "Rain", short: "Rain", unit: "mm/h", fmt: (v) => (v < 0.05 ? "0" : v < 1 ? v.toFixed(1) : `${Math.round(v)}`) },
  wind: { label: "Wind", short: "Wind", unit: "mph", fmt: (v) => `${Math.round(v)}` },
};

export const fmtF = (v) => `${Math.round(v)}°`;
export const fmtMph = (v) => `${Math.round(v)} mph`;

const tzFmt = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts });
const fDay = tzFmt({ weekday: "short" });
const fLongDay = tzFmt({ weekday: "long" });
const fDate = tzFmt({ month: "short", day: "numeric" });
const fHour = tzFmt({ hour: "numeric" });
const fClock = tzFmt({ hour: "numeric", minute: "2-digit" });
const fParts = tzFmt({ hour: "numeric", minute: "numeric", hourCycle: "h23" });

export const fmtDow = (d) => fDay.format(d);
export const fmtLongDow = (d) => fLongDay.format(d);
export const fmtDate = (d) => fDate.format(d);
export const fmtHour = (d) => fHour.format(d);
export const fmtClock = (d) => fClock.format(d);

/** fractional local hour (0..24) in Cambridge for a Date */
export function localHourOf(d) {
  const parts = fParts.formatToParts(d);
  const h = +parts.find((p) => p.type === "hour").value;
  const m = +parts.find((p) => p.type === "minute").value;
  return (h % 24) + m / 60;
}

/** weather glyph name from cloud %, rain mm/h, and hour */
export function condition(cloudPct, rainMm, hour = 12) {
  const night = hour < 6.5 || hour > 18.5;
  if (rainMm >= 4) return "storm";
  if (rainMm >= 0.3) return "rain";
  if (rainMm >= 0.08) return "drizzle";
  if (cloudPct >= 80) return "cloudy";
  if (cloudPct >= 40) return night ? "partly-night" : "partly";
  return night ? "clear-night" : "sunny";
}

export const CONDITION_LABEL = {
  storm: "Thunderstorms", rain: "Rain", drizzle: "Drizzle", cloudy: "Cloudy",
  partly: "Partly Cloudy", "partly-night": "Partly Cloudy", sunny: "Sunny", "clear-night": "Clear",
};

/** small inline SVG weather glyphs, colored with currentColor plus fixed accents */
export function glyph(name, size = 24) {
  const s = size;
  const sun = '<circle cx="12" cy="12" r="4.2" fill="#ffc94a"/><g stroke="#ffc94a" stroke-width="1.6" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g>';
  const moon = '<path d="M15.5 4.5a7.5 7.5 0 1 0 4 13.4A8 8 0 0 1 15.5 4.5z" fill="#e8e6ff"/>';
  const cloud = (y = 0, fill = "#f2f4f8") => `<path transform="translate(0 ${y})" d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2-1.2A4.4 4.4 0 0 0 7 18.5z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, k) => `<path d="M${8 + k * 3.5} 20.5l-1 2.4" stroke="#6fc3ff" stroke-width="1.6" stroke-linecap="round"/>`).join("");
  const bolt = '<path d="M12.5 17l-2.5 4h2.2l-1 3.5 3.8-5h-2.3l1.3-2.5z" fill="#ffd34a"/>';
  const body = {
    sunny: sun,
    "clear-night": moon,
    partly: `<g transform="translate(-3 -3) scale(.8)">${sun}</g>${cloud(1)}`,
    "partly-night": `<g transform="translate(-2 -3) scale(.75)">${moon}</g>${cloud(1)}`,
    cloudy: `${cloud(-2, "#c9ced8")}${cloud(1)}`,
    drizzle: `${cloud(-3)}${drops(2)}`,
    rain: `${cloud(-3, "#d5dae3")}${drops(3)}`,
    storm: `${cloud(-4, "#9aa3b2")}${bolt}${drops(2)}`,
  }[name] ?? sun;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** seeded RNG so "random" visuals are stable between visits */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** run fn on every animation frame while `active()` is true; returns stop() */
export function loop(fn) {
  let id = 0;
  let last = performance.now();
  let running = true;
  const tick = (now) => {
    if (!running) return;
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    fn(dt, now / 1000);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => { running = false; cancelAnimationFrame(id); };
}

export function el(tag, attrs = {}, html = "") {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  if (html) node.innerHTML = html;
  return node;
}
