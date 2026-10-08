import { manifest, points, field, valueAtPercentile } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { frame, responsive, segmented } from "../chart.js";
import { divergingTemp, sequentialBlue, cToF, fmtTime, fmtPct, SERIES, onThemeChange } from "../theme.js";

const Q = ["p10", "p25", "p50", "p75", "p90"];
const MODES = {
  temp: { label: "Temperature", prefix: "t2m", conv: cToF, fmt: (v) => `${Math.round(v)}°F` },
  rain: { label: "Rain", prefix: "precip", conv: (v) => Math.max(0, v), fmt: (v) => (v < 0.1 ? "dry" : `${v.toFixed(1)} mm/h`) },
};

export default async function roulette(el) {
  const m = await manifest();
  const pts = await points();
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const reelEl = el.querySelector(".reel");
  const tallyEl = el.querySelector(".tally");
  const hourly = m.leads_h.filter((h) => h <= 48).length;
  const t = Math.min(hourly - 1, m.validTimes.findIndex((d, k) => k > 12 && d.getHours() === 15));
  let mode = "temp";
  let fields;
  let spins = [];
  let threshold;

  segmented(controls, Object.entries(MODES).map(([value, d]) => ({ label: d.label, value })), mode,
    async (v) => { mode = v; await load(); reset(); });
  d3.select(controls).append("button").attr("class", "btn primary").text("Spin").on("click", () => spin(true));
  d3.select(controls).append("button").attr("class", "btn").text("Spin ×25").on("click", () => {
    for (let n = 0; n < 24; n++) spin(false);
    spin(true);
  });
  d3.select(controls).append("button").attr("class", "btn ghost").text("Reset").on("click", reset);

  const map = await createMap(mapEl, { onDraw: () => drawMap() });
  let current = 0.5;

  async function load() {
    fields = await Promise.all(Q.map((q) => field(`${MODES[mode].prefix}_${q}`)));
    const b = pts.Boston;
    threshold = mode === "temp" ? Math.round(cToF(b.t2m_p50[t])) : 0.1;
  }

  function bostonAt(u) {
    const b = pts.Boston;
    return MODES[mode].conv(valueAtPercentile(Q.map((q) => b[`${MODES[mode].prefix}_${q}`][t]), u));
  }

  function trueProb() {
    const b = pts.Boston;
    if (mode === "rain") return b.p_rain[t];
    const qs = Q.map((q) => cToF(b[`t2m_${q}`][t]));
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (valueAtPercentile(qs, mid) > threshold) hi = mid; else lo = mid;
    }
    return 1 - lo;
  }

  function drawMap() {
    if (!map.projection || !fields) return;
    const size = m.nLat * m.nLon;
    const frames = fields.map((f) => f.frame(t));
    const vals = new Float32Array(size);
    for (let k = 0; k < size; k++) vals[k] = MODES[mode].conv(valueAtPercentile(frames.map((f) => f[k]), current));
    const color = mode === "temp" ? divergingTemp(20, 55, 90) : sequentialBlue(0, 4);
    map.drawGrid(m, vals, color);
    legendRamp(legendEl, color, mode === "temp" ? [20, 90] : [0, 4],
      { label: mode === "temp" ? "Temperature in this possible future (°F)" : "Rain in this possible future (mm/h)", format: (d) => d });
    map.addTowns(pts, ["Boston", "Worcester", "Providence", "Portland ME"]);
  }

  function spin(animate) {
    const u = 0.02 + Math.random() * 0.96;
    spins.push({ u, v: bostonAt(u) });
    if (!animate) return;
    const reel = d3.select(reelEl).select(".reel-value");
    const ticks = 14;
    d3.range(ticks).forEach((n) => setTimeout(() => {
      const shown = n === ticks - 1 ? u : Math.random();
      reel.text(MODES[mode].fmt(bostonAt(shown))).classed("settled", n === ticks - 1);
      if (n === ticks - 1) {
        d3.select(reelEl).select(".reel-sub").text(`A ${ordinal(Math.round(u * 100))}-percentile future`);
        current = u;
        drawMap();
        tally();
      }
    }, n * n * 4));
  }

  function reset() {
    spins = [];
    current = 0.5;
    d3.select(reelEl).html(`<div class="reel-label">Boston, ${fmtTime(m.validTimes[t])}</div>
      <div class="reel-value">?</div><div class="reel-sub">Press spin to visit one possible future</div>`);
    drawMap();
    tally();
  }

  let tallyRender;
  function tally() { tallyRender?.(); }
  tallyRender = responsive(tallyEl, (width) => {
    d3.select(tallyEl).selectAll(".tally-title").remove();
    const title = d3.select(tallyEl).insert("div", ":first-child").attr("class", "tally-title");
    const { g, w, h } = frame(tallyEl, width, 160, { top: 12, right: 12, bottom: 26, left: 12 });
    const yes = mode === "temp" ? spins.filter((s) => s.v > threshold).length : spins.filter((s) => s.v >= threshold).length;
    const p = trueProb();
    const q = mode === "temp" ? `warmer than ${threshold}°F` : "rain";
    title.html(spins.length
      ? `${yes} of ${spins.length} spins had ${q}: <b>${fmtPct(yes / spins.length)}</b> · the forecast says ${fmtPct(p)}`
      : `Forecast chance of ${q}: ${fmtPct(p)}. Spin to see it emerge.`);
    const [lo, hi] = mode === "temp" ? [bostonAt(0.02) - 1, bostonAt(0.98) + 1] : [0, Math.max(1, bostonAt(0.98))];
    const x = d3.scaleLinear().domain([lo, hi]).range([0, w]);
    const bins = d3.bin().domain(x.domain()).thresholds(24)(spins.map((s) => s.v));
    const r = Math.min(5, (w / 24) / 2.4);
    const color = SERIES()[0];
    bins.forEach((b) => b.forEach((v, n) => g.append("circle").attr("cx", x((b.x0 + b.x1) / 2))
      .attr("cy", h - r - n * (r * 2.1)).attr("r", r)
      .attr("fill", (mode === "temp" ? v > threshold : v >= threshold) ? color : "var(--muted)")));
    g.append("line").attr("class", "threshold").attr("x1", x(threshold)).attr("x2", x(threshold)).attr("y1", -4).attr("y2", h);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6).tickSize(4).tickFormat((d) => (mode === "temp" ? `${d}°` : d)))
      .call((s) => s.select(".domain").remove());
  });

  await load();
  reset();
  onThemeChange(() => { drawMap(); tally(); });
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
