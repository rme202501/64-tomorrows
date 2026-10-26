import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis } from "../chart.js";
import { cToF, fmtTime, SERIES, onThemeChange } from "../theme.js";
import { watchSteps, fillValues } from "../scrolly.js";

// Act 1 (hook): one app-style number, then the fan it was picked from.
// Each scroll step changes what the chart reveals.

const TOWN = "Boston";
const ANSWERS = [
  { key: "p10", label: "1 in 10 colder" },
  { key: "p50", label: "Most likely" },
  { key: "p90", label: "1 in 10 warmer" },
];

export default async function scrollyHook(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const chartEl = el.querySelector(".chart");
  const cardEl = el.querySelector(".app-card");
  const times = m.validTimes;
  const at = (h) => m.leads_h.indexOf(h);
  const K_DAY = at(24);
  const K_WEEK = at(150);
  const value = (key, k) => cToF(pts[TOWN][`t2m_${key}`][k]);
  const gapF = (k) => (pts[TOWN].t2m_p90[k] - pts[TOWN].t2m_p10[k]) * 9 / 5;

  // Per-step state. edges = show the far-end answers; bands = show the fan.
  const STATES = [
    { k: K_DAY, bands: false, edges: false },
    { k: K_DAY, bands: true, edges: false },
    { k: K_DAY, bands: true, edges: true },
    { k: K_WEEK, bands: true, edges: true },
  ];
  let state = STATES[0];

  fillValues(el, {
    "hook-gap-day": Math.round(gapF(K_DAY)),
    "hook-gap-week": Math.round(gapF(K_WEEK)),
    "hook-day": fmtTime(times[K_DAY]),
    "hook-week": fmtTime(times[K_WEEK]),
  });

  function renderCard() {
    const k = state.k;
    cardEl.querySelector(".app-place").textContent = `${TOWN} · ${fmtTime(times[k])}`;
    cardEl.querySelector(".app-num").textContent = `${Math.round(value("p50", k))}°`;
    cardEl.querySelector(".app-tag").textContent = state.edges
      ? `8 in 10 of the 64 forecasts fall within ${Math.round(gapF(k))}°F of each other at this hour.`
      : "The one number a typical weather app shows.";
    cardEl.querySelector(".app-chips").innerHTML = state.edges
      ? ANSWERS.map((a) => `<span class="${a.key === "p50" ? "on" : ""}">${a.label}<b>${Math.round(value(a.key, k))}°</b></span>`).join("")
      : "";
  }

  function render(width) {
    const p = pts[TOWN];
    const s = (key) => p[`t2m_${key}`].map(cToF);
    const q = { p10: s("p10"), p25: s("p25"), p50: s("p50"), p75: s("p75"), p90: s("p90") };
    const { g, w, h } = frame(chartEl, width, width < 520 ? 240 : 300,
      { top: 30, right: 16, bottom: 28, left: 44 });
    const x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    const y = d3.scaleLinear().domain([d3.min(q.p10) - 2, d3.max(q.p90) + 2]).nice().range([h, 0]);
    const color = SERIES()[0];

    yAxis(g, y, w, { format: (d) => `${d}°`, label: "°F" });
    timeAxis(g, x, h, w);

    const line = d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX);
    const band = (lo, hi) => d3.area().x((_, i) => x(times[i])).y0((_, i) => y(lo[i]))
      .y1((_, i) => y(hi[i])).curve(d3.curveMonotoneX)(times);

    if (state.bands) {
      g.append("path").attr("class", "fade-in").attr("d", band(q.p10, q.p90)).attr("fill", color).attr("opacity", 0.16);
      g.append("path").attr("class", "fade-in").attr("d", band(q.p25, q.p75)).attr("fill", color).attr("opacity", 0.28);
    }
    if (state.edges) {
      [q.p10, q.p90].forEach((d) => g.append("path").attr("class", "line fade-in").attr("stroke", color)
        .attr("stroke-dasharray", "4 4").attr("d", line(d)));
    }
    g.append("path").attr("class", "line").attr("stroke", color).attr("d", line(q.p50));

    const k = state.k;
    const mx = x(times[k]);
    g.append("line").attr("class", "crosshair").attr("x1", mx).attr("x2", mx).attr("y1", 0).attr("y2", h)
      .style("opacity", 1);
    if (state.edges) {
      g.append("g").selectAll("circle").data(ANSWERS).join("circle").attr("r", 5).attr("class", "fan-dot")
        .attr("cx", mx).attr("cy", (d) => y(q[d.key][k])).attr("fill", color);
    }
  }

  const draw = responsive(chartEl, render);
  renderCard();
  onThemeChange(draw);

  watchSteps(el, (i) => {
    state = STATES[i];
    renderCard();
    draw();
  });
}
