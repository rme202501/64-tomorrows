import { clamp, lerp, seg, ease, smoothstep, tempColor, rng, el } from "../util.js";
import { lorenzRuns } from "../why/lorenz.js";

const DAYS = 15;
const PER_DAY = 10;
const DAYS_PER_UNIT = 2;
const SCALE = 0.7;
const BASE = [16.910892373134402, 16.620283498741603, 39.06117595218449];
const LIMIT_DAY = 10;
const STEPS = [0, 0.16, 0.31, 0.56, 0.74, 1];
const AMBER = "#ffb547";
const INK = "244, 241, 234";
const FONT = '"Inter Tight", system-ui, sans-serif';

const CAPS = [
  (s) => `Nobody can measure the air perfectly.<small>Weather stations, satellites and balloons leave gaps. So the starting temperature is a best guess: about ${s.mean}°F, give or take ${s.half}°.</small>`,
  () => "So the model starts 64 times, from 64 slightly different guesses.<small>Each dot is one starting point. They differ by only a degree or two.</small>",
  () => "The air is chaotic: tiny differences grow, roughly doubling every few days.<small>These lines are a toy model of chaos (Lorenz, 1963), started from the same 64 points. Same physics, very different endings.</small>",
  () => "The same thing happened in the real forecast.<small>The amber band is the real WeatherNext 3 forecast for Harvard Yard: how far the middle 80% of its 64 runs sit from their average.</small>",
  () => "Better measurements delay the fan, but never remove it.<small>That's why forecasts more than about 10 days out are about odds, not answers.</small>",
];

const SMOOTH_DAYS = 1.5;

let st = null;

function stats(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (f) => d3.quantileSorted(s, f);
  return { mean: d3.mean(s), p10: q(0.1), p90: q(0.9), min: s[0], max: s[s.length - 1] };
}

function mount(layer, ctx) {
  const { data } = ctx;
  const starts = data.members.t2m.map((m) => m[0]);
  const s0 = stats(starts);
  const runs = lorenzRuns(BASE, starts.map((v) => (v - s0.mean) / SCALE), { days: DAYS, perDay: PER_DAY, daysPerUnit: DAYS_PER_UNIT });
  const nT = runs[0].length;
  const toy = runs.map(() => new Float32Array(nT));
  for (let i = 0; i < nT; i++) {
    let m = 0;
    for (const xs of runs) m += xs[i];
    m /= runs.length;
    runs.forEach((xs, k) => { toy[k][i] = (xs[i] - m) * SCALE; });
  }
  const win = Math.max(1, Math.round(SMOOTH_DAYS * PER_DAY / 2));
  for (const xs of toy) {
    const src = xs.slice();
    for (let i = 0; i < nT; i++) {
      let a = 0;
      let n = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(nT - 1, i + win); j++) { a += src[j]; n++; }
      xs[i] = a / n;
    }
  }

  const { t2m } = data.series;
  const real = [{ d: 0, lo: s0.p10 - s0.mean, hi: s0.p90 - s0.mean }];
  data.leads.forEach((h, i) => {
    if (h / 24 <= DAYS) real.push({ d: h / 24, lo: t2m.p10[i] - t2m.mean[i], hi: t2m.p90[i] - t2m.mean[i] });
  });

  const lastReal = real[real.length - 1];
  const lastToy = stats(toy.map((xs) => xs[nT - 1]));
  const fit = (lastReal.hi - lastReal.lo) / Math.max(1e-6, lastToy.p90 - lastToy.p10);
  for (const xs of toy) for (let i = 0; i < nT; i++) xs[i] *= fit;

  const mags = [];
  for (const xs of toy) for (const v of xs) mags.push(Math.abs(v));
  mags.sort((a, b) => a - b);
  let reach = d3.quantileSorted(mags, 0.97);
  for (const r of real) reach = Math.max(reach, -r.lo, r.hi);
  const R = Math.ceil((reach + 1) / 5) * 5;
  const full = [-R, R];
  const focus = [-3, 3];

  const rand = rng(17);
  const jitter = starts.map(() => rand() * 2 - 1);
  const capVals = { mean: Math.round(s0.mean), half: Math.max(0.5, Math.round(((s0.p90 - s0.p10) / 2) * 2) / 2) };

  layer.classList.add("wy");
  layer.innerHTML = `
    <div class="wy-stage">
      <header class="wy-head">
        <p class="t-kicker">Why the 64 forecasts drift apart</p>
        <ul class="wy-legend" aria-hidden="true">
          <li class="wy-key is-toy"><i></i>Toy model of chaos, 64 starts</li>
          <li class="wy-key is-real"><i></i>Real forecast, middle 80% of 64 runs</li>
        </ul>
      </header>
      <canvas class="wy-canvas" role="img" aria-label="Harvard Yard temperature over 15 days. 64 lines from a toy chaos model start together and fan apart, and the real WeatherNext 3 forecast band widens the same way."></canvas>
    </div>`;
  const capWrap = el("div", { class: "st-caps wy-caps" });
  const caps = CAPS.map((f) => el("p", { class: "st-cap" }, f(capVals)));
  capWrap.append(...caps);
  layer.append(capWrap);

  st = {
    layer,
    stage: layer.querySelector(".wy-stage"),
    canvas: layer.querySelector(".wy-canvas"),
    keys: [...layer.querySelectorAll(".wy-key")],
    capWrap,
    caps,
    starts,
    s0,
    toy,
    real,
    full,
    focus,
    jitter,
    geo: null,
    p: 0,
  };
  const ro = new ResizeObserver(() => { st.geo = null; render(st.p, ctx); });
  ro.observe(layer);
  document.fonts?.ready.then(() => { st.geo = null; render(st.p, ctx); });
}

