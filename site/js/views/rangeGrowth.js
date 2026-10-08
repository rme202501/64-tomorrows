import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis, crosshair, segmented } from "../chart.js";
import { fmtTime, tooltip, SERIES, onThemeChange } from "../theme.js";

const TOWNS = ["Boston", "Pittsfield", "Cape Cod", "Mt Washington"];
const METRICS = {
  t2m: { label: "Temperature", unit: "°F", conv: (d) => d * 9 / 5 },
  wind: { label: "Wind", unit: "mph", conv: (d) => d * 2.237 },
  precip: { label: "Rain rate", unit: "mm/h", conv: (d) => d },
};

export default async function rangeGrowth(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const controls = el.querySelector(".controls");
  const chartEl = el.querySelector(".chart");
  const legendEl = el.querySelector(".legend");
  const tip = tooltip();
  let metric = "t2m";
  const times = m.validTimes;

  segmented(controls, Object.entries(METRICS).map(([value, d]) => ({ label: d.label, value })), metric,
    (v) => { metric = v; redraw(); });

  function render(width) {
    const M = METRICS[metric];
    const colors = SERIES();
    const series = TOWNS.map((t, i) => ({
      town: t, color: colors[i],
      values: pts[t][`${metric}_p90`].map((hi, k) => M.conv(hi - pts[t][`${metric}_p10`][k])),
    }));
    const smooth = (v) => v.map((_, k) => d3.mean(v.slice(Math.max(0, k - 2), k + 3)));
    series.forEach((s) => { s.smooth = smooth(s.values); });

    const { g, w, h } = frame(chartEl, width, 300, { top: 28, right: width < 500 ? 16 : 110, bottom: 28, left: 44 });
    const x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    const y = d3.scaleLinear().domain([0, d3.max(series, (s) => d3.max(s.smooth)) * 1.1]).nice().range([h, 0]);
    yAxis(g, y, w, { label: `Gap between 1-in-10 high and low (${M.unit})` });
    timeAxis(g, x, h, w);

    const line = d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX);
    g.selectAll("path.series").data(series).join("path").attr("class", "line series")
      .attr("stroke", (d) => d.color).attr("d", (d) => line(d.smooth));
    if (width >= 500) {
      const last = times.length - 1;
      const ys = series.map((s) => y(s.smooth[last]));
      const placed = dodge(ys, 14);
      g.append("g").attr("class", "direct-labels").selectAll("text").data(series).join("text")
        .attr("x", w + 8).attr("y", (_, i) => placed[i] + 4).text((d) => d.town);
    }

    d3.select(legendEl).selectAll("*").remove();
    d3.select(legendEl).append("div").attr("class", "legend-swatches")
      .selectAll("span").data(series).join("span")
      .html((d) => `<i class="line-swatch" style="background:${d.color}"></i>${d.town}`);

    const dots = g.append("g").selectAll("circle").data(series).join("circle").attr("r", 4)
      .attr("class", "hover-dot").attr("fill", (d) => d.color).style("opacity", 0);
    crosshair(g, x, w, h, times, (k, e) => {
      dots.attr("cx", x(times[k])).attr("cy", (d) => y(d.smooth[k])).style("opacity", 1);
      tip.show(`<b>${fmtTime(times[k])}</b> (${m.leads_h[k]} h ahead)<br>` + series.map((s) =>
        `<i class="line-swatch" style="background:${s.color}"></i>${s.town}: ${s.values[k].toFixed(1)} ${M.unit}`).join("<br>"),
      e.clientX, e.clientY);
    }, () => { dots.style("opacity", 0); tip.hide(); });
  }

  const redraw = responsive(chartEl, render);
  onThemeChange(redraw);
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
