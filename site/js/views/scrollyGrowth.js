import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis } from "../chart.js";
import { SERIES, fmtTime, onThemeChange } from "../theme.js";
import { watchSteps, fillValues } from "../scrolly.js";

// Act 2 (rising insights): how far apart the forecasts spread, and how that
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

  function render(width) {
    const M = METRICS[state.metric];
    const colors = SERIES();
    const n = m.leads_h.filter((hh) => hh <= state.maxH).length;
    const ts = times.slice(0, n);
    const series = state.places.map((town, i) => ({
      town,
      color: colors[PLACES.indexOf(town)] ?? colors[i],
      values: Array.from({ length: n }, (_, k) => gap(town, state.metric, k)),
    }));
    const multi = series.length > 1;
    const { g, w, h } = frame(chartEl, width, width < 520 ? 260 : 320,
      { top: 30, right: multi && width >= 520 ? 110 : 16, bottom: 28, left: 44 });
    const x = d3.scaleTime().domain(d3.extent(ts)).range([0, w]);
    const y = d3.scaleLinear().domain([0, d3.max(series, (s) => d3.max(s.values)) * 1.1]).nice().range([h, 0]);
    yAxis(g, y, w, { label: `Gap between 1-in-10 high and low (${M.unit})` });
    timeAxis(g, x, h, w);

    if (state.jump) {
      const x1 = x(times[at(144)]);
      const x2 = x(times[at(150)]);
      g.append("rect").attr("class", "fade-in").attr("x", x1).attr("y", 0).attr("width", x2 - x1)
        .attr("height", h).attr("fill", "#eb6834").attr("opacity", 0.22);
      g.append("text").attr("x", x1 - 6).attr("y", 14).attr("text-anchor", "end")
        .attr("font-size", 12).attr("fill", "var(--text-primary)")
        .text(`Tue 13, ${fmtTime(times[at(144)]).replace("Tue ", "")} → ${fmtTime(times[at(150)]).replace("Tue ", "")}`);
    }

    const line = d3.line().x((_, i) => x(ts[i])).y((d) => y(d)).curve(d3.curveMonotoneX);
    g.selectAll("path.series").data(series).join("path").attr("class", "line series fade-in")
      .attr("stroke", (d) => d.color).attr("d", (d) => line(d.values));

    if (multi && width >= 520) {
      const last = n - 1;
      const ys = series.map((s) => y(s.values[last]));
      const placed = dodge(ys, 14);
      g.append("g").attr("class", "direct-labels").selectAll("text").data(series).join("text")
        .attr("x", w + 8).attr("y", (_, i) => placed[i] + 4).text((d) => d.town);
    }

    d3.select(legendEl).selectAll("*").remove();
    if (multi) {
      d3.select(legendEl).append("div").attr("class", "legend-swatches")
        .selectAll("span").data(series).join("span")
        .html((d) => `<i class="line-swatch" style="background:${d.color}"></i>${d.town}`);
    }
  }

  const draw = responsive(chartEl, render);
  onThemeChange(draw);
  watchSteps(el, (i) => {
    state = STATES[i];
    draw();
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
