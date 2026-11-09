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
      <p class="sp-cap t-caption" data-k="0">Now follow all 64 forecasts for Harvard Yard, day by day.</p>
      <p class="sp-cap t-caption" data-k="1">Further out, the forecasts disagree more, so the bars spread apart.</p>
    </div>
    <div class="sp-readout">
      <div class="sp-readout-num">
        <p class="sp-when t-mono"><span class="sp-day"></span><span class="sp-date"></span></p>
        <div class="sp-num t-num"><span class="sp-val">0</span><span class="sp-deg">°</span></div>
        <p class="sp-num-label">between the coldest and warmest forecast</p>
      </div>
      <div class="sp-strip-box">
        <svg class="sp-strip" aria-hidden="true"></svg>
        <p class="sp-strip-key">Each bar is one of the 64 forecasts of the temperature at that moment.</p>
      </div>
    </div>
    <div class="sp-chart glass"><div class="sp-chart-host"></div></div>
  `;

  const all = data.members.t2m.flat();
  const lo = Math.floor(d3.min(all) - 1);
  const hi = Math.ceil(d3.max(all) + 1);
  const strip = layer.querySelector(".sp-strip");
  const mk = (tag, cls) => {
    const n = document.createElementNS(NS, tag);
    if (cls) n.setAttribute("class", cls);
    strip.append(n);
    return n;
  };
  const axis = mk("g", "sp-strip-axis");
  const track = mk("line", "sp-strip-track");
  const range = mk("line", "sp-strip-range");
  const dots = Array.from({ length: data.nMembers }, () => mk("rect"));
  const tLo = mk("text", "sp-strip-end");
  const tHi = mk("text", "sp-strip-end");
  tLo.setAttribute("text-anchor", "end");

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
    axis,
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

const STRIP_PAD = 34;

function layoutStrip() {
  const box = st.strip.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const w = box.width;
  const h = box.height;
  st.stripW = w;
  st.stripH = h;
  st.barTop = 26;
  st.barH = Math.max(24, h - st.barTop - 30);
  st.strip.setAttribute("viewBox", `0 0 ${w} ${h}`);
  st.sx = d3.scaleLinear().domain([st.lo, st.hi]).range([STRIP_PAD, w - STRIP_PAD]);
  const base = st.barTop + st.barH + 6;
  for (const n of [st.track, st.range]) {
    n.setAttribute("y1", base);
    n.setAttribute("y2", base);
  }
  st.track.setAttribute("x1", STRIP_PAD);
  st.track.setAttribute("x2", w - STRIP_PAD);
  const barW = Math.max(2, Math.min(4, (w - 2 * STRIP_PAD) / 160));
  st.dots.forEach((c) => {
    c.setAttribute("width", barW);
    c.setAttribute("height", st.barH);
    c.setAttribute("y", st.barTop);
    c.setAttribute("rx", barW / 2);
  });
  st.barW = barW;
  st.axis.replaceChildren();
  const step = st.hi - st.lo > 40 ? 10 : 5;
  for (let F = Math.ceil(st.lo / step) * step; F <= st.hi; F += step) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", st.sx(F));
    t.setAttribute("y", base + 18);
    t.setAttribute("text-anchor", "middle");
    t.textContent = `${F}°`;
    st.axis.append(t);
  }
  return true;
}

function drawStrip(members) {
  if (!st.stripW && !layoutStrip()) return;
  const sx = st.sx;
  const sorted = members.slice().sort((a, b) => a - b);
  sorted.forEach((v, k) => {
    const c = st.dots[k];
    c.setAttribute("x", (sx(v) - st.barW / 2).toFixed(1));
    c.setAttribute("fill", tempColor(v));
  });
  const a = sx(sorted[0]);
  const b = sx(sorted[sorted.length - 1]);
  st.range.setAttribute("x1", a);
  st.range.setAttribute("x2", b);
  const merged = b - a < 70;
  st.tLo.setAttribute("x", merged ? (a + b) / 2 - 4 : a);
  st.tLo.setAttribute("y", st.barTop - 9);
  st.tLo.setAttribute("text-anchor", merged ? "end" : "middle");
  st.tLo.textContent = `${Math.round(sorted[0])}°`;
  st.tHi.setAttribute("x", merged ? (a + b) / 2 + 4 : b);
  st.tHi.setAttribute("y", st.barTop - 9);
  st.tHi.setAttribute("text-anchor", merged ? "start" : "middle");
  st.tHi.textContent = `${Math.round(sorted[sorted.length - 1])}°`;
}

/** a fixed, calm backdrop: the first afternoon, median weather, so only the bars move */
function sceneFor(data) {
  const lead = data.leadForDay(0, 15);
  const s = data.series;
  return {
    date: data.timeAt(lead),
    wx: {
      tempF: data.at(s.t2m.p50, lead),
      cloud: Math.min(45, data.at(s.cloud.p50, lead)),
      rain: 0,
      wind: data.at(s.wind.p50, lead),
      windDir: windDir(data.at(s.u10.mean, lead), data.at(s.v10.mean, lead)),
    },
  };
}

function leadFor(p, data) {
  return lerp(data.leads[0], data.maxLead, seg(p, T0, T1));
}

function update(p, ctx) {
  if (!st) return;
  st.lastP = p;
  const { data, world, hud } = ctx;
  if (!st.scene) st.scene = sceneFor(data);
  const lead = leadFor(p, data);
  const date = data.timeAt(lead);

  const cam = ease.inOut(seg(p, 0, T0));
  world.setVisible(true);
  world.setCameraPath("street", "high", cam);
  world.setDim(0.3 * cam);
  world.setTime(st.scene.date);
  world.setWeather(st.scene.wx);
  world.setUncertainty(0);
  ctx.veil(0);
  hud.show(false);

  const spread = data.at(data.spread.t2m_min_max, lead);
  const u = clamp(spread / st.maxSpread);
  const members = data.membersAt("t2m", lead);

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
    ctx.world.setUncertainty(0);
    ctx.hud.show(false);
    ctx.veil(0);
  },
  leave(dir, ctx) {
    ctx.world.setDim(0);
  },
};
