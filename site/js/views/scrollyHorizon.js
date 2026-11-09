import { manifest, points } from "../data.js";
import { frame, responsive, stepTransition } from "../chart.js";
import { SERIES, fmtTime, onThemeChange, tooltip } from "../theme.js";
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
  const tip = tooltip();

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

  // render() builds the bars for a width; update() highlights towns for the
  // current step, animated when the step changed.
  let marks;

  function render(width) {
    const rowH = width < 520 ? 24 : 28;
    const top = 8;
    const left = width < 520 ? 110 : 130;
    const { g, w, h } = frame(chartEl, width, top + rowH * sorted.length + 26,
      { top, right: 52, bottom: 26, left });
    const x = d3.scaleLinear().domain([0, maxH / 24]).range([0, w]);
    const y = d3.scaleBand().domain(sorted).range([0, h]).padding(0.28);
    const color = SERIES()[0];
    const mid = (t) => y(t) + y.bandwidth() / 2 + 4;

    g.append("g").attr("class", "grid").selectAll("line").data(d3.range(0, maxH / 24 + 0.01, 1)).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", h);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(7).tickSize(4).tickFormat((d) => `${d} d`))
      .call((s) => s.select(".domain").remove());

    const bars = g.append("g").selectAll("rect").data(sorted).join("rect")
      .attr("x", 0).attr("y", (t) => y(t)).attr("width", (t) => x(days(t)))
      .attr("height", y.bandwidth()).attr("fill", color);
    const names = g.append("g").selectAll("text").data(sorted).join("text")
      .attr("x", -8).attr("y", mid).attr("text-anchor", "end").attr("font-size", 12).text((t) => t);
    const values = g.append("g").selectAll("text").data(sorted).join("text")
      .attr("x", (t) => x(days(t)) + 6).attr("y", mid).attr("font-size", 12)
      .text((t) => `${horizon.get(t) == null ? "> " : ""}${days(t).toFixed(1)} d`);

    // Full-width hit area per row, so the label and the empty track are hoverable too.
    g.append("g").selectAll("rect").data(sorted).join("rect")
      .attr("x", -left).attr("y", (t) => y(t) - y.step() * y.paddingInner() / 2)
      .attr("width", w + left).attr("height", y.step()).attr("fill", "transparent")
      .on("pointermove", (e, t) => {
        bars.attr("stroke", (b) => (b === t ? "var(--text-primary)" : null)).attr("stroke-width", 1.5);
        const hz = horizon.get(t);
        const last = pts[t].t2m_p90.length - 1;
        const endGap = (pts[t].t2m_p90[last] - pts[t].t2m_p10[last]) * 9 / 5;
        const until = hz == null
          ? "Stays inside 7°F for the whole week"
          : `Stays inside 7°F until <b>${fmtTime(new Date(+m.init + hz * 3600e3))}</b> (${days(t).toFixed(1)} days)`;
        tip.show(`<b>${t}</b><br>${until}<br>A week out the forecasts are ${Math.round(endGap)}°F apart`,
          e.clientX, e.clientY);
      })
      .on("pointerleave", () => {
        bars.attr("stroke", null);
        tip.hide();
      });

    marks = { bars, names, values };
    update(false);
  }

  function update(animate) {
    if (!marks) return;
    const t = stepTransition(animate);
    const hi = new Set(state.hi);
    const on = (town) => state.hi.length === 0 || hi.has(town);
    marks.bars.transition(t).attr("opacity", (town) => (on(town) ? 0.85 : 0.18));
    marks.names.transition(t).attr("fill", (town) => (on(town) ? "var(--text-primary)" : "var(--muted)"));
    marks.values.transition(t).attr("fill", (town) => (on(town) ? "var(--text-primary)" : "var(--muted)"));
  }

  const draw = responsive(chartEl, render);
  onThemeChange(draw);
  watchSteps(el, (i) => {
    state = STATES[i];
    update(true);
  });
}
