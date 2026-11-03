import { tempColor } from "../util.js";

const SQRT2PI = Math.sqrt(2 * Math.PI);

export function completeDays(data) {
  return data.daily.filter((d) => d.complete && d.lead_days >= 0 && d.high?.length);
}

export function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function silverman(xs, min = 1.5) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const s = [...xs].sort((a, b) => a - b);
  const iqr = (quantile(s, 0.75) - quantile(s, 0.25)) / 1.34;
  const spread = iqr > 0 ? Math.min(sd, iqr) : sd;
  return Math.max(min, 0.9 * spread * n ** -0.2);
}

export function dayStats(day) {
  const sorted = [...day.high].sort((a, b) => a - b);
  const p50 = day.high_p50 ?? quantile(sorted, 0.5);
  return {
    day,
    sorted,
    p50,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    h: silverman(sorted),
  };
}

/** domain [lo, hi] in F covering every complete day's highs, snapped to `step` */
export function tempDomain(stats, step = 5, pad = 3) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of stats) {
    lo = Math.min(lo, s.min);
    hi = Math.max(hi, s.max);
  }
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step];
}

/**
 * Gaussian KDE evaluated on a regular grid into `out`.
 * Members are pulled toward `center` by factor `k` (0 = all at center, 1 = true positions).
 */
export function kde(out, xs, x0, dx, h, center = 0, k = 1) {
  out.fill(0);
  const n = xs.length;
  const m = out.length;
  const norm = 1 / (n * h * SQRT2PI);
  const reach = 4 * h;
  for (let i = 0; i < n; i++) {
    const c = center + (xs[i] - center) * k;
    const j0 = Math.max(0, Math.ceil((c - reach - x0) / dx));
    const j1 = Math.min(m - 1, Math.floor((c + reach - x0) / dx));
    for (let j = j0; j <= j1; j++) {
      const z = (x0 + j * dx - c) / h;
      out[j] += Math.exp(-0.5 * z * z) * norm;
    }
  }
  return out;
}

/** a random high for `stats`: a random member plus jitter within its neighbors' midpoints */
export function sampleHigh(stats, rand) {
  const s = stats.sorted;
  const n = s.length;
  const i = Math.min(n - 1, Math.floor(rand() * n));
  const lo = i > 0 ? (s[i - 1] + s[i]) / 2 : s[i] - (s[1] - s[0]) / 2;
  const hi = i < n - 1 ? (s[i] + s[i + 1]) / 2 : s[i] + (s[n - 1] - s[n - 2]) / 2;
  return lo + (hi - lo) * rand();
}

export function tempGradient(g, x0, x1, lo, hi, alpha = 1) {
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const c = d3.color(tempColor(lo + ((hi - lo) * i) / steps));
    c.opacity = alpha;
    grad.addColorStop(i / steps, c.formatRgb());
  }
  return grad;
}

/** size a canvas to its CSS box at a capped DPR; returns { g, w, h, dpr } */
export function fitCanvas(canvas, mobile) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr };
}

export function dayName(day) {
  if (day.lead_days === 0) return "Today";
  if (day.lead_days === 1) return "Tomorrow";
  return day.dow;
}

export function dateLabel(day) {
  const [, m, d] = day.date.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${mon} ${d}`;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const FONT = {
  serif: '"Instrument Serif", "Times New Roman", serif',
  sans: '"Inter Tight", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};
