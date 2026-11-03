import { clamp, lerp, seg, ease, smoothstep, tempColor, fmtDow, fmtHour } from "../util.js";
import { createSpreadChart } from "../spread/chart.js";

const NS = "http://www.w3.org/2000/svg";
const T0 = 0.15;
const T1 = 0.9;

let st = null;

function windDir(u, v) {
  return (Math.atan2(-u, -v) * 180) / Math.PI + 180;
}

const spreadColor = d3.scaleLinear().domain([0, 0.45, 1]).range(["#6fc3ff", "#ffb547", "#ff6b4a"]).interpolate(d3.interpolateLab).clamp(true);

function mount(layer, ctx) {
  const { data } = ctx;
  layer.classList.add("sp");
  layer.innerHTML = `
    <div class="sp-scrim"></div>
    <div class="sp-captions">
      <p class="sp-cap t-caption" data-k="0">Back to Harvard. Now watch the 64 drift apart.</p>
      <p class="sp-cap t-caption" data-k="1">Every day further out, the forecasts disagree more.</p>
    </div>
    <div class="sp-readout">
      <p class="sp-when t-mono"><span class="sp-day"></span><span class="sp-date"></span></p>
      <div class="sp-num t-num"><span class="sp-val">0</span><span class="sp-deg">°</span></div>
      <p class="sp-num-label">between the coldest and warmest forecast</p>
      <svg class="sp-strip" aria-hidden="true"></svg>
    </div>
    <div class="sp-chart glass"><div class="sp-chart-host"></div></div>
  `;

  const all = data.members.t2m.flat();
  const lo = Math.floor(d3.min(all) - 1);
  const hi = Math.ceil(d3.max(all) + 1);
  const strip = layer.querySelector(".sp-strip");
  const track = document.createElementNS(NS, "line");
  track.setAttribute("class", "sp-strip-track");
  const range = document.createElementNS(NS, "line");
  range.setAttribute("class", "sp-strip-range");
  strip.append(track, range);
  const dots = Array.from({ length: data.nMembers }, () => {
    const c = document.createElementNS(NS, "rect");
    c.setAttribute("width", 2);
    c.setAttribute("height", 16);
    c.setAttribute("y", 4);
    c.setAttribute("rx", 1);
    strip.append(c);
    return c;
  });
  const tLo = document.createElementNS(NS, "text");
  const tHi = document.createElementNS(NS, "text");
  tLo.setAttribute("class", "sp-strip-end");
  tHi.setAttribute("class", "sp-strip-end");
  tLo.setAttribute("text-anchor", "end");
  strip.append(tLo, tHi);

  const chart = createSpreadChart(layer.querySelector(".sp-chart-host"), data);
  const maxSpread = d3.max(data.spread.t2m_min_max);

  st = {
    layer,
    chart,
    caps: [...layer.querySelectorAll(".sp-cap")],
    readout: layer.querySelector(".sp-readout"),
    chartBox: layer.querySelector(".sp-chart"),
    val: layer.querySelector(".sp-val"),
    num: layer.querySelector(".sp-num"),
    day: layer.querySelector(".sp-day"),
    date: layer.querySelector(".sp-date"),
    strip,
    track,
    range,
    dots,
    tLo,
    tHi,
    lo,
    hi,
    maxSpread,
    stripW: 0,
    lastP: 0,
  };

  const onResize = () => {
    chart.layout();
    st.stripW = 0;
    if (ctx.active === "spread") update(st.lastP, ctx);
  };
  new ResizeObserver(onResize).observe(layer.querySelector(".sp-chart-host"));
}

function layoutStrip() {
  const w = st.strip.getBoundingClientRect().width;
  if (!w) return false;
  st.stripW = w;
  st.strip.setAttribute("viewBox", `0 0 ${w} 34`);
  st.track.setAttribute("x1", 30);
  st.track.setAttribute("x2", w - 30);
  st.track.setAttribute("y1", 12);
  st.track.setAttribute("y2", 12);
  return true;
}

