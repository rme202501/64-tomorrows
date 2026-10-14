(async function main() {
  // Each rule returns 2 good, 1 marginal, 0 poor. Inputs: feels-like °F, precipitation chance, wind mph.
  const ACTIVITIES = {
    run: { label: "Run", noun: "running", rule: (f, r, w) => Math.min(f >= 40 && f <= 75 ? 2 : f >= 25 && f <= 85 ? 1 : 0, r < 0.2 ? 2 : r < 0.5 ? 1 : 0, w < 15 ? 2 : w < 25 ? 1 : 0) },
    bike: { label: "Bike", noun: "biking", rule: (f, r, w) => Math.min(f >= 50 && f <= 80 ? 2 : f >= 35 && f <= 88 ? 1 : 0, r < 0.15 ? 2 : r < 0.4 ? 1 : 0, w < 12 ? 2 : w < 20 ? 1 : 0) },
    beach: { label: "Beach", noun: "the beach", rule: (f, r, w) => Math.min(f >= 75 ? 2 : f >= 65 ? 1 : 0, r < 0.15 ? 2 : r < 0.3 ? 1 : 0, w < 15 ? 2 : w < 22 ? 1 : 0) },
    picnic: { label: "Picnic", noun: "a picnic", rule: (f, r, w) => Math.min(f >= 60 && f <= 85 ? 2 : f >= 50 && f <= 90 ? 1 : 0, r < 0.1 ? 2 : r < 0.3 ? 1 : 0, w < 10 ? 2 : w < 18 ? 1 : 0) },
  };
  const VERDICT = ["Poor", "Marginal", "Good"];
  const MS_TO_MPH = 2.237;
  const ICE_START = 0.2;
  const MELT_C = 2;
  const MELT_HOURS = 6;
  const TOWN_LABELS = ["Boston", "Worcester", "Springfield", "Pittsfield", "Cape Cod", "Providence", "Hartford",
    "Portland ME", "Burlington VT", "Concord NH", "Mt Washington"];

  const mapEl = document.getElementById("map");
  let m, F;
  try {
    m = await W.manifest();
    const names = ["t2m_p10", "t2m_p25", "t2m_p50", "t2m_p75", "t2m_p90", "t2m_mean", "feels_like", "p_rain", "wind_mean", "p_freezing_precip"];
    const loaded = await Promise.all(names.map(W.field));
    F = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  } catch (err) {
    return W.fail(document.getElementById("board"), err);
  }
  mapEl.classList.remove("loading");
  mapEl.textContent = "";

  const tip = W.tooltip();
  const fmtInit = d3.timeFormat("%a %b %-d, %-I %p");
  document.getElementById("run-info").textContent =
    `Forecast issued ${fmtInit(m.init)} · next ${m.leads_h.at(-1) / 24} days · ${m.size.toLocaleString()} grid cells`;

  let activity = "run";
  let mapMode = "suit";
  let cell = W.cellOf(m, ...W.TOWNS.Boston);
  const day2 = d3.timeDay.offset(d3.timeDay.floor(m.times[0]), 1);
  const defaultIdx = W.indicesIn(m, d3.timeHour.offset(day2, 8), d3.timeHour.offset(day2, 20));
  let win = [defaultIdx[0], defaultIdx.at(-1)];

  const score = (q, k) => ACTIVITIES[activity].rule(
    W.cToF(F.feels_like.at(q, k)), F.p_rain.at(q, k), F.wind_mean.at(q, k) * MS_TO_MPH);
  const winIdx = () => d3.range(win[0], win[1] + 1);
  const winHours = () => d3.sum(winIdx(), (q) => m.weightH[q]);

  const colors = {
    suit: () => d3.scaleLinear().domain([0, 0.5, 1])
      .range([W.css("--critical"), W.css("--warning"), W.css("--good")]).interpolate(d3.interpolateLab).clamp(true),
    status: (s) => [W.css("--critical"), W.css("--warning"), W.css("--good")][s],
    temp: W.divergingTemp(20, 55, 90),
  };

  let worstIce = 0;
  {
    let best = -1;
    for (let k = 0; k < m.size; k++) {
      let mx = 0;
      for (let q = 0; q < m.nT; q++) mx = Math.max(mx, F.p_freezing_precip.at(q, k));
      if (mx > best) { best = mx; worstIce = k; }
    }
  }

  // ---------- Controls ----------
  W.segmented(document.getElementById("activity"),
    Object.entries(ACTIVITIES).map(([value, a]) => ({ label: a.label, value })), activity,
    (v) => { activity = v; updateAll(); }, "Activity");
  W.segmented(document.getElementById("map-mode"),
    [{ label: "Activity rating", value: "suit" }, { label: "Feels like", value: "feels" }], mapMode,
    (v) => { mapMode = v; drawMap(); }, "Map shows");

  // ---------- Map ----------
  const map = await W.createMap(mapEl, { onResize: () => drawMap() });
  map.svg.classed("interactive", true);
  let mapVals;

  function windowStats(k) {
    const hrs = [0, 0, 0];
    let feelsSum = 0;
    let wsum = 0;
    let feelsMin = Infinity;
    let feelsMax = -Infinity;
    let rainMax = 0;
    let iceMax = 0;
    let windMax = 0;
    for (const q of winIdx()) {
      const w = m.weightH[q];
      const f = W.cToF(F.feels_like.at(q, k));
      hrs[score(q, k)] += w;
      feelsSum += w * f;
      wsum += w;
      feelsMin = Math.min(feelsMin, f);
      feelsMax = Math.max(feelsMax, f);
      rainMax = Math.max(rainMax, F.p_rain.at(q, k));
      iceMax = Math.max(iceMax, F.p_freezing_precip.at(q, k));
      windMax = Math.max(windMax, F.wind_mean.at(q, k) * MS_TO_MPH);
    }
    return { hrs, total: wsum, suit: (hrs[2] + 0.5 * hrs[1]) / wsum, feels: feelsSum / wsum, feelsMin, feelsMax, rainMax, iceMax, windMax };
  }

  function drawMap() {
    const stats = Array.from({ length: m.size }, (_, k) => windowStats(k));
    mapVals = stats;
    if (mapMode === "suit") map.drawGrid(m, stats.map((s) => s.suit), colors.suit());
    else map.drawGrid(m, stats.map((s) => s.feels), colors.temp);
    drawPins();
    mapLegend();
    d3.select("#map-question").text(mapMode === "suit"
      ? `Where is it good for ${ACTIVITIES[activity].noun}?`
      : "What will it feel like outside?");
  }

  function drawPins() {
    const proj = (k) => map.projection(W.cellLatLon(m, k).slice().reverse());
    const towns = map.overlay.selectAll("g.town").data(TOWN_LABELS, (d) => d).join((enter) => {
      const g = enter.append("g").attr("class", "town ref");
      g.append("circle").attr("r", 3);
      g.append("text").attr("x", 5).attr("y", 4).text((d) => d);
      return g;
    });
    towns.attr("transform", (d) => `translate(${map.projection([W.TOWNS[d][1], W.TOWNS[d][0]])})`)
      .select("circle").attr("fill", W.css("--text-secondary"));
    const pin = map.overlay.selectAll("g.pin").data([cell]).join((enter) => {
      const g = enter.append("g").attr("class", "pin");
      g.append("circle").attr("class", "halo").attr("r", 8);
      g.append("circle").attr("class", "ring").attr("r", 8);
      g.append("circle").attr("class", "dot").attr("r", 2.5);
      g.append("text").attr("x", 12).attr("y", 4);
      return g;
    });
    pin.attr("transform", (k) => `translate(${proj(k)})`);
    pin.select(".ring").attr("stroke", W.css("--text-primary"));
    pin.select(".dot").attr("fill", W.css("--text-primary"));
    pin.select("text").text((k) => W.placeName(m, k).replace(/^Near /, ""));
    pin.raise();
    W.labelTowns(map, map.overlay.selectAll("g.pin, g.town"));
  }

  function mapLegend() {
    const el = d3.select("#map-legend");
    el.selectAll("*").remove();
    if (mapMode === "suit") {
      W.legendRamp(el.node(), colors.suit(), [0, 1], {
        label: `Share of your window that suits ${ACTIVITIES[activity].noun}`,
        format: (d) => (d === 0 ? "Poor" : d === 1 ? "Good" : d === 0.5 ? "Mixed" : ""),
        ticks: 2, width: 200,
      });
      el.append("span").attr("class", "legend-item").style("color", "var(--muted)")
        .text("Good hours count fully, marginal hours count half");
    } else {
      W.legendRamp(el.node(), colors.temp, [20, 90], { label: "Average feels-like temperature in your window (°F)", format: (d) => `${d}°`, width: 200 });
    }
  }

  d3.select(map.svg.node())
    .on("pointermove", (e) => {
      const [x, y] = d3.pointer(e);
      const k = map.cellAt(m, x, y);
      if (k == null || !mapVals) return tip.hide();
      const s = mapVals[k];
      const h = (v) => `${Math.round(v)} h`;
      tip.show(`<b>${W.placeName(m, k)}</b><br>
        ${ACTIVITIES[activity].label}: <i style="background:${colors.status(2)}"></i>${h(s.hrs[2])} good,
        ${h(s.hrs[1])} marginal, ${h(s.hrs[0])} poor<br>
        Feels like ${Math.round(s.feelsMin)}° to ${Math.round(s.feelsMax)}°F<br>
        Precipitation chance up to ${W.fmtPct(s.rainMax)} · wind up to ${Math.round(s.windMax)} mph<br>
        <span class="sub">Click to chart this spot</span>`, e.clientX, e.clientY);
    })
    .on("pointerleave", () => tip.hide())
    .on("click", (e) => {
      const [x, y] = d3.pointer(e);
      const k = map.cellAt(m, x, y);
      if (k == null) return;
      cell = k;
      tip.hide();
      drawPins();
      updatePlace();
    });

  // ---------- Shared chart pieces ----------
  const MARGIN = { top: 28, right: 14, bottom: 26, left: 40 };
  const series = (name) => Array.from(F[name].series(cell));
  const charts = {};

  function goSpans() {
    const spans = [];
    let start = null;
    for (let q = 0; q < m.nT; q++) {
      const good = score(q, cell) === 2;
      if (good && start == null) start = q;
      if (!good && start != null) { spans.push([start, q - 1]); start = null; }
    }
    if (start != null) spans.push([start, m.nT - 1]);
    return spans;
  }

  function drawGo(g, x, h) {
    const spans = goSpans();
    const sg = g.append("g");
    sg.selectAll("rect").data(spans).join("rect").attr("class", "go-span")
      .attr("x", (d) => x(m.edgeTimes[d[0]])).attr("width", (d) => x(m.edgeTimes[d[1] + 1]) - x(m.edgeTimes[d[0]]))
      .attr("y", 0).attr("height", h);
    sg.selectAll("line").data(spans).join("line").attr("class", "go-edge")
      .attr("x1", (d) => x(m.edgeTimes[d[0]])).attr("x2", (d) => x(m.edgeTimes[d[1] + 1]))
      .attr("y1", h + 0.5).attr("y2", h + 0.5);
  }

  function hoverAt(q, e) {
    for (const c of Object.values(charts)) {
      if (!c.hover) continue;
      if (q == null) { c.hover.style("opacity", 0); continue; }
      const xq = c.x(m.times[q]);
      c.hover.attr("x1", xq).attr("x2", xq).style("opacity", 1);
    }
    if (q == null) return tip.hide();
    const p = (n) => F[n].at(q, cell);
    const f = W.cToF(p("feels_like"));
    const s = score(q, cell);
    tip.show(`<b>${W.fmtTime(m.times[q])}</b> <span class="sub">${W.fmtLead(m.leads_h[q])}</span><br>
      Most likely <b>${Math.round(W.cToF(p("t2m_p50")))}°F</b>, feels like ${Math.round(f)}°F<br>
      8 in 10 forecasts: ${Math.round(W.cToF(p("t2m_p10")))}° to ${Math.round(W.cToF(p("t2m_p90")))}°F<br>
      Precipitation ${W.fmtPct(p("p_rain"))} · freezing ${W.fmtPct(p("p_freezing_precip"))}<br>
      Wind ${Math.round(p("wind_mean") * MS_TO_MPH)} mph<br>
      <i style="background:${colors.status(s)}"></i>${VERDICT[s]} for ${ACTIVITIES[activity].noun}`,
    e.clientX, e.clientY);
  }
  const pointerTime = (e, c) => W.nearestTimeIndex(m, c.x.invert(d3.pointer(e, c.g.node())[0]));

  // ---------- Fan chart ----------
  const fanEl = document.getElementById("fan");
  function renderFan(width) {
    const height = width < 480 ? 250 : 280;
    const { g, w, h } = W.frame(fanEl, width, height, MARGIN);
    const q = Object.fromEntries(["p10", "p25", "p50", "p75", "p90"].map((k) => [k, series(`t2m_${k}`).map(W.cToF)]));
    const x = d3.scaleTime().domain([m.edgeTimes[0], m.edgeTimes.at(-1)]).range([0, w]);
    const y = d3.scaleLinear().domain([d3.min(q.p10) - 2, d3.max(q.p90) + 2]).nice().range([h, 0]);
    const c = { g, x, w, h };
    charts.fan = c;
    const color = W.SERIES()[1];

    drawGo(g, x, h);
    W.yAxis(g, y, w, { format: (d) => `${d}°`, label: "°F" });
    W.timeAxis(g, x, h, w);

    const band = (lo, hi) => d3.area().x((_, i) => x(m.times[i])).y0((_, i) => y(lo[i])).y1((_, i) => y(hi[i]))
      .curve(d3.curveMonotoneX)(m.times);
    g.append("path").attr("d", band(q.p10, q.p90)).attr("fill", color).attr("opacity", 0.18).attr("pointer-events", "none");
    g.append("path").attr("d", band(q.p25, q.p75)).attr("fill", color).attr("opacity", 0.32).attr("pointer-events", "none");
    g.append("path").attr("class", "series-line").attr("stroke", color).attr("stroke-width", 2.2)
      .attr("d", d3.line().x((_, i) => x(m.times[i])).y((v) => y(v)).curve(d3.curveMonotoneX)(q.p50));

    c.brush = d3.brushX().extent([[0, 0], [w, h]])
      .on("brush", (e) => { if (e.sourceEvent) brushed(e.selection, false); })
      .on("end", (e) => {
        if (!e.sourceEvent) return;
        if (!e.selection) {
          const at = x.invert(d3.pointer(e.sourceEvent, g.node())[0]);
          const idx = W.indicesIn(m, d3.timeHour.offset(at, -6), d3.timeHour.offset(at, 6));
          if (idx.length >= 2) setWindow([idx[0], idx.at(-1)]);
          c.brushG.call(c.brush.move, [x(m.times[win[0]]), x(m.times[win[1]])]);
          return;
        }
        brushed(e.selection, true);
      });
    c.brushG = g.append("g").attr("class", "brush").call(c.brush);
    c.brushG.call(c.brush.move, [x(m.times[win[0]]), x(m.times[win[1]])]);
    c.hover = g.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", h).style("opacity", 0);
    c.brushG.on("pointermove.tip", (e) => hoverAt(pointerTime(e, c), e))
      .on("pointerleave.tip", () => hoverAt(null));

    const leg = d3.select("#fan-legend");
    leg.selectAll("*").remove();
    leg.html(`<span class="legend-item"><i class="swatch line" style="background:${color}"></i>Most likely</span>
      <span class="legend-item"><i class="swatch" style="background:${color};opacity:.5"></i>Half of forecasts</span>
      <span class="legend-item"><i class="swatch" style="background:${color};opacity:.22"></i>8 in 10 forecasts</span>
      <span class="legend-item"><i class="swatch good"></i>Good for ${ACTIVITIES[activity].noun}</span>`);
  }

  function brushed(sel, final) {
    const c = charts.fan;
    const idx = W.indicesIn(m, c.x.invert(sel[0]), c.x.invert(sel[1]));
    if (idx.length < 2) {
      if (final) c.brushG.call(c.brush.move, [c.x(m.times[win[0]]), c.x(m.times[win[1]])]);
      return;
    }
    if (final) c.brushG.call(c.brush.move, [c.x(m.times[idx[0]]), c.x(m.times[idx.at(-1)])]);
    setWindow([idx[0], idx.at(-1)]);
  }

  let raf = 0;
  function setWindow(next) {
    if (next[0] === win[0] && next[1] === win[1]) return;
    win = next;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      drawMap();
      summary();
      positionWindowMark();
    });
  }

  // ---------- Precipitation chart ----------
  const precipEl = document.getElementById("precip");
  function iceSpans(pIce, t2m) {
    const spans = [];
    let start = null;
    let warmSince = null;
    for (let q = 0; q < m.nT; q++) {
      if (start == null && pIce[q] >= ICE_START) start = q;
      if (start == null) continue;
      if (t2m[q] > MELT_C) {
        warmSince ??= q;
        if (m.leads_h[q] - m.leads_h[warmSince] >= MELT_HOURS) {
          spans.push([start, q]);
          start = null;
          warmSince = null;
        }
      } else warmSince = null;
    }
    if (start != null) spans.push([start, m.nT - 1]);
    return spans;
  }

  function renderPrecip(width) {
    const height = width < 480 ? 200 : 220;
    const { g, w, h } = W.frame(precipEl, width, height, MARGIN);
    const x = d3.scaleTime().domain([m.edgeTimes[0], m.edgeTimes.at(-1)]).range([0, w]);
    const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
    const c = { g, x, w, h };
    charts.precip = c;
    const [rainC, iceC] = [W.SERIES()[0], W.SERIES()[4]];
    const rain = series("p_rain");
    const ice = series("p_freezing_precip");
    const spans = iceSpans(ice, series("t2m_mean"));

    g.append("defs").append("pattern").attr("id", "ice-hatch").attr("width", 6).attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
      .append("line").attr("y2", 6);
    drawGo(g, x, h);
    g.append("g").selectAll("rect").data(spans).join("rect").attr("class", "ice-span")
      .attr("x", (d) => x(m.edgeTimes[d[0]])).attr("width", (d) => Math.max(2, x(m.edgeTimes[d[1] + 1]) - x(m.edgeTimes[d[0]])))
      .attr("y", 0).attr("height", h);
    W.yAxis(g, y, w, { format: d3.format(".0%"), ticks: 4, label: "Chance" });
    W.timeAxis(g, x, h, w);

    const area = (vals) => d3.area().x((_, i) => x(m.edgeTimes[i])).y0(h).y1((v) => y(v)).curve(d3.curveStepAfter)([...vals, vals.at(-1)]);
    g.append("path").attr("d", area(rain)).attr("fill", rainC).attr("opacity", 0.4).attr("pointer-events", "none");
    g.append("path").attr("d", area(ice)).attr("fill", iceC).attr("opacity", 0.9).attr("pointer-events", "none");

    c.mark = g.append("rect").attr("class", "window-mark").attr("y", 0).attr("height", h);
    c.hover = g.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", h).style("opacity", 0);
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => hoverAt(pointerTime(e, c), e))
      .on("pointerleave", () => hoverAt(null));
    positionWindowMark();

    d3.select("#precip-legend").html(`<span class="legend-item"><i class="swatch" style="background:${rainC};opacity:.5"></i>Any precipitation</span>
      <span class="legend-item"><i class="swatch" style="background:${iceC}"></i>Freezing precipitation</span>
      <span class="legend-item"><i class="swatch hatch"></i>Ice likely on the ground</span>
      <span class="legend-item"><i class="swatch good"></i>Good for ${ACTIVITIES[activity].noun}</span>
      <span class="legend-item"><i class="swatch window"></i>Your window</span>`);

    const maxIce = d3.max(ice);
    const note = d3.select("#precip-note");
    note.selectAll("*").remove();
    if (maxIce < 0.05) {
      note.append("span").html(`No meaningful chance of freezing precipitation here this week.`);
      if (cell !== worstIce) {
        note.append("button").attr("type", "button").attr("class", "btn small").attr("id", "show-ice")
          .text(`Show the riskiest spot (${W.placeName(m, worstIce).replace(/^Near /, "")})`)
          .on("click", () => { cell = worstIce; drawPins(); updatePlace(); });
      }
    } else {
      note.append("span").html(`Peak chance of freezing precipitation here: <b>${W.fmtPct(maxIce)}</b>, ${W.fmtTime(m.times[d3.maxIndex(ice)])}.`);
    }
  }

  function positionWindowMark() {
    const c = charts.precip;
    if (!c?.mark) return;
    const a = c.x(m.times[win[0]]);
    c.mark.attr("x", a).attr("width", c.x(m.times[win[1]]) - a);
  }

  // ---------- Summary ----------
  function summary() {
    const s = windowStats(cell);
    d3.select("#place-title").text(W.placeName(m, cell));
    d3.select("#window-text").html(`Your window: <b>${W.fmtRange(m.times[win[0]], m.times[win[1]])}</b>`);
    const p10 = d3.min(winIdx(), (q) => F.t2m_p10.at(q, cell));
    const p90 = d3.max(winIdx(), (q) => F.t2m_p90.at(q, cell));
    const p50lo = d3.min(winIdx(), (q) => F.t2m_p50.at(q, cell));
    const p50hi = d3.max(winIdx(), (q) => F.t2m_p50.at(q, cell));
    const total = Math.round(s.total);
    const good = Math.round(s.hrs[2]);
    const best = s.hrs[2] >= s.total / 2 ? 2 : s.hrs[0] > s.total / 2 ? 0 : 1;
    const bar = [2, 1, 0].map((v) => `<span style="width:${(s.hrs[v] / s.total) * 100}%;background:${colors.status(v)}"></span>`).join("");
    const tiles = [
      {
        k: `Good for ${ACTIVITIES[activity].noun}`,
        v: `${good} of ${total} h`,
        extra: `<div class="verdict-bar" role="img" aria-label="${Math.round(s.hrs[2])} good, ${Math.round(s.hrs[1])} marginal, ${Math.round(s.hrs[0])} poor hours">${bar}</div>`,
        s: `<span class="pill" style="background:color-mix(in srgb, ${colors.status(best)} 22%, transparent)"><i style="background:${colors.status(best)}"></i>${["Mostly poor", "Mixed", "Mostly good"][best]}</span>`,
      },
      { k: "Temperature, 8 in 10 forecasts", v: `${Math.round(W.cToF(p10))}–${Math.round(W.cToF(p90))}°F`, s: `Most likely ${Math.round(W.cToF(p50lo))}–${Math.round(W.cToF(p50hi))}°F` },
      { k: "Feels like", v: `${Math.round(s.feelsMin)}–${Math.round(s.feelsMax)}°F`, s: `Wind up to ${Math.round(s.windMax)} mph` },
      { k: "Precipitation chance", v: `up to ${W.fmtPct(s.rainMax)}`, s: s.iceMax >= 0.01 ? `Freezing up to ${W.fmtPct(s.iceMax)}` : "No freezing risk" },
    ];
    const el = d3.select("#tiles");
    el.selectAll("*").remove();
    tiles.forEach((t) => {
      const d = el.append("div").attr("class", "tile");
      d.append("span").attr("class", "k").text(t.k);
      d.append("span").attr("class", "v").text(t.v);
      if (t.extra) d.append("div").html(t.extra);
      d.append("span").attr("class", "s").html(t.s);
    });
  }

  const redrawFan = W.responsive(fanEl, renderFan);
  const redrawPrecip = W.responsive(precipEl, renderPrecip);

  function updatePlace() { summary(); redrawFan(); redrawPrecip(); }
  function updateAll() { drawMap(); updatePlace(); }

  drawMap();
  summary();
  W.onThemeChange(updateAll);
})();