function layout(ctx) {
  const vw = st.layer.clientWidth;
  const vh = st.layer.clientHeight;
  if (!vw || !vh) return null;
  let box;
  if (ctx.mobile) {
    const top = 56;
    box = { left: 16, top, width: vw - 32, height: Math.max(260, vh - top - 190) };
  } else {
    const caps = st.capWrap.getBoundingClientRect();
    const left = Math.round(caps.right + Math.min(72, vw * 0.04));
    const top = Math.max(64, vh * 0.1);
    box = { left, top, width: vw - left - Math.max(56, vw * 0.045), height: vh - top - Math.max(56, vh * 0.09) };
  }
  Object.assign(st.stage.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  const r = st.canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  st.canvas.width = Math.round(r.width * dpr);
  st.canvas.height = Math.round(r.height * dpr);
  const m = ctx.mobile ? { l: 40, r: 14, t: 26, b: 40 } : { l: 52, r: 24, t: 34, b: 46 };
  return { W: r.width, H: r.height, dpr, x: m.l, y: m.t, w: r.width - m.l - m.r, h: r.height - m.t - m.b, mobile: ctx.mobile };
}

function render(p, ctx) {
  if (!st) return;
  st.p = p;
  st.geo ??= layout(ctx);
  const G = st.geo;

  st.caps.forEach((c, k) => {
    const a = STEPS[k];
    const b = STEPS[k + 1];
    const fin = k === 0 ? smoothstep(0, 0.03, p) : smoothstep(a - 0.005, a + 0.025, p);
    const fout = k === st.caps.length - 1 ? 1 : 1 - smoothstep(b - 0.03, b - 0.005, p);
    const o = Math.min(fin, fout);
    c.style.opacity = o.toFixed(3);
    c.style.transform = `translate3d(0,${((1 - fin) * 12 - (1 - fout) * 8).toFixed(1)}px,0)`;
    c.style.visibility = o > 0.001 ? "visible" : "hidden";
  });

  const realIn = seg(p, 0.57, 0.69);
  st.keys[0].style.opacity = smoothstep(0.34, 0.4, p).toFixed(3);
  st.keys[1].style.opacity = smoothstep(0.56, 0.6, p).toFixed(3);

  if (!G) return;
  const g = st.canvas.getContext("2d");
  g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  g.clearRect(0, 0, G.W, G.H);

  const one = 1 - smoothstep(0.16, 0.185, p);
  const many = smoothstep(0.175, 0.25, p);
  const z = ease.inOut(seg(p, 0.315, 0.39));
  const T = DAYS * ease.inOut(seg(p, 0.37, 0.55));
  const endIn = smoothstep(0.75, 0.81, p);

  const lo = lerp(st.focus[0], st.full[0], z);
  const hi = lerp(st.focus[1], st.full[1], z);
  const Y = (v) => G.y + G.h * (1 - (v - lo) / (hi - lo));
  const X = (d) => G.x + (G.w * d) / DAYS;
  const cx = lerp(G.x + G.w * 0.42, G.x, z);
  const spreadX = G.w * (G.mobile ? 0.2 : 0.14) * (1 - z) * many;

  drawAxes(g, G, Y, X, z, lo, hi);
  g.save();
  g.beginPath();
  g.rect(G.x - 12, G.y, G.w + 24, G.h);
  g.clip();

  if (endIn > 0) {
    const x10 = X(LIMIT_DAY);
    g.fillStyle = `rgba(${INK}, ${0.035 * endIn})`;
    g.fillRect(x10, G.y, G.x + G.w - x10, G.h);
    g.save();
    g.setLineDash([3, 4]);
    g.strokeStyle = `rgba(${INK}, ${0.55 * endIn})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x10) + 0.5, G.y);
    g.lineTo(Math.round(x10) + 0.5, G.y + G.h);
    g.stroke();
    g.restore();
    g.fillStyle = `rgba(${INK}, ${0.85 * endIn})`;
    g.font = `500 ${G.mobile ? 11 : 13}px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("Odds, not answers", x10 + 8, G.y + 6);
  }

  if (realIn > 0) drawReal(g, G, X, Y, realIn);

  const toyA = lerp(G.mobile ? 0.3 : 0.26, 0.11, realIn);
  if (T > 0) {
    const n = Math.floor(T * PER_DAY);
    const f = T * PER_DAY - n;
    g.lineWidth = G.mobile ? 0.9 : 1.1;
    g.lineJoin = "round";
    g.strokeStyle = `rgba(${INK}, ${toyA})`;
    g.beginPath();
    for (const xs of st.toy) {
      g.moveTo(X(0), Y(xs[0]));
      for (let i = 1; i <= n; i++) g.lineTo(X(i / PER_DAY), Y(xs[i]));
      if (f > 0 && n + 1 < xs.length) g.lineTo(X(T), Y(lerp(xs[n], xs[n + 1], f)));
    }
    g.stroke();
  }

  const tipA = 1 - realIn;
  if (tipA > 0 && many > 0) {
    const r = lerp(G.mobile ? 3.2 : 3.6, G.mobile ? 2.2 : 2.6, z);
    const n = Math.floor(T * PER_DAY);
    const f = T * PER_DAY - n;
    g.globalAlpha = many * tipA;
    st.toy.forEach((xs, k) => {
      const v = T > 0 ? lerp(xs[n], xs[Math.min(xs.length - 1, n + 1)], f) : xs[0] * many;
      const x = T > 0 ? X(T) : cx + st.jitter[k] * spreadX;
      g.fillStyle = tempColor(st.s0.mean + v);
      g.beginPath();
      g.arc(x, Y(v), r, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
  }

  g.restore();

  if (T > 0.05 && realIn < 1) {
    const a = smoothstep(0.37, 0.4, p) * (1 - realIn);
    const x = Math.round(X(T)) + 0.5;
    g.strokeStyle = `rgba(${INK}, ${0.22 * a})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, G.y);
    g.lineTo(x, G.y + G.h);
    g.stroke();
    g.fillStyle = `rgba(${INK}, ${0.9 * a})`;
    g.font = `600 ${G.mobile ? 11 : 12}px ${FONT}`;
    g.textBaseline = "top";
    const flip = T > DAYS - 1.5;
    g.textAlign = flip ? "right" : "left";
    g.fillText(`Day ${Math.round(T)}`, flip ? x - 7 : x + 7, G.y + 4);
  }

  if (one > 0) drawStart(g, G, cx, Y, one);
  if (many > 0 && z < 1) {
    const a = smoothstep(0.215, 0.245, p) * (1 - smoothstep(0.31, 0.34, p));
    if (a > 0) {
      g.fillStyle = `rgba(${INK}, ${0.85 * a})`;
      g.font = `500 ${G.mobile ? 12 : 14}px ${FONT}`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText("64 starting points", cx + spreadX + 16, Y(0));
    }
  }
}

function drawStart(g, G, cx, Y, a) {
  const { s0 } = st;
  const yTop = Y(s0.p90 - s0.mean);
  const yBot = Y(s0.p10 - s0.mean);
  const y = Y(0);
  g.globalAlpha = a;
  g.strokeStyle = `rgba(${INK}, 0.6)`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx, yTop);
  g.lineTo(cx, yBot);
  g.moveTo(cx - 7, yTop);
  g.lineTo(cx + 7, yTop);
  g.moveTo(cx - 7, yBot);
  g.lineTo(cx + 7, yBot);
  g.stroke();
  g.fillStyle = tempColor(s0.mean);
  g.beginPath();
  g.arc(cx, y, G.mobile ? 6 : 7, 0, Math.PI * 2);
  g.fill();
  const tx = cx + 22;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = `rgba(${INK}, 1)`;
  g.font = `400 ${G.mobile ? 30 : 40}px "Instrument Serif", serif`;
  g.fillText(`${Math.round(s0.mean)}°F`, tx, y + (G.mobile ? 4 : 6));
  g.fillStyle = `rgba(${INK}, 0.62)`;
  g.font = `500 ${G.mobile ? 11 : 13}px ${FONT}`;
  g.fillText("best guess, 8 AM Nov 3", tx, y + (G.mobile ? 22 : 28));
  g.fillText("bar: likely range", tx, y + (G.mobile ? 38 : 47));
  g.globalAlpha = 1;
}

function drawReal(g, G, X, Y, t) {
  const pts = st.real;
  const end = DAYS * t;
  const vis = [];
  for (let i = 0; i < pts.length; i++) {
    const r = pts[i];
    if (r.d <= end) { vis.push(r); continue; }
    const q = pts[i - 1];
    const f = (end - q.d) / (r.d - q.d);
    vis.push({ d: end, lo: lerp(q.lo, r.lo, f), hi: lerp(q.hi, r.hi, f) });
    break;
  }
  if (vis.length < 2) return;
  g.beginPath();
  vis.forEach((r, i) => (i ? g.lineTo(X(r.d), Y(r.hi)) : g.moveTo(X(r.d), Y(r.hi))));
  for (let i = vis.length - 1; i >= 0; i--) g.lineTo(X(vis[i].d), Y(vis[i].lo));
  g.closePath();
  g.fillStyle = "rgba(255, 181, 71, 0.26)";
  g.fill();
  g.strokeStyle = AMBER;
  g.lineWidth = G.mobile ? 1.1 : 1.3;
  g.lineJoin = "round";
  for (const k of ["hi", "lo"]) {
    g.beginPath();
    vis.forEach((r, i) => (i ? g.lineTo(X(r.d), Y(r[k])) : g.moveTo(X(r.d), Y(r[k]))));
    g.stroke();
  }
}

function drawAxes(g, G, Y, X, z, lo, hi) {
  g.font = `500 ${G.mobile ? 10.5 : 12}px ${FONT}`;
  g.textBaseline = "middle";
  g.textAlign = "right";
  const m0 = st.s0.mean;
  const step = hi - lo > 34 ? 10 : 5;
  const fmtRel = (v) => (v > 0 ? `+${v}°` : v < 0 ? `\u2212${-v}°` : "0°");
  const sets = [
    { a: 1 - smoothstep(0, 0.4, z), vals: d3.range(Math.ceil(m0 + lo), Math.floor(m0 + hi) + 1).map((F) => [F - m0, `${F}°`]) },
    { a: smoothstep(0.55, 1, z), vals: d3.range(Math.ceil(lo / step) * step, hi + 1e-6, step).map((v) => [v, fmtRel(v)]) },
  ];
  for (const { a, vals } of sets) {
    if (a < 0.02) continue;
    for (const [v, label] of vals) {
      const y = Math.round(Y(v)) + 0.5;
      if (y < G.y - 1 || y > G.y + G.h + 1) continue;
      g.strokeStyle = `rgba(${INK}, ${(v === 0 && label === "0°" ? 0.16 : 0.08) * a})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(G.x, y);
      g.lineTo(G.x + G.w, y);
      g.stroke();
      g.fillStyle = `rgba(${INK}, ${0.5 * a})`;
      g.fillText(label, G.x - 10, y);
    }
  }
  g.textAlign = "left";
  g.textBaseline = "bottom";
  const tx = G.x - (G.mobile ? 36 : 44);
  g.fillStyle = `rgba(${INK}, ${0.55 * sets[0].a})`;
  g.fillText("Temperature, °F", tx, G.y - 10);
  g.fillStyle = `rgba(${INK}, ${0.55 * sets[1].a})`;
  g.fillText("°F above or below the average forecast", tx, G.y - 10);

  g.globalAlpha = z;
  g.strokeStyle = `rgba(${INK}, 0.28)`;
  g.beginPath();
  g.moveTo(G.x, Math.round(G.y + G.h) + 0.5);
  g.lineTo(G.x + G.w, Math.round(G.y + G.h) + 0.5);
  g.stroke();
  g.fillStyle = `rgba(${INK}, 0.5)`;
  g.textBaseline = "top";
  const ticks = G.mobile ? [0, 5, 10, 15] : [0, 3, 6, 9, 12, 15];
  for (const d of ticks) {
    const x = X(d);
    g.textAlign = d === 0 ? "left" : d === DAYS ? "right" : "center";
    g.fillText(String(d), d === 0 ? x - 3 : d === DAYS ? x + 3 : x, G.y + G.h + 9);
  }
  g.textAlign = "center";
  g.fillText("Days after the forecast was made", G.x + G.w / 2, G.y + G.h + (G.mobile ? 24 : 27));
  g.globalAlpha = 1;
}

export default {
  length: 5,
  mount,
  update(p, ctx) {
    ctx.veil(1);
    render(p, ctx);
  },
  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.veil(1);
    clearTimeout(st?.hideTimer);
    if (st) {
      st.geo = null;
      st.hideTimer = setTimeout(() => { if (ctx.active === "why") ctx.world.setVisible(false); }, 700);
    }
  },
  leave(dir, ctx) {
    clearTimeout(st?.hideTimer);
    ctx.world.setVisible(true);
    ctx.veil(0);
  },
};
