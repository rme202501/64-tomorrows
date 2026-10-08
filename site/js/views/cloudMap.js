import { manifest, points, field } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { frame, responsive, timeAxis, yAxis } from "../chart.js";
import { fmtTime, isDark, SERIES, onThemeChange } from "../theme.js";

export default async function cloudMap(el) {
  const m = await manifest();
  const [pts, cloud, cloudP10, cloudP90] = await Promise.all([
    points(), field("cloud_mean"), field("cloud_p10"), field("cloud_p90")]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const insetEl = el.querySelector(".inset");
  const hourly = m.leads_h.filter((h) => h <= 48).length;
  let t = 0;
  let timer = null;
  let showDisagreement = false;

  const play = d3.select(controls).append("button").attr("class", "btn").text("Play")
    .on("click", () => (timer ? stop() : start()));
  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  const input = slider.append("input").attr("type", "range").attr("min", 0).attr("max", hourly - 1)
    .attr("value", t).on("input", (e) => { stop(); t = +e.target.value; draw(); });
  const toggle = d3.select(controls).append("label").attr("class", "control check");
  toggle.append("input").attr("type", "checkbox").on("change", (e) => { showDisagreement = e.target.checked; draw(); });
  toggle.append("span").text("Show where forecasts disagree");

  function start() {
    play.text("Pause");
    timer = d3.interval(() => { t = (t + 1) % hourly; input.property("value", t); draw(); }, 260);
  }
  function stop() {
    play.text("Play");
    timer?.stop();
    timer = null;
  }

  const map = await createMap(mapEl, { onDraw: () => draw() });
  const skyColor = () => (isDark()
    ? d3.scaleLinear().domain([0, 0.5, 1]).range(["#0d366b", "#4b5d78", "#d9d8d2"]).interpolate(d3.interpolateLab)
    : d3.scaleLinear().domain([0, 0.5, 1]).range(["#5598e7", "#b8c8dc", "#fcfcfb"]).interpolate(d3.interpolateLab));

  function draw() {
    if (!map.projection) return;
    timeText.text(fmtTime(m.validTimes[t]));
    const c = skyColor();
    const values = cloud.frame(t);
    const lo = cloudP10.frame(t);
    const hi = cloudP90.frame(t);
    map.drawGrid(m, values, c, showDisagreement ? { alpha: (k) => 1 - 0.75 * Math.min(1, hi[k] - lo[k]) } : {});
    legendRamp(legendEl, c, [0, 1], { label: "Cloud cover", format: d3.format(".0%"), ticks: 4 });
    map.addTowns(pts, ["Boston", "Pittsfield", "Cape Cod", "Portland ME", "Burlington VT"]);
    inset();
  }

  let insetRender;
  function inset() { insetRender?.(); }
  insetRender = responsive(insetEl, (width) => {
    const p = pts.Boston;
    const times = m.validTimes.slice(0, hourly);
    const { g, w, h } = frame(insetEl, width, 150, { top: 22, right: 10, bottom: 24, left: 40 });
    const x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    const y = d3.scaleLinear().domain([0, Math.max(800, d3.max(p.solar_mean.slice(0, hourly)))]).range([h, 0]);
    yAxis(g, y, w, { ticks: 3, label: "Sunshine at Boston (W/m²)" });
    timeAxis(g, x, h, w);
    g.append("path").attr("fill", SERIES()[3]).attr("opacity", 0.85)
      .attr("d", d3.area().x((_, i) => x(times[i])).y0(h).y1((d) => y(d)).curve(d3.curveMonotoneX)(p.solar_mean.slice(0, hourly)));
    g.append("line").attr("class", "crosshair").attr("x1", x(times[t])).attr("x2", x(times[t]))
      .attr("y1", 0).attr("y2", h).style("opacity", 1);
  });

  draw();
  onThemeChange(draw);
}
