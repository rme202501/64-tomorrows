import { clamp, lerp, rng } from "../util.js";

const BACK = ["#241a14", "#2c1d15", "#1f2017"];
const MID = ["#512915", "#5f3d1b", "#38361b"];
const FRONT = ["#8a4520", "#a3652a", "#6b371b"];
const LEAF = ["#d0782c", "#e2a13f", "#b24c22", "#9a7a2a"];

export const intensityOf = (mph) => clamp(mph / 24) ** 0.85;

/** One illustrated vignette: autumn tree, grass, banner and wind streaks driven by a wind speed in mph. */
export class WindScene {
  constructor(canvas, seed = 1, { reduced = false } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.seed = seed;
    this.reduced = reduced;
    this.mph = 0;
    this.I = 0;
    this.target = 0;
    this.time = seed * 3.7;
    this.leaves = [];
    this.spawnAcc = 0;
    this.W = 0;
    this.H = 0;
    const r = rng(seed * 977 + 13);
    this.phase = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    this.rand = r;
  }

  setWind(mph, snap = false) {
    this.mph = mph;
    this.target = intensityOf(mph);
    if (snap) this.I = this.target;
  }

  resize(mobile) {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    this.dpr = dpr;
    this.W = box.width;
    this.H = box.height;
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(box.height * dpr);
    this.build();
    return true;
  }

