import { tempColor, clamp, loop, fmtDow, fmtDate, localHourOf } from "../util.js";

const ARC = 240;
const R = 40;

function polar(deg, r = R) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

function arcPath(a0, a1, r = R) {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function ticks(n, a0, span, r0, r1, every = 0) {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = a0 + (span * i) / n;
    const long = every && i % every === 0;
    const [x0, y0] = polar(a, long ? r0 - 2 : r0);
    const [x1, y1] = polar(a, r1);
    d += `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

const TMIN = 20;
const TMAX = 95;
const tempAngle = (f) => -ARC / 2 + (clamp((f - TMIN) / (TMAX - TMIN)) * ARC);

function gradientStops() {
  let s = "";
  for (let i = 0; i <= 6; i++) {
    const f = TMIN + ((TMAX - TMIN) * i) / 6;
    s += `<stop offset="${(i / 6) * 100}%" stop-color="${tempColor(f)}"/>`;
  }
  return s;
}

const SUN = '<circle r="5.2" fill="#ffc94a"/><circle r="9" fill="#ffc94a" opacity=".18"/>';
const MOON = '<circle r="5" fill="#e8e6ff"/><circle r="4.4" cx="2.6" cy="-1.6" fill="#0d1322"/>';

export function createHud(root, ctx) {
  root.innerHTML = `
<div class="hud" data-mode="full">
  <div class="hud-full">
    <figure class="hud-card" data-g="time">
      <div class="hud-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs><linearGradient id="hud-daysky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fc3ff" stop-opacity=".28"/><stop offset="1" stop-color="#6fc3ff" stop-opacity="0"/></linearGradient></defs>
          <path d="M10 50A40 40 0 0 1 90 50Z" fill="url(#hud-daysky)"/>
          <circle cx="50" cy="50" r="${R}" class="hud-track"/>
          <path d="${ticks(24, 0, 360, 44, 47, 6)}" class="hud-ticks"/>
          <line x1="6" y1="50" x2="94" y2="50" class="hud-horizon"/>
          <g class="hud-orb"><g class="hud-sun">${SUN}</g><g class="hud-moon">${MOON}</g></g>
        </svg>
        <div class="hud-center"><span class="hud-num hud-clock">--</span><span class="hud-unit hud-ampm"></span></div>
      </div>
      <figcaption class="hud-label hud-date">--</figcaption>
    </figure>
    <figure class="hud-card" data-g="temp">
      <div class="hud-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs><linearGradient id="hud-tgrad" x1="0" y1="0" x2="1" y2="0">${gradientStops()}</linearGradient></defs>
          <path d="${arcPath(-ARC / 2, ARC / 2)}" class="hud-track"/>
          <path d="${arcPath(-ARC / 2, ARC / 2)}" class="hud-grad" stroke="url(#hud-tgrad)"/>
          <path d="${ticks(15, -ARC / 2, ARC, 45, 47.5, 5)}" class="hud-ticks"/>
          <path d="${arcPath(-ARC / 2, ARC / 2)}" class="hud-fill" pathLength="100"/>
          <g class="hud-needle"><circle cx="50" cy="${50 - R}" r="4.2" class="hud-knob"/></g>
        </svg>
        <div class="hud-center"><span class="hud-num hud-temp">--</span></div>
      </div>
      <figcaption class="hud-label">Temp</figcaption>
    </figure>
    <figure class="hud-card" data-g="wind">
      <div class="hud-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="${R}" class="hud-track"/>
          <path d="${ticks(36, 0, 360, 44, 47, 9)}" class="hud-ticks"/>
          <text x="50" y="5.5" class="hud-n">N</text>
          <path d="${arcPath(0.01, 359.99)}" class="hud-fill hud-wfill" pathLength="100"/>
          <g class="hud-arrow"><path d="M50 13.5l5.2 9.5h-10.4z" class="hud-knob"/></g>
        </svg>
        <div class="hud-center"><span class="hud-num hud-wind">--</span><span class="hud-unit">mph</span></div>
      </div>
      <figcaption class="hud-label">Wind</figcaption>
    </figure>
    <figure class="hud-card" data-g="rain">
      <div class="hud-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="${R}" class="hud-track"/>
          <path d="${arcPath(0.01, 359.99)}" class="hud-fill hud-rfill" pathLength="100"/>
          <g class="hud-drops">
            <path d="M34 66l-2 5M44 69l-2 5M54 66l-2 5M64 69l-2 5"/>
          </g>
        </svg>
        <div class="hud-center"><span class="hud-num hud-rain">--</span><span class="hud-unit hud-rainmm">dry</span></div>
      </div>
      <figcaption class="hud-label">Rain chance</figcaption>
    </figure>
  </div>
  <div class="hud-mini">
    <span class="hud-mini-orb"></span>
    <span class="hud-mini-time">--</span>
    <i></i>
    <span class="hud-mini-dot"></span><span class="hud-mini-temp">--</span>
    <i></i>
    <span class="hud-mini-wind">--</span>
    <i></i>
    <span class="hud-mini-rain">--</span>
  </div>
</div>`;

  const hud = root.querySelector(".hud");
  const q = (s) => hud.querySelector(s);
  const n = {
    clock: q(".hud-clock"), ampm: q(".hud-ampm"), date: q(".hud-date"), orb: q(".hud-orb"),
    sun: q(".hud-sun"), moon: q(".hud-moon"),
    temp: q(".hud-temp"), tfill: q('[data-g="temp"] .hud-fill'), needle: q(".hud-needle"),
    wind: q(".hud-wind"), wfill: q(".hud-wfill"), arrow: q(".hud-arrow"),
    rain: q(".hud-rain"), rfill: q(".hud-rfill"), rainmm: q(".hud-rainmm"), drops: q(".hud-drops"),
    mOrb: q(".hud-mini-orb"), mTime: q(".hud-mini-time"), mTemp: q(".hud-mini-temp"), mDot: q(".hud-mini-dot"),
    mWind: q(".hud-mini-wind"), mRain: q(".hud-mini-rain"),
  };

  const target = { tempF: 55, wind: 0, windDir: 270, rainProb: 0, rain: 0, hour: 12, cloud: 0 };
  const cur = { ...target };
  let date = null;
  let stop = null;
  let shown = false;
  const cache = {};

  const put = (key, node, val, prop = "textContent") => {
    if (cache[key] === val) return;
    cache[key] = val;
    if (prop === "textContent") node.textContent = val;
    else node.setAttribute(prop, val);
  };
  const style = (key, node, prop, val) => {
    if (cache[key] === val) return;
    cache[key] = val;
    node.style[prop] = val;
  };

  function render() {
    const t = Math.round(cur.tempF);
    put("temp", n.temp, `${t}°`);
    put("mtemp", n.mTemp, `${t}°`);
    const tc = tempColor(cur.tempF);
    style("tcol", n.tfill, "stroke", tc);
    style("mdot", n.mDot, "background", tc);
    const frac = clamp((cur.tempF - TMIN) / (TMAX - TMIN));
    put("tdash", n.tfill, `${(frac * 100).toFixed(2)} 100`, "stroke-dasharray");
    put("needle", n.needle, `rotate(${tempAngle(cur.tempF).toFixed(2)} 50 50)`, "transform");

    const w = Math.round(cur.wind);
    put("wind", n.wind, `${w}`);
    put("mwind", n.mWind, `${w} mph`);
    put("wdash", n.wfill, `${(clamp(cur.wind / 40) * 100).toFixed(2)} 100`, "stroke-dasharray");
    put("arrow", n.arrow, `rotate(${(cur.windDir + 180).toFixed(1)} 50 50)`, "transform");

    const rp = Math.round(cur.rainProb * 100);
    put("rain", n.rain, `${rp}%`);
    put("mrain", n.mRain, `${rp}% rain`);
    put("rdash", n.rfill, `${(clamp(cur.rainProb) * 100).toFixed(2)} 100`, "stroke-dasharray");
    const mm = cur.rain;
    put("rmm", n.rainmm, mm < 0.05 ? "dry" : `${mm < 1 ? mm.toFixed(1) : Math.round(mm)} mm/h`);
    style("drops", n.drops, "opacity", clamp(mm / 1.5).toFixed(2));

    const h = ((cur.hour % 24) + 24) % 24;
    const ang = (h / 24) * 360 + 180;
    const [ox, oy] = polar(ang, R);
    put("orb", n.orb, `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`, "transform");
    const day = h > 6.6 && h < 18.4;
    style("sun", n.sun, "opacity", day ? "1" : "0");
    style("moon", n.moon, "opacity", day ? "0" : "1");
    style("morb", n.mOrb, "background", day ? "#ffc94a" : "#e8e6ff");
    if (date) {
      const hh = Math.floor(h);
      const mm2 = Math.floor((h - hh) * 60 / 5) * 5;
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      const clock = `${h12}:${String(mm2).padStart(2, "0")}`;
      const ap = hh < 12 ? "AM" : "PM";
      put("clock", n.clock, clock);
      put("ampm", n.ampm, ap);
      put("mtime", n.mTime, `${clock} ${ap}`);
    }
  }

  const circ = (a, b, k) => a + ((((b - a) % 24) + 36) % 24 - 12) * k;
  const circDeg = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;

  function tick(dt) {
    const k = ctx.reduced ? 1 : 1 - Math.exp(-dt * 7);
    let moving = false;
    for (const key of ["tempF", "wind", "rainProb", "rain", "cloud"]) {
      const d = target[key] - cur[key];
      if (Math.abs(d) > 1e-3) moving = true;
      cur[key] += d * k;
    }
    const hd = Math.abs(((((target.hour - cur.hour) % 24) + 36) % 24) - 12);
    if (hd > 1e-3) moving = true;
    cur.hour = circ(cur.hour, target.hour, k);
    const wd = Math.abs(((((target.windDir - cur.windDir) % 360) + 540) % 360) - 180);
    if (wd > 0.05) moving = true;
    cur.windDir = circDeg(cur.windDir, target.windDir, k);
    render();
    if (!moving && stop) {
      stop();
      stop = null;
    }
  }

  const kick = () => {
    if (!stop && shown) stop = loop(tick);
  };

  let first = true;
  return {
    show(on) {
      shown = !!on;
      hud.classList.toggle("is-on", shown);
      if (shown) kick();
      else if (stop) { stop(); stop = null; }
    },
    set(v = {}) {
      for (const key of ["tempF", "wind", "windDir", "rainProb", "rain", "cloud"]) if (Number.isFinite(v[key])) target[key] = v[key];
      if (v.date) {
        date = v.date;
        target.hour = localHourOf(date);
        put("date", n.date, `${fmtDow(date)} ${fmtDate(date)}`);
      }
      if (first) {
        Object.assign(cur, target);
        first = false;
        render();
      }
      kick();
    },
    mode(m) {
      if (hud.dataset.mode !== m) hud.dataset.mode = m;
    },
  };
}
