const W = (() => {
  const meta = (name, fallback) => document.querySelector(`meta[name="${name}"]`)?.content ?? fallback;
  const DATA_ROOT = meta("data-root", "data/");
  const FIELD_FORMAT = meta("field-format", "bin");

  (function setupTheme() {
    const root = document.documentElement;
    try {
      const saved = localStorage.getItem("theme");
      if (saved) root.dataset.theme = saved;
    } catch { /* storage unavailable */ }
    document.querySelector(".theme-toggle")?.addEventListener("click", () => {
      const dark = root.dataset.theme === "dark"
        || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage unavailable */ }
    });
  })();
  const TOWNS = {
    "Boston": [42.36, -71.06], "Worcester": [42.26, -71.8], "Springfield": [42.1, -72.59],
    "Pittsfield": [42.45, -73.25], "Cape Cod": [41.67, -70.3], "Providence": [41.82, -71.41],
    "Hartford": [41.76, -72.67], "Portland ME": [43.66, -70.26], "Burlington VT": [44.48, -73.21],
    "Concord NH": [43.21, -71.54], "Mt Washington": [44.27, -71.3], "New York": [40.71, -74.01],
  };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  };
  function onThemeChange(fn) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
    new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  let manifestP;
  function manifest() {
    manifestP ??= d3.json(`${DATA_ROOT}manifest.json`).then((m) => {
      m.nLat = m.lat.length;
      m.nLon = m.lon.length;
      m.size = m.nLat * m.nLon;
      m.nT = m.leads_h.length;
      m.init = new Date(m.init_time.slice(0, 19) + "Z");
      m.times = m.leads_h.map((h) => new Date(+m.init + h * 3600e3));
      const mid = m.leads_h.map((h, k) => (k === 0 ? h - 0.5 : (h + m.leads_h[k - 1]) / 2));
      mid.push(m.leads_h.at(-1) + (m.leads_h.at(-1) - m.leads_h.at(-2)) / 2);
      m.edgesH = mid;
      m.weightH = m.leads_h.map((_, k) => mid[k + 1] - mid[k]);
      m.edgeTimes = mid.map((h) => new Date(+m.init + h * 3600e3));
      return m;
    });
    return manifestP;
  }

  const fieldCache = new Map();
  function field(name) {
    if (!fieldCache.has(name)) {
      fieldCache.set(name, (async () => {
        const m = await manifest();
        const meta = m.fields[name];
        const res = await fetch(`${DATA_ROOT}fields/${name}.${FIELD_FORMAT}`);
        if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
        let buffer;
        if (FIELD_FORMAT === "txt") {
          const bin = atob(await res.text());
          const bytes = new Uint8Array(bin.length);
          for (let q = 0; q < bin.length; q++) bytes[q] = bin.charCodeAt(q);
          buffer = bytes.buffer;
        } else {
          buffer = await res.arrayBuffer();
        }
        const raw = new Int16Array(buffer);
        const values = new Float32Array(raw.length);
        for (let k = 0; k < raw.length; k++) values[k] = raw[k] === -32768 ? NaN : raw[k] * meta.scale + meta.offset;
        const size = meta.shape[1] * meta.shape[2];
        return {
          values,
          frame: (t) => values.subarray(t * size, (t + 1) * size),
          at: (t, k) => values[t * size + k],
          series: (k) => Float32Array.from({ length: meta.shape[0] }, (_, t) => values[t * size + k]),
        };
      })());
    }
    return fieldCache.get(name);
  }

  let geoP;
  function geo() {
    geoP ??= Promise.all([d3.json(`${DATA_ROOT}geo/states-10m.json`), d3.json(`${DATA_ROOT}geo/countries-50m.json`)])
      .then(([us, world]) => ({
        stateMesh: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
        land: topojson.feature(world, world.objects.land),
      }));
    return geoP;
  }

  const cellLatLon = (m, k) => [m.lat[Math.floor(k / m.nLon)], m.lon[k % m.nLon]];
  function cellOf(m, lat, lon) {
    const i = Math.round((lat - m.lat[0]) / (m.lat[1] - m.lat[0]));
    const j = Math.round((lon - m.lon[0]) / (m.lon[1] - m.lon[0]));
    if (i < 0 || j < 0 || i >= m.nLat || j >= m.nLon) return null;
    return i * m.nLon + j;
  }
  function placeName(m, k) {
    const [lat, lon] = cellLatLon(m, k);
    let best = null;
    let bestD = 0.2;
    for (const [name, [la, lo]] of Object.entries(TOWNS)) {
      const d = Math.hypot(la - lat, (lo - lon) * Math.cos(lat * Math.PI / 180));
      if (d < bestD) { bestD = d; best = name; }
    }
    return best ? `Near ${best}` : `${lat.toFixed(1)}°N ${(-lon).toFixed(1)}°W`;
  }

  async function createMap(container, { onResize } = {}) {
    const g = await geo();
    const box = { lonMin: -80, lonMax: -66, latMin: 40, latMax: 48 };
    const wrap = d3.select(container).classed("map", true);
    const canvas = wrap.append("canvas").node();
    const svg = wrap.append("svg");
    const under = svg.append("g");
    const outlines = svg.append("g");
    const overlay = svg.append("g");
    const outline = {
      type: "Polygon",
      coordinates: [[[box.lonMin, box.latMin], [box.lonMin, box.latMax], [box.lonMax, box.latMax],
        [box.lonMax, box.latMin], [box.lonMin, box.latMin]]],
    };
    const map = { canvas, svg, under, overlay, ctx: canvas.getContext("2d"), width: 0, height: 0, cells: null };
    const fogCanvas = document.createElement("canvas");

    function resize() {
      const width = container.clientWidth;
      const projection = d3.geoConicConformal()
        .parallels([box.latMin + 1, box.latMax - 1])
        .rotate([-(box.lonMin + box.lonMax) / 2, 0])
        .fitWidth(width, outline);
      const [[, y0], [, y1]] = d3.geoPath(projection).bounds(outline);
      projection.translate([projection.translate()[0], projection.translate()[1] - y0]);
      const height = Math.ceil(y1 - y0);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      map.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
      Object.assign(map, { projection, width, height, dpr, cells: null, path: d3.geoPath(projection) });
      outlines.selectAll("*").remove();
      outlines.append("path").datum(g.land).attr("class", "land-edge").attr("d", map.path);
      outlines.append("path").datum(g.stateMesh).attr("class", "state-edge").attr("d", map.path);
    }

    function cellPolys(m) {
      if (map.cells) return map.cells;
      const dLat = (m.lat[1] - m.lat[0]) / 2;
      const dLon = (m.lon[1] - m.lon[0]) / 2;
      const cells = [];
      for (let i = 0; i < m.nLat; i++) {
        for (let j = 0; j < m.nLon; j++) {
          const la = m.lat[i];
          const lo = m.lon[j];
          cells.push([[lo - dLon, la - dLat], [lo + dLon, la - dLat], [lo + dLon, la + dLat], [lo - dLon, la + dLat]]
            .map((p) => map.projection(p)));
        }
      }
      map.cells = cells;
      return cells;
    }

    function fillCell(ctx, c) {
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      ctx.lineTo(c[1][0], c[1][1]);
      ctx.lineTo(c[2][0], c[2][1]);
      ctx.lineTo(c[3][0], c[3][1]);
      ctx.closePath();
      ctx.fill();
    }

    map.drawGrid = function (m, values, color) {
      const { ctx } = map;
      const cells = cellPolys(m);
      ctx.clearRect(0, 0, map.width, map.height);
      ctx.lineWidth = 0.6;
      for (let k = 0; k < cells.length; k++) {
        const v = values[k];
        if (!Number.isFinite(v)) continue;
        ctx.fillStyle = color(v);
        ctx.strokeStyle = ctx.fillStyle;
        fillCell(ctx, cells[k]);
        ctx.stroke();
      }
    };

    map.drawFog = function (m, alpha) {
      const cells = cellPolys(m);
      fogCanvas.width = canvas.width;
      fogCanvas.height = canvas.height;
      const f = fogCanvas.getContext("2d");
      f.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
      f.fillStyle = css("--fog");
      for (let k = 0; k < cells.length; k++) {
        const a = alpha(k);
        if (!(a > 0)) continue;
        f.globalAlpha = a * 0.92;
        fillCell(f, cells[k]);
      }
      const { ctx } = map;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${Math.max(2, Math.round(map.width / 90 * map.dpr))}px)`;
      ctx.drawImage(fogCanvas, 0, 0);
      ctx.restore();
    };

    map.cellAt = function (m, x, y) {
      const [lon, lat] = map.projection.invert([x, y]);
      return cellOf(m, lat, lon);
    };

    map.gridPath = function (m, geometry) {
      const dLat = m.lat[1] - m.lat[0];
      const dLon = m.lon[1] - m.lon[0];
      const px = ([x, y]) => map.projection([m.lon[0] + (x - 0.5) * dLon, m.lat[0] + (y - 0.5) * dLat]);
      return geometry.coordinates.map((poly) => poly.map((ring) => `M${ring.map(px).join("L")}Z`).join("")).join("");
    };

    resize();
    let lastW = map.width;
    new ResizeObserver(() => {
      if (container.clientWidth && container.clientWidth !== lastW) {
        lastW = container.clientWidth;
        resize();
        onResize?.(map);
      }
    }).observe(container);
    return map;
  }

  function labelTowns(map, sel) {
    const placed = [];
    const nodes = sel.nodes().sort((a, b) => b.classList.contains("pin") - a.classList.contains("pin"));
    const pins = nodes.filter((n) => n.classList.contains("pin")).map((n) => n.getBoundingClientRect());
    d3.selectAll(nodes).each(function () {
      if (!this.classList.contains("pin")) {
        const r = this.querySelector("circle").getBoundingClientRect();
        const under = pins.some((p) => r.left < p.right + 2 && r.right > p.left - 2 && r.top < p.bottom + 2 && r.bottom > p.top - 2);
        d3.select(this).style("display", under ? "none" : null);
        if (under) return;
      }
      const text = d3.select(this).select("text").style("display", null);
      const r = this.getBoundingClientRect();
      const hit = placed.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top);
      if (hit) text.style("display", "none");
      else placed.push(r);
    });
  }

  function legendRamp(container, color, domain, { label, format = (d) => d, ticks = 5, width = 220 } = {}) {
    const el = d3.select(container).append("div").attr("class", "legend-ramp");
    if (label) el.append("div").style("margin-bottom", "4px").text(label);
    const svg = el.append("svg").attr("width", width + 24).attr("height", 30);
    const id = `grad-${Math.random().toString(36).slice(2)}`;
    const grad = svg.append("defs").append("linearGradient").attr("id", id);
    d3.range(0, 1.0001, 0.05).forEach((t) => grad.append("stop").attr("offset", t)
      .attr("stop-color", color(domain[0] + t * (domain[1] - domain[0]))));
    svg.append("rect").attr("x", 12).attr("width", width).attr("height", 10).attr("rx", 2).attr("fill", `url(#${id})`);
    const x = d3.scaleLinear().domain(domain).range([12, width + 12]);
    svg.append("g").attr("transform", "translate(0,12)").attr("class", "axis")
      .call(d3.axisBottom(x).ticks(ticks).tickSize(4).tickFormat(format))
      .call((s) => s.select(".domain").remove());
  }

  function timeAxis(g, x, h, w) {
    g.append("g").attr("class", "gridlines")
      .selectAll("line").data(d3.timeDay.range(...x.domain())).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", h);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(d3.timeDay.every(w < 380 ? 2 : 1)).tickSize(4).tickFormat(d3.timeFormat("%a %-d")))
      .call((s) => s.select(".domain").remove())
      .call((s) => s.selectAll(".tick text").classed("tick-day", true).attr("text-anchor", "start").attr("dx", 3));
  }

  function yAxis(g, y, w, { format, ticks = 5, label } = {}) {
    g.append("g").attr("class", "gridlines")
      .selectAll("line").data(y.ticks(ticks)).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).ticks(ticks).tickSize(0).tickPadding(8).tickFormat(format))
      .call((s) => s.select(".domain").remove());
    if (label) g.append("text").attr("class", "axis-label").attr("x", -8).attr("y", -12).text(label);
  }

  function frame(container, width, height, margin) {
    const sel = d3.select(container);
    sel.selectAll("svg").remove();
    const svg = sel.append("svg").attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    return { svg, g, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
  }

  function responsive(container, render) {
    let last = 0;
    const run = () => {
      const w = container.clientWidth;
      if (!w || w === last) return;
      last = w;
      render(w);
    };
    new ResizeObserver(run).observe(container);
    run();
    return () => { last = 0; run(); };
  }

  function segmented(container, options, value, onChange, label) {
    const wrap = d3.select(container).append("div").attr("class", "segmented").attr("role", "radiogroup");
    if (label) wrap.attr("aria-label", label);
    const btns = wrap.selectAll("button").data(options).join("button")
      .attr("type", "button")
      .attr("role", "radio")
      .attr("id", (d) => `seg-${label ? label.replace(/\W+/g, "-").toLowerCase() : "x"}-${d.value}`)
      .text((d) => d.label)
      .classed("on", (d) => d.value === value)
      .attr("aria-checked", (d) => d.value === value)
      .on("click", (e, d) => {
        btns.classed("on", (o) => o === d).attr("aria-checked", (o) => o === d);
        onChange(d.value);
      });
    return wrap;
  }

  function tooltip() {
    let el = document.querySelector(".tooltip");
    if (!el) {
      el = document.createElement("div");
      el.className = "tooltip";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
      window.addEventListener("scroll", () => { el.style.opacity = 0; }, { passive: true });
    }
    return {
      show(html, x, y) {
        el.innerHTML = html;
        el.style.opacity = 1;
        const r = el.getBoundingClientRect();
        const left = Math.max(8, Math.min(x + 14, window.innerWidth - r.width - 8));
        const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
        el.style.transform = `translate(${left}px, ${top}px)`;
      },
      hide() { el.style.opacity = 0; },
    };
  }

  const BLUE = ["#0d366b", "#184f95", "#2a78d6", "#6da7ec", "#b7d3f6"];
  const RED = ["#f6c9c4", "#ef8f89", "#e34948", "#b52f2f", "#7a1d1d"];
  function divergingTemp(minF, midF, maxF) {
    const mid = "#ecebe6";
    const cold = d3.scaleLinear().domain(d3.range(5).map((k) => minF + (k / 5) * (midF - minF)).concat(midF))
      .range([...BLUE, mid]).interpolate(d3.interpolateLab).clamp(true);
    const warm = d3.scaleLinear().domain([midF, ...d3.range(1, 6).map((k) => midF + (k / 5) * (maxF - midF))])
      .range([mid, ...RED]).interpolate(d3.interpolateLab).clamp(true);
    return (v) => (v < midF ? cold(v) : warm(v));
  }

  const SERIES = () => (isDark()
    ? ["#3987e5", "#d95926", "#199e70", "#d55181", "#9085e9", "#c98500"]
    : ["#2a78d6", "#eb6834", "#1baf7a", "#e87ba4", "#4a3aa7", "#eda100"]);

  const cToF = (c) => c * 9 / 5 + 32;
  const fmtTime = d3.timeFormat("%a %-I %p");
  const fmtPct = (p) => `${Math.round(p * 100)}%`;
  function fmtLead(h) {
    return h < 48 ? `${Math.round(h)} h ahead` : `${(h / 24).toFixed(1)} days ahead`;
  }
  function fmtRange(a, b) {
    const sameDay = d3.timeDay.floor(a).getTime() === d3.timeDay.floor(b).getTime();
    return sameDay
      ? `${d3.timeFormat("%a %-I %p")(a)} to ${d3.timeFormat("%-I %p")(b)}`
      : `${fmtTime(a)} to ${fmtTime(b)}`;
  }

  function nearestTimeIndex(m, date) {
    return d3.minIndex(m.times, (d) => Math.abs(d - date));
  }

  function indicesIn(m, a, b) {
    const out = [];
    for (let k = 0; k < m.nT; k++) if (m.times[k] >= a && m.times[k] <= b) out.push(k);
    return out;
  }

  function fail(root, err) {
    console.error(err);
    d3.select(root).html("").append("p").attr("class", "loading error")
      .text(`The forecast data did not load (${err.message}). Reload the page to try again.`);
  }

  return {
    TOWNS, css, isDark, onThemeChange, manifest, field, geo, cellLatLon, cellOf, placeName, createMap,
    labelTowns, legendRamp, timeAxis, yAxis, frame, responsive, segmented, tooltip, divergingTemp, SERIES,
    cToF, fmtTime, fmtPct, fmtLead, fmtRange, nearestTimeIndex, indicesIn, fail,
  };
})();
