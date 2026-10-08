import { manifest, points, field } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { segmented } from "../chart.js";
import { divergingTemp, cToF, fmtTime, fmtPct, tooltip, STATUS, onThemeChange } from "../theme.js";

// Each rule returns a score: 2 go, 1 marginal, 0 no-go. Inputs: feels-like °F, rain chance, wind mph.
const ACTIVITIES = {
  run: { label: "Run", rule: (f, r, w) => Math.min(f >= 40 && f <= 75 ? 2 : f >= 25 && f <= 85 ? 1 : 0, r < 0.2 ? 2 : r < 0.5 ? 1 : 0, w < 15 ? 2 : w < 25 ? 1 : 0) },
  bike: { label: "Bike", rule: (f, r, w) => Math.min(f >= 50 && f <= 80 ? 2 : f >= 35 && f <= 88 ? 1 : 0, r < 0.15 ? 2 : r < 0.4 ? 1 : 0, w < 12 ? 2 : w < 20 ? 1 : 0) },
  beach: { label: "Beach", rule: (f, r, w) => Math.min(f >= 75 ? 2 : f >= 65 ? 1 : 0, r < 0.15 ? 2 : r < 0.3 ? 1 : 0, w < 15 ? 2 : w < 22 ? 1 : 0) },
  picnic: { label: "Picnic", rule: (f, r, w) => Math.min(f >= 60 && f <= 85 ? 2 : f >= 50 && f <= 90 ? 1 : 0, r < 0.1 ? 2 : r < 0.3 ? 1 : 0, w < 10 ? 2 : w < 18 ? 1 : 0) },
};
const LABELS = ["No-go", "Marginal", "Go"];

export default async function feelsMap(el) {
  const m = await manifest();
  const [pts, feels, rain, wind] = await Promise.all([points(), field("feels_like"), field("p_rain"), field("wind_mean")]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const detailEl = el.querySelector(".detail");
  const tip = tooltip();
  let activity = null;
  let town = "Boston";
  const hourly = m.leads_h.filter((h) => h <= 48).length;
  let t = Math.min(hourly - 1, m.validTimes.findIndex((d) => d.getHours() === 15 && d > m.init));

  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  slider.append("input").attr("type", "range").attr("min", 0).attr("max", hourly - 1).attr("value", t)
    .on("input", (e) => { t = +e.target.value; draw(); });
  segmented(controls, [{ label: "Feels like", value: null },
    ...Object.entries(ACTIVITIES).map(([value, a]) => ({ label: a.label, value }))], null,
  (v) => { activity = v; draw(); });

  const map = await createMap(mapEl, { onDraw: () => draw() });
  const tempColor = () => divergingTemp(20, 55, 90);
  const statusColor = (s) => [STATUS.critical, STATUS.warning, STATUS.good][s];

  function score(k) {
    const f = feels.frame(t)[k];
    return ACTIVITIES[activity].rule(cToF(f), rain.frame(t)[k], wind.frame(t)[k] * 2.237);
  }

  function draw() {
    if (!map.projection) return;
    timeText.text(fmtTime(m.validTimes[t]));
    const f = feels.frame(t);
    if (activity) {
      const vals = Float32Array.from(f, (_, k) => score(k));
      map.drawGrid(m, vals, statusColor);
      d3.select(legendEl).selectAll("*").remove();
      d3.select(legendEl).classed("legend-ramp", false).append("div").attr("class", "legend-swatches")
        .selectAll("span").data([2, 1, 0]).join("span")
        .html((s) => `<i style="background:${statusColor(s)}"></i>${LABELS[s]}`);
    } else {
      const c = tempColor();
      map.drawGrid(m, Float32Array.from(f, cToF), c);
      legendRamp(legendEl, c, [20, 90], { label: "Feels like (°F)", format: (d) => `${d}°` });
    }
    map.addTowns(pts, Object.keys(pts).filter((d) => d !== "New York"), {
      onClick: (d) => { town = d; detail(); },
    }).classed("selected", (d) => d === town);
    detail();
  }

  d3.select(map.svg.node()).on("pointermove", (e) => {
    const [x, y] = d3.pointer(e);
    const c = map.cellAt(m, x, y);
    if (!c) return tip.hide();
    const f = cToF(feels.frame(t)[c.k]);
    const verdict = activity ? `<br>${ACTIVITIES[activity].label}: <b>${LABELS[score(c.k)]}</b>` : "";
    tip.show(`Feels like <b>${Math.round(f)}°F</b><br>Rain chance ${fmtPct(rain.frame(t)[c.k])}<br>
      Wind ${Math.round(wind.frame(t)[c.k] * 2.237)} mph${verdict}`, e.clientX, e.clientY);
  }).on("pointerleave", () => tip.hide());

  function detail() {
    const p = pts[town];
    const start = Math.max(0, t - 6);
    const hours = d3.range(start, Math.min(hourly, start + 13));
    const d = d3.select(detailEl);
    d.selectAll("*").remove();
    d.append("div").attr("class", "detail-title").text(`${town}, hour by hour`);
    const row = d.append("div").attr("class", "hour-strip");
    hours.forEach((k) => {
      const f = cToF(p.feels_like[k]);
      const s = activity ? ACTIVITIES[activity].rule(f, p.p_rain[k], p.wind_mean[k] * 2.237) : null;
      const cell = row.append("div").attr("class", "hour").classed("now", k === t);
      cell.append("div").attr("class", "h").text(d3.timeFormat("%-I%p")(m.validTimes[k]).toLowerCase());
      cell.append("div").attr("class", "v").text(`${Math.round(f)}°`);
      cell.append("div").attr("class", "chip")
        .style("background", s == null ? tempColor()(f) : statusColor(s))
        .attr("title", s == null ? "" : LABELS[s]);
    });
  }

  draw();
  onThemeChange(draw);
}