function drawStrip(members) {
  if (!st.stripW && !layoutStrip()) return;
  const pad = 30;
  const sx = d3.scaleLinear().domain([st.lo, st.hi]).range([pad, st.stripW - pad]);
  const sorted = members.slice().sort((a, b) => a - b);
  sorted.forEach((v, k) => {
    const c = st.dots[k];
    c.setAttribute("x", (sx(v) - 1).toFixed(1));
    c.setAttribute("fill", tempColor(v));
  });
  const a = sx(sorted[0]);
  const b = sx(sorted[sorted.length - 1]);
  st.range.setAttribute("x1", a);
  st.range.setAttribute("x2", b);
  st.range.setAttribute("y1", 12);
  st.range.setAttribute("y2", 12);
  st.tLo.setAttribute("x", a - 9);
  st.tLo.setAttribute("y", 16);
  st.tLo.textContent = `${Math.round(sorted[0])}°`;
  st.tHi.setAttribute("x", b + 9);
  st.tHi.setAttribute("y", 16);
  st.tHi.textContent = `${Math.round(sorted[sorted.length - 1])}°`;
}

function leadFor(p, data) {
  return lerp(data.leads[0], data.maxLead, seg(p, T0, T1));
}

function update(p, ctx) {
  if (!st) return;
  st.lastP = p;
  const { data, world, hud } = ctx;
  const lead = leadFor(p, data);
  const date = data.timeAt(lead);

  const cam = ease.inOut(seg(p, 0, T0));
  world.setVisible(true);
  world.setCameraPath("street", "high", cam);
  world.setDim(0);
  ctx.veil(0);

  const t = data.statsAt("t2m", lead);
  const cloud = data.at(data.series.cloud.p50, lead);
  const rain = data.at(data.series.precip.p50, lead);
  const wind = data.at(data.series.wind.p50, lead);
  const u10 = data.at(data.series.u10.mean, lead);
  const v10 = data.at(data.series.v10.mean, lead);
  world.setTime(date);
  world.setWeather({ tempF: t.p50, cloud, rain, wind, windDir: windDir(u10, v10) });

  const spread = data.at(data.spread.t2m_min_max, lead);
  const u = clamp(spread / st.maxSpread);
  const members = data.membersAt("t2m", lead);
  world.setUncertainty(Math.max(0.04, u) * smoothstep(0.02, 0.14, p), { members });

  const precip = data.membersAt("precip", lead);
  const rainProb = precip.filter((v) => v >= 0.1).length / precip.length;
  hud.show(true);
  hud.mode("mini");
  hud.set({ date, tempF: t.p50, wind, rainProb, rain, cloud });

  const capIn = smoothstep(0.0, 0.05, p);
  const cap0 = capIn * (1 - smoothstep(0.17, 0.22, p));
  const cap1 = smoothstep(0.22, 0.27, p);
  st.caps[0].style.opacity = cap0;
  st.caps[0].style.transform = `translate3d(0,${(1 - capIn) * 14 - (1 - cap0) * (p > 0.15 ? 10 : 0)}px,0)`;
  st.caps[1].style.opacity = cap1;
  st.caps[1].style.transform = `translate3d(0,${(1 - cap1) * 14}px,0)`;

  const rIn = ease.out(seg(p, 0.08, 0.18));
  st.readout.style.opacity = rIn;
  st.readout.style.transform = `translate3d(0,${(1 - rIn) * 24}px,0) scale(${lerp(0.96, 1, rIn)})`;
  st.readout.style.filter = rIn < 1 ? `blur(${(1 - rIn) * 8}px)` : "none";

  const cIn = ease.out(seg(p, 0.1, 0.2));
  st.chartBox.style.opacity = cIn;
  st.chartBox.style.transform = `translate3d(0,${(1 - cIn) * 40}px,0)`;

  st.val.textContent = Math.round(spread);
  st.num.style.color = spreadColor(u);
  const dAhead = lead / 24;
  st.day.textContent = dAhead < 1 ? `${Math.round(lead)} h ahead` : `${dAhead.toFixed(1)} days ahead`;
  st.date.textContent = `${fmtDow(date)} ${fmtHour(date)}`;
  drawStrip(members);

  st.chart.draw(lead);
}

export default {
  length: 5,
  mount,
  update,
  enter(dir, ctx) {
    ctx.world.setVisible(true);
    ctx.veil(0);
  },
  leave(dir, ctx) {
    if (dir < 0) ctx.world.setUncertainty(0, {});
  },
};
