import { createMap, legendRamp } from "../map.js";
import { frame, responsive, yAxis, segmented, townSelect } from "../chart.js";
import { cToF, fmtTime, SERIES, tooltip, onThemeChange, isDark } from "../theme.js";

async function loadTM() {
  const d = await d3.json("data/time_machine.json");
  d.runs = d.runs.map((r) => new Date(r));
  d.valid = d.valid_times.map((r) => new Date(r));
  const raw = new Int16Array(await (await fetch("data/fields/tm_t2m_mean.bin")).arrayBuffer());
  const [, nV, nLat, nLon] = d.field.shape;
  const values = Float32Array.from(raw, (r) => r * d.field.scale + d.field.offset);
  d.map = (r, v) => values.subarray((r * nV + v) * nLat * nLon, (r * nV + v + 1) * nLat * nLon);
  d.grid = { lat: d.lat, lon: d.lon, nLat, nLon };
  return d;
}

export default async function timeMachine(el) {
  const d = await loadTM();
  const controls = el.querySelector(".controls");
  const chartEl = el.querySelector(".chart");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const tip = tooltip();
  const last = d.runs.length - 1;
  let v = Math.min(d.valid.length - 1, d.valid.findIndex((t) => t.getUTCHours() === 18) + 8);
  let run = 0;
  let town = "Boston";
  let metric = "t2m";

  townSelect(controls, Object.keys(d.towns), town, (x) => { town = x; redraw(); });
  segmented(controls, [{ label: "Temperature", value: "t2m" }, { label: "Rain", value: "precip" }], metric,
    (x) => { metric = x; redraw(); });
  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  slider.append("input").attr("type", "range").attr("min", 0).attr("max", d.valid.length - 1).attr("value", v)
    .on("input", (e) => { v = +e.target.value; redraw(); drawMap(); });

  function render(width) {
    timeText.html(`Forecasts for <b>${fmtTime(d.valid[v])}</b>`);
    const s = d.towns[town];
    const rows = d.runs.map((r, k) => metric === "t2m"
      ? { k, r, mid: cToF(s.t2m_mean[k][v]), lo: cToF(s.t2m_p10[k][v]), hi: cToF(s.t2m_p90[k][v]) }
      : { k, r, mid: s.precip_mean[k][v], lo: 0, hi: s.precip_p90[k][v] });
    const { g, w, h } = frame(chartEl, width, 280, { top: 28, right: 16, bottom: 40, left: 44 });
    const x = d3.scaleBand().domain(rows.map((r) => r.k)).range([0, w]).padding(0.35);
    const y = d3.scaleLinear().domain([d3.min(rows, (r) => r.lo) - (metric === "t2m" ? 3 : 0), d3.max(rows, (r) => r.hi) * 1.05 + 0.1]).nice().range([h, 0]);
    const color = SERIES()[0];
    yAxis(g, y, w, { label: metric === "t2m" ? "°F" : "Rain (mm/h)", format: (t) => (metric === "t2m" ? `${t}°` : t) });

    const daysAhead = (r) => (d.valid[v] - r) / 864e5;
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((k) => `${daysAhead(d.runs[k]).toFixed(1)}d`))
      .call((a) => a.select(".domain").remove());
    g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 34).attr("text-anchor", "end")
      .text("How far ahead the forecast was made →  (newest on the right)");

    const bar = g.append("g").selectAll("g").data(rows).join("g").attr("class", "tm-run")
      .attr("transform", (r) => `translate(${x(r.k) + x.bandwidth() / 2},0)`)
      .classed("selected", (r) => r.k === run)
      .on("click", (e, r) => { run = r.k; redraw(); drawMap(); })
      .on("pointermove", (e, r) => tip.show(`Made ${fmtTime(r.r)} (${daysAhead(r.r).toFixed(1)} days ahead)<br>
        ${metric === "t2m" ? `Most likely ${Math.round(r.mid)}°F<br>8 in 10: ${Math.round(r.lo)}° to ${Math.round(r.hi)}°`
        : `Average ${r.mid.toFixed(2)} mm/h<br>1 in 10 wettest: ${r.hi.toFixed(2)} mm/h`}<br><i>Click to map it</i>`, e.clientX, e.clientY))
      .on("pointerleave", () => tip.hide());
    bar.append("rect").attr("class", "hit").attr("x", -x.step() / 2).attr("width", x.step()).attr("y", 0).attr("height", h);
    bar.append("rect").attr("x", -Math.min(10, x.bandwidth() / 2)).attr("width", Math.min(20, x.bandwidth()))
      .attr("y", (r) => y(r.hi)).attr("height", (r) => Math.max(2, y(r.lo) - y(r.hi))).attr("rx", 4)
      .attr("fill", color).attr("opacity", 0.3);
    bar.append("circle").attr("cy", (r) => y(r.mid)).attr("r", 5).attr("fill", color);
    g.append("path").attr("class", "line").attr("stroke", color).attr("stroke-opacity", 0.5)
      .attr("d", d3.line().x((r) => x(r.k) + x.bandwidth() / 2).y((r) => y(r.mid))(rows));
  }

  const map = await createMap(mapEl, { onDraw: () => drawMap() });
  function drawMap() {
    if (!map.projection) return;
    const a = d.map(run, v);
    const b = d.map(last, v);
    const diff = Float32Array.from(a, (x, k) => (x - b[k]) * 9 / 5);
    const mid = isDark() ? "#383835" : "#f0efec";
    const color = d3.scaleLinear().domain([-10, -5, 0, 5, 10]).range(["#184f95", "#6da7ec", mid, "#ef8f89", "#b52f2f"])
      .interpolate(d3.interpolateLab).clamp(true);
    map.drawGrid(d.grid, diff, color);
    legendRamp(legendEl, color, [-10, 10], {
      label: run === last ? "Newest run (pick an older bar to compare)" : `Run from ${fmtTime(d.runs[run])} minus newest run (°F)`,
      format: (t) => (t > 0 ? `+${t}°` : `${t}°`),
    });
  }

  const redraw = responsive(chartEl, render);
  drawMap();
  onThemeChange(() => { redraw(); drawMap(); });
}
