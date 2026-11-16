import { manifest, points } from "../data.js";
import {
  frame, responsive, timeAxis, yAxis, updateTimeAxis, updateYAxis, crosshair, stepTransition,
} from "../chart.js";
import { SERIES, fmtTime, onThemeChange, tooltip } from "../theme.js";
import { watchSteps, fillValues } from "../scrolly.js";

// Rising insights: how far apart the forecasts spread, and how that
// changes with lead time, place, variable and a sudden jump.

const PLACES = ["Boston", "Pittsfield", "Cape Cod", "Mt Washington"];
const METRICS = {
  t2m: { label: "Temperature", unit: "°F", conv: (d) => d * 9 / 5 },
  wind: { label: "Wind", unit: "mph", conv: (d) => d * 2.237 },
};

// Each step: which places, which metric, how far ahead, and whether to call
// out the Tue 13 jump (leads 144 h to 150 h).
const STATES = [
  { places: ["Boston"], metric: "t2m", maxH: 48, jump: false },
  { places: ["Boston"], metric: "t2m", maxH: 168, jump: false },
  { places: PLACES, metric: "t2m", maxH: 168, jump: false },
  { places: ["Boston"], metric: "t2m", maxH: 168, jump: true },
  { places: PLACES, metric: "wind", maxH: 168, jump: false },
];

