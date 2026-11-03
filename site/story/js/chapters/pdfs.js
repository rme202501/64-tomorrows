import { seg, ease, clamp, lerp } from "../util.js";
import {
  completeDays, dayStats, tempDomain, kde, tempGradient, fitCanvas, dayName, dateLabel, roundRect, FONT,
} from "../pdfs/common.js";

const START = 0.08;
const END = 0.78;
const H0 = 0.025;
const CAPTIONS = [
  "Your app gives one high per day. A single spike.",
  "64 forecasts melt that spike into a range.",
  "Each day out, the curve flattens and widens.",
  "The app's spike stays sharp. The forecast does not.",
];

const capSoft = (v, cap) => v / (1 + (v / cap) ** 10) ** (1 / 10);

export default {
  length: 5,

  mount(layer, ctx) {
    layer.classList.add("pdfs");
    layer.innerHTML = `
      <div class="pd-wrap">
        <header class="pd-head">
          <p class="t-kicker">Daily high temperature, Harvard Yard</p>
          <h2 class="t-title pd-title">One number, or a whole curve?</h2>
          <div class="pd-caps">${CAPTIONS.map((c) => `<p class="t-caption pd-cap">${c}</p>`).join("")}</div>
        </header>
        <div class="pd-plot"><canvas class="pd-canvas" role="img" aria-label="Probability curves of the daily high temperature for each forecast day, widening with lead time, each with a single spike for the app's forecast."></canvas></div>
      </div>`;
    this.layer = layer;
    this.canvas = layer.querySelector(".pd-canvas");
    this.caps = [...layer.querySelectorAll(".pd-cap")];
    this.head = layer.querySelector(".pd-head");
    this.ctx = ctx;
    this.p = 0;
    this.days = completeDays(ctx.data).map(dayStats);
    this.domain = tempDomain(this.days, 5, 4);
    const n = this.days.length;
    const weights = this.days.map((_, i) => (i === 0 ? 2.2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = START;
    this.slots = weights.map((w) => {
      const a = acc;
      acc += ((END - START) * w) / total;
      return [a, acc];
    });
    this.n = n;
    const [a0, b0] = this.slots[0];
    const second = this.slots[1]?.[0] ?? END;
    this.capBreaks = [a0 + (b0 - a0) * 0.3, second + (END - second) * 0.15, END + 0.01];
    this.layout = null;
    this.ro = new ResizeObserver(() => { this.layout = null; this.draw(); });
    this.ro.observe(this.canvas);
  },

  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.veil(1);
    ctx.world.setDim(1);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (ctx.active === "pdfs") ctx.world.setVisible(false); }, 700);
    if (document.fonts?.status !== "loaded") document.fonts?.ready.then(() => this.draw());
  },

  leave(dir, ctx) {
    clearTimeout(this.hideTimer);
    cancelAnimationFrame(this.raf);
    if (dir < 0) ctx.world.setVisible(true);
  },

  update(p, ctx) {
    this.p = p;
    ctx.veil(1);
    const cap = this.capBreaks.filter((b) => p >= b).length;
    this.caps.forEach((el, i) => el.classList.toggle("is-on", i === cap));
    this.head.style.setProperty("--pd-in", ease.out(seg(p, 0, 0.06)).toFixed(3));
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  },

  computeLayout() {
    const mobile = this.ctx.mobile;
    const { g, w, h } = fitCanvas(this.canvas, mobile);
    const n = this.n;
    const L = mobile ? 74 : 132;
    const R = mobile ? 54 : 104;
    const bottom = mobile ? 36 : 44;
    const pill = mobile ? 30 : 34;
    const a = 2.3;
    const gap = Math.min(mobile ? 70 : 92, (h - bottom - pill - 10) / (n - 1 + a));
    const spike = gap * a;
    const used = (n - 1 + a) * gap;
    const free = Math.max(0, h - bottom - pill - 10 - used);
    const yLast = h - bottom - 4 - free * 0.45;
    const base = this.days.map((_, i) => yLast - (n - 1 - i) * gap);
    const [lo, hi] = this.domain;
    const xL = L;
    const xR = w - R;
    const xOf = (F) => xL + ((F - lo) / (hi - lo)) * (xR - xL);
    const step = 1;
    const m = Math.ceil((xR - xL) / step) + 1;
    const dxF = ((hi - lo) * step) / (xR - xL);
    const finals = this.days.map((s) => kde(new Float32Array(m), s.sorted, lo, dxF, s.h, s.p50, 1));
    const peak = Math.max(...finals.map((f) => Math.max(...f)));
    const scale = (0.6 * spike) / peak;
    this.layout = {
      g, w, h, mobile, gap, spike, base, axisY: yLast + 12, xL, xR, xOf, m, step, dxF, lo, hi, finals, scale, bottom,
      grad: tempGradient(g, xL, xR, lo, hi, 0.92),
      gradLine: tempGradient(g, xL, xR, lo, hi, 1),
      tmp: new Float32Array(m),
      ys: new Float32Array(m),
    };
  },

  dayState(i, p) {
    const [a, b] = this.slots[i];
    const len = b - a;
    return {
      appear: ease.out(seg(p, a, a + len * 0.22)),
      morph: ease.inOut(seg(p, a + len * 0.3, a + len * 0.96)),
      current: p >= a && (i === this.n - 1 ? p < END + 0.02 : p < this.slots[i + 1][0]),
      label: ease.out(seg(p, a, a + len * 0.3)),
    };
  },

  draw() {
    if (!this.canvas.isConnected) return;
    if (!this.layout) this.computeLayout();
    const Lo = this.layout;
    const { g, w, h, xL, xR, xOf, m, step, dxF, lo, hi, base, spike, scale, mobile } = Lo;
    const p = this.p;
    g.clearRect(0, 0, w, h);

    const axisIn = ease.out(seg(p, 0.01, 0.08));
    const final = ease.inOut(seg(p, END + 0.01, END + 0.07));
    this.drawAxis(axisIn);

    for (let i = 0; i < this.n; i++) {
      const st = this.dayState(i, p);
      const y0 = base[i];
      g.save();
      g.globalAlpha = st.label;
      g.strokeStyle = "rgba(244,241,234,0.14)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xL, y0 + 0.5);
      g.lineTo(xR, y0 + 0.5);
      g.stroke();
      g.restore();
      if (st.appear <= 0) continue;
      this.drawDay(i, st, y0, final);
    }

    for (let i = 0; i < this.n; i++) {
      const st = this.dayState(i, p);
      if (st.label <= 0) continue;
      this.drawLabels(i, st, base[i], final);
    }

    for (let i = 0; i < this.n; i++) {
      const st = this.dayState(i, p);
      if (st.appear <= 0) continue;
      this.drawNeedle(i, st, base[i], final);
    }
  },

  drawAxis(k) {
    const { g, h, xL, xR, xOf, lo, hi, bottom, mobile } = this.layout;
    if (k <= 0) return;
    g.save();
    g.globalAlpha = k;
    const y = this.layout.axisY;
    g.strokeStyle = "rgba(244,241,234,0.22)";
    g.beginPath();
    g.moveTo(xL, y + 0.5);
    g.lineTo(xL + (xR - xL) * k, y + 0.5);
    g.stroke();
    const tick = (hi - lo) > 40 ? 10 : 5;
    g.font = `400 ${mobile ? 10 : 11}px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.5)";
    g.textAlign = "center";
    g.textBaseline = "top";
    for (let F = Math.ceil(lo / tick) * tick; F <= hi; F += tick) {
      const x = xOf(F);
      g.fillRect(Math.round(x), y, 1, 4);
      g.fillText(`${F}°`, x, y + 8);
    }
    g.textAlign = "right";
    g.restore();
  },

  curveFor(i, st) {
    const Lo = this.layout;
    const s = this.days[i];
    if (st.morph >= 1) return Lo.finals[i];
    const hh = Math.exp(lerp(Math.log(H0), Math.log(s.h), st.morph));
    return kde(Lo.tmp, s.sorted, Lo.lo, Lo.dxF, hh, s.p50, st.morph);
  },

  drawDay(i, st, y0, final) {
    const Lo = this.layout;
    const { g, xL, m, step, scale, spike, ys } = Lo;
    const dens = this.curveFor(i, st);
    const grow = st.appear;
    for (let j = 0; j < m; j++) ys[j] = y0 - capSoft(dens[j] * scale, spike) * grow;

    g.beginPath();
    g.moveTo(xL, y0);
    for (let j = 0; j < m; j++) g.lineTo(xL + j * step, ys[j]);
    g.lineTo(xL + (m - 1) * step, y0);
    g.closePath();
    g.fillStyle = "#05070d";
    g.fill();
    g.save();
    g.globalAlpha = lerp(0.55, 1, st.morph);
    g.fillStyle = Lo.grad;
    g.fill();
    g.restore();

    const shade = g.createLinearGradient(0, y0 - spike * 0.6, 0, y0);
    shade.addColorStop(0, "rgba(5,7,13,0)");
    shade.addColorStop(1, "rgba(5,7,13,0.38)");
    g.fillStyle = shade;
    g.fill();

    g.beginPath();
    for (let j = 0; j < m; j++) {
      const x = xL + j * step;
      if (j === 0) g.moveTo(x, ys[j]); else g.lineTo(x, ys[j]);
    }
    g.save();
    if (st.current) {
      g.shadowColor = "rgba(255,220,170,0.7)";
      g.shadowBlur = 12;
    }
    g.strokeStyle = Lo.gradLine;
    g.lineWidth = st.current ? 2 : 1.4;
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
  },

  drawNeedle(i, st, y0, final) {
    const Lo = this.layout;
    const { g, xOf, spike, mobile } = Lo;
    const s = this.days[i];
    const x = Math.round(xOf(s.p50)) + 0.5;
    const top = y0 - spike * st.appear;
    const hot = st.current ? 1 : final;
    const alpha = lerp(0.42, 1, hot);
    g.save();
    g.globalAlpha = alpha;
    if (hot > 0) {
      g.shadowColor = "rgba(255,255,255,0.9)";
      g.shadowBlur = 10 * hot;
    }
    g.strokeStyle = "#ffffff";
    g.lineWidth = lerp(1.1, 2, hot);
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, top);
    g.stroke();
    g.beginPath();
    g.arc(x, top, lerp(2, 3.2, hot), 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.restore();

    if (st.current && final < 1) {
      const k = 1 - final;
      const text = `Your app  ${Math.round(s.p50)}°`;
      g.save();
      g.font = `600 ${mobile ? 11 : 12}px ${FONT.sans}`;
      const tw = g.measureText(text).width;
      const pw = tw + 16;
      const ph = mobile ? 20 : 22;
      let px = x - pw / 2;
      px = clamp(px, Lo.xL - 8, Lo.xR + 8 - pw);
      const py = top - ph - 8;
      g.globalAlpha = k * st.appear;
      roundRect(g, px, py, pw, ph, ph / 2);
      g.fillStyle = "#ffffff";
      g.fill();
      g.fillStyle = "#05070d";
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillText(text, px + 8, py + ph / 2 + 0.5);
      g.restore();
    }
  },

  drawLabels(i, st, y0, final) {
    const Lo = this.layout;
    const { g, xL, xR, mobile } = Lo;
    const s = this.days[i];
    const on = st.current || final > 0;
    g.save();
    g.globalAlpha = st.label * (on ? 1 : 0.62);
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = "#f4f1ea";
    g.font = `400 ${mobile ? 18 : 24}px ${FONT.serif}`;
    const nm = dayName(s.day);
    const label = mobile && nm === "Tomorrow" ? "Tmrw" : nm;
    g.fillText(label, 0, y0 - 4);
    g.font = `400 ${mobile ? 9 : 10}px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.5)";
    g.fillText(dateLabel(s.day).toUpperCase(), 0, y0 + (mobile ? 9 : 11));
    g.restore();

    const k = st.morph;
    if (k <= 0) return;
    g.save();
    g.globalAlpha = k * (on ? 1 : 0.7);
    const lo = Math.round(s.min);
    const hi = Math.round(s.max);
    const x = xR + (mobile ? 8 : 14);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = `600 ${mobile ? 12 : 15}px ${FONT.sans}`;
    g.fillStyle = "#f4f1ea";
    g.fillText(`${lo}-${hi}°`, x, y0 - 4);
    g.font = `400 ${mobile ? 9 : 10}px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.5)";
    g.fillText(`APP ${Math.round(s.p50)}°`, x, y0 + (mobile ? 9 : 11));
    g.restore();
  },
};
