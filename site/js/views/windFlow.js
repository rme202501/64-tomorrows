import { manifest, points, field, bilinear } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { fmtTime, isDark, tooltip, onThemeChange } from "../theme.js";

const N_PARTICLES = 2600;
const MAX_AGE = 90;
const SPEEDUP = 20000;

export default async function windFlow(el) {
  const m = await manifest();
  const [pts, u, v, speed, p10, p90] = await Promise.all([points(), field("u10_mean"), field("v10_mean"),
    field("wind_mean"), field("wind_p10"), field("wind_p90")]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const tip = tooltip();
  let t = 0;

  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  slider.append("input").attr("type", "range").attr("min", 0).attr("max", m.leads_h.length - 1).attr("value", 0)
    .on("input", (e) => { t = +e.target.value; drawBase(); });

  const map = await createMap(mapEl, { onDraw: () => { drawBase(); resizeParticles(); } });
  const pc = d3.select(mapEl).insert("canvas", "svg").attr("class", "particles").node();
  const pctx = pc.getContext("2d");
  const spreadColor = () => {
    const lo = isDark() ? "#8a8984" : "#7d7b75";
    return d3.scaleLinear().domain([0, 2, 5, 8]).range([lo, "#eb6834", "#b8461c", "#6e2a10"])
      .interpolate(d3.interpolateLab).clamp(true);
  };
  let particles = [];

  function resizeParticles() {
    const dpr = window.devicePixelRatio || 1;
    pc.width = map.width * dpr;
    pc.height = map.height * dpr;
    pc.style.width = `${map.width}px`;
    pc.style.height = `${map.height}px`;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(p = {}) {
    p.lon = m.lon[0] + Math.random() * (m.lon.at(-1) - m.lon[0]);
    p.lat = m.lat[0] + Math.random() * (m.lat.at(-1) - m.lat[0]);
    p.age = Math.floor(Math.random() * MAX_AGE);
    return p;
  }

  function drawBase() {
    if (!map.projection) return;
    timeText.text(fmtTime(m.validTimes[t]));
    const base = isDark()
      ? d3.scaleLinear().domain([0, 15]).range(["#1a1a19", "#3a3a37"])
      : d3.scaleLinear().domain([0, 15]).range(["#fcfcfb", "#dddcd5"]);
    map.drawGrid(m, speed.frame(t), base.clamp(true));
    d3.select(mapEl).classed("has-raster", false);
    legendRamp(legendEl, spreadColor(), [0, 8], { label: "Streak colour: how much forecasts disagree on wind speed (mph)", format: (d) => d, ticks: 4 });
    map.addTowns(pts, ["Boston", "Cape Cod", "Portland ME", "Mt Washington"]);
  }

  function step() {
    const dt = 1 / 60;
    pctx.globalCompositeOperation = "destination-out";
    pctx.fillStyle = "rgba(0,0,0,0.06)";
    pctx.fillRect(0, 0, map.width, map.height);
    pctx.globalCompositeOperation = "source-over";
    const color = spreadColor();
    pctx.lineWidth = 1.4;
    for (const p of particles) {
      const uu = bilinear(u, m, t, p.lat, p.lon);
      const vv = bilinear(v, m, t, p.lat, p.lon);
      const a = map.projection([p.lon, p.lat]);
      p.lon += (uu * dt * SPEEDUP) / (111e3 * Math.cos((p.lat * Math.PI) / 180));
      p.lat += (vv * dt * SPEEDUP) / 111e3;
      p.age++;
      const b = map.projection([p.lon, p.lat]);
      const out = p.lon < m.lon[0] || p.lon > m.lon.at(-1) || p.lat < m.lat[0] || p.lat > m.lat.at(-1);
      if (!out) {
        const s = (bilinear(p90, m, t, p.lat, p.lon) - bilinear(p10, m, t, p.lat, p.lon)) * 2.237;
        pctx.strokeStyle = color(s);
        pctx.beginPath();
        pctx.moveTo(a[0], a[1]);
        pctx.lineTo(b[0], b[1]);
        pctx.stroke();
      }
      if (out || p.age > MAX_AGE) spawn(p);
    }
  }

  particles = d3.range(N_PARTICLES).map(() => spawn());
  resizeParticles();
  drawBase();
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(mapEl);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  d3.timer(() => { if (visible && !reduce) step(); });

  d3.select(map.svg.node()).on("pointermove", (e) => {
    const [x, y] = d3.pointer(e);
    const c = map.cellAt(m, x, y);
    if (!c) return tip.hide();
    const mph = (f) => Math.round(f.frame(t)[c.k] * 2.237);
    tip.show(`Wind <b>${mph(speed)} mph</b><br>8 in 10 forecasts: ${mph(p10)} to ${mph(p90)} mph`, e.clientX, e.clientY);
  }).on("pointerleave", () => tip.hide());

  onThemeChange(drawBase);
}
