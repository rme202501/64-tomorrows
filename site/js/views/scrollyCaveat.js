import { manifest, points } from "../data.js";
import { frame, responsive } from "../chart.js";
import { SERIES, onThemeChange } from "../theme.js";
import { watchSteps, fillValues } from "../scrolly.js";

// Act 3 (main message): the single number hides a day-by-day caveat.
// Bars show how far apart the 64 forecasts were on each local day; the dashed
// line is the 7 °F trust limit the trust-horizon map already uses.

const LIMIT_F = 7;
const LOCAL_OFFSET_MS = -4 * 3600e3; // EDT

export default async function scrollyCaveat(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const chartEl = el.querySelector(".chart");
  const towns = Object.keys(pts);

  // Bucket every (town, lead) gap by its local calendar day.
  const dayKey = (t) => d3.utcDay.floor(new Date(t.getTime() + LOCAL_OFFSET_MS));
  const buckets = new Map();
  m.validTimes.forEach((t, k) => {
    const key = +dayKey(t);
    if (!buckets.has(key)) buckets.set(key, []);
    towns.forEach((town) => {
      const gap = (pts[town].t2m_p90[k] - pts[town].t2m_p10[k]) * 9 / 5;
      buckets.get(key).push(gap);
    });
  });
  // Thu 8 Oct through Wed 14 Oct (Wed 14 covers the hours up to 8 AM only).
  const FIRST_DAY = +new Date(Date.UTC(2026, 9, 8));
  const days = [...buckets.entries()]
    .filter(([key]) => key >= FIRST_DAY)
    .sort(([a], [b]) => a - b)
    .map(([key, gaps]) => ({
      day: new Date(key),
      mean: d3.mean(gaps),
      max: d3.max(gaps),
      over: gaps.filter((v) => v > LIMIT_F).length / gaps.length,
    }));

  // Steps highlight a run of days. -1 means no highlight.
  const STATES = [
    { from: -1, to: -1 },
    { from: 0, to: 2 },
    { from: 3, to: 4 },
    { from: 5, to: 6 },
  ];
  let state = STATES[0];

  const f = d3.utcFormat("%a %-d");
  fillValues(el, {
    "cav-agree-max": Math.round(d3.max(days.slice(0, 3), (d) => d.max)),
    "cav-day-over": Math.round(days[4].over * 100),
    "cav-end-over": Math.round(days[6].over * 100),
    "cav-end-mean": Math.round(days[6].mean),
  });

  function render(width) {
    const { g, w, h } = frame(chartEl, width, width < 520 ? 260 : 300,
      { top: 26, right: 16, bottom: 30, left: 44 });
    const x = d3.scaleBand().domain(days.map((d) => +d.day)).range([0, w]).padding(0.28);
    const y = d3.scaleLinear().domain([0, Math.max(LIMIT_F + 2, d3.max(days, (d) => d.max)) * 1.05]).nice().range([h, 0]);
    const color = SERIES()[0];
    const alert = SERIES()[1];

    g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)
      .tickFormat((d) => `${d}°`)).call((s) => s.select(".domain").remove());
    g.append("text").attr("class", "axis-label").attr("x", -8).attr("y", -12).text("°F gap");

    const inRun = (i) => i >= state.from && i <= state.to;
    days.forEach((d, i) => {
      const bx = x(+d.day);
      const bw = x.bandwidth();
      const on = state.from < 0 || inRun(i);
      const flagged = d.over > 0;
      const col = flagged ? alert : color;
      g.append("line").attr("class", "fade-in").attr("x1", bx + bw / 2).attr("x2", bx + bw / 2)
        .attr("y1", y(d.max)).attr("y2", y(d.mean)).attr("stroke", col).attr("stroke-width", 1.5)
        .attr("opacity", on ? 1 : 0.25);
      g.append("rect").attr("class", "fade-in").attr("x", bx).attr("y", y(d.mean)).attr("width", bw)
        .attr("height", h - y(d.mean)).attr("fill", col).attr("opacity", on ? 0.85 : 0.2);
      g.append("text").attr("x", bx + bw / 2).attr("y", h + 18).attr("text-anchor", "middle")
        .attr("font-size", 11).attr("fill", "var(--text-secondary)").text(f(d.day));
      if (state.from >= 0 && on) {
        g.append("text").attr("class", "fade-in").attr("x", bx + bw / 2).attr("y", y(d.max) - 6)
          .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "var(--text-primary)")
          .text(d.over > 0 ? `${Math.round(d.over * 100)}%` : "");
      }
    });

    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(LIMIT_F)).attr("y2", y(LIMIT_F))
      .attr("stroke", "var(--muted)").attr("stroke-dasharray", "5 4");
    g.append("text").attr("x", 4).attr("y", y(LIMIT_F) - 6).attr("text-anchor", "start")
      .attr("font-size", 11).attr("fill", "var(--muted)").text("7 °F trust limit");
  }

  const draw = responsive(chartEl, render);
  onThemeChange(draw);
  watchSteps(el, (i) => {
    state = STATES[i];
    draw();
  });
}
