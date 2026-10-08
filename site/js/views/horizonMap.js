import { manifest, points, field } from "../data.js";
import { createMap, legendRamp } from "../map.js";
import { sequentialBlue, tooltip, onThemeChange } from "../theme.js";

export function gridContourPath(map, m, geometry) {
  const dLat = m.lat[1] - m.lat[0];
  const dLon = m.lon[1] - m.lon[0];
  const px = ([x, y]) => map.projection([m.lon[0] + (x - 0.5) * dLon, m.lat[0] + (y - 0.5) * dLat]);
  return geometry.coordinates.map((poly) => poly.map((ring) => `M${ring.map(px).join("L")}Z`).join("")).join("");
}

export default async function horizonMap(el) {
  const m = await manifest();
  const [pts, spread] = await Promise.all([points(), field("t2m_spread")]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const legendEl = el.querySelector(".legend");
  const statEl = el.querySelector(".stat");
  const tip = tooltip();
  let thresholdF = 7;
  const maxDays = m.leads_h.at(-1) / 24;

  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const text = slider.append("span");
  slider.append("input").attr("type", "range").attr("min", 3).attr("max", 15).attr("step", 1)
    .attr("value", thresholdF).on("input", (e) => { thresholdF = +e.target.value; draw(); });

  const map = await createMap(mapEl, { onDraw: () => draw() });
  const contourG = map.overlay.insert("g", ":first-child").attr("class", "isolines");
  let horizon;

  function compute() {
    const size = m.nLat * m.nLon;
    const out = new Float32Array(size).fill(maxDays + 0.5);
    const limitC = thresholdF * 5 / 9;
    for (let k = 0; k < size; k++) {
      for (let t = 0; t < m.leads_h.length; t++) {
        if (spread.at(t, Math.floor(k / m.nLon), k % m.nLon) > limitC) {
          out[k] = m.leads_h[t] / 24;
          break;
        }
      }
    }
    return smooth(out);
  }

  function smooth(a) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < m.nLat; i++) {
      for (let j = 0; j < m.nLon; j++) {
        let sum = 0;
        let n = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= m.nLat || jj >= m.nLon) continue;
            sum += a[ii * m.nLon + jj];
            n++;
          }
        }
        out[i * m.nLon + j] = sum / n;
      }
    }
    return out;
  }

  function draw() {
    if (!map.projection) return;
    text.html(`Trust a forecast while 8 in 10 runs agree within <b>${thresholdF}°F</b>`);
    horizon = compute();
    const color = sequentialBlue(1, maxDays);
    map.drawGrid(m, horizon, color);
    legendRamp(legendEl, color, [1, maxDays], { label: "Days you can trust the temperature forecast", format: (d) => `${d}d`, ticks: 7 });

    const contours = d3.contours().size([m.nLon, m.nLat]).thresholds(d3.range(1, maxDays + 0.01, 1))(Array.from(horizon));
    contourG.selectAll("path").data(contours).join("path").attr("d", (c) => gridContourPath(map, m, c));
    map.addTowns(pts, ["Boston", "Pittsfield", "Cape Cod", "Burlington VT", "Mt Washington", "New York"]);

    const p = pts.Boston;
    const i = d3.minIndex(m.lat, (d) => Math.abs(d - p.lat));
    const j = d3.minIndex(m.lon, (d) => Math.abs(d - p.lon));
    const days = horizon[i * m.nLon + j];
    d3.select(statEl).html(days > maxDays
      ? `<div class="stat-value">${maxDays}+ days</div><div class="stat-label">Boston temperature forecast stays trustworthy for the whole week</div>`
      : `<div class="stat-value">${days.toFixed(1)} days</div><div class="stat-label">How far ahead Boston's temperature forecast stays trustworthy</div>`);
  }

  d3.select(map.svg.node()).on("pointermove", (e) => {
    const [x, y] = d3.pointer(e);
    const c = map.cellAt(m, x, y);
    if (!c || !horizon) return tip.hide();
    const d = horizon[c.k];
    tip.show(d > maxDays ? `Trustworthy for all ${maxDays} days` : `Trustworthy for <b>${d.toFixed(1)} days</b>`, e.clientX, e.clientY);
  }).on("pointerleave", () => tip.hide());

  draw();
  onThemeChange(draw);
}
