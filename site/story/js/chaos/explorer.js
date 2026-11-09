import { el, clamp, lerp, rng, tempColor, loop } from "../util.js";
import { roundRect, FONT } from "../pdfs/common.js";

/*
 * Lorenz (1963) convection model. 64 copies start a hair apart and are integrated with RK4.
 * x maps to a stand-in Harvard Yard temperature so the strip and chart read like the rest of the story.
 */
const N = 64;
const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;
const DT = 0.004;
const DAYS_PER_UNIT = 1.25;
const MAX_DAY = 15;
const DAYS_PER_SEC = 0.85;
const TRAIL = 36;
const toF = (x) => 52 + x;

const STEPS = [
  { day: 0, html: "Each dot is one forecast. They start almost on top of each other, because nobody can measure today's air perfectly." },
  { day: 2.5, html: "For a few days they travel together. The tiny differences are growing, just too small to see." },
  { day: 6, html: "Then the differences double, and double again. The swarm stretches into a ribbon." },
  { day: 10, html: "Now the dots are scattered over both wings. Same physics, same starting guess, completely different weather." },
  { day: MAX_DAY, html: "This is why the 64 WeatherNext forecasts agree about tomorrow and argue about day 15. <em>Tap the loop</em> to release a new swarm anywhere, or shrink the starting difference." },
];

const SLIDER = { min: -6, max: -0.3, value: -2 };

function deriv(x, y, z, out, o) {
  out[o] = SIGMA * (y - x);
  out[o + 1] = x * (RHO - z) - y;
  out[o + 2] = x * y - BETA * z;
}

const k1 = new Float64Array(3);
const k2 = new Float64Array(3);
const k3 = new Float64Array(3);
const k4 = new Float64Array(3);
function rk4(s, i, h) {
  const x = s[i];
  const y = s[i + 1];
  const z = s[i + 2];
  deriv(x, y, z, k1, 0);
  deriv(x + (h / 2) * k1[0], y + (h / 2) * k1[1], z + (h / 2) * k1[2], k2, 0);
  deriv(x + (h / 2) * k2[0], y + (h / 2) * k2[1], z + (h / 2) * k2[2], k3, 0);
  deriv(x + h * k3[0], y + h * k3[1], z + h * k3[2], k4, 0);
  s[i] = x + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  s[i + 1] = y + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  s[i + 2] = z + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
}

function attractor(n) {
  const s = new Float64Array([1, 1, 20]);
  for (let k = 0; k < 4000; k++) rk4(s, 0, DT);
  const pts = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < 3; j++) rk4(s, 0, DT);
    pts.set(s, k * 3);
  }
  return pts;
}

const fmtEps = (e) => {
  const f = Math.abs(e);
  if (f >= 0.1) return `${f.toFixed(1)}°F`;
  const d = Math.ceil(-Math.log10(f));
  return `${f.toFixed(d)}°F`;
};
const epsWords = (e) => {
  const l = Math.log10(e);
  if (l < -4.5) return "a millionth of a degree";
  if (l < -3.5) return "ten-thousandths of a degree";
  if (l < -2.5) return "a thousandth of a degree";
  if (l < -1.5) return "a hundredth of a degree";
  if (l < -0.75) return "a tenth of a degree";
  return "about half a degree";
};

