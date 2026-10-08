import { geo } from "./data.js";

const BOX = { lonMin: -80, lonMax: -66, latMin: 40, latMax: 48 };

export async function createMap(container, { box = BOX, onDraw } = {}) {
  const g = await geo();
  const wrap = d3.select(container).classed("map", true);
  const canvas = wrap.append("canvas").node();
  const svg = wrap.append("svg");
  const outlines = svg.append("g").attr("class", "outlines");
  const overlay = svg.append("g").attr("class", "overlay");

  const outline = {
    type: "Polygon",
    coordinates: [[[box.lonMin, box.latMin], [box.lonMin, box.latMax], [box.lonMax, box.latMax],
      [box.lonMax, box.latMin], [box.lonMin, box.latMin]]],
  };
  const map = {
    canvas, svg, overlay, box, projection: null, width: 0, height: 0, cellCache: null,
    ctx: canvas.getContext("2d"),
    resize,
  };

  function resize(initial = false) {
    const width = container.clientWidth;
    const projection = d3.geoConicConformal()
      .parallels([box.latMin + 1, box.latMax - 1])
      .rotate([-(box.lonMin + box.lonMax) / 2, 0])
      .fitWidth(width, outline);
    const [[, y0], [, y1]] = d3.geoPath(projection).bounds(outline);
    const height = Math.ceil(y1 - y0);
    projection.translate([projection.translate()[0], projection.translate()[1] - y0]);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    map.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    Object.assign(map, { projection, width, height, cellCache: null, path: d3.geoPath(projection) });
    drawOutlines();
    if (!initial) onDraw?.(map);
  }

  function drawOutlines() {
    const path = map.path;
    outlines.selectAll("*").remove();
    outlines.append("path").datum(g.land).attr("class", "land-edge").attr("d", path);
    outlines.append("path").datum(g.stateMesh).attr("class", "state-edge").attr("d", path);
  }

  map.drawGrid = function (m, values, color, { alpha } = {}) {
    const { ctx, projection } = map;
    if (!map.cellCache || map.cellCache.m !== m) {
      const dLat = (m.lat[1] - m.lat[0]) / 2;
      const dLon = (m.lon[1] - m.lon[0]) / 2;
      const cells = [];
      for (let i = 0; i < m.nLat; i++) {
        for (let j = 0; j < m.nLon; j++) {
          const la = m.lat[i];
          const lo = m.lon[j];
          cells.push([[lo - dLon, la - dLat], [lo + dLon, la - dLat], [lo + dLon, la + dLat],
            [lo - dLon, la + dLat]].map((p) => projection(p)));
        }
      }
      map.cellCache = { m, cells };
    }
    ctx.clearRect(0, 0, map.width, map.height);
    wrap.classed("has-raster", true);
    const cells = map.cellCache.cells;
    for (let k = 0; k < cells.length; k++) {
      const v = values[k];
      if (!Number.isFinite(v)) continue;
      ctx.globalAlpha = alpha ? alpha(k) : 1;
      ctx.fillStyle = color(v);
      const c = cells[k];
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      ctx.lineTo(c[1][0], c[1][1]);
      ctx.lineTo(c[2][0], c[2][1]);
      ctx.lineTo(c[3][0], c[3][1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  map.cellAt = function (m, x, y) {
    const [lon, lat] = map.projection.invert([x, y]);
    const i = Math.round((lat - m.lat[0]) / (m.lat[1] - m.lat[0]));
    const j = Math.round((lon - m.lon[0]) / (m.lon[1] - m.lon[0]));
    if (i < 0 || j < 0 || i >= m.nLat || j >= m.nLon) return null;
    return { i, j, lat, lon, k: i * m.nLon + j };
  };

  map.addTowns = function (pts, names, { onClick } = {}) {
    const sel = overlay.selectAll("g.town").data(names, (d) => d).join((enter) => {
      const t = enter.append("g").attr("class", "town");
      t.append("circle").attr("r", 3.5);
      t.append("text").attr("x", 6).attr("y", 4).text((d) => d);
      return t;
    });
    sel.attr("transform", (d) => `translate(${map.projection([pts[d].lon, pts[d].lat])})`);
    if (onClick) sel.style("cursor", "pointer").on("click", (e, d) => onClick(d));
    const placed = [];
    sel.sort((a, b) => (b === "Boston") - (a === "Boston")).each(function () {
      const text = d3.select(this).select("text").style("display", null);
      const r = this.getBoundingClientRect();
      const box = { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
      const hit = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      if (hit) text.style("display", "none");
      else placed.push(box);
    });
    return sel;
  };

  new ResizeObserver(() => {
    if (container.clientWidth && container.clientWidth !== map.width) resize();
  }).observe(container);
  resize(true);
  return map;
}

export function legendRamp(container, color, domain, { label, format = (d) => d, ticks = 5 } = {}) {
  const el = d3.select(container);
  el.selectAll("*").remove();
  el.classed("legend-ramp", true);
  if (label) el.append("div").attr("class", "legend-label").text(label);
  const width = 220;
  const svg = el.append("svg").attr("width", width + 40).attr("height", 34);
  const id = `grad-${Math.random().toString(36).slice(2)}`;
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.0001, 0.1).forEach((t) => grad.append("stop").attr("offset", t)
    .attr("stop-color", color(domain[0] + t * (domain[1] - domain[0]))));
  svg.append("rect").attr("x", 16).attr("width", width).attr("height", 10).attr("rx", 2)
    .attr("fill", `url(#${id})`);
  const x = d3.scaleLinear().domain(domain).range([16, width + 16]);
  svg.append("g").attr("transform", "translate(0,12)").attr("class", "axis")
    .call(d3.axisBottom(x).ticks(ticks).tickSize(4).tickFormat(format))
    .call((g) => g.select(".domain").remove());
}