  build() {
    const { W, H } = this;
    const wide = W / H > 1.15;
    this.wide = wide;
    this.G = H * (wide ? 0.86 : 0.86);
    this.TH = wide ? H * 0.7 : Math.min(H * 0.56, W * 0.74);
    this.TX = W * (wide ? 0.58 : 0.4);
    this.FX = W * (wide ? 0.86 : 0.82);
    this.k = this.TH / 300;
    const r = rng(this.seed * 31 + 7);

    this.clusters = [];
    const layers = [[BACK, 9, 0.3], [MID, 8, 0.27], [FRONT, 6, 0.21]];
    layers.forEach(([pal, n, spreadR], depth) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.6;
        const rr = spreadR * (0.45 + r() * 0.55);
        const cx = Math.cos(a) * rr * 1.05;
        const cy = Math.sin(a) * rr * 0.62 - depth * 0.02;
        const puffs = Array.from({ length: 6 + Math.floor(r() * 4) }, () => ({
          x: (r() - 0.5) * 0.15,
          y: (r() - 0.5) * 0.1,
          r: (0.036 + r() * 0.034) * (depth === 0 ? 1.35 : 1),
        }));
        this.clusters.push({ cx, cy, depth, puffs, color: pal[i % pal.length], ph: r() * 6.28, hf: 0.85 + (0.3 - cy) * 0.6 });
      }
    });

    const step = Math.max(2.4, 3.2 * this.k);
    this.blades = [];
    for (let x = -4; x < W + 4; x += step * (0.6 + r() * 0.8)) {
      this.blades.push({ x, h: (7 + r() * 11) * Math.max(0.7, this.k), ph: r() * 6.28, front: r() > 0.55 });
    }

    this.streaks = Array.from({ length: 14 }, () => this.newStreak(true, r));
    this.clouds = Array.from({ length: 3 }, (_, i) => ({ x: r() * W, y: H * (0.1 + i * 0.1 + r() * 0.05), w: W * (0.35 + r() * 0.3), h: H * (0.05 + r() * 0.03) }));

    const sk = new Path2D();
    const base = this.G - H * 0.015;
    const sx = W * (wide ? 0.18 : 0.14);
    const sw = Math.max(8, W * 0.024);
    sk.moveTo(0, this.G + 4);
    sk.lineTo(0, base);
    let x = 0;
    let spire = false;
    while (x < W) {
      const bw = W * (0.05 + r() * 0.07);
      const bh = H * (0.03 + r() * 0.045);
      const roof = r();
      if (!spire && x + bw > sx - sw * 1.5) {
        spire = true;
        sk.lineTo(x, base);
        sk.lineTo(sx - sw, base);
        sk.lineTo(sx - sw, base - H * 0.06);
        sk.lineTo(sx - sw, base - H * 0.1);
        sk.lineTo(sx - sw * 0.5, base - H * 0.12);
        sk.lineTo(sx - sw * 0.5, base - H * 0.15);
        sk.lineTo(sx, base - H * 0.25);
        sk.lineTo(sx + sw * 0.5, base - H * 0.15);
        sk.lineTo(sx + sw * 0.5, base - H * 0.12);
        sk.lineTo(sx + sw, base - H * 0.1);
        sk.lineTo(sx + sw, base - H * 0.06);
        x = Math.max(x, sx + sw);
        continue;
      }
      sk.lineTo(x, base - bh);
      if (roof < 0.45) {
        sk.lineTo(x + bw * 0.5, base - bh - bw * 0.28);
      } else if (roof < 0.6) {
        sk.lineTo(x + bw * 0.42, base - bh);
        sk.lineTo(x + bw * 0.42, base - bh - H * 0.02);
        sk.lineTo(x + bw * 0.5, base - bh - H * 0.035);
        sk.lineTo(x + bw * 0.58, base - bh - H * 0.02);
        sk.lineTo(x + bw * 0.58, base - bh);
      }
      sk.lineTo(x + bw, base - bh);
      x += bw;
    }
    sk.lineTo(W, base);
    sk.lineTo(W, this.G + 4);
    sk.closePath();
    this.skyline = sk;

    const g = this.g;
    this.skyGrad = g.createLinearGradient(0, 0, 0, this.G);
    this.skyGrad.addColorStop(0, "#060a15");
    this.skyGrad.addColorStop(0.55, "#111b31");
    this.skyGrad.addColorStop(1, "#2c2638");
    this.glow = g.createRadialGradient(W * 0.08, this.G, 0, W * 0.08, this.G, Math.max(W, H) * 0.7);
    this.glow.addColorStop(0, "rgba(255, 150, 80, 0.22)");
    this.glow.addColorStop(1, "rgba(255, 150, 80, 0)");
    this.groundGrad = g.createLinearGradient(0, this.G - 6, 0, H);
    this.groundGrad.addColorStop(0, "#151d17");
    this.groundGrad.addColorStop(1, "#06090a");
  }

  groundY(x) {
    return this.G - 5 * this.k * Math.sin((x / this.W) * Math.PI);
  }

  newStreak(initial, r = this.rand) {
    return {
      x: initial ? r() * this.W : -r() * this.W * 0.6,
      y: this.H * 0.06 + r() * (this.G - this.H * 0.12),
      len: (40 + r() * 90) * this.k,
      spd: 0.7 + r() * 0.6,
      curve: (r() - 0.5) * 8,
    };
  }

  gust() {
    const t = this.time;
    const [a, b, c] = this.phase;
    return 0.5 + 0.25 * Math.sin(t * 0.9 + a) + 0.15 * Math.sin(t * 2.3 + b) + 0.1 * Math.sin(t * 5.1 + c);
  }

  step(dt) {
    if (!this.W) return;
    this.I += (this.target - this.I) * (1 - Math.exp(-dt * 3));
    if (this.reduced) return;
    this.time += dt;
    const { I, k } = this;

    const rate = 0.35 + Math.max(0, I - 0.18) * 30;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc > 1 && this.leaves.length < 110) {
      this.spawnAcc -= 1;
      this.spawnLeaf();
    }
    if (this.spawnAcc > 1) this.spawnAcc = 0;

    const wind = (8 + I * 320) * k;
    for (const L of this.leaves) {
      L.age += dt;
      if (L.landed) {
        L.fade -= dt * 0.6;
        L.x += I * 40 * k * dt;
        continue;
      }
      L.vx += (wind * L.drag - L.vx) * dt * 1.4;
      L.vy += (26 * k * (1 - I * 0.6)) * dt;
      L.vy += Math.sin(this.time * 5 + L.ph) * 30 * k * dt;
      L.x += L.vx * dt;
      L.y += L.vy * dt;
      L.rot += L.spin * dt * (1 + I * 3);
      const gy = this.groundY(L.x);
      if (L.y > gy - 1) {
        L.y = gy - 1;
        L.landed = true;
      }
    }
    this.leaves = this.leaves.filter((L) => L.x < this.W + 30 && L.fade > 0 && L.age < 14);

    const sp = (120 + 820 * I) * k;
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      s.x += sp * s.spd * dt;
      if (s.x - s.len > this.W) this.streaks[i] = this.newStreak(false);
    }
    for (const c of this.clouds) {
      c.x += (4 + this.mph * 2.2) * k * dt;
      if (c.x - c.w > this.W) c.x = -c.w;
    }
  }

  spawnLeaf() {
    const r = this.rand;
    const c = this.clusters[Math.floor(r() * this.clusters.length)];
    const crown = this.crown(this.bend());
    const p = c.puffs[Math.floor(r() * c.puffs.length)];
    this.leaves.push({
      x: crown.x + (c.cx + p.x) * this.TH,
      y: crown.y + (c.cy + p.y) * this.TH,
      vx: 0,
      vy: -10 * this.k,
      drag: 0.6 + r() * 0.6,
      rot: r() * 6.28,
      spin: (r() - 0.5) * 8,
      size: (2.6 + r() * 2.2) * Math.max(0.8, this.k),
      color: LEAF[Math.floor(r() * LEAF.length)],
      ph: r() * 6.28,
      age: 0,
      fade: 1,
      landed: false,
    });
  }

  bend() {
    const { I, time } = this;
    const g = this.gust();
    return I * (0.62 + 0.38 * g) + Math.sin(time * (1.2 + 2.8 * I) + this.phase[3]) * 0.05 * I + Math.sin(time * 0.6) * 0.012;
  }

  trunkTop(b) {
    const { TX, TH, G } = this;
    return { x: TX + b * TH * 0.26, y: G - TH * 0.6 + Math.abs(b) * TH * 0.05 };
  }

  crown(b) {
    const t = this.trunkTop(b);
    return { x: t.x + b * this.TH * 0.06, y: t.y - this.TH * 0.1 };
  }

  draw() {
    if (!this.W) return;
    const { g, W, H, G, TH, TX, I, k } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    g.fillStyle = this.skyGrad;
    g.fillRect(0, 0, W, H);
    g.fillStyle = this.glow;
    g.fillRect(0, 0, W, H);

    for (const c of this.clouds) {
      const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.w * 0.5);
      grad.addColorStop(0, "rgba(150, 160, 190, 0.08)");
      grad.addColorStop(1, "rgba(150, 160, 190, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(c.x, c.y, c.w * 0.5, c.h, 0, 0, Math.PI * 2);
      g.fill();
    }

    g.fillStyle = "#0c1222";
    g.fill(this.skyline);

    g.lineCap = "round";
    for (let i = 0; i < this.streaks.length; i++) {
      const a = clamp(I * 16 - i * 1.05) * (0.1 + 0.2 * I);
      if (a <= 0.003) continue;
      const s = this.streaks[i];
      const grad = g.createLinearGradient(s.x - s.len, 0, s.x, 0);
      grad.addColorStop(0, "rgba(210, 225, 255, 0)");
      grad.addColorStop(1, `rgba(210, 225, 255, ${a})`);
      g.strokeStyle = grad;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(s.x - s.len, s.y);
      g.quadraticCurveTo(s.x - s.len * 0.5, s.y + s.curve * k, s.x, s.y);
      g.stroke();
    }

    g.fillStyle = this.groundGrad;
    g.beginPath();
    g.moveTo(0, this.groundY(0));
    for (let x = 0; x <= W; x += 12) g.lineTo(x, this.groundY(x));
    g.lineTo(W, this.groundY(W));
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fill();

    this.drawGrass(false);
    this.drawFlag();

    const b = this.bend();
    const shadowW = TH * (0.42 + b * 0.1);
    const sh = g.createRadialGradient(TX + b * TH * 0.12, G + 2, 0, TX + b * TH * 0.12, G + 2, shadowW);
    sh.addColorStop(0, "rgba(0,0,0,0.5)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(TX + b * TH * 0.12, G + 2, shadowW, TH * 0.04, 0, 0, Math.PI * 2);
    g.fill();

    this.drawTrunk(b);
    this.drawCanopy(b, 0);
    this.drawCanopy(b, 1);
    this.drawCanopy(b, 2);

    for (const L of this.leaves) {
      g.save();
      g.globalAlpha = clamp(L.fade) * 0.95;
      g.translate(L.x, L.y);
      g.rotate(L.rot);
      g.fillStyle = L.color;
      g.beginPath();
      g.ellipse(0, 0, L.size, L.size * 0.55 * Math.abs(Math.cos(L.rot * 1.7)) + 0.6, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.globalAlpha = 1;

    this.drawGrass(true);

    const vig = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vig.addColorStop(0, "rgba(5,7,13,0)");
    vig.addColorStop(1, "rgba(5,7,13,0.55)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }

  drawTrunk(b) {
    const { g, TX, TH, G } = this;
    const top = this.trunkTop(b);
    const cx = TX + b * TH * 0.03;
    const cy = G - TH * 0.32;
    const n = 10;
    const left = [];
    const right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (1 - t) ** 2 * TX + 2 * (1 - t) * t * cx + t * t * top.x;
      const y = (1 - t) ** 2 * G + 2 * (1 - t) * t * cy + t * t * top.y;
      const dx = 2 * (1 - t) * (cx - TX) + 2 * t * (top.x - cx);
      const dy = 2 * (1 - t) * (cy - G) + 2 * t * (top.y - cy);
      const len = Math.hypot(dx, dy) || 1;
      const w = TH * (0.07 * (1 - t) + 0.026 * t + 0.04 * Math.max(0, 0.12 - t) * 8) * 0.5;
      left.push([x - (dy / len) * -w, y + (dx / len) * -w]);
      right.push([x + (dy / len) * -w, y - (dx / len) * -w]);
    }
    const grad = g.createLinearGradient(TX - TH * 0.05, 0, TX + TH * 0.05, 0);
    grad.addColorStop(0, "#4a3426");
    grad.addColorStop(1, "#1c140f");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left) g.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
    g.fill();

    g.strokeStyle = "#2a1d14";
    g.lineCap = "round";
    const branches = [[0.62, -0.17, -0.2], [0.72, 0.16, -0.18], [0.86, -0.08, -0.16], [0.8, 0.1, -0.24]];
    for (const [t, ex, ey] of branches) {
      const x = (1 - t) ** 2 * TX + 2 * (1 - t) * t * cx + t * t * top.x;
      const y = (1 - t) ** 2 * G + 2 * (1 - t) * t * cy + t * t * top.y;
      const tx = x + (ex + b * 0.12) * TH;
      const ty = y + (ey + Math.abs(b) * 0.04) * TH;
      g.lineWidth = TH * 0.016;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + ex * TH * 0.3, y + ey * TH * 0.7, tx, ty);
      g.stroke();
    }
  }

  drawCanopy(b, depth) {
    const { g, TH, I, time } = this;
    const crown = this.crown(b);
    const squash = 1 + I * 0.1;
    for (const c of this.clusters) {
      if (c.depth !== depth) continue;
      const jit = Math.sin(time * (2 + 7 * I) + c.ph) * TH * 0.012 * I * c.hf;
      const jy = Math.cos(time * (2.4 + 6 * I) + c.ph) * TH * 0.006 * I;
      const ox = crown.x + c.cx * TH * squash + b * TH * 0.12 * c.hf + jit;
      const oy = crown.y + c.cy * TH + jy;
      g.fillStyle = c.color;
      g.beginPath();
      for (const p of c.puffs) {
        const px = ox + p.x * TH;
        const py = oy + p.y * TH;
        g.moveTo(px + p.r * TH, py);
        g.arc(px, py, p.r * TH, 0, Math.PI * 2);
      }
      g.fill();
      if (depth > 0) {
        g.fillStyle = depth === 2 ? "rgba(255, 190, 120, 0.14)" : "rgba(255, 170, 100, 0.07)";
        g.beginPath();
        for (const p of c.puffs) {
          const rr = p.r * TH * 0.62;
          const px = ox + p.x * TH - p.r * TH * 0.3;
          const py = oy + p.y * TH - p.r * TH * 0.32;
          g.moveTo(px + rr, py);
          g.arc(px, py, rr, 0, Math.PI * 2);
        }
        g.fill();
      }
    }
  }

  drawGrass(front) {
    const { g, I, time, k } = this;
    g.strokeStyle = front ? "#2f3a22" : "#1c2618";
    g.lineWidth = Math.max(1, 1.3 * k);
    g.beginPath();
    const ws = 1.5 + 5 * I;
    const amp = 0.12 + 0.32 * I;
    for (const bl of this.blades) {
      if (bl.front !== front) continue;
      const gy = this.groundY(bl.x) + (front ? 3 : 0);
      const a = I * 1.05 + Math.sin(time * ws - bl.x * 0.035 + bl.ph * 0.3) * amp + 0.08;
      const h = bl.h * (front ? 1 : 0.85);
      const tx = bl.x + Math.sin(a) * h;
      const ty = gy - Math.cos(a) * h;
      g.moveTo(bl.x, gy);
      g.quadraticCurveTo(bl.x + Math.sin(a * 0.4) * h * 0.5, gy - h * 0.55, tx, ty);
    }
    g.stroke();
  }

  drawFlag() {
    const { g, FX, TH, I, time, k } = this;
    const base = this.groundY(FX);
    const PH = TH * 0.78;
    const top = base - PH;
    g.strokeStyle = "rgba(170, 176, 190, 0.75)";
    g.lineWidth = Math.max(1.4, 2.2 * k);
    g.beginPath();
    g.moveTo(FX, base);
    g.lineTo(FX, top - 3 * k);
    g.stroke();
    g.fillStyle = "#cfd3dc";
    g.beginPath();
    g.arc(FX, top - 4 * k, Math.max(1.8, 2.6 * k), 0, Math.PI * 2);
    g.fill();

    const L = Math.min(TH * 0.3, (this.W - FX) * 0.82);
    const Hf = L * 0.56;
    const gst = this.gust();
    const th = lerp(1.32, 0.06, clamp(I * 1.1)) - (gst - 0.5) * 0.2 * I;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const n = 16;
    const A = Hf * (0.04 + 0.16 * I);
    const w = 3 + 13 * I;
    const topPts = [];
    const botPts = [];
    const shade = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const s = u * L * (1 - 0.06 * I * Math.sin(time * w * 0.5));
      const wave = Math.sin(u * Math.PI * 2.6 - time * w) * A * u;
      const wave2 = Math.sin(u * Math.PI * 2.6 - time * w - 0.5) * A * u;
      const x = FX + ca * s - sa * wave;
      const y = top + sa * s + ca * wave;
      topPts.push([x, y]);
      botPts.push([x, y + Hf * (0.55 + 0.45 * ca) + ca * (wave2 - wave)]);
      shade.push(Math.cos(u * Math.PI * 2.6 - time * w) * u);
    }
    const end = topPts[n];
    const grad = g.createLinearGradient(FX, top, end[0], end[1]);
    for (let i = 0; i <= n; i++) {
      const s = shade[i] * (0.4 + 0.6 * I);
      const l = clamp(0.5 + s * 0.35, 0.15, 0.9);
      grad.addColorStop(i / n, `hsl(352, 62%, ${Math.round(l * 46)}%)`);
    }
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(topPts[0][0], topPts[0][1]);
    for (const p of topPts) g.lineTo(p[0], p[1]);
    for (let i = n; i >= 0; i--) g.lineTo(botPts[i][0], botPts[i][1]);
    g.closePath();
    g.fill();
  }
}
