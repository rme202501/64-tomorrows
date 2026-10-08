import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis, crosshair, townSelect } from "../chart.js";
import { fmtTime, fmtPct, fmtF, tooltip, SERIES, onThemeChange } from "../theme.js";

const ICE_START = 0.2;
const MELT_C = 2;
const MELT_HOURS = 6;

function iceSpans(times, pFreezing, t2m, leads) {
  const spans = [];
  let start = null;
  let warmSince = null;
  for (let k = 0; k < times.length; k++) {
    if (start == null && pFreezing[k] >= ICE_START) start = k;
    if (start == null) continue;
    if (t2m[k] > MELT_C) {
      warmSince ??= k;
      if (leads[k] - leads[warmSince] >= MELT_HOURS) {
        spans.push([start, k]);
        start = null;
        warmSince = null;
      }
    } else warmSince = null;
  }
  if (start != null) spans.push([start, times.length - 1]);
  return spans;
}

export default async function freezeTimeline(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const controls = el.querySelector(".controls");
  const chartEl = el.querySelector(".chart");
  const noteEl = el.querySelector(".note");
  const tip = tooltip();
  const ranked = Object.keys(pts).sort((a, b) => d3.max(pts[b].p_freezing_precip) - d3.max(pts[a].p_freezing_precip));
  let town = ranked[0];
  const times = m.validTimes;

  townSelect(controls, Object.keys(pts), town, (v) => { town = v; redraw(); });

  function render(width) {
    const p = pts[town];
    const [rainC, iceC] = [SERIES()[0], SERIES()[6]];
    const { g, w, h } = frame(chartEl, width, 260, { top: 28, right: 16, bottom: 28, left: 44 });
    const x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
    const spans = iceSpans(times, p.p_freezing_precip, p.t2m_mean, m.leads_h);
    g.append("defs").append("pattern").attr("id", "ice-hatch").attr("width", 6).attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
      .append("line").attr("y2", 6);

    g.append("g").selectAll("rect").data(spans).join("rect").attr("class", "ice-span")
      .attr("x", (d) => x(times[d[0]])).attr("width", (d) => Math.max(2, x(times[d[1]]) - x(times[d[0]])))
      .attr("y", 0).attr("height", h);
    yAxis(g, y, w, { format: d3.format(".0%"), ticks: 4, label: "Chance" });
    timeAxis(g, x, h, w);

    const area = (vals) => d3.area().x((_, i) => x(times[i])).y0(h).y1((d) => y(d)).curve(d3.curveStepAfter)(vals);
    g.append("path").attr("d", area(p.p_rain)).attr("fill", rainC).attr("opacity", 0.35);
    g.append("path").attr("d", area(p.p_freezing_precip)).attr("fill", iceC).attr("opacity", 0.9);

    const maxIce = d3.max(p.p_freezing_precip);
    d3.select(noteEl).html(maxIce < 0.05
      ? `No meaningful chance of freezing precipitation at <b>${town}</b> this week. The places most at risk are listed first in the menu.`
      : `Peak chance of freezing precipitation at <b>${town}</b>: <b>${fmtPct(maxIce)}</b>. Hatched spans show when ice would likely still be on the ground (from the first ${fmtPct(ICE_START)}+ hour until it stays above ${fmtF(MELT_C)} for ${MELT_HOURS} h).`);

    crosshair(g, x, w, h, times, (k, e) => {
      tip.show(`<b>${fmtTime(times[k])}</b><br>Any precipitation: ${fmtPct(p.p_rain[k])}<br>
        Freezing precipitation: <b>${fmtPct(p.p_freezing_precip[k])}</b><br>Temperature ${fmtF(p.t2m_mean[k])}`, e.clientX, e.clientY);
    }, () => tip.hide());
  }

  const redraw = responsive(chartEl, render);
  onThemeChange(redraw);
}
