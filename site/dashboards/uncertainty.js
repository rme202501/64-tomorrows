(async function main() {
  const C_TO_F = 9 / 5;
  const FOG_START_F = 2;
  const FOG_FULL_F = 10;
  const MAX_SELECTED = 4;
  const REF_NAMES = ["Boston", "Pittsfield", "Cape Cod", "Mt Washington"];

  const mapEl = document.getElementById("map");
  let m, temp, spread;
  try {
    m = await W.manifest();
    [temp, spread] = await Promise.all([W.field("t2m_mean"), W.field("t2m_spread")]);
  } catch (err) {
    return W.fail(document.getElementById("board"), err);
  }
  mapEl.classList.remove("loading");
  mapEl.textContent = "";

  const tip = W.tooltip();
  const maxH = m.leads_h.at(-1);
  const maxDays = maxH / 24;
  const fmtInit = d3.timeFormat("%a %b %-d, %-I %p");
  document.getElementById("run-info").textContent =
    `Forecast issued ${fmtInit(m.init)} · ${m.nT} time steps over ${maxDays} days · ${m.size.toLocaleString()} grid cells`;

  let t = 0;
  let win = null;
  let thresholdF = 7;
  let shadePast = true;
  let timer = null;

  const spreadSeries = (k) => Array.from(spread.series(k), (v) => v * C_TO_F);
  const refs = REF_NAMES.map((name) => {
    const k = W.cellOf(m, ...W.TOWNS[name]);
    return { k, name, short: name, ref: true, values: spreadSeries(k) };
  });
  let selected = [];
  addPlace(W.cellOf(m, ...W.TOWNS.Hartford));

  function addPlace(k) {
    if (selected.length >= MAX_SELECTED) selected.shift();
    const used = new Set(selected.map((s) => s.slot));
    const slot = d3.range(MAX_SELECTED).find((s) => !used.has(s));
    const name = W.placeName(m, k);
    selected.push({ k, name, short: name.replace(/^Near /, ""), slot, values: spreadSeries(k) });
  }
  const colorOf = (s) => (s.ref ? W.css("--ref-line") : W.SERIES()[s.slot]);

  function crossHours(get) {
    const thr = thresholdF;
    if (get(0) > thr) return m.leads_h[0];
    for (let q = 1; q < m.nT; q++) {
      const b = get(q);
      if (b > thr) {
        const a = get(q - 1);
        return m.leads_h[q - 1] + ((thr - a) / (b - a)) * (m.leads_h[q] - m.leads_h[q - 1]);
      }
    }
    return Infinity;
  }
  const cellHorizon = new Float32Array(m.size);
  function computeHorizons() {
    const v = spread.values;
    for (let k = 0; k < m.size; k++) cellHorizon[k] = crossHours((q) => v[q * m.size + k] * C_TO_F);
    for (const s of [...refs, ...selected]) s.horizon = crossHours((q) => s.values[q]);
  }
  computeHorizons();

  const viewLeadH = () => (win ? m.leads_h[win[1]] : m.leads_h[t]);

  // ---------- Map ----------
  const play = d3.select("#play");
  const slider = d3.select("#time-slider").attr("max", m.nT - 1);
  const timeLabel = d3.select("#time-label");
  play.on("click", () => (timer ? stop() : start()));
  slider.on("input", (e) => { stop(); setWindow(null); setTime(+e.target.value); });
  d3.select("#shade-past").on("change", (e) => { shadePast = e.target.checked; drawPast(); });

  function start() {
    setWindow(null);
    play.text("Pause");
    timer = d3.interval(() => setTime((t + 1) % m.nT), 160);
  }
  function stop() { play.text("Play"); timer?.stop(); timer = null; }

  const map = await W.createMap(mapEl, { onResize: () => drawMap() });
  const defs = map.svg.insert("defs", ":first-child");
  defs.append("pattern").attr("id", "past-hatch").attr("class", "past-hatch")
    .attr("width", 6).attr("height", 6).attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
    .append("line").attr("y2", 6);
  const pastPath = map.under.append("path").attr("class", "past-area");
  map.svg.classed("interactive", true);
  const tempColor = W.divergingTemp(20, 55, 90);
  const fogAlpha = (f) => Math.max(0, Math.min(1, (f - FOG_START_F) / (FOG_FULL_F - FOG_START_F)));

  function currentFields() {
    if (!win) {
      const tf = temp.frame(t);
      const sf = spread.frame(t);
      return { tempF: Float32Array.from(tf, W.cToF), spreadF: Float32Array.from(sf, (v) => v * C_TO_F) };
    }
    const tempF = new Float32Array(m.size);
    const spreadF = new Float32Array(m.size);
    let wsum = 0;
    for (let q = win[0]; q <= win[1]; q++) {
      const w = m.weightH[q];
      wsum += w;
      const tf = temp.frame(q);
      const sf = spread.frame(q);
      for (let k = 0; k < m.size; k++) { tempF[k] += w * tf[k]; spreadF[k] += w * sf[k]; }
    }
    for (let k = 0; k < m.size; k++) { tempF[k] = W.cToF(tempF[k] / wsum); spreadF[k] = spreadF[k] / wsum * C_TO_F; }
    return { tempF, spreadF };
  }

  let fields;
  function drawMap() {
    fields = currentFields();
    map.drawGrid(m, fields.tempF, tempColor);
    map.drawFog(m, (k) => fogAlpha(fields.spreadF[k]));
    drawPast();
    drawPins();
    if (win) {
      timeLabel.html(`Average, ${W.fmtRange(m.times[win[0]], m.times[win[1]])}`);
    } else {
      timeLabel.html(`${W.fmtTime(m.times[t])} <span class="muted">· ${W.fmtLead(m.leads_h[t])}</span>`);
    }
  }

  function drawPast() {
    if (!shadePast) { pastPath.attr("d", null); return; }
    const lead = viewLeadH();
    const mask = Float32Array.from(cellHorizon, (h) => (h <= lead ? 1 : 0));
    const [c] = d3.contours().size([m.nLon, m.nLat]).thresholds([0.5])(Array.from(mask));
    pastPath.attr("d", map.gridPath(m, c) || null);
  }

  function drawPins() {
    const proj = (s) => map.projection(W.cellLatLon(m, s.k).slice().reverse());
    const refSel = map.overlay.selectAll("g.town").data(refs, (d) => d.name).join((enter) => {
      const g = enter.append("g").attr("class", "town ref");
      g.append("circle").attr("r", 3.5);
      g.append("text").attr("x", 6).attr("y", 4).text((d) => d.name);
      return g;
    });
    refSel.attr("transform", (d) => `translate(${proj(d)})`).select("circle").attr("fill", W.css("--text-secondary"));
    const pinSel = map.overlay.selectAll("g.pin").data(selected, (d) => d.k).join((enter) => {
      const g = enter.append("g").attr("class", "pin");
      g.append("circle").attr("class", "halo").attr("r", 7);
      g.append("circle").attr("class", "ring").attr("r", 7);
      g.append("circle").attr("class", "dot").attr("r", 2.5);
      g.append("text").attr("x", 11).attr("y", 4);
      return g;
    });
    pinSel.attr("transform", (d) => `translate(${proj(d)})`);
    pinSel.select(".ring").attr("stroke", colorOf);
    pinSel.select(".dot").attr("fill", colorOf);
    pinSel.select("text").text((d) => d.short);
    pinSel.raise();
    W.labelTowns(map, map.overlay.selectAll("g.pin, g.town"));
  }

  d3.select(map.svg.node())
    .on("pointermove", (e) => {
      const [x, y] = d3.pointer(e);
      const k = map.cellAt(m, x, y);
      if (k == null || !fields) return tip.hide();
      const h = cellHorizon[k];
      const isSel = selected.some((s) => s.k === k);
      const horizonText = h === Infinity
        ? `Stays within ${thresholdF}°F all ${maxDays} days`
        : `Trust horizon <b>${(h / 24).toFixed(1)} days</b> <span class="sub">(${thresholdF}°F limit)</span>`;
      tip.show(`<b>${W.placeName(m, k)}</b><br>
        ${win ? "Average temperature" : "Most likely"} <b>${Math.round(fields.tempF[k])}°F</b><br>
        8 in 10 forecasts within a <b>${fields.spreadF[k].toFixed(1)}°F</b> range<br>
        ${horizonText}<br><span class="sub">${isSel ? "Click to remove from charts" : "Click to add to charts"}</span>`,
      e.clientX, e.clientY);
    })
    .on("pointerleave", () => tip.hide())
    .on("click", (e) => {
      const [x, y] = d3.pointer(e);
      const k = map.cellAt(m, x, y);
      if (k == null) return;
      const at = selected.findIndex((s) => s.k === k);
      if (at >= 0) selected.splice(at, 1);
      else addPlace(k);
      onSelectionChange();
      tip.hide();
    });

  function legend() {
    const el = d3.select("#map-legend");
    el.selectAll("*").remove();
    W.legendRamp(el.node(), tempColor, [20, 90], { label: "Most likely temperature (°F)", format: (d) => `${d}°`, width: 200 });
    el.append("span").attr("class", "legend-item")
      .html(`<i class="swatch fog"></i>Fog: forecasts disagree by ${FOG_START_F}°F or more (opaque at ${FOG_FULL_F}°F)`);
    el.append("span").attr("class", "legend-item")
      .html(`<i class="swatch hatch"></i>Past its trust horizon`);
  }

  function chips() {
    const el = d3.select("#chips");
    el.selectAll("*").remove();
    el.append("span").attr("class", "muted").style("color", "var(--muted)").text("Comparing");
    selected.forEach((s) => {
      const c = el.append("span").attr("class", "chip");
      c.append("span").attr("class", "dot").style("background", colorOf(s));
      c.append("span").text(s.name);
      c.append("button").attr("type", "button").attr("aria-label", `Remove ${s.name}`).text("×")
        .on("click", () => {
          selected = selected.filter((x) => x !== s);
          onSelectionChange();
        });
    });
    if (!selected.length) el.append("span").style("color", "var(--muted)").text("no places yet. Click the map to add one.");
    el.append("span").attr("class", "chip ref")
      .html(`<span class="dot" style="background:${W.css("--ref-line")}"></span>4 reference places in gray`);
  }

  // ---------- Growth chart ----------
  const growthEl = document.getElementById("growth");
  const G = {};

  function renderGrowth(width) {
    const wide = width >= 520;
    const height = wide ? 300 : 260;
    const { svg, g, w, h } = W.frame(growthEl, width, height, { top: 30, right: wide ? 118 : 14, bottom: 26, left: 36 });
    const series = [...refs, ...selected];
    const x = d3.scaleTime().domain([m.times[0], m.times.at(-1)]).range([0, w]);
    const yMax = Math.max(16, d3.max(series, (s) => d3.max(s.values)) * 1.04);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([h, 0]);
    Object.assign(G, { svg, g, w, h, x, y, wide });

    W.yAxis(g, y, w, { format: (d) => `${d}°`, label: "Spread (°F)" });
    W.timeAxis(g, x, h, w);

    G.brush = d3.brushX().extent([[0, 0], [w, h]])
      .on("brush", (e) => { if (e.sourceEvent) brushed(e.selection, false); })
      .on("end", (e) => {
        if (!e.sourceEvent) return;
        if (!e.selection) {
          const [mx] = d3.pointer(e.sourceEvent, g.node());
          stop();
          setWindow(null);
          setTime(W.nearestTimeIndex(m, x.invert(mx)));
          return;
        }
        brushed(e.selection, true);
      });
    G.brushG = g.append("g").attr("class", "brush").call(G.brush);

    const line = d3.line().x((_, q) => x(m.times[q])).y((v) => y(v)).curve(d3.curveMonotoneX);
    g.append("g").selectAll("path").data(series).join("path")
      .attr("class", "series-line")
      .attr("stroke", colorOf)
      .attr("stroke-width", (d) => (d.ref ? 1.4 : 2.6))
      .attr("d", (d) => line(d.values));

    if (wide) {
      const last = m.nT - 1;
      const ys = dodge(series.map((s) => y(s.values[last])), 13);
      g.append("g").attr("class", "direct-labels").selectAll("text").data(series).join("text")
        .attr("x", w + 6).attr("y", (_, i) => ys[i] + 4)
        .attr("fill", (d) => (d.ref ? W.css("--muted") : colorOf(d)))
        .attr("font-weight", (d) => (d.ref ? 400 : 600))
        .text((d) => truncate(d.short, 16));
    }

    G.cursor = g.append("line").attr("class", "cursor-line").attr("y1", -6).attr("y2", h);
    G.cursorDots = g.append("g");
    G.hoverLine = g.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", h).style("opacity", 0);
    G.crossings = g.append("g");

    const thr = g.append("g").attr("class", "threshold").attr("tabindex", 0).attr("role", "slider")
      .attr("aria-label", "Trust limit in degrees Fahrenheit").attr("aria-valuemin", 2).attr("aria-valuemax", 15);
    thr.append("rect").attr("class", "threshold-hit").attr("x", 0).attr("width", w).attr("y", -7).attr("height", 14);
    thr.append("line").attr("class", "threshold-line").attr("x1", 0).attr("x2", w);
    const tag = thr.append("g").attr("class", "threshold-tag").style("cursor", "ns-resize");
    tag.append("rect").attr("rx", 4).attr("height", 18).attr("y", -9);
    tag.append("text").attr("y", 4).attr("x", 7);
    thr.call(d3.drag()
      .on("start", () => thr.classed("dragging", true))
      .on("drag", (e) => setThreshold(y.invert(e.y)))
      .on("end", () => thr.classed("dragging", false)));
    thr.on("keydown", (e) => {
      const step = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5 }[e.key];
      if (step) { e.preventDefault(); setThreshold(thresholdF + step); }
    });
    G.thr = thr;
    G.tag = tag;

    G.brushG.on("pointermove.tip", (e) => {
      const [mx] = d3.pointer(e, g.node());
      const q = W.nearestTimeIndex(m, x.invert(mx));
      G.hoverLine.attr("x1", x(m.times[q])).attr("x2", x(m.times[q])).style("opacity", 1);
      const rows = [...selected, ...refs].map((s) =>
        `<i style="background:${colorOf(s)}"></i>${s.short}: <b>${s.values[q].toFixed(1)}°F</b>`);
      tip.show(`<b>${W.fmtTime(m.times[q])}</b> <span class="sub">${W.fmtLead(m.leads_h[q])}</span><br>${rows.join("<br>")}`,
        e.clientX, e.clientY);
    }).on("pointerleave.tip", () => { G.hoverLine.style("opacity", 0); tip.hide(); });

    if (win) G.brushG.call(G.brush.move, [x(m.times[win[0]]), x(m.times[win[1]])]);
    positionThreshold();
    positionCursor();
  }

  function brushed(sel, final) {
    const idx = W.indicesIn(m, G.x.invert(sel[0]), G.x.invert(sel[1]));
    if (idx.length < 2) {
      if (final) { G.brushG.call(G.brush.move, null); setWindow(null); }
      return;
    }
    stop();
    win = [idx[0], idx.at(-1)];
    if (final) G.brushG.call(G.brush.move, [G.x(m.times[win[0]]), G.x(m.times[win[1]])]);
    scheduleWindowUpdate();
  }

  let raf = 0;
  function scheduleWindowUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      drawMap();
      positionCursor();
      renderHorizon();
      windowInfo();
    });
  }

  function setWindow(next) {
    if (!next && !win) return;
    win = next;
    if (!win && G.brushG) G.brushG.call(G.brush.move, null);
    scheduleWindowUpdate();
  }

  function setTime(q) {
    t = q;
    slider.property("value", t);
    drawMap();
    positionCursor();
    renderHorizon();
    windowInfo();
  }

  function positionCursor() {
    if (!G.g) return;
    const { x, y } = G;
    G.cursor.style("display", win ? "none" : null).attr("x1", x(m.times[t])).attr("x2", x(m.times[t]));
    G.cursorDots.selectAll("circle").data(win ? [] : selected, (d) => d.k).join("circle")
      .attr("class", "cross-dot").attr("r", 4.5).attr("fill", colorOf)
      .attr("cx", x(m.times[t])).attr("cy", (d) => y(d.values[t]));
  }

  function positionThreshold() {
    const { y, w } = G;
    G.thr.attr("transform", `translate(0,${y(thresholdF)})`).attr("aria-valuenow", thresholdF)
      .attr("aria-valuetext", `${thresholdF} degrees`);
    G.tag.select("text").text(`Trust limit ${thresholdF}°F ↕`);
    const tw = G.tag.select("text").node().getComputedTextLength() + 14;
    G.tag.select("rect").attr("width", tw);
    G.tag.attr("transform", `translate(${Math.max(0, w - tw - 4)},0)`);
    const toX = (hrs) => G.x(new Date(+m.init + hrs * 3600e3));
    const marks = [...refs, ...selected].filter((s) => s.horizon < Infinity);
    G.crossings.selectAll("circle").data(marks, (d) => `${d.ref ? "r" : "s"}${d.k}`).join("circle")
      .attr("class", "cross-dot")
      .attr("r", (d) => (d.ref ? 3.5 : 5))
      .attr("fill", colorOf)
      .attr("cx", (d) => toX(d.horizon))
      .attr("cy", y(thresholdF));
    G.crossings.raise();
    G.thr.raise();
  }

  function setThreshold(v) {
    const next = Math.max(2, Math.min(15, Math.round(v * 2) / 2));
    if (next === thresholdF) return;
    thresholdF = next;
    computeHorizons();
    positionThreshold();
    drawPast();
    renderHorizon();
  }

  function windowInfo() {
    const el = d3.select("#window-info");
    el.selectAll("*").remove();
    if (!win) {
      el.append("span").html(`Map shows <b>${W.fmtTime(m.times[t])}</b>. Drag across the chart to average a window.`);
      return;
    }
    const hrs = m.leads_h[win[1]] - m.leads_h[win[0]];
    el.append("span").html(`Map shows the average over <b>${W.fmtRange(m.times[win[0]], m.times[win[1]])}</b> (${hrs} h)`);
    el.append("button").attr("type", "button").attr("class", "btn small").attr("id", "clear-window").text("Clear window")
      .on("click", () => setWindow(null));
  }

  // ---------- Trust horizon chart ----------
  const horizonEl = document.getElementById("horizon");
  let horizonWidth = 0;

  function renderHorizon(width = horizonWidth) {
    if (!width) return;
    horizonWidth = width;
    const narrow = width < 440;
    const rows = [...selected, ...refs];
    const histH = 46;
    const rowH = 26;
    const labelW = narrow ? 104 : 132;
    const margin = { top: 22, right: 46, bottom: 26, left: labelW };
    const height = margin.top + histH + 14 + rows.length * rowH + margin.bottom;
    const { g, w, h } = W.frame(horizonEl, width, height, margin);
    const capDays = maxDays + 1.1;
    const x = d3.scaleLinear().domain([0, capDays]).range([0, w]);
    const xd = (hrs) => x(hrs === Infinity ? maxDays + 0.7 : Math.min(maxDays, hrs / 24));
    const valueText = (hrs) => (hrs === Infinity ? `${maxDays}+ d` : `${(hrs / 24).toFixed(1)} d`);

    g.append("g").attr("class", "gridlines").selectAll("line").data(d3.range(0, maxDays + 1)).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", h);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues([...d3.range(0, maxDays + 1), maxDays + 0.7]).tickSize(4)
        .tickFormat((d) => (d > maxDays ? "all wk" : `${d}d`)))
      .call((s) => s.select(".domain").remove());

    const bins = d3.range(0, maxDays * 4).map((b) => ({ x0: b / 4, x1: (b + 1) / 4, n: 0 }));
    let never = 0;
    for (let k = 0; k < m.size; k++) {
      const hd = cellHorizon[k] / 24;
      if (hd === Infinity) never++;
      else bins[Math.min(bins.length - 1, Math.floor(hd * 4))].n++;
    }
    const maxN = Math.max(never, d3.max(bins, (b) => b.n));
    const yh = d3.scaleLinear().domain([0, maxN]).range([0, histH]);
    const hist = g.append("g");
    hist.selectAll("rect").data(bins).join("rect").attr("class", "hz-bar")
      .attr("x", (b) => x(b.x0) + 0.5).attr("width", (b) => Math.max(0.5, x(b.x1) - x(b.x0) - 1))
      .attr("y", (b) => histH - yh(b.n)).attr("height", (b) => yh(b.n)).attr("opacity", 0.55);
    hist.append("rect").attr("class", "hz-bar").attr("opacity", 0.3)
      .attr("x", x(maxDays + 0.45)).attr("width", x(maxDays + 0.95) - x(maxDays + 0.45))
      .attr("y", histH - yh(never)).attr("height", yh(never));
    hist.append("text").attr("class", "hz-label").attr("x", -10).attr("y", histH / 2 - 7).attr("text-anchor", "end").text("Whole map");
    hist.append("text").attr("class", "hz-sub").attr("x", -10).attr("y", histH / 2 + 8).attr("text-anchor", "end").text("share of area");
    hist.append("line").attr("class", "hz-track").attr("x1", 0).attr("x2", w).attr("y1", histH + 0.5).attr("y2", histH + 0.5);
    hist.append("rect").attr("class", "hz-row-hit").attr("width", w).attr("height", histH)
      .on("pointermove", (e) => {
        const d = x.invert(d3.pointer(e)[0]);
        const share = (n) => `${((n / m.size) * 100).toFixed(1)}%`;
        if (d > maxDays) return tip.show(`<b>${share(never)}</b> of the map stays within ${thresholdF}°F all week`, e.clientX, e.clientY);
        const b = bins[Math.max(0, Math.min(bins.length - 1, Math.floor(d * 4)))];
        tip.show(`<b>${share(b.n)}</b> of the map passes its horizon between day ${b.x0} and ${b.x1}`, e.clientX, e.clientY);
      })
      .on("pointerleave", () => tip.hide());

    const viewLead = viewLeadH();
    const rowsG = g.append("g").attr("transform", `translate(0,${histH + 14})`);
    const row = rowsG.selectAll("g").data(rows).join("g").attr("transform", (_, i) => `translate(0,${i * rowH + rowH / 2})`);
    row.append("line").attr("class", "hz-track").attr("x1", 0).attr("x2", w);
    row.append("rect").attr("rx", 3).attr("y", -3.5).attr("height", 7)
      .attr("width", (d) => xd(d.horizon)).attr("fill", colorOf).attr("opacity", (d) => (d.ref ? 0.55 : 0.4));
    row.append("circle").attr("cx", (d) => xd(d.horizon)).attr("r", (d) => (d.ref ? 4 : 5.5))
      .attr("fill", (d) => (d.horizon <= viewLead ? W.css("--surface-1") : colorOf(d)))
      .attr("stroke", colorOf).attr("stroke-width", 2);
    row.append("text").attr("class", (d) => `hz-value${d.horizon <= viewLead ? " past" : ""}`)
      .attr("x", (d) => xd(d.horizon) + 9).attr("y", 1)
      .text((d) => valueText(d.horizon));
    row.append("text").attr("class", (d) => `hz-label${d.ref ? " ref" : ""}`).attr("x", -10).attr("y", 1).attr("text-anchor", "end")
      .attr("font-weight", (d) => (d.ref ? 400 : 600))
      .text((d) => truncate(d.short, narrow ? 14 : 18));
    row.append("rect").attr("class", "hz-row-hit").attr("x", -labelW).attr("y", -rowH / 2).attr("width", w + labelW + 40).attr("height", rowH)
      .on("pointermove", (e, d) => {
        const status = d.horizon === Infinity
          ? `Stays within ${thresholdF}°F for all ${maxDays} days`
          : `Spread passes ${thresholdF}°F at <b>${W.fmtTime(new Date(+m.init + d.horizon * 3600e3))}</b><br>${(d.horizon / 24).toFixed(1)} days after the forecast was issued`;
        const now = d.horizon <= viewLead ? "<br><span class=\"sub\">Already past its horizon at the time shown on the map</span>" : "";
        tip.show(`<b>${d.name}</b><br>${status}${now}`, e.clientX, e.clientY);
      })
      .on("pointerleave", () => tip.hide());

    const nx = x(Math.min(maxDays, viewLead / 24));
    g.append("line").attr("class", "hz-now").attr("x1", nx).attr("x2", nx).attr("y1", -6).attr("y2", h);
    const label = win ? "window end" : "map time";
    g.append("text").attr("class", "hz-now-label").attr("y", -10).attr("x", nx)
      .attr("text-anchor", nx > w - 40 ? "end" : nx < 40 ? "start" : "middle").text(label);

    statLine();
  }

  function statLine() {
    const sorted = Float32Array.from(cellHorizon).sort();
    const med = sorted[Math.floor(sorted.length / 2)];
    const never = sorted.filter((v) => v === Infinity).length / m.size;
    const medText = med === Infinity ? `all ${maxDays} days` : `${(med / 24).toFixed(1)} days`;
    d3.select("#horizon-stat").html(
      `With a <b>${thresholdF}°F</b> limit, half the map stays trustworthy for <b>${medText}</b> or more, and <b>${Math.round(never * 100)}%</b> stays trustworthy all week.`);
  }

  function onSelectionChange() {
    computeHorizons();
    chips();
    drawPins();
    redrawGrowth();
    renderHorizon();
  }

  function truncate(s, n) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
  function dodge(ys, gap) {
    const order = d3.range(ys.length).sort((a, b) => ys[a] - ys[b]);
    const out = ys.slice();
    for (let n = 1; n < order.length; n++) {
      const prev = out[order[n - 1]];
      if (out[order[n]] - prev < gap) out[order[n]] = prev + gap;
    }
    return out;
  }

  t = m.leads_h.indexOf(72);
  slider.property("value", t);
  legend();
  chips();
  drawMap();
  windowInfo();
  const redrawGrowth = W.responsive(growthEl, renderGrowth);
  const redrawHorizon = W.responsive(horizonEl, (w) => renderHorizon(w));
  W.onThemeChange(() => { drawMap(); legend(); chips(); redrawGrowth(); redrawHorizon(); });
})();
