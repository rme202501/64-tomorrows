import { manifest, points } from "../data.js";
import { frame, responsive } from "../chart.js";
import { SERIES, onThemeChange } from "../theme.js";
import { watchSteps, fillValues } from "../scrolly.js";

// Solution: for each town, how many days ahead the forecast stays
// inside the 7 °F trust limit (the same limit the trust-horizon map uses).

const LIMIT_C = 7 * 5 / 9;
const COAST = ["Boston", "Cape Cod", "Providence", "Portland ME"];
const INLAND = ["Worcester", "Springfield", "Pittsfield", "Hartford", "Concord NH", "Mt Washington", "Burlington VT"];

const STATES = [
  { hi: [] },
  { hi: ["Mt Washington"] },
  { hi: ["Cape Cod"] },
  { hi: COAST },
];

export default async function scrollyHorizon(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const chartEl = el.querySelector(".chart");
  const towns = Object.keys(pts);
  const maxH = m.leads_h[m.leads_h.length - 1];

  // First lead time whose 10-90 gap exceeds the limit. Null = never does.
  const horizon = new Map(towns.map((t) => {
    const k = pts[t].t2m_p90.findIndex((hi, i) => hi - pts[t].t2m_p10[i] > LIMIT_C);
    return [t, k < 0 ? null : m.leads_h[k]];
  }));
  const days = (t) => (horizon.get(t) ?? maxH) / 24;
  const sorted = [...towns].sort((a, b) => days(a) - days(b));
  const mean = (group) => d3.mean(group, (t) => days(t));

  fillValues(el, {
    "hz-short": sorted[0],
    "hz-short-days": days(sorted[0]).toFixed(1),
    "hz-long": sorted[sorted.length - 1],
    "hz-long-days": days(sorted[sorted.length - 1]).toFixed(1),
    "hz-coast": mean(COAST).toFixed(1),
    "hz-inland": mean(INLAND).toFixed(1),
  });

  let state = STATES[0];

  function render(width) {
    const rowH = width < 520 ? 24 : 28;
    const top = 8;
    const left = width < 520 ? 110 : 130;
    const { g, w, h } = frame(chartEl, width, top + rowH * sorted.length + 26,
      { top, right: 52, bottom: 26, left });
    const x = d3.scaleLinear().domain([0, maxH / 24]).range([0, w]);
    const y = d3.scaleBand().domain(sorted).range([0, h]).padding(0.28);
    const color = SERIES()[0];
    const hi = new Set(state.hi);
    const dim = state.hi.length > 0;

    g.append("g").attr("class", "grid").selectAll("line").data(d3.range(0, maxH / 24 + 0.01, 1)).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", h);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(7).tickSize(4).tickFormat((d) => `${d} d`))
      .call((s) => s.select(".domain").remove());

    sorted.forEach((t) => {
      const on = !dim || hi.has(t);
      const d = days(t);
      const capped = horizon.get(t) == null;
      g.append("rect").attr("class", "fade-in").attr("x", 0).attr("y", y(t)).attr("width", x(d))
        .attr("height", y.bandwidth()).attr("fill", color).attr("opacity", on ? 0.85 : 0.18);
      g.append("text").attr("x", -8).attr("y", y(t) + y.bandwidth() / 2 + 4).attr("text-anchor", "end")
        .attr("font-size", 12).attr("fill", on ? "var(--text-primary)" : "var(--muted)").text(t);
      g.append("text").attr("x", x(d) + 6).attr("y", y(t) + y.bandwidth() / 2 + 4)
        .attr("font-size", 12).attr("fill", on ? "var(--text-primary)" : "var(--muted)")
        .text(`${capped ? "> " : ""}${d.toFixed(1)} d`);
    });
  }

  const draw = responsive(chartEl, render);
  onThemeChange(draw);
  watchSteps(el, (i) => {
    state = STATES[i];
    draw();
  });
}