export default async function scrollyGrowth(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const chartEl = el.querySelector(".chart");
  const legendEl = el.querySelector(".legend");
  const times = m.validTimes;
  const at = (h) => m.leads_h.indexOf(h);
  let state = STATES[0];
  const tip = tooltip();

  const gap = (town, metric, k) => {
    const M = METRICS[metric];
    return M.conv(pts[town][`${metric}_p90`][k] - pts[town][`${metric}_p10`][k]);
  };
  fillValues(el, {
    "growth-day": Math.round(gap("Boston", "t2m", at(24))),
    "growth-week": Math.round(gap("Boston", "t2m", at(168))),
    "growth-jump-from": Math.round(gap("Boston", "t2m", at(144))),
    "growth-jump-to": Math.round(gap("Boston", "t2m", at(150))),
    "growth-mt": Math.round(gap("Mt Washington", "t2m", at(144))),
    "growth-cape": Math.round(gap("Cape Cod", "t2m", at(144))),
  });

  // render() builds the chart for a width; update() moves it to the current
  // step. Lines always hold all 168 h and are clipped to the plot, so changing
  // how far ahead we look stretches them instead of redrawing.
  let marks;

  function setDomains(x, y) {
    const n = m.leads_h.filter((hh) => hh <= state.maxH).length;
    const max = d3.max(state.places, (town) => d3.max(d3.range(n), (k) => gap(town, state.metric, k)));
    x.domain([times[0], times[n - 1]]);
    y.domain([0, max * 1.1]).nice();
    return n;
  }

  function render(width) {
    const { g, w, h } = frame(chartEl, width, width < 520 ? 260 : 320,
      { top: 30, right: width >= 520 ? 110 : 16, bottom: 28, left: 44 });
    const x = d3.scaleTime().range([0, w]);
    const y = d3.scaleLinear().range([h, 0]);
    setDomains(x, y);
    const yAxes = yAxis(g, y, w, { label: "Gap" });
    const xAxes = timeAxis(g, x, h, w);

    g.append("clipPath").attr("id", "growth-clip").append("rect").attr("width", w).attr("height", h);
    const plot = g.append("g").attr("clip-path", "url(#growth-clip)");
    const jump = plot.append("g").style("opacity", 0);
    jump.append("rect").attr("y", 0).attr("height", h).attr("fill", "#eb6834").attr("opacity", 0.22);
    jump.append("text").attr("y", 14).attr("text-anchor", "end").attr("font-size", 12)
      .attr("fill", "var(--text-primary)")
      .text(`Tue 13, ${fmtTime(times[at(144)]).replace("Tue ", "")} → ${fmtTime(times[at(150)]).replace("Tue ", "")}`);
    const lines = plot.append("g");
    const labels = width >= 520 ? g.append("g").attr("class", "direct-labels") : null;
    const hoverDots = g.append("g");

    crosshair(g, x, w, h, times, (k, e) => {
      const { series } = marks;
      const M = METRICS[state.metric];
      hoverDots.selectAll("circle").data(series, (d) => d.town).join("circle").attr("r", 4)
        .attr("class", "hover-dot").attr("fill", (d) => d.color)
        .attr("cx", x(times[k])).attr("cy", (d) => y(d.values[k])).style("opacity", 1);
      const rows = [...series].sort((a, b) => b.values[k] - a.values[k])
        .map((d) => `<span style="color:${d.color}">●</span> ${d.town}: <b>${d.values[k].toFixed(1)} ${M.unit}</b>`);
      tip.show(`<b>${fmtTime(times[k])}</b> · ${m.leads_h[k]} h ahead<br>${rows.join("<br>")}`, e.clientX, e.clientY);
    }, () => {
      hoverDots.selectAll("circle").style("opacity", 0);
      tip.hide();
    });

    marks = { x, y, w, h, xAxes, yAxes, jump, lines, labels };
    update(false);
  }

  function update(animate) {
    if (!marks) return;
    const { x, y, w, h } = marks;
    const t = stepTransition(animate);
    const M = METRICS[state.metric];
    const colors = SERIES();
    const n = setDomains(x, y);
    updateTimeAxis(marks.xAxes, x, h, w, t);
    updateYAxis(marks.yAxes, y, w, {}, t);
    marks.yAxes.label.text(`Gap between 1-in-10 high and low (${M.unit})`);

    const series = state.places.map((town) => ({
      town,
      color: colors[PLACES.indexOf(town)],
      values: times.map((_, k) => gap(town, state.metric, k)),
    }));
    marks.series = series;

    const line = d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX);
    marks.lines.selectAll("path").data(series, (d) => d.town).join(
      (enter) => enter.append("path").attr("class", "line").attr("opacity", 0).attr("d", (d) => line(d.values)),
      (upd) => upd,
      (exit) => exit.transition(t).attr("opacity", 0).remove(),
    ).attr("stroke", (d) => d.color)
      .transition(t).attr("opacity", 1).attr("d", (d) => line(d.values));

    const x1 = x(times[at(144)]);
    const x2 = x(times[at(150)]);
    marks.jump.transition(t).style("opacity", state.jump ? 1 : 0);
    marks.jump.select("rect").transition(t).attr("x", x1).attr("width", x2 - x1);
    marks.jump.select("text").transition(t).attr("x", x1 - 6);

    if (marks.labels) {
      const placed = dodge(series.map((s) => y(s.values[n - 1])), 14);
      marks.labels.selectAll("text").data(series, (d) => d.town).join(
        (enter) => enter.append("text").attr("x", w + 8).attr("y", (_, i) => placed[i] + 4).attr("opacity", 0)
          .text((d) => d.town),
        (upd) => upd,
        (exit) => exit.transition(t).attr("opacity", 0).remove(),
      ).transition(t).attr("y", (_, i) => placed[i] + 4).attr("opacity", 1);
    }

    d3.select(legendEl).selectAll("*").remove();
    if (series.length > 1) {
      d3.select(legendEl).append("div").attr("class", "legend-swatches")
        .selectAll("span").data(series).join("span")
        .html((d) => `<i class="line-swatch" style="background:${d.color}"></i>${d.town}`);
    }
  }

  const draw = responsive(chartEl, render);
  onThemeChange(draw);
  watchSteps(el, (i) => {
    state = STATES[i];
    update(true);
  });
}

function dodge(ys, gap) {
  const order = d3.range(ys.length).sort((a, b) => ys[a] - ys[b]);
  const out = ys.slice();
  for (let n = 1; n < order.length; n++) {
    const prev = out[order[n - 1]];
    if (out[order[n]] - prev < gap) out[order[n]] = prev + gap;
  }
  return out;
}
