import { clamp, lerp, seg, ease, tempColor, glyph, condition, CONDITION_LABEL, fmtLongDow, fmtDate } from "../util.js";
import {
  svgEl, targetDay, numWord, beeswarm, tweenNumber, scrollToProgress, flag, setText, setStyle,
} from "../decide/common.js";
import { buildYard } from "../decide/yard.js";

const COLD = 55;
const WARM = 65;
const HOUR = 9;
const P_REVEAL = 0.34;
const P_STEP3 = 0.55;
const P_A = 0.58;
const P_B = 0.71;
const P_C = 0.75;
const P_D = 0.87;
const P_PUNCH = 0.88;

const CHOICES = [
  { id: "jacket", label: "Jacket" },
  { id: "none", label: "No jacket" },
  { id: "laundry", label: "Do laundry today" },
];

export default {
  length: 5.5,
  interactive: true,

  mount(layer, ctx) {
    const { data } = ctx;
    const N = targetDay(data);
    this.N = N;
    this.ctx = ctx;
    this.mid = Math.min(4, N);
    const leadN = data.leadForDay(N, HOUR);
    const stats = data.statsAt("t2m", leadN);
    this.app = stats.p50;
    const day = data.timeAt(leadN);
    const cond = condition(data.statsAt("cloud", leadN).p50, data.statsAt("precip", leadN).p50, HOUR);

    this.days = [];
    for (let d = 0; d <= N; d++) {
      const vals = data.membersAt("t2m", data.leadForDay(d, HOUR)).sort((a, b) => a - b);
      const med = (vals[31] + vals[32]) / 2;
      this.days.push(vals.map((v) => v - med + this.app));
    }
    const all = this.days.flat();
    this.lo = Math.min(COLD - 3, Math.floor((Math.min(...all) - 2) / 5) * 5);
    this.hi = Math.max(WARM + 3, Math.ceil((Math.max(...all) + 2) / 5) * 5);

    layer.classList.add("jk");
    layer.innerHTML = `
      <div class="jk-scene"></div>
      <div class="jk-panel">
        <p class="t-kicker jk-kicker">${fmtLongDow(day)}, ${fmtDate(day)} · 9 AM</p>
        <h2 class="t-title jk-title">Walking to class, ${N === 1 ? "tomorrow" : `${numWord(N)} days from now`}.</h2>
        <div class="jk-app">
          <div class="jk-app-num t-num">${Math.round(this.app)}°</div>
          <div class="jk-app-meta">
            <span class="jk-app-cond">${glyph(cond, 22)}<span>${CONDITION_LABEL[cond]}</span></span>
            <span class="jk-app-src">Your weather app</span>
          </div>
        </div>
        <div class="jk-slot">
          <div class="jk-choices" role="group" aria-label="Do you need a jacket?">
            ${CHOICES.map((c) => `<button type="button" class="btn jk-btn" data-c="${c.id}" aria-pressed="false">${c.label}</button>`).join("")}
          </div>
          <div class="jk-days">
            <div class="jk-days-head"><span class="jk-days-label t-num">${N} days out</span><span class="jk-days-hint">drag or scroll</span></div>
            <input class="jk-range" type="range" min="0" max="${N}" step="0.01" value="0" aria-label="Days until class">
            <div class="jk-days-ends"><span>${N} days out</span><span>That morning</span></div>
          </div>
        </div>
        <div class="jk-chart"><svg class="jk-strip" aria-hidden="true"></svg></div>
        <div class="jk-out">
          <div class="jk-verdict">
            <div class="jk-stat"><b class="jk-count t-num">0</b><span>of 64 mornings<br>colder than ${COLD}°</span></div>
            <p class="jk-line"></p>
          </div>
          <p class="jk-punch">You can just put on a jacket <em>that morning.</em></p>
        </div>
        <p class="jk-note">Narrowing uses this run's spread at shorter leads, centered on the same median.</p>
      </div>`;

    this.layer = layer;
    this.q = (s) => layer.querySelector(s);
    this.yard = buildYard(this.q(".jk-scene"));
    this.yard.setOutfit("tee");
    this.yard.setMood("ok");
    this.yard.setChip(this.app, "YOUR APP");
    this.btns = [...layer.querySelectorAll(".jk-btn")];
    this.range = this.q(".jk-range");
    this.countEl = this.q(".jk-count");
    this.lineEl = this.q(".jk-line");
    this.daysLabel = this.q(".jk-days-label");

    this.choice = null;
    this.userChose = false;
    this.reveal = { t: 0 };
    this.revealed = false;
    this.p = 0;
    this.dd = N;
    this.lastCount = -1;

    this.btns.forEach((b) => b.addEventListener("click", () => this.choose(b.dataset.c, true)));
    this.range.addEventListener("input", () => {
      const dd = N - +this.range.value;
      scrollToProgress("jacket", this.pOf(dd), false);
    });

    this.buildStrip();
    this.ro = new ResizeObserver(() => { this.buildStrip(); this.draw(); });
    this.ro.observe(this.q(".jk-chart"));
  },

  ddOf(p) {
    const { N, mid } = this;
    if (N <= mid) return lerp(N, 0, ease.inOut(seg(p, P_A, P_D)));
    if (p < P_C) return lerp(N, mid, ease.inOut(seg(p, P_A, P_B)));
    return lerp(mid, 0, ease.inOut(seg(p, P_C, P_D)));
  },

  pOf(dd) {
    const { N, mid } = this;
    const inv = (t) => {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ease.inOut(m) < t) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    if (N <= mid) return lerp(P_A, P_D, inv((N - dd) / Math.max(1e-6, N)));
    if (dd >= mid) return lerp(P_A, P_B, inv((N - dd) / (N - mid)));
    return lerp(P_C, P_D, inv((mid - dd) / mid));
  },

  buildStrip() {
    const svg = this.q(".jk-strip");
    const box = this.q(".jk-chart");
    const W = Math.max(240, box.clientWidth);
    const H = Math.max(120, box.clientHeight);
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const padX = 14;
    const x = d3.scaleLinear().domain([this.lo, this.hi]).range([padX, W - padX]);
    this.x = x;
    const axisY = H - 22;
    const top = 26;
    this.cy = (top + axisY) / 2;
    const half = (axisY - top) / 2 - 4;
    const r = W < 480 ? 4 : 5;
    this.r = r;
    this.layouts = this.days.map((vals) => beeswarm(vals.map((v) => x(v)), r));
    for (const l of this.layouts) {
      const maxY = Math.max(...l.map((p) => Math.abs(p.y)));
      if (maxY > half) l.forEach((p) => { p.y *= half / maxY; });
    }

    const g = (cls) => svgEl("g", { class: cls }, svg);
    const zone = g("jk-zones");
    svgEl("rect", { class: "jk-cold-zone", x: padX, y: top - 8, width: Math.max(0, x(COLD) - padX), height: axisY - top + 8 }, zone);
    this.warmZone = svgEl("rect", { class: "jk-warm-zone", x: x(WARM), y: top - 8, width: Math.max(0, W - padX - x(WARM)), height: axisY - top + 8 }, zone);

    const axis = g("jk-axis");
    svgEl("line", { x1: padX, x2: W - padX, y1: axisY, y2: axisY }, axis);
    const step = (this.hi - this.lo) > 40 && W < 480 ? 10 : 5;
    for (let v = Math.ceil(this.lo / step) * step; v <= this.hi; v += step) {
      svgEl("line", { x1: x(v), x2: x(v), y1: axisY, y2: axisY + 4 }, axis);
      const t = svgEl("text", { x: x(v), y: axisY + 16, "text-anchor": "middle" }, axis);
      t.textContent = `${v}°`;
    }

    const lines = g("jk-lines");
    svgEl("line", { class: "jk-cold-line", x1: x(COLD), x2: x(COLD), y1: top - 8, y2: axisY }, lines);
    const ct = svgEl("text", { class: "jk-cold-label", x: x(COLD) - 6, y: top + 2, "text-anchor": "end" }, lines);
    ct.textContent = "jacket weather";
    this.warmLine = svgEl("g", { class: "jk-warm" }, lines);
    svgEl("line", { x1: x(WARM), x2: x(WARM), y1: top - 8, y2: axisY }, this.warmLine);
    const narrow = matchMedia("(max-width: 720px)").matches;
    const wt = svgEl("text", narrow
      ? { x: x(WARM) - 6, y: top + 2, "text-anchor": "end" }
      : { x: x(WARM) + 6, y: top + 2 }, this.warmLine);
    wt.textContent = narrow ? "too warm" : "too warm for one";

    const app = g("jk-appmark");
    svgEl("line", { x1: x(this.app), x2: x(this.app), y1: top - 14, y2: axisY }, app);
    const at = svgEl("text", { x: x(this.app), y: top - 18, "text-anchor": "middle" }, app);
    at.textContent = `app ${Math.round(this.app)}°`;
    this.appMark = app;
    box.style.setProperty("--ax", `${x(this.app)}px`);

    const dots = g("jk-dots");
    this.dots = Array.from({ length: 64 }, () => svgEl("circle", { r, cx: x(this.app), cy: this.cy }, dots));
    this.delays = Array.from({ length: 64 }, (_, k) => ((k * 37) % 64) / 64);
    flag(this.warmLine, "is-on", this.choice === "jacket");
    flag(this.warmZone, "is-on", this.choice === "jacket");
  },

  valuesAt(dd) {
    const a = Math.floor(dd);
    const b = Math.min(this.N, a + 1);
    const t = dd - a;
    const A = this.days[a];
    const B = this.days[b];
    return A.map((v, k) => lerp(v, B[k], t));
  },

  draw() {
    if (!this.dots) return;
    const dd = this.dd;
    const a = Math.floor(dd);
    const b = Math.min(this.N, a + 1);
    const t = dd - a;
    const LA = this.layouts[a];
    const LB = this.layouts[b];
    const ax = this.x(this.app);
    const rv = this.reveal.t;
    for (let k = 0; k < 64; k++) {
      const px = lerp(LA[k].x, LB[k].x, t);
      const py = lerp(LA[k].y, LB[k].y, t);
      const v = lerp(this.days[a][k], this.days[b][k], t);
      const e = ease.out(clamp((rv - this.delays[k] * 0.45) / 0.55));
      const c = this.dots[k];
      c.setAttribute("cx", lerp(ax, px, e).toFixed(1));
      c.setAttribute("cy", (this.cy + py * e).toFixed(1));
      c.setAttribute("fill", tempColor(v));
      c.setAttribute("opacity", (0.25 + 0.75 * e).toFixed(2));
    }
  },

  choose(id, user) {
    this.choice = id;
    if (user) this.userChose = true;
    this.btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === id)));
    flag(this.layer, "is-auto", !this.userChose);
    this.yard.setOutfit(id === "none" ? "tee" : id === "laundry" ? "laundry" : "coat");
    flag(this.warmLine, "is-on", id === "jacket");
    flag(this.warmZone, "is-on", id === "jacket");
    this.setRevealed(true);
    this.lastCount = -1;
    this.updateVerdict(true);
  },

  setRevealed(on) {
    if (on === this.revealed) return;
    this.revealed = on;
    flag(this.layer, "is-revealed", on);
    gsap.killTweensOf(this.reveal);
    if (this.ctx.reduced) {
      this.reveal.t = on ? 1 : 0;
      this.draw();
    } else {
      gsap.to(this.reveal, { t: on ? 1 : 0, duration: on ? 1.6 : 0.5, ease: on ? "power2.out" : "power2.in", onUpdate: () => this.draw() });
    }
    if (on) this.startSampling(); else this.stopSampling();
  },

  verdictText(cold, warm) {
    const dd = this.dd;
    const step3 = this.p >= P_STEP3;
    if (step3) {
      const r = Math.round(dd);
      const when = r === 0 ? "That morning" : r === 1 ? "The day before" : `${r} days out`;
      return `${when}: cold in ${cold} of 64.`;
    }
    const of = (n) => `${n} of 64 tomorrows`;
    switch (this.userChose ? this.choice : "auto") {
      case "none":
        return cold ? `No jacket. In ${of(cold)}, you shiver.` : "No jacket. Warm enough in all 64 tomorrows.";
      case "jacket":
        return warm ? `Jacket on. Needed in ${cold} of 64, too warm in ${warm}.` : `Jacket on. You needed it in ${of(cold)}.`;
      case "laundry":
        return `Laundry today, just in case. Needed in ${of(cold)}.`;
      default:
        return `Trusting the app: ${this.choice === "none" ? "no jacket" : "jacket"}. Cold in ${of(cold)}.`;
    }
  },

  updateVerdict(force) {
    const vals = this.valuesAt(this.dd);
    const cold = vals.filter((v) => v < COLD).length;
    const warm = vals.filter((v) => v >= WARM).length;
    if (cold !== this.lastCount || force) {
      this.lastCount = cold;
      tweenNumber(this.countEl, cold, { duration: 0.6 });
    }
    setText(this.lineEl, this.verdictText(cold, warm));
  },

  startSampling() {
    if (this.timer || !this.active) return;
    const tick = () => {
      const vals = this.valuesAt(this.dd);
      const k = Math.floor(Math.random() * 64);
      const v = vals[k];
      this.yard.setChip(v, `TOMORROW #${k + 1}`);
      const outfit = this.choice === "none" ? "tee" : "coat";
      this.yard.setMood(v < COLD && outfit === "tee" ? "cold" : v >= WARM && outfit === "coat" ? "warm" : "ok");
      this.dots.forEach((c, j) => c.classList.toggle("is-picked", j === k));
    };
    tick();
    this.timer = setInterval(tick, 1700);
  },

  stopSampling() {
    clearInterval(this.timer);
    this.timer = 0;
    this.dots?.forEach((c) => c.classList.remove("is-picked"));
    if (this.yard) {
      this.yard.setChip(this.app, "YOUR APP");
      this.yard.setMood("ok");
    }
  },

  enter(dir, ctx) {
    this.active = true;
    ctx.hud.show(false);
    ctx.world.setDim(0.6);
    this.yard.setWalking(!ctx.reduced);
    if (this.revealed) this.startSampling();
  },

  leave(dir, ctx) {
    this.active = false;
    this.yard.setWalking(false);
    clearInterval(this.timer);
    this.timer = 0;
    if (dir < 0) {
      ctx.world.setVisible(true);
      ctx.veil(0);
    }
  },

  update(p, ctx) {
    this.p = p;
    ctx.veil(clamp(p / 0.08));
    ctx.world.setVisible(p < 0.1);

    if (!this.userChose) {
      if (p >= P_REVEAL && !this.revealed) this.choose(this.app >= COLD ? "none" : "jacket", false);
      else if (p < P_REVEAL && this.revealed) {
        this.choice = null;
        this.btns.forEach((b) => b.setAttribute("aria-pressed", "false"));
        this.yard.setOutfit("tee");
        flag(this.warmLine, "is-on", false);
        flag(this.warmZone, "is-on", false);
        this.setRevealed(false);
      }
    }

    const step3 = p >= P_STEP3;
    flag(this.layer, "is-step3", step3);
    flag(this.layer, "is-punch", p >= P_PUNCH);

    const dd = this.ddOf(p);
    const changed = Math.abs(dd - this.dd) > 1e-4;
    this.dd = dd;
    const shown = this.N - dd;
    if (document.activeElement !== this.range) this.range.value = String(shown);
    setStyle(this.range, "--fill", `${((shown / Math.max(1, this.N)) * 100).toFixed(2)}%`);
    const r = Math.round(dd);
    setText(this.daysLabel, r === 0 ? "That morning" : r === 1 ? "1 day out" : `${r} days out`);
    if (changed) this.draw();
    if (this.revealed) this.updateVerdict(false);
  },
};
