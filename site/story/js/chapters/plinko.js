import { seg, ease, clamp, lerp, tempColor, loop } from "../util.js";
import {
  completeDays, dayStats, tempDomain, sampleHigh, fitCanvas, dayName, roundRect, FONT,
} from "../pdfs/common.js";

const BATCH = 100;
const MAX_BALLS = 1500;
const HOP = 0.085;
const ENTRY = 0.22;

function pickDays(days) {
  const byLead = (n) => days.find((d) => d.day.lead_days === n);
  const last = days[days.length - 1];
  const picks = [byLead(1) ?? days[0], byLead(3), byLead(7), last].filter(Boolean);
  return [...new Set(picks)];
}

const chipLabel = (s) => (s.day.lead_days === 1 ? "Tomorrow" : `${s.day.dow} · day ${s.day.lead_days}`);

export default {
  length: 4,
  interactive: true,

  mount(layer, ctx) {
    layer.classList.add("plinko");
    this.ctx = ctx;
    this.all = completeDays(ctx.data).map(dayStats);
    this.domain = tempDomain(this.all, 5, 3);
    this.choices = pickDays(this.all);
    const farIdx = this.choices.findIndex((s) => s.day.lead_days >= 5);
    this.dayIdx = farIdx >= 0 ? farIdx : this.choices.length - 1;

    layer.innerHTML = `
      <div class="pk-wrap">
        <div class="pk-head">
          <p class="t-kicker">Daily high, Harvard Yard</p>
          <h2 class="t-title pk-title">Simulate the weather 100x.</h2>
          <p class="t-caption pk-cap">Each ball is one possible high temperature for <b class="pk-dayname"></b>, picked at random from the 64 forecasts. The tallest piles are the likeliest temperatures.</p>
        </div>
        <div class="chips pk-chips" role="group" aria-label="Forecast day">
          ${this.choices.map((s, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="false">${chipLabel(s)}</button>`).join("")}
        </div>
        <div class="pk-board"><canvas class="pk-canvas" role="img" aria-label="Galton board: balls fall through pegs and stack into a histogram of possible daily highs."></canvas></div>
        <div class="pk-actions">
          <button type="button" class="btn is-primary pk-go"><span class="pk-go-icon" aria-hidden="true"></span>Simulate 100x</button>
          <button type="button" class="btn pk-reset">Reset</button>
          <p class="pk-count" aria-live="polite"><b class="t-num">0</b><span><span class="pk-long">simulated </span>days</span></p>
        </div>
        <p class="pk-result" aria-live="polite"></p>
      </div>`;
    this.layer = layer;
    this.canvas = layer.querySelector(".pk-canvas");
    this.chips = [...layer.querySelectorAll(".pk-chips .chip")];
    this.goBtn = layer.querySelector(".pk-go");
    this.resetBtn = layer.querySelector(".pk-reset");
    this.countEl = layer.querySelector(".pk-count b");
    this.resultEl = layer.querySelector(".pk-result");
    this.dayNameEl = layer.querySelector(".pk-dayname");

    this.balls = [];
    this.queue = 0;
    this.nextRelease = 0;
    this.counts = [];
    this.shown = 0;
    this.time = 0;
    this.flash = null;
    this.cx = null;
    this.pegHits = new Map();
    this.interacted = false;
    this.autoDone = false;
    this.sprites = new Map();
    this.seed = 1;
    this.rand = Math.random;

    this.chips.forEach((c) => c.addEventListener("click", () => {
      this.interacted = true;
      this.setDay(+c.dataset.i, true);
    }));
    this.goBtn.addEventListener("click", () => {
      this.interacted = true;
      this.drop(BATCH);
    });
    this.resetBtn.addEventListener("click", () => {
      this.interacted = true;
      this.clear();
    });
    this.setDay(this.dayIdx, false);
    this.ro = new ResizeObserver(() => { this.layout = null; this.kick(); });
    this.ro.observe(this.canvas);
  },

  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.veil(1);
    ctx.world.setDim(1);
    ctx.world.setVisible(false);
    this.active = true;
    this.kick();
  },

  leave(dir, ctx) {
    this.active = false;
    this.stop?.();
    this.stop = null;
    if (dir > 0) ctx.world.setVisible(true);
  },

  update(p, ctx) {
    ctx.veil(1);
    if (!this.interacted) {
      if (!this.autoDone && p > 0.1) {
        this.autoDone = true;
        this.drop(BATCH);
      } else if (this.autoDone && p < 0.02) {
        this.autoDone = false;
        this.clear();
      }
    }
  },

  setDay(i, redrop) {
    this.dayIdx = i;
    this.stats = this.choices[i];
    this.chips.forEach((c, k) => c.setAttribute("aria-pressed", String(k === i)));
    const nm = dayName(this.stats.day);
    this.dayNameEl.textContent = nm === "Tomorrow" || nm === "Today" ? nm.toLowerCase() : longDow(this.stats.day.dow);
    if (this.balls.length || this.queue) {
      this.clear();
      if (redrop) this.drop(BATCH);
    } else if (redrop) {
      this.drop(BATCH);
    }
    this.kick();
  },

  clear() {
    for (const b of this.balls) if (!b.dying) { b.dying = true; b.dieAt = this.time; }
    this.queue = 0;
    this.counts = [];
    this.shown = 0;
    this.countEl.textContent = "0";
    this.flash = null;
    this.resultEl.classList.remove("is-on");
    this.kick();
  },

  drop(n) {
    const live = this.balls.filter((b) => !b.dying).length + this.queue;
    const add = Math.min(n, MAX_BALLS - live);
    if (add <= 0) return;
    this.queue += add;
    this.nextRelease = Math.max(this.nextRelease, this.time);
    if (this.flash) this.flash.out = this.time;
    this.resultEl.classList.remove("is-on");
    this.kick();
  },

  computeLayout() {
    const mobile = this.ctx.mobile;
    const { g, w, h } = fitCanvas(this.canvas, mobile);
    const [lo, hi] = this.domain;
    const pad = mobile ? 4 : 12;
    const xL = pad;
    const xR = w - pad;
    const pxF = (xR - xL) / (hi - lo);
    const binF = pxF >= 11 ? 1 : pxF >= 5.5 ? 2 : 3;
    const nb = Math.ceil((hi - lo) / binF);
    const bw = (xR - xL) / nb;
    const r = Math.min(bw * 0.42, 8);
    const rows = mobile ? 8 : 10;
    const sx = clamp(Math.min((xR - xL) * 0.46 / rows, (h * 0.36) / (rows * 0.86)), r * 2.6, 36);
    const sy = sx * 0.86;
    const top = 26;
    const axisH = mobile ? 46 : 52;
    const yB = h - axisH;
    const pegBottom = top + 18 + (rows - 1) * sy;
    const histTop = pegBottom + Math.max(58, h * 0.08);
    this.layout = {
      g, w, h, mobile, lo, hi, xL, xR, pxF, binF, nb, bw, r, rows, sx, sy, top, yB, pegBottom, histTop,
      xOf: (F) => xL + ((F - lo) / (hi - lo)) * (xR - xL),
      pegY: (row) => top + 18 + row * sy,
      grav: Math.max(1600, h * 3.2),
      pitch: r * 2,
    };
    this.sprites.clear();
    if (this.cx == null || !Number.isFinite(this.cx)) this.cx = this.targetCx();
  },

  targetCx() {
    const L = this.layout;
    const half = (L.rows * L.sx) / 2 + L.sx;
    return clamp(L.xOf(this.stats.p50), L.xL + half, L.xR - half);
  },

  sprite(color, landed = false) {
    const key = landed ? `L${color}` : color;
    let s = this.sprites.get(key);
    if (s) return s;
    const L = this.layout;
    const dpr = Math.min(window.devicePixelRatio || 1, L.mobile ? 1.5 : 2);
    const R = L.r * (landed ? 1.35 : 2.4);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(R * 2 * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    const col = d3.color(color);
    const core = d3.interpolateLab("#ffffff", color)(0.35);
    const stops = landed
      ? [[0, core], [0.3, color], [0.68, color], [0.76, col.copy({ opacity: 0.3 }).formatRgb()], [1, col.copy({ opacity: 0 }).formatRgb()]]
      : [[0, core], [0.2, color], [0.36, color], [0.42, col.copy({ opacity: 0.35 }).formatRgb()], [0.7, col.copy({ opacity: 0.08 }).formatRgb()], [1, col.copy({ opacity: 0 }).formatRgb()]];
    for (const [o, c2] of stops) grad.addColorStop(o, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    s = { c, R };
    this.sprites.set(key, s);
    return s;
  },

  spawn() {
    const L = this.layout;
    const v = sampleHigh(this.stats, this.rand);
    const bin = clamp(Math.floor((v - L.lo) / L.binF), 0, L.nb - 1);
    const xt = L.xL + (bin + 0.5) * L.bw;
    const span = L.rows * L.sx;
    const left = this.cx - span / 2;
    let k = Math.round(clamp((xt - left) / span) * L.rows);
    if (this.rand() < 0.35) k = clamp(k + (this.rand() < 0.5 ? -1 : 1), 0, L.rows);
    const path = Array.from({ length: L.rows }, (_, j) => j < k);
    for (let j = path.length - 1; j > 0; j--) {
      const q = Math.floor(this.rand() * (j + 1));
      [path[j], path[q]] = [path[q], path[j]];
    }
    return {
      v, bin, xt, path, cx: this.cx, t0: this.time, phase: 0, x: this.cx, y: -10,
      vy: 0, fallT: 0, color: tempColor(v), slot: -1, landT: 0, dying: false,
      hop: 0.7 + this.rand() * 0.6,
    };
  },

  step(dt) {
    const L = this.layout;
    this.time += dt;
    const now = this.time;
    const interval = this.ctx.reduced ? 0 : 0.032;
    while (this.queue > 0 && now >= this.nextRelease) {
      const b = this.spawn();
      if (this.ctx.reduced) this.land(b, now);
      this.balls.push(b);
      this.queue--;
      this.nextRelease += interval * (0.6 + this.rand() * 0.8);
      if (interval === 0) continue;
    }

    const tcx = this.targetCx();
    this.cx += (tcx - this.cx) * (1 - Math.exp(-dt * 8));

    const maxCount = this.maxCount();
    const room = L.yB - L.histTop - 16;
    const pitchT = Math.min(L.r * 2, room / maxCount);
    L.pitch += (pitchT - L.pitch) * (1 - Math.exp(-dt * 10));

    for (const b of this.balls) {
      if (b.dying || b.phase === 3) continue;
      const t = now - b.t0;
      const y0 = L.pegY(0) - L.r - 2.5;
      if (t < ENTRY) {
        const u = t / ENTRY;
        b.x = b.cx;
        b.y = lerp(-L.r * 2, y0, u * u);
        b.phase = 0;
        continue;
      }
      const hopT = t - ENTRY;
      const hop = Math.floor(hopT / HOP);
      if (hop < L.rows - 1) {
        const u = (hopT - hop * HOP) / HOP;
        if (b.phase === 0 || b.lastHop !== hop) {
          b.lastHop = hop;
          b.phase = 1;
          const rights = b.path.slice(0, hop).filter(Boolean).length;
          this.pegHits.set(`${hop}:${rights}`, now);
        }
        const rights = b.path.slice(0, hop).filter(Boolean).length;
        const xs = b.cx + (rights - hop / 2) * L.sx;
        const dir = b.path[hop] ? 1 : -1;
        b.x = xs + dir * (L.sx / 2) * Math.sin((u * Math.PI) / 2);
        b.y = L.pegY(hop) - L.r - 2.5 + L.sy * u * u - L.sy * 0.32 * b.hop * Math.sin(Math.PI * u) * (1 - u * 0.4);
        continue;
      }
      if (b.phase !== 2) {
        b.phase = 2;
        const rights = b.path.slice(0, L.rows - 1).filter(Boolean).length;
        this.pegHits.set(`${L.rows - 1}:${rights}`, now);
        const dir = b.path[L.rows - 1] ? 1 : -1;
        b.sx0 = b.cx + (rights - (L.rows - 1) / 2) * L.sx;
        b.x0 = b.sx0;
        b.y = L.pegY(L.rows - 1) - L.r - 2.5;
        b.vy = -L.sy * 2.2 * b.hop;
        b.vx = dir * L.sx * 2.6;
        b.fallT = 0;
        const yLand = L.yB - L.r;
        b.drift = Math.sqrt((2 * Math.max(10, yLand - b.y)) / L.grav) * 0.95 + 0.12;
      }
      b.fallT += dt;
      b.vy += L.grav * dt;
      b.y += b.vy * dt;
      const u = clamp(b.fallT / b.drift);
      b.x = lerp(b.x0 + b.vx * Math.min(b.fallT, 0.08), b.xt, ease.out(u));
      const c = this.counts[b.bin] || 0;
      const yTop = L.yB - L.r - c * L.pitch;
      if (b.y >= yTop) this.land(b, now);
    }

    this.balls = this.balls.filter((b) => !(b.dying && now - b.dieAt > 0.45));
    let landed = 0;
    for (const c of this.counts) landed += c || 0;
    if (landed !== this.shown) {
      this.shown = landed;
      this.countEl.textContent = String(landed);
    }
    const inFlight = this.queue > 0 || this.balls.some((b) => !b.dying && b.phase !== 3);
    if (!inFlight && landed > 0 && (!this.flash || this.flash.out != null)) this.showFlash();
  },

  maxCount() {
    let m = 1;
    for (const c of this.counts) if (c > m) m = c;
    return m;
  },

  land(b, now) {
    b.phase = 3;
    b.slot = this.counts[b.bin] || 0;
    this.counts[b.bin] = b.slot + 1;
    b.x = b.xt;
    b.landT = now;
    b.vy = Math.min(1, Math.abs(b.vy || 600) / 1400);
  },

  showFlash() {
    const live = this.balls.filter((b) => !b.dying && b.phase === 3);
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of live) { lo = Math.min(lo, b.v); hi = Math.max(hi, b.v); }
    this.flash = { t0: this.time, out: null, lo, hi };
    const app = Math.round(this.stats.p50);
    this.resultEl.innerHTML = `Your app: <b class="pk-app">${app}°</b>. Balls landed from <b>${Math.round(lo)}°</b> to <b>${Math.round(hi)}°</b>.`;
    this.resultEl.classList.add("is-on");
  },

  kick() {
    if (!this.active) { this.render(); return; }
    if (this.stop) return;
    this.stop = loop((dt) => {
      if (!this.layout) this.computeLayout();
      this.step(dt);
      this.render();
      if (this.idle()) { this.stop?.(); this.stop = null; }
    });
  },

  idle() {
    const now = this.time;
    if (this.queue > 0) return false;
    if (this.balls.some((b) => b.dying || b.phase !== 3 || now - b.landT < 0.4)) return false;
    if (Math.abs(this.targetCx() - this.cx) > 0.3) return false;
    if (this.flash && now - this.flash.t0 < 2.6) return false;
    for (const t of this.pegHits.values()) if (now - t < 0.4) return false;
    const L = this.layout;
    const maxCount = this.maxCount();
    if (Math.abs(Math.min(L.r * 2, (L.yB - L.histTop - 16) / maxCount) - L.pitch) > 0.05) return false;
    return true;
  },

  render() {
    if (!this.canvas.isConnected) return;
    if (!this.layout) this.computeLayout();
    const L = this.layout;
    const { g, w, h, xL, xR, r } = L;
    const now = this.time;
    g.clearRect(0, 0, w, h);

    this.drawAxis();

    for (let row = 0; row < L.rows; row++) {
      const y = L.pegY(row);
      for (let j = 0; j <= row; j++) {
        const x = this.cx + (j - row / 2) * L.sx;
        const hit = this.pegHits.get(`${row}:${j}`);
        const k = hit != null ? clamp(1 - (now - hit) / 0.35) : 0;
        g.beginPath();
        g.arc(x, y, 2.2 + k * 1.6, 0, Math.PI * 2);
        g.fillStyle = k > 0 ? `rgba(255,230,190,${0.32 + k * 0.68})` : "rgba(244,241,234,0.3)";
        g.fill();
        if (k > 0) {
          g.beginPath();
          g.arc(x, y, 4 + k * 9, 0, Math.PI * 2);
          g.fillStyle = `rgba(255,181,71,${0.18 * k})`;
          g.fill();
        }
      }
    }


    g.save();
    for (const b of this.balls) {
      g.globalCompositeOperation = b.phase === 3 && !b.dying ? "source-over" : "lighter";
      let alpha = 1;
      let x = b.x;
      let y = b.y;
      if (b.phase === 3) {
        const age = now - b.landT;
        y = L.yB - r - b.slot * L.pitch;
        const bounce = age < 0.3 ? Math.sin((age / 0.3) * Math.PI) * Math.exp(-age * 8) * 10 * b.vy : 0;
        y -= bounce;
        alpha = 0.78 + 0.22 * clamp(1 - age / 0.5);
        if (this.ctx.reduced) alpha *= clamp(age / 0.3);
      }
      if (b.dying) {
        const k = clamp((now - b.dieAt) / 0.45);
        alpha *= 1 - k;
        y += k * k * 30;
      }
      const s = this.sprite(b.color, b.phase === 3 && !b.dying && now - b.landT > 0.25);
      const R = s.R;
      g.globalAlpha = alpha;
      g.drawImage(s.c, x - R, y - R, R * 2, R * 2);
    }
    g.restore();

    this.drawFlashFront();
  },

  drawAxis() {
    const L = this.layout;
    const { g, xL, xR, yB, lo, hi, xOf, mobile } = L;
    g.save();
    g.strokeStyle = "rgba(244,241,234,0.22)";
    g.beginPath();
    g.moveTo(xL, yB + 0.5);
    g.lineTo(xR, yB + 0.5);
    g.stroke();
    g.font = `400 ${mobile ? 10 : 11}px ${FONT.mono}`;
    g.fillStyle = "rgba(244,241,234,0.5)";
    g.textAlign = "center";
    g.textBaseline = "top";
    const tick = (hi - lo) > 40 || mobile ? 10 : 5;
    for (let F = Math.ceil(lo / tick) * tick; F <= hi; F += tick) {
      const x = xOf(F);
      const half = g.measureText(`${F}°`).width / 2;
      g.fillRect(Math.round(x), yB, 1, 4);
      g.fillText(`${F}°`, clamp(x, xL + half, L.xR - half), yB + 9);
    }
    g.restore();
  },

  flashK() {
    const f = this.flash;
    if (!f) return 0;
    const inK = ease.out(clamp((this.time - f.t0) / 0.5));
    const outK = f.out != null ? 1 - clamp((this.time - f.out) / 0.3) : 1;
    return inK * outK;
  },

  drawFlashFront() {
    const k = this.flashK();
    if (k <= 0) return;
    const L = this.layout;
    const { g, yB, xOf, mobile, xL, xR } = L;
    const f = this.flash;
    const age = this.time - f.t0;
    const x = Math.round(xOf(this.stats.p50)) + 0.5;
    const topFull = L.histTop;
    const grow = ease.outExpo(clamp(age / 0.55));
    const top = lerp(yB, topFull, grow);
    const pulse = 1 + Math.max(0, Math.sin(clamp(age / 1.6) * Math.PI * 3)) * 0.8 * (1 - clamp(age / 2));

    g.save();
    g.globalAlpha = k;
    g.shadowColor = "rgba(255,255,255,0.95)";
    g.shadowBlur = 16 * pulse;
    g.fillStyle = "#ffffff";
    g.fillRect(x - 1.5, top, 3, yB - top);
    g.shadowBlur = 0;
    g.beginPath();
    g.arc(x, top, 4, 0, Math.PI * 2);
    g.fill();

    const lk = ease.out(clamp((age - 0.35) / 0.4));
    if (lk > 0) {
      const text = `Your app: ${Math.round(this.stats.p50)}°`;
      g.font = `600 ${mobile ? 12 : 14}px ${FONT.sans}`;
      const tw = g.measureText(text).width;
      const ph = mobile ? 24 : 28;
      const pw = tw + 20;
      const px = clamp(x - pw / 2, xL, xR - pw);
      const py = top - ph - 10 + (1 - lk) * 8;
      g.globalAlpha = k * lk;
      roundRect(g, px, py, pw, ph, ph / 2);
      g.fill();
      g.fillStyle = "#05070d";
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillText(text, px + 10, py + ph / 2 + 0.5);
    }

    const rk = ease.out(clamp((age - 0.6) / 0.5));
    if (rk > 0) {
      const x0 = xOf(f.lo);
      const x1 = xOf(f.hi);
      const y = yB + (mobile ? 30 : 34);
      const mid = (x0 + x1) / 2;
      const a = lerp(mid, x0, rk);
      const b = lerp(mid, x1, rk);
      g.globalAlpha = k;
      g.strokeStyle = "rgba(111,195,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a, y);
      g.lineTo(b, y);
      g.stroke();
      g.fillStyle = "#6fc3ff";
      for (const xx of [a, b]) {
        g.beginPath();
        g.arc(xx, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = k * rk;
      g.font = `600 ${mobile ? 11 : 12}px ${FONT.sans}`;
      g.textBaseline = "middle";
      const lt = `${Math.round(f.lo)}°`;
      const rt = `${Math.round(f.hi)}°`;
      const lw = g.measureText(lt).width;
      const rw = g.measureText(rt).width;
      g.textAlign = "right";
      g.fillText(lt, Math.max(a - 9, xL + lw), y + 0.5);
      g.textAlign = "left";
      g.fillText(rt, Math.min(b + 9, xR - rw), y + 0.5);
    }
    g.restore();
  },
};

function longDow(d) {
  return { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" }[d] ?? d;
}