export function createChaosExplorer(ctx) {
  const root = el("div", { class: "cx", role: "dialog", "aria-modal": "true", "aria-labelledby": "cx-title", hidden: "" });
  root.innerHTML = `
    <div class="cx-panel">
      <button type="button" class="cx-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <aside class="cx-side">
        <p class="t-kicker">Why the forecasts drift apart</p>
        <h2 class="t-title cx-title" id="cx-title">The butterfly effect</h2>
        <p class="cx-lede">The atmosphere is chaotic: a tiny change today grows into a big change later. Watch it happen to 64 forecasts.</p>
        <div class="cx-steps" aria-live="polite">${STEPS.map((s) => `<p class="cx-step">${s.html}</p>`).join("")}</div>
        <div class="cx-controls">
          <div class="cx-buttons">
            <button type="button" class="btn is-primary cx-play"><span class="cx-play-icon" aria-hidden="true"></span><span class="cx-play-label">Pause</span></button>
            <button type="button" class="btn cx-restart">Restart</button>
          </div>
          <label class="cx-slider">
            <span class="cx-slider-head"><span>How different the 64 starts are</span><b class="cx-eps t-num"></b></span>
            <input type="range" min="${SLIDER.min}" max="${SLIDER.max}" step="0.05" value="${SLIDER.value}">
            <span class="cx-slider-foot"><span>Measured perfectly</span><span>Roughly</span></span>
          </label>
        </div>
        <p class="cx-note">The loop is Edward Lorenz's 1963 model of air rising and sinking, the system that gave chaos theory its butterfly. It is a toy, not the real atmosphere, but the 64 WeatherNext forecasts spread apart for the same reason.</p>
      </aside>
      <section class="cx-stage">
        <div class="cx-canvas-wrap">
          <canvas class="cx-canvas" role="img" aria-label="64 forecasts moving on the Lorenz butterfly attractor. They start together and scatter across both wings."></canvas>
          <div class="cx-readout" aria-hidden="true">
            <p class="cx-day"><span>Day</span> <b class="t-num">0</b></p>
            <p class="cx-spread"><b class="t-num">0°</b> between coldest and warmest</p>
          </div>
          <div class="cx-wings" aria-hidden="true"><span class="is-cold">colder wing</span><span class="is-warm">warmer wing</span></div>
          <div class="cx-hint" aria-hidden="true">Tap the loop to start a new swarm there</div>
        </div>
        <div class="cx-bottom">
          <figure class="cx-card cx-strip-card">
            <figcaption>Harvard Yard temperature in each of the 64 forecasts</figcaption>
            <canvas class="cx-strip"></canvas>
          </figure>
          <figure class="cx-card cx-chart-card">
            <figcaption>Gap between coldest and warmest</figcaption>
            <canvas class="cx-chart"></canvas>
          </figure>
        </div>
      </section>
    </div>`;
  document.body.append(root);

  const q = (s) => root.querySelector(s);
  const dom = {
    canvas: q(".cx-canvas"),
    wrap: q(".cx-canvas-wrap"),
    strip: q(".cx-strip"),
    chart: q(".cx-chart"),
    day: q(".cx-day b"),
    spread: q(".cx-spread b"),
    steps: [...root.querySelectorAll(".cx-step")],
    play: q(".cx-play"),
    playLabel: q(".cx-play-label"),
    restart: q(".cx-restart"),
    slider: q(".cx-slider input"),
    eps: q(".cx-eps"),
    hint: q(".cx-hint"),
    close: q(".cx-close"),
  };

  const ghost = attractor(26000);
  const state = new Float64Array(N * 3);
  const trails = new Float32Array(N * TRAIL * 2);
  let trailHead = 0;
  let trailLen = 0;
  let day = 0;
  let playing = false;
  let stop = null;
  let lastFocus = null;
  let eps = 10 ** SLIDER.value;
  let seed = 7;
  let origin = 9000;
  let history = [];
  let butterfly = null;
  let L = null;
  let stepIdx = -1;
  let wallT = 0;

  const fitCanvas = (c) => {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h, dpr };
  };

  function layout() {
    const main = fitCanvas(dom.canvas);
    const mobile = main.w < 560;
    const pad = mobile ? 18 : 40;
    const top = mobile ? 70 : 92;
    const bottom = mobile ? 34 : 46;
    const xr = [-21, 21];
    const zr = [2, 50];
    const s = Math.min((main.w - 2 * pad) / (xr[1] - xr[0]), (main.h - top - bottom) / (zr[1] - zr[0]));
    const cx = main.w / 2;
    const cy = top + (main.h - top - bottom) / 2;
    const px = (x) => cx + x * s;
    const py = (z) => cy - (z - (zr[0] + zr[1]) / 2) * s;

    const off = document.createElement("canvas");
    off.width = main.g.canvas.width;
    off.height = main.g.canvas.height;
    const og = off.getContext("2d");
    og.setTransform(main.dpr, 0, 0, main.dpr, 0, 0);
    og.lineWidth = 0.7;
    og.globalAlpha = 0.16;
    const seg = 400;
    for (let k = 0; k < ghost.length / 3 - 1; k += seg) {
      og.beginPath();
      const end = Math.min(ghost.length / 3 - 1, k + seg);
      og.strokeStyle = tempColor(toF(ghost[k * 3]));
      for (let j = k; j <= end; j++) {
        const X = px(ghost[j * 3]);
        const Y = py(ghost[j * 3 + 2]);
        if (j === k) og.moveTo(X, Y); else og.lineTo(X, Y);
      }
      og.stroke();
    }
    L = { main, mobile, px, py, s, off, strip: fitCanvas(dom.strip), chart: fitCanvas(dom.chart) };
  }

  function reset(newOrigin) {
    if (newOrigin != null) origin = newOrigin;
    const r = rng(seed++);
    const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const ox = ghost[origin * 3];
    const oy = ghost[origin * 3 + 1];
    const oz = ghost[origin * 3 + 2];
    for (let i = 0; i < N; i++) {
      state[i * 3] = ox + gauss() * eps;
      state[i * 3 + 1] = oy + gauss() * eps;
      state[i * 3 + 2] = oz + gauss() * eps;
    }
    day = 0;
    trailHead = 0;
    trailLen = 0;
    history = [[0, spreadF()]];
    pushTrail();
    setPlaying(true);
    draw();
  }

  function spreadF() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const v = state[i * 3];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }

  function pushTrail() {
    if (!L) return;
    const o = trailHead * N * 2;
    for (let i = 0; i < N; i++) {
      trails[o + i * 2] = L.px(state[i * 3]);
      trails[o + i * 2 + 1] = L.py(state[i * 3 + 2]);
    }
    trailHead = (trailHead + 1) % TRAIL;
    trailLen = Math.min(TRAIL, trailLen + 1);
  }

  function advance(dt) {
    if (!playing) return;
    const target = Math.min(MAX_DAY, day + dt * DAYS_PER_SEC);
    const steps = Math.max(1, Math.round(((target - day) / DAYS_PER_UNIT) / DT));
    const h = ((target - day) / DAYS_PER_UNIT) / steps;
    for (let k = 0; k < steps; k++) for (let i = 0; i < N; i++) rk4(state, i * 3, h);
    day = target;
    history.push([day, spreadF()]);
    pushTrail();
    if (day >= MAX_DAY) setPlaying(false, true);
  }

  function setPlaying(on, ended = false) {
    playing = on;
    dom.playLabel.textContent = on ? "Pause" : ended ? "Replay" : "Play";
    dom.play.classList.toggle("is-paused", !on);
    dom.play.dataset.ended = ended ? "1" : "";
  }

  function drawMain(t) {
    const { g, w, h } = L.main;
    g.clearRect(0, 0, w, h);
    g.drawImage(L.off, 0, 0, w, h);
    const colors = Array.from({ length: N }, (_, i) => tempColor(toF(state[i * 3])));

    for (let a = 1; a < trailLen; a++) {
      const i0 = (trailHead - trailLen + a - 1 + TRAIL * 2) % TRAIL;
      const i1 = (trailHead - trailLen + a + TRAIL * 2) % TRAIL;
      const alpha = (a / trailLen) ** 1.6 * 0.75;
      g.globalAlpha = alpha;
      g.lineWidth = lerp(0.6, 2, a / trailLen);
      for (let i = 0; i < N; i++) {
        g.strokeStyle = colors[i];
        g.beginPath();
        g.moveTo(trails[i0 * N * 2 + i * 2], trails[i0 * N * 2 + i * 2 + 1]);
        g.lineTo(trails[i1 * N * 2 + i * 2], trails[i1 * N * 2 + i * 2 + 1]);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    const r = L.mobile ? 3 : 4;
    for (let i = 0; i < N; i++) {
      const X = L.px(state[i * 3]);
      const Y = L.py(state[i * 3 + 2]);
      g.fillStyle = colors[i];
      g.globalAlpha = 0.22;
      g.beginPath();
      g.arc(X, Y, r * 2.6, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(X, Y, r, 0, Math.PI * 2);
      g.fill();
    }

    if (butterfly) {
      const age = t - butterfly.t;
      if (age > 1.6) butterfly = null;
      else drawButterfly(g, butterfly.x, butterfly.y, age);
    }

    const tlY = h - (L.mobile ? 16 : 22);
    const x0 = L.mobile ? 16 : 40;
    const x1 = w - x0;
    g.strokeStyle = "rgba(244,241,234,0.16)";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x0, tlY);
    g.lineTo(x1, tlY);
    g.stroke();
    g.strokeStyle = "#ffb547";
    g.beginPath();
    g.moveTo(x0, tlY);
    g.lineTo(lerp(x0, x1, day / MAX_DAY), tlY);
    g.stroke();
    g.font = `400 10px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.46)";
    g.textBaseline = "bottom";
    for (const d of [0, 5, 10, 15]) {
      const X = lerp(x0, x1, d / MAX_DAY);
      g.textAlign = d === 0 ? "left" : d === 15 ? "right" : "center";
      g.fillText(d === 0 ? "today" : `day ${d}`, X, tlY - 6);
    }
  }

  function drawButterfly(g, x, y, age) {
    const fade = 1 - clamp((age - 0.9) / 0.7);
    const flap = Math.abs(Math.sin(age * 18));
    g.save();
    g.translate(x, y - 18 - age * 20);
    g.globalAlpha = fade;
    g.fillStyle = "#ffb547";
    for (const side of [-1, 1]) {
      g.save();
      g.scale(side * lerp(0.25, 1, flap), 1);
      g.beginPath();
      g.ellipse(6, -4, 7, 5.5, -0.5, 0, Math.PI * 2);
      g.ellipse(5, 5, 4.5, 3.6, 0.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = "#f4f1ea";
    g.fillRect(-0.8, -7, 1.6, 14);
    g.restore();
  }

  const F_LO = 28;
  const F_HI = 76;

  function drawStrip() {
    const { g, w, h } = L.strip;
    g.clearRect(0, 0, w, h);
    const pad = 26;
    const sx = (F) => pad + ((F - F_LO) / (F_HI - F_LO)) * (w - 2 * pad);
    const top = 22;
    const barH = Math.max(18, h - top - 28);
    const base = top + barH + 5;
    g.strokeStyle = "rgba(244,241,234,0.16)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad, base);
    g.lineTo(w - pad, base);
    g.stroke();
    const vals = Array.from({ length: N }, (_, i) => toF(state[i * 3])).sort((a, b) => a - b);
    const bw = Math.max(2, Math.min(4, (w - 2 * pad) / 150));
    for (const v of vals) {
      g.fillStyle = tempColor(v);
      g.globalAlpha = 0.9;
      roundRect(g, sx(v) - bw / 2, top, bw, barH, bw / 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const lo = sx(vals[0]);
    const hi = sx(vals[N - 1]);
    g.strokeStyle = "rgba(244,241,234,0.7)";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(lo, base);
    g.lineTo(hi, base);
    g.stroke();
    const med = sx((vals[N / 2 - 1] + vals[N / 2]) / 2);
    g.fillStyle = "#ffffff";
    g.fillRect(med - 1, top - 6, 2, barH + 6);
    g.font = `600 11px ${FONT.sans}`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText("your app", clamp(med, pad + 20, w - pad - 20), top - 8);
    g.font = `400 10px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.46)";
    g.textBaseline = "top";
    for (let F = 30; F <= 75; F += 15) g.fillText(`${F}°`, sx(F), base + 8);
  }

  function drawChart() {
    const { g, w, h } = L.chart;
    g.clearRect(0, 0, w, h);
    const m = { l: 30, r: 10, t: 10, b: 20 };
    const yMax = 40;
    const X = (d) => m.l + (d / MAX_DAY) * (w - m.l - m.r);
    const Y = (v) => h - m.b - (Math.min(v, yMax) / yMax) * (h - m.t - m.b);
    g.font = `400 10px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.46)";
    g.strokeStyle = "rgba(244,241,234,0.07)";
    g.lineWidth = 1;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const v of [10, 20, 30, 40]) {
      g.beginPath();
      g.moveTo(m.l, Y(v));
      g.lineTo(w - m.r, Y(v));
      g.stroke();
      g.fillText(`${v}°`, m.l - 6, Y(v));
    }
    g.textBaseline = "top";
    for (const d of [0, 5, 10, 15]) {
      g.textAlign = d === 0 ? "left" : d === 15 ? "right" : "center";
      g.fillText(d === 0 ? "now" : `${d}d`, X(d), h - m.b + 6);
    }
    if (history.length < 2) return;
    const grad = g.createLinearGradient(m.l, 0, w - m.r, 0);
    grad.addColorStop(0, "#6fc3ff");
    grad.addColorStop(0.45, "#ffb547");
    grad.addColorStop(1, "#ff6b4a");
    g.strokeStyle = grad;
    g.lineWidth = 2.2;
    g.lineJoin = "round";
    g.beginPath();
    history.forEach(([d, v], k) => (k ? g.lineTo(X(d), Y(v)) : g.moveTo(X(d), Y(v))));
    g.stroke();
    const [d, v] = history[history.length - 1];
    g.fillStyle = "#fff";
    g.strokeStyle = "#ffb547";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(d), Y(v), 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  function draw(t = wallT) {
    if (!L) layout();
    drawMain(t);
    drawStrip();
    drawChart();
    dom.day.textContent = day < 10 ? day.toFixed(1) : Math.floor(day);
    const sp = spreadF();
    dom.spread.textContent = sp < 1 ? `${sp < 0.1 ? "<0.1" : sp.toFixed(1)}°` : `${Math.round(sp)}°`;
    const idx = STEPS.reduce((acc, s, k) => (day >= s.day - 1e-6 ? k : acc), 0);
    if (idx !== stepIdx) {
      stepIdx = idx;
      dom.steps.forEach((p, k) => p.classList.toggle("is-on", k === idx));
    }
  }

  function updateEps() {
    eps = 10 ** +dom.slider.value;
    dom.eps.textContent = fmtEps(eps);
    dom.eps.title = epsWords(eps);
    dom.slider.setAttribute("aria-valuetext", `${fmtEps(eps)}, ${epsWords(eps)}`);
  }

  function pick(ev) {
    if (!L) return;
    const r = dom.canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    let best = 0;
    let bd = Infinity;
    const n = ghost.length / 3 - 1;
    for (let k = 0; k < n; k += 3) {
      const dx = L.px(ghost[k * 3]) - mx;
      const dy = L.py(ghost[k * 3 + 2]) - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    butterfly = { x: L.px(ghost[best * 3]), y: L.py(ghost[best * 3 + 2]), t: wallT };
    dom.hint.classList.add("is-gone");
    reset(best);
  }

  dom.canvas.addEventListener("click", pick);
  dom.play.addEventListener("click", () => {
    if (dom.play.dataset.ended) reset();
    else setPlaying(!playing);
  });
  dom.restart.addEventListener("click", () => reset());
  dom.slider.addEventListener("input", () => { updateEps(); reset(); });
  dom.close.addEventListener("click", () => close());
  const onKey = (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const f = [...root.querySelectorAll("button, input")].filter((n) => n.offsetParent);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const ro = new ResizeObserver(() => {
    if (root.hidden) return;
    L = null;
    layout();
    trailLen = 0;
    pushTrail();
    draw();
  });
  ro.observe(dom.wrap);
  ro.observe(dom.strip);
  updateEps();

  function open() {
    lastFocus = document.activeElement;
    root.hidden = false;
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("cx-open");
    requestAnimationFrame(() => root.classList.add("is-open"));
    L = null;
    layout();
    reset(9000);
    if (ctx.reduced) setPlaying(false);
    stop?.();
    stop = loop((dt, t) => {
      wallT = t;
      advance(dt);
      draw(t);
    });
    dom.close.focus();
  }

  function close() {
    root.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("cx-open");
    stop?.();
    stop = null;
    setTimeout(() => { if (!root.classList.contains("is-open")) root.hidden = true; }, 320);
    lastFocus?.focus?.();
  }

  return { open, close };
}
