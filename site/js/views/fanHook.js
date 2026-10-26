import { manifest, points } from "../data.js";
import { frame, responsive, timeAxis, yAxis, crosshair, townSelect } from "../chart.js";
import { cToF, fmtTime, SERIES, onThemeChange } from "../theme.js";

// Hook view: the single number a weather app shows, placed on the fan of
// possible temperatures it was picked from. Pick a time with the pointer;
// tap the card to step through the three answers (1-in-10 colder, most
// likely, 1-in-10 warmer).

const HOURS = 168;
const ANSWERS = [
  { key: "p10", label: "1 in 10 colder", note: "1 in 10 chance it is this cold or colder." },
  { key: "p50", label: "Most likely", note: "The one number most apps show you." },
  { key: "p90", label: "1 in 10 warmer", note: "1 in 10 chance it is this warm or warmer." },
];

export default async function fanHook(el) {
  const [m, pts] = await Promise.all([manifest(), points()]);
  const controls = el.querySelector(".controls");
  const chartEl = el.querySelector(".chart");
  const cardEl = el.querySelector(".app-card");
  const n = m.leads_h.filter((h) => h <= HOURS).length;
  const times = m.validTimes.slice(0, n);
  let town = "Boston";
  let k = m.leads_h.indexOf(24);
  let which = 1;

  townSelect(controls, Object.keys(pts), town, (v) => { town = v; redraw(); });

  const value = (key, idx = k) => cToF(pts[town][`t2m_${key}`][idx]);

  cardEl.addEventListener("click", () => { which = (which + 1) % ANSWERS.length; renderCard(); placeDots(); });
  cardEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cardEl.click(); }
  });

  let dots = null;
  let x = null;
  let y = null;

  function renderCard() {
    const a = ANSWERS[which];
    const deg = Math.round(value(a.key));
    cardEl.querySelector(".app-place").textContent = `${town} · ${fmtTime(times[k])}`;
    cardEl.querySelector(".app-num").textContent = `${deg}°`;
    cardEl.querySelector(".app-tag").textContent = a.note;
    const chips = cardEl.querySelector(".app-chips");
    chips.innerHTML = "";
    ANSWERS.forEach((o, i) => {
      const b = document.createElement("span");
      b.className = i === which ? "on" : "";
      b.innerHTML = `${o.label}<b>${Math.round(value(o.key))}°</b>`;
      chips.appendChild(b);
    });
  }

  function placeDots() {
    if (!dots) return;
    dots.attr("cx", x(times[k])).attr("cy", (d) => y(value(d.key)))
      .classed("active", (d, i) => i === which);
  }

  function render(width) {
    const p = pts[town];
    const s = (key) => p[`t2m_${key}`].slice(0, n).map(cToF);
    const q = { p10: s("p10"), p25: s("p25"), p50: s("p50"), p75: s("p75"), p90: s("p90") };
    const { g, w, h } = frame(chartEl, width, width < 520 ? 280 : 320,
      { top: 30, right: 16, bottom: 28, left: 44 });
    x = d3.scaleTime().domain(d3.extent(times)).range([0, w]);
    y = d3.scaleLinear().domain([d3.min(q.p10) - 2, d3.max(q.p90) + 2]).nice().range([h, 0]);
    const color = SERIES()[0];

    yAxis(g, y, w, { format: (d) => `${d}°`, label: "°F" });
    timeAxis(g, x, h, w);

    const band = (lo, hi) => d3.area().x((_, i) => x(times[i])).y0((_, i) => y(lo[i]))
      .y1((_, i) => y(hi[i])).curve(d3.curveMonotoneX)(times);
    g.append("path").attr("d", band(q.p10, q.p90)).attr("fill", color).attr("opacity", 0.16);
    g.append("path").attr("d", band(q.p25, q.p75)).attr("fill", color).attr("opacity", 0.28);
    g.append("path").attr("class", "line").attr("stroke", color).attr("stroke-dasharray", "4 4")
      .attr("d", d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX)(q.p90));
    g.append("path").attr("class", "line").attr("stroke", color).attr("stroke-dasharray", "4 4")
      .attr("d", d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX)(q.p10));
    g.append("path").attr("class", "line").attr("stroke", color)
      .attr("d", d3.line().x((_, i) => x(times[i])).y((d) => y(d)).curve(d3.curveMonotoneX)(q.p50));

    dots = g.append("g").selectAll("circle").data(ANSWERS).join("circle")
      .attr("r", 5).attr("class", "fan-dot").attr("fill", color).attr("stroke", "var(--surface-1)");
    placeDots();

    crosshair(g, x, w, h, times, (idx) => {
      k = idx;
      renderCard();
      placeDots();
    }, () => {});
  }

  function redraw() { renderCard(); draw(); }
  const draw = responsive(chartEl, render);
  renderCard();
  onThemeChange(draw);
}
