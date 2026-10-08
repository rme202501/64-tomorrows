import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis, crosshair, townSelect } from "../chart.js";
import { cToF, fmtTime, tooltip, SERIES, onThemeChange } from "../theme.js";

const HOURS = 48;

export default async function tempSpread(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const controls = el.querySelector(".controls");
  const chartEl = el.querySelector(".chart");
  let town = "Boston";
  const tip = tooltip();
  const n = m.leads_h.filter((h) => h <= HOURS).length;
  const times = m.validTimes.slice(0, n);

  townSelect(controls, Object.keys(pts), town, (v) => { town = v; redraw(); });

  function render(width) {
    const p = pts[town];
    const s = (k) => p[`t2m_${k}`].slice(0, n).map(cToF);
    const q = { p10: s("p10"), p25: s("p25"), p50: s("p50"), p75: s("p75"), p90: s("p90") };
    const { g, w, h } = frame(chartEl, width, 320, { top: 28, right: width < 520 ? 16 : 104, bottom: 28, left: 44 });
    const x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    const y = d3.scaleLinear().domain([d3.min(q.p10) - 3, d3.max(q.p90) + 3]).nice().range([h, 0]);
    const color = SERIES()[1];

    yAxis(g, y, w, { format: (d) => `${d}°`, label: "°F" });
    timeAxis(g, x, h, w);

    const band = (lo, hi) => d3.area().x((_, i) => x(times[i])).y0((_, i) => y(lo[i]))
      .y1((_, i) => y(hi[i])).curve(d3.curveMonotoneX)(times);
    g.append("path").attr("d", band(q.p10, q.p90)).attr("fill", color).attr("opacity", 0.18);
    g.append("path").attr("d", band(q.p25, q.p75)).attr("fill", color).attr("opacity", 0.3);
    g.append("path").attr("class", "line").attr("stroke", color)
      .attr("d", d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX)(q.p50));

    const last = n - 1;
    const labels = [["1 in 10 warmer", q.p90[last]], ["most likely", q.p50[last]], ["1 in 10 colder", q.p10[last]]];
    const ys = labels.map(([, v]) => y(v));
    ys[0] = Math.min(ys[0], ys[1] - 15);
    ys[2] = Math.max(ys[2], ys[1] + 15);
    if (width >= 520) {
      g.append("g").attr("class", "direct-labels").selectAll("text").data(labels).join("text")
        .attr("x", w + 8).attr("y", (_, i) => ys[i] + 4).text((d) => d[0]);
    }

    const dot = g.append("circle").attr("r", 4.5).attr("class", "hover-dot").style("opacity", 0)
      .attr("fill", color);
    crosshair(g, x, w, h, times, (k, e) => {
      dot.attr("cx", x(times[k])).attr("cy", y(q.p50[k])).style("opacity", 1);
      tip.show(`<b>${fmtTime(times[k])}</b><br>Most likely <b>${Math.round(q.p50[k])}°F</b><br>
        8 in 10 chance: ${Math.round(q.p10[k])}° to ${Math.round(q.p90[k])}°<br>
        Half of forecasts: ${Math.round(q.p25[k])}° to ${Math.round(q.p75[k])}°`, e.clientX, e.clientY);
    }, () => { dot.style("opacity", 0); tip.hide(); });
  }

  const redraw = responsive(chartEl, render);
  onThemeChange(redraw);
}
