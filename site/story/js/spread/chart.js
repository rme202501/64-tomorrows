import { smoothstep } from "../util.js";

/**
 * Self-drawing spread chart: min-max line, p10-p90 band, playhead and day annotations.
 * draw(lead) reveals everything up to `lead` hours; it is pure in `lead`, so scrubbing is exact.
 */
export function createSpreadChart(host, data) {
  const days = data.leads.map((h) => h / 24);
  const minMax = data.spread.t2m_min_max;
  const band = data.spread.t2m_p10_p90;
  const lastDay = data.maxLead / 24;
  const yMax = Math.max(8, d3.max(minMax) * 1.12);

  const annDays = (host.clientWidth < 520 ? [3, 7] : [1, 3, 7]).filter((d) => d <= lastDay - 0.9);
  annDays.push(lastDay);

  const svg = d3.select(host).append("svg").attr("class", "sp-chart-svg").attr("role", "img")
    .attr("aria-label", "Spread between the coldest and warmest forecast, by days ahead");
  const defs = svg.append("defs");
  const uid = `sp${Math.random().toString(36).slice(2, 7)}`;

  const grad = defs.append("linearGradient").attr("id", `${uid}-line`).attr("gradientUnits", "userSpaceOnUse");
  const stops = [["0%", "#6fc3ff"], ["45%", "#ffb547"], ["100%", "#ff6b4a"]];
  stops.forEach(([o, c]) => grad.append("stop").attr("offset", o).attr("stop-color", c));

  const fillGrad = defs.append("linearGradient").attr("id", `${uid}-fill`).attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
  fillGrad.append("stop").attr("offset", "0%").attr("stop-color", "#ffb547").attr("stop-opacity", 0.22);
  fillGrad.append("stop").attr("offset", "100%").attr("stop-color", "#ffb547").attr("stop-opacity", 0);

  const glow = defs.append("filter").attr("id", `${uid}-glow`).attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("stdDeviation", 4);

  const clipRect = defs.append("clipPath").attr("id", `${uid}-clip`).append("rect");

  const root = svg.append("g");
  const grid = root.append("g").attr("class", "sp-grid");
  const xAxis = root.append("g").attr("class", "sp-axis sp-axis-x");
  const plot = root.append("g").attr("clip-path", `url(#${uid}-clip)`);
  const bandPath = plot.append("path").attr("class", "sp-band");
  const fillPath = plot.append("path").attr("class", "sp-fill").attr("fill", `url(#${uid}-fill)`);
  const glowPath = plot.append("path").attr("class", "sp-line-glow").attr("stroke", `url(#${uid}-line)`).attr("filter", `url(#${uid}-glow)`);
  const linePath = plot.append("path").attr("class", "sp-line").attr("stroke", `url(#${uid}-line)`);

  const ann = root.append("g").attr("class", "sp-anns").selectAll("g").data(annDays).join("g").attr("class", "sp-ann");
  ann.append("line").attr("class", "sp-ann-stem");
  ann.append("circle").attr("class", "sp-ann-dot").attr("r", 4);
  const annText = ann.append("text").attr("class", "sp-ann-label").attr("text-anchor", "middle");
  annText.append("tspan").attr("class", "sp-ann-day");
  annText.append("tspan").attr("class", "sp-ann-val");

  const head = root.append("g").attr("class", "sp-head");
  const headRule = head.append("line").attr("class", "sp-head-rule");
  const headHalo = head.append("circle").attr("class", "sp-head-halo").attr("r", 14);
  const headDot = head.append("circle").attr("class", "sp-head-dot").attr("r", 5);
  const lineLabel = root.append("text").attr("class", "sp-label sp-label-line").text("coldest to warmest");
  const bandLabel = root.append("text").attr("class", "sp-label sp-label-band").text("middle 80%");

  const x = d3.scaleLinear().domain([0, lastDay]);
  const y = d3.scaleLinear().domain([0, yMax]);
  let w = 0;
  let h = 0;
  let lineLabelW = 120;
  let bandLabelW = 70;
  const m = { t: 34, r: 18, b: 30, l: 40 };

  const valAt = (arr, lead) => data.at(arr, lead);

  function layout() {
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const mobile = box.width < 560;
    m.l = mobile ? 34 : 44;
    m.r = mobile ? 12 : 22;
    m.t = mobile ? 26 : 30;
    w = box.width - m.l - m.r;
    h = box.height - m.t - m.b;
    svg.attr("width", box.width).attr("height", box.height);
    root.attr("transform", `translate(${m.l},${m.t})`);
    x.range([0, w]);
    y.range([h, 0]);
    grad.attr("x1", 0).attr("x2", w).attr("y1", 0).attr("y2", 0);
    clipRect.attr("y", -m.t).attr("height", h + m.t + 2);

    const yTicks = y.ticks(mobile ? 3 : 4).filter((v) => v > 0);
    grid.selectAll("g").data(yTicks).join((en) => {
      const g = en.append("g");
      g.append("line");
      g.append("text").attr("text-anchor", "end").attr("dy", "0.32em");
      return g;
    }).attr("transform", (v) => `translate(0,${y(v)})`)
      .call((g) => g.select("line").attr("x1", 0).attr("x2", w))
      .call((g) => g.select("text").attr("x", -10).text((v) => `${v}°`));

    const step = lastDay > 9 ? (mobile ? 3 : 2) : 1;
    const all = d3.range(0, Math.floor(lastDay) + 1, step);
    const end = all[all.length - 1];
    const xTicks = all.filter((d) => d === end || x(end) - x(d) > (mobile ? 104 : 84));
    xAxis.attr("transform", `translate(0,${h})`);
    xAxis.selectAll("line.base").data([0]).join("line").attr("class", "base").attr("x1", 0).attr("x2", w);
    const lastTick = xTicks[xTicks.length - 1];
    xAxis.selectAll("text").data(xTicks).join("text").attr("x", (d) => x(d)).attr("y", 20)
      .attr("text-anchor", (d) => (d === 0 ? "start" : d === lastTick && x(d) > w - 30 ? "end" : "middle"))
      .text((d) => (d === 0 ? "now" : d === lastTick ? `${d} days out` : d));

    const pts = days.map((d, k) => [d, minMax[k], band[k]]);
    const curve = d3.curveMonotoneX;
    linePath.attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(curve)(pts));
    glowPath.attr("d", linePath.attr("d"));
    fillPath.attr("d", d3.area().x((p) => x(p[0])).y0(h).y1((p) => y(p[1])).curve(curve)(pts));
    bandPath.attr("d", d3.area().x((p) => x(p[0])).y0(h).y1((p) => y(p[2])).curve(curve)(pts));

    ann.each(function (d) {
      const g = d3.select(this);
      const lead = Math.min(d * 24, data.maxLead);
      const v = valAt(minMax, lead);
      const px = x(d);
      const py = y(v);
      const last = d === lastDay;
      const ty = Math.max(-m.t + 14, py - 20);
      g.attr("transform", `translate(${px},0)`);
      g.select(".sp-ann-dot").attr("cy", py);
      g.select(".sp-ann-stem").attr("y1", py).attr("y2", h);
      g.select("text").attr("y", ty).attr("text-anchor", last ? "end" : "middle").attr("x", last ? -8 : 0);
      g.select(".sp-ann-day").text(d === lastDay ? `Day ${Math.round(d)}  ` : `Day ${d}  `);
      g.select(".sp-ann-val").text(`${Math.round(v)}°`);
    });
    lineLabelW = lineLabel.node().getComputedTextLength() || lineLabelW;
    bandLabelW = bandLabel.node().getComputedTextLength() || bandLabelW;
  }

  function draw(lead) {
    if (!w) layout();
    if (!w) return;
    const d = lead / 24;
    const px = x(d);
    clipRect.attr("x", -2).attr("width", Math.max(0, px + 2));
    const vLine = valAt(minMax, lead);
    const vBand = valAt(band, lead);
    const py = y(vLine);
    head.attr("transform", `translate(${px},0)`);
    headDot.attr("cy", py);
    headHalo.attr("cy", py);
    headRule.attr("y1", py).attr("y2", h);

    const flip = smoothstep(w * 0.55, w * 0.85, px);
    const lx = px + 14 - flip * (lineLabelW + 28);
    const bx = px + 14 - flip * (bandLabelW + 28);
    const byRaw = Math.min(h - 8, y(vBand) + 16);
    const d0 = x.invert(lx - 4);
    const d1 = x.invert(lx + lineLabelW + 4);
    let peak = vLine;
    for (let k = 0; k < days.length; k++) if (days[k] >= d0 && days[k] <= Math.min(d1, d)) peak = Math.max(peak, minMax[k]);
    const ly = Math.min(py - 12, y(peak) - 10, byRaw - 20);
    const annGap = Math.min(...annDays.filter((a) => a < lastDay && a <= d).map((a) => d - a), Infinity);
    const clearOfAnn = smoothstep(0.35, 0.8, annGap);
    lineLabel.attr("opacity", clearOfAnn * (1 - smoothstep(lastDay - 0.35, lastDay - 0.05, d))).attr("x", lx).attr("y", Math.max(-m.t + 12, ly));
    bandLabel.attr("x", bx).attr("y", Math.max(byRaw, Math.max(-m.t + 12, ly) + 18));

    ann.classed("is-on", (a) => lead >= Math.min(a * 24, data.maxLead) - 0.5);
  }

  return { layout, draw };
}
