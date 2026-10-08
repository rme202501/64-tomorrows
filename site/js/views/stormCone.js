import { manifest } from "../data.js";
import { createMap } from "../map.js";
import { gridContourPath } from "./horizonMap.js";
import { fmtTime, SERIES, tooltip, onThemeChange } from "../theme.js";

const CONE_MARGIN_HPA = 3;
const SEARCH_KM = 900;

async function loadStorm() {
  const s = await d3.json("data/storm.json");
  const decode = async (name) => {
    const meta = s.fields[name];
    const raw = new Int16Array(await (await fetch(`data/fields/storm_mslp_${name}.bin`)).arrayBuffer());
    const [, nLat, nLon] = meta.shape;
    const values = Float32Array.from(raw, (r) => r * meta.scale + meta.offset);
    return (t) => values.subarray(t * nLat * nLon, (t + 1) * nLat * nLon);
  };
  s.mean = await decode("mean");
  s.p10 = await decode("p10");
  s.nLat = s.lat.length;
  s.nLon = s.lon.length;
  return s;
}

export default async function stormCone(el) {
  const [m, s] = await Promise.all([manifest(), loadStorm()]);
  const controls = el.querySelector(".controls");
  const mapEl = el.querySelector(".map-wrap");
  const infoEl = el.querySelector(".info");
  const tip = tooltip();
  const box = { lonMin: s.lon[0], lonMax: s.lon.at(-1), latMin: s.lat[0], latMax: s.lat.at(-1) };
  const tracks = s.tracks.slice(0, 6).map((tr, n) => ({ ...tr, id: n }));
  let selected = 0;
  let t = tracks[0].t[0];
  const validTime = (k) => new Date(+m.init + s.leads_h[k] * 3600e3);

  const slider = d3.select(controls).append("label").attr("class", "control grow");
  const timeText = slider.append("span");
  const input = slider.append("input").attr("type", "range").attr("min", 0).attr("max", s.leads_h.length - 1)
    .attr("value", t).on("input", (e) => { t = +e.target.value; draw(); });

  const map = await createMap(mapEl, { box, onDraw: () => draw() });
  const grid = { lat: s.lat, lon: s.lon, nLat: s.nLat, nLon: s.nLon };
  const defs = map.svg.insert("defs", ":first-child");
  const layers = {
    isobars: map.overlay.append("g").attr("class", "isobars"),
    cone: map.overlay.append("g").attr("class", "cone"),
    tracks: map.overlay.append("g").attr("class", "tracks"),
    now: map.overlay.append("g").attr("class", "now"),
  };

  function lowRegion(k, center, clipId) {
    const p10 = s.p10(k);
    let lowest = Infinity;
    for (let i = 0; i < s.nLat; i++) {
      for (let j = 0; j < s.nLon; j++) {
        if (d3.geoDistance([s.lon[j], s.lat[i]], [center.lon, center.lat]) * 6371 < SEARCH_KM / 2) {
          lowest = Math.min(lowest, p10[i * s.nLon + j]);
        }
      }
    }
    const c = d3.contours().size([s.nLon, s.nLat]).thresholds([-(lowest + CONE_MARGIN_HPA)])(Array.from(p10, (x) => -x))[0];
    const circle = d3.geoCircle().center([center.lon, center.lat]).radius(SEARCH_KM / 111)();
    defs.select(`#${clipId}`).remove();
    defs.append("clipPath").attr("id", clipId).append("path").attr("d", map.path(circle));
    return gridContourPath(map, grid, c);
  }

  function draw() {
    if (!map.projection) return;
    map.ctx.clearRect(0, 0, map.width, map.height);
    timeText.text(`${fmtTime(validTime(t))} · ${s.leads_h[t]} h ahead`);
    const levels = d3.range(980, 1040, 4);
    const iso = d3.contours().size([s.nLon, s.nLat]).thresholds(levels)(Array.from(s.mean(t)));
    layers.isobars.selectAll("path").data(iso).join("path").attr("d", (c) => gridContourPath(map, grid, c));

    const colors = SERIES();
    const tr = tracks[selected];
    const cone = tr.t.map((k, n) => ({ k, id: `clip-${k}`, center: { lat: tr.lat[n], lon: tr.lon[n], hpa: tr.hpa[n] } }));
    layers.cone.selectAll("path").data(cone, (d) => d.k).join("path")
      .attr("d", (d) => lowRegion(d.k, d.center, d.id))
      .attr("clip-path", (d) => `url(#${d.id})`)
      .attr("fill", colors[1]).attr("fill-opacity", (d) => (d.k === t ? 0.45 : 0.12))
      .attr("stroke", colors[1]).attr("stroke-opacity", (d) => (d.k === t ? 0.9 : 0));

    const line = d3.line().x((d) => map.projection(d)[0]).y((d) => map.projection(d)[1]).curve(d3.curveCatmullRom);
    layers.tracks.selectAll("path").data(tracks, (d) => d.id).join("path")
      .attr("class", (d) => (d.id === selected ? "track selected" : "track"))
      .attr("d", (d) => line(d.lon.map((lo, n) => [lo, d.lat[n]])))
      .on("click", (e, d) => { selected = d.id; t = d.t[0]; input.property("value", t); draw(); })
      .on("pointermove", (e, d) => tip.show(`Low ${d.id + 1}: deepest ${Math.round(d3.min(d.hpa))} hPa<br>Click to build its cone`, e.clientX, e.clientY))
      .on("pointerleave", () => tip.hide());

    const n = tr.t.indexOf(t);
    layers.now.selectAll("*").remove();
    if (n >= 0) {
      layers.now.append("circle").attr("r", 6).attr("class", "low-center")
        .attr("transform", `translate(${map.projection([tr.lon[n], tr.lat[n]])})`);
      layers.now.append("text").attr("class", "low-label").attr("x", 10).attr("y", 4)
        .attr("transform", `translate(${map.projection([tr.lon[n], tr.lat[n]])})`).text(`L ${Math.round(tr.hpa[n])}`);
    }
    d3.select(infoEl).html(n >= 0
      ? `Low ${selected + 1} at <b>${Math.round(tr.hpa[n])} hPa</b>. The shaded blob is where the 1-in-10 lowest-pressure forecast puts pressure within ${CONE_MARGIN_HPA} hPa of the centre: where the storm could plausibly be.`
      : `Low ${selected + 1} is not on the map at this time. Its track runs ${fmtTime(validTime(tr.t[0]))} to ${fmtTime(validTime(tr.t.at(-1)))}.`);
  }

  draw();
  onThemeChange(draw);
}
