import { manifest, points, field, bilinear } from "../data.js";
import { createMap } from "../map.js";
import { frame, responsive, segmented } from "../chart.js";
import { divergingTemp, sequentialBlue, sequentialOrange, cToF, fmtTime, fmtPct, tooltip, onThemeChange } from "../theme.js";

const SAMPLES = 32;
const SPEEDS = { walk: { label: "Walk", kmh: 5 }, bike: { label: "Bike", kmh: 18 }, drive: { label: "Drive", kmh: 70 } };
const METRICS = {
  rain: { label: "Rain chance", field: "p_rain", conv: (v) => v, fmt: fmtPct, color: () => sequentialBlue(0, 1), worst: (vals) => d3.max(vals) },
  feels: { label: "Feels like", field: "feels_like", conv: cToF, fmt: (v) => `${Math.round(v)}°F`, color: () => divergingTemp(20, 55, 90), worst: (vals) => d3.max(vals, (v) => Math.abs(v - 65)) },
  wind: { label: "Wind", field: "wind_mean", conv: (v) => v * 2.237, fmt: (v) => `${Math.round(v)} mph`, color: () => sequentialOrange(0, 30), worst: (vals) => d3.max(vals) },
};
const DEFAULT_ROUTE = [[-71.06, 42.36], [-71.35, 42.3], [-71.8, 42.26]];

export default async function routePlanner(el) {
  const m = await manifest();
  const pts = await points();
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const chartEl = el.querySelector(".chart");
  const infoEl = el.querySelector(".info");
  const tip = tooltip();
  const hourly = m.leads_h.filter((h) => h <= 48).length;
  let route = DEFAULT_ROUTE.slice();
  let speed = "bike";
  let metric = "rain";
  let f;

  segmented(controls, Object.entries(SPEEDS).map(([value, s]) => ({ label: s.label, value })), speed, (v) => { speed = v; update(); });
  segmented(controls, Object.entries(METRICS).map(([value, s]) => ({ label: s.label, value })), metric,
    async (v) => { metric = v; f = await field(METRICS[metric].field); update(); });
  d3.select(controls).append("button").attr("class", "btn ghost").text("Clear route").on("click", () => { route = []; update(); });

  const map = await createMap(mapEl, { onDraw: () => drawRoute() });
  const routeG = map.overlay.append("g").attr("class", "route");
  d3.select(map.svg.node()).style("cursor", "crosshair").on("click", (e) => {
    route.push(map.projection.invert(d3.pointer(e)));
    update();
  });
  map.svg.append("text").attr("class", "map-hint").attr("x", 10).attr("y", 20).text("Click to add stops along your route");

  function sampleRoute() {
    if (route.length < 2) return null;
    const legs = d3.pairs(route).map(([a, b]) => d3.geoDistance(a, b) * 6371);
    const total = d3.sum(legs);
    return d3.range(SAMPLES).map((n) => {
      let dist = (n / (SAMPLES - 1)) * total;
      let k = 0;
      while (k < legs.length - 1 && dist > legs[k]) { dist -= legs[k]; k++; }
      const p = d3.geoInterpolate(route[k], route[k + 1])(Math.min(1, dist / legs[k]));
      return { lon: p[0], lat: p[1], km: (n / (SAMPLES - 1)) * total };
    });
  }

  function drawRoute() {
    if (!map.projection) return;
    map.ctx.clearRect(0, 0, map.width, map.height);
    map.addTowns(pts, ["Boston", "Worcester", "Providence", "Springfield", "Cape Cod", "Hartford", "Portland ME"]);
    routeG.selectAll("path").data(route.length > 1 ? [route] : []).join("path")
      .attr("d", (r) => map.path({ type: "LineString", coordinates: r }));
    routeG.selectAll("circle").data(route).join("circle").attr("r", (d, i) => (i === 0 || i === route.length - 1 ? 6 : 4))
      .attr("transform", (d) => `translate(${map.projection(d)})`);
  }

  function grid(samples) {
    const kmh = SPEEDS[speed].kmh;
    const total = samples.at(-1).km;
    const tripH = total / kmh;
    const departures = d3.range(0, Math.max(1, Math.floor(hourly - 1 - tripH)));
    const conv = METRICS[metric].conv;
    return {
      tripH, departures,
      cells: departures.map((dep) => samples.map((s) => {
        const tt = Math.min(hourly - 1, Math.round(dep + s.km / kmh));
        return conv(bilinear(f, m, tt, s.lat, s.lon));
      })),
    };
  }

  function render(width) {
    const samples = sampleRoute();
    d3.select(chartEl).selectAll("*").remove();
    if (!samples) {
      d3.select(infoEl).html("Add at least two stops on the map to plan a trip.");
      return;
    }
    const M = METRICS[metric];
    const { tripH, departures, cells } = grid(samples);
    const scores = cells.map(M.worst);
    const best = d3.minIndex(scores);
    const total = samples.at(-1).km;
    const { g, w, h } = frame(chartEl, width, 240, { top: 16, right: 12, bottom: 30, left: 52 });
    const x = d3.scaleBand().domain(departures).range([0, w]).paddingInner(0.06);
    const y = d3.scaleBand().domain(d3.range(SAMPLES)).range([h, 0]);
    const color = M.color();
    cells.forEach((col, i) => g.append("g").selectAll("rect").data(col).join("rect")
      .attr("x", x(departures[i])).attr("width", x.bandwidth()).attr("y", (_, n) => y(n)).attr("height", y.bandwidth() + 0.5)
      .attr("fill", color)
      .on("pointermove", (e, v) => tip.show(`Leave ${fmtTime(m.validTimes[departures[i]])}<br>${M.label}: <b>${M.fmt(v)}</b>`, e.clientX, e.clientY))
      .on("pointerleave", () => tip.hide()));
    g.append("rect").attr("class", "best").attr("x", x(departures[best]) - 1).attr("width", x.bandwidth() + 2)
      .attr("y", -2).attr("height", h + 4).attr("rx", 3);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(departures.filter((dd) => m.validTimes[dd].getHours() % 6 === 0))
        .tickSize(4).tickFormat((dd) => d3.timeFormat("%a %-I%p")(m.validTimes[dd]).replace(/AM|PM/, (s) => s.toLowerCase())))
      .call((a) => a.select(".domain").remove());
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(d3.scaleLinear().domain([0, total]).range([h, 0])).ticks(4).tickSize(0).tickPadding(6).tickFormat((d) => `${Math.round(d)} km`))
      .call((a) => a.select(".domain").remove());
    d3.select(infoEl).html(`${total.toFixed(0)} km, about ${tripH < 1 ? `${Math.round(tripH * 60)} min` : `${tripH.toFixed(1)} h`}.
      Best time to leave: <b>${fmtTime(m.validTimes[departures[best]])}</b>
      (worst ${M.label.toLowerCase()} on the way: ${M.fmt(metric === "feels" ? cells[best][d3.maxIndex(cells[best], (v) => Math.abs(v - 65))] : d3.max(cells[best]))}).`);
  }

  f = await field(METRICS[metric].field);
  const redraw = responsive(chartEl, render);
  function update() { drawRoute(); redraw(); }
  drawRoute();
  onThemeChange(update);
}
