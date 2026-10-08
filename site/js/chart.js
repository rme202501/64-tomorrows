export function responsive(container, render) {
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

export function frame(container, width, height, margin) {
  const sel = d3.select(container);
  sel.selectAll("svg").remove();
  const svg = sel.append("svg").attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  return { svg, g, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
}

export function timeAxis(g, x, h, w) {
  const days = d3.timeDay.range(...x.domain());
  g.append("g").attr("class", "grid")
    .selectAll("line").data(days).join("line")
    .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", h);
  const spanDays = (x.domain()[1] - x.domain()[0]) / 864e5;
  if (spanDays > 3) {
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(d3.timeDay.every(w < 420 ? 2 : 1)).tickSize(4).tickFormat(d3.timeFormat("%a %-d")))
      .call((s) => s.select(".domain").remove());
    return;
  }
  const ticks = w < 420 ? d3.timeHour.every(12) : d3.timeHour.every(6);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(ticks).tickSize(4).tickFormat((d) => (
      d.getHours() === 0 ? d3.timeFormat("%a")(d) : d3.timeFormat("%-I%p")(d).toLowerCase())))
    .call((s) => s.select(".domain").remove())
    .call((s) => s.selectAll(".tick text").classed("tick-day", (d) => d.getHours() === 0));
}

export function yAxis(g, y, w, { format, ticks = 5, label } = {}) {
  g.append("g").attr("class", "grid")
    .selectAll("line").data(y.ticks(ticks)).join("line")
    .attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(ticks).tickSize(0).tickPadding(8).tickFormat(format))
    .call((s) => s.select(".domain").remove());
  if (label) {
    g.append("text").attr("class", "axis-label").attr("x", -8).attr("y", -10).text(label);
  }
}

export function crosshair(g, x, w, h, times, onMove, onLeave) {
  const line = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h)
    .style("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("pointermove", (e) => {
      const [mx] = d3.pointer(e);
      const t = x.invert(mx);
      const k = d3.minIndex(times, (d) => Math.abs(d - t));
      line.attr("x1", x(times[k])).attr("x2", x(times[k])).style("opacity", 1);
      onMove(k, e);
    })
    .on("pointerleave", () => {
      line.style("opacity", 0);
      onLeave();
    });
}

export function townSelect(container, names, value, onChange) {
  const sel = d3.select(container).append("label").attr("class", "control");
  sel.append("span").text("Place");
  const s = sel.append("select").on("change", (e) => onChange(e.target.value));
  s.selectAll("option").data(names).join("option").attr("value", (d) => d).text((d) => d)
    .property("selected", (d) => d === value);
  return s;
}

export function segmented(container, options, value, onChange) {
  const wrap = d3.select(container).append("div").attr("class", "segmented").attr("role", "radiogroup");
  const btns = wrap.selectAll("button").data(options).join("button")
    .attr("type", "button")
    .text((d) => d.label)
    .classed("on", (d) => d.value === value)
    .on("click", (e, d) => {
      btns.classed("on", (o) => o === d);
      onChange(d.value);
    });
  return wrap;
}
