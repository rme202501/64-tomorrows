import { manifest, points, field } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { divergingTemp, cToF, fmtTime, css, tooltip, onThemeChange } from "../theme.js";

const FOG_START_F = 2;
const FOG_FULL_F = 10;

export default async function fogMap(el) {
  const m = await manifest();
  const [pts, temp, spread] = await Promise.all([points(), field("t2m_mean"), field("t2m_spread")]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const tip = tooltip();
  let t = 0;
  let timer = null;

  const play = d3.select(controls).append("button").attr("class", "btn").text("Play")
    .on("click", () => (timer ? stop() : start()));
  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  const input = slider.append("input").attr("type", "range").attr("min", 0).attr("max", m.leads_h.length - 1)
    .attr("value", 0).on("input", (e) => { stop(); t = +e.target.value; draw(); });

  function start() {
    play.text("Pause");
    timer = d3.interval(() => { t = (t + 1) % m.leads_h.length; input.property("value", t); draw(); }, 140);
  }
  function stop() { play.text("Play"); timer?.stop(); timer = null; }

  const map = await createMap(mapEl, { onDraw: () => draw() });
  const fogCanvas = document.createElement("canvas");
  const fogAlpha = (c) => Math.max(0, Math.min(1, (c * 9 / 5 - FOG_START_F) / (FOG_FULL_F - FOG_START_F)));

  function draw() {
    if (!map.projection) return;
    const lead = m.leads_h[t];
    timeText.html(`${fmtTime(m.validTimes[t])} <span class="muted">· ${lead < 48 ? `${lead} h` : `${(lead / 24).toFixed(1)} days`} ahead</span>`);
    const color = divergingTemp(20, 55, 90);
    map.drawGrid(m, Float32Array.from(temp.frame(t), cToF), color);

    const { ctx, width, canvas } = map;
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;
    const fctx = fogCanvas.getContext("2d");
    fctx.setTransform(ctx.getTransform());
    const s = spread.frame(t);
    const cells = map.cellCache.cells;
    fctx.fillStyle = css("--fog");
    for (let k = 0; k < cells.length; k++) {
      const a = fogAlpha(s[k]);
      if (a <= 0) continue;
      fctx.globalAlpha = a * 0.92;
      const c = cells[k];
      fctx.beginPath();
      fctx.moveTo(c[0][0], c[0][1]);
      for (let q = 1; q < 4; q++) fctx.lineTo(c[q][0], c[q][1]);
      fctx.fill();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${Math.round(width / 90)}px)`;
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.restore();

    legendRamp(legendEl, color, [20, 90], { label: "Most likely temperature (°F)", format: (d) => `${d}°` });
    d3.select(legendEl).append("div").attr("class", "legend-note")
      .html(`<i class="fog-swatch"></i>Fog = forecasts disagree by more than ${FOG_START_F}°F (fully hidden at ${FOG_FULL_F}°F)`);
    map.addTowns(pts, ["Boston", "Hartford", "Portland ME", "Burlington VT", "New York"]);
  }

  d3.select(map.svg.node()).on("pointermove", (e) => {
    const [x, y] = d3.pointer(e);
    const c = map.cellAt(m, x, y);
    if (!c) return tip.hide();
    const s = spread.frame(t)[c.k] * 9 / 5;
    tip.show(`Most likely <b>${Math.round(cToF(temp.frame(t)[c.k]))}°F</b><br>
      8 in 10 forecasts within a ${Math.round(s)}°F range`, e.clientX, e.clientY);
  }).on("pointerleave", () => tip.hide());

  draw();
  onThemeChange(draw);
}
