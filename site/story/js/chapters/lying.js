import { seg, ease, lerp, clamp, rng, tempColor, loop } from "../util.js";

const WORDS = ["Your", "weather", "app", "is", "lying", "to", "you."];
const LIE = 4;
const GHOSTS = 18;

const slam = (t) => {
  if (t <= 0) return { s: 2.6, o: 0, b: 26, y: -0.35 };
  if (t < 0.62) {
    const u = ease.in(t / 0.62);
    return { s: lerp(2.6, 0.93, u), o: clamp(t / 0.3), b: lerp(26, 0, u), y: lerp(-0.35, 0.03, u) };
  }
  const u = ease.out((t - 0.62) / 0.38);
  return { s: lerp(0.93, 1, u), o: 1, b: 0, y: lerp(0.03, 0, u) };
};

const impulse = (d, len = 0.05) => (d < 0 || d > len ? 0 : (1 - d / len) ** 2);

export default {
  length: 2.5,
  fade: false,

  mount(layer, ctx) {
    layer.classList.add("lying");
    const r = rng(64);
    const ghostSpecs = Array.from({ length: GHOSTS }, (_, k) => {
      const z = (r() + r() + r() - 1.5) * 1.6;
      return { dx: z * 0.28, dy: (r() - 0.62) * 0.7, rot: (r() - 0.5) * 6, temp: 40 + ((z + 2.4) / 4.8) * 45, delay: r() * 0.35, k };
    });
    const word = (w, i) => (i === LIE
      ? `<span class="ly-word ly-lie" data-i="${i}"><span class="ly-ghosts" aria-hidden="true">${ghostSpecs.map((g) => `<span class="ly-ghost" style="color:${tempColor(g.temp)}">lying</span>`).join("")}</span><span class="ly-lie-core">lying</span></span>`
      : `<span class="ly-word" data-i="${i}">${w}</span>`);
    layer.innerHTML = `
      <div class="ly-vignette"></div>
      <div class="ly-stage">
        <h2 class="ly-title" aria-label="Your weather app is lying to you.">
          <span class="ly-line">${WORDS.slice(0, 3).map((w, i) => word(w, i)).join(" ")}</span>
          <span class="ly-line">${WORDS.slice(3).map((w, i) => word(w, i + 3)).join(" ")}</span>
        </h2>
        <p class="ly-cap">Well, not lying. Leaving out 63 other forecasts.</p>
      </div>`;
    this.layer = layer;
    this.stage = layer.querySelector(".ly-stage");
    this.title = layer.querySelector(".ly-title");
    this.words = [...layer.querySelectorAll(".ly-word")];
    this.lie = layer.querySelector(".ly-lie");
    this.core = layer.querySelector(".ly-lie-core");
    this.ghosts = [...layer.querySelectorAll(".ly-ghost")].map((el, k) => ({ el, ...ghostSpecs[k] }));
    this.cap = layer.querySelector(".ly-cap");
    this.vignette = layer.querySelector(".ly-vignette");
    this.glitch = 0;
    this.p = 0;
  },

  enter(dir, ctx) {
    this.layer.style.opacity = "1";
    ctx.hud.show(false);
    ctx.world.setVisible(true);
    ctx.world.setDim(1);
    this.stop?.();
    if (!ctx.reduced) {
      let next = 0;
      let jx = 0;
      let jy = 0;
      let skew = 0;
      this.stop = loop((dt, t) => {
        if (t > next) {
          const amp = this.glitch;
          const burst = Math.random() < 0.18 ? 3 : 1;
          jx = (Math.random() - 0.5) * 0.06 * amp * burst;
          jy = (Math.random() - 0.5) * 0.03 * amp * burst;
          next = t + 0.05 + Math.random() * 0.09;
          const split = amp * (0.012 + Math.random() * 0.018 * burst);
          this.core.style.textShadow = amp > 0.01
            ? `${split.toFixed(3)}em 0 rgba(255,60,90,${(0.7 * amp).toFixed(2)}), ${(-split).toFixed(3)}em 0 rgba(80,200,255,${(0.7 * amp).toFixed(2)})`
            : "none";
          skew = burst > 1 ? (Math.random() - 0.5) * 14 * amp : 0;
        }
        this.core.style.transform = `translate(${jx.toFixed(3)}em, ${jy.toFixed(3)}em) skewX(${skew.toFixed(2)}deg)`;
      });
    }
  },

  leave(dir, ctx) {
    this.stop?.();
    this.stop = null;
    if (dir < 0) {
      ctx.veil(0);
      ctx.world.setDim(0);
      ctx.hud.show(true);
    }
  },

  update(p, ctx) {
    this.p = p;
    ctx.veil(lerp(0.6, 0.96, ease.out(seg(p, 0, 0.3))));
    ctx.world.setDim(1);
    const exit = ease.inOut(seg(p, 0.8, 1));

    const impacts = [];
    this.words.forEach((el, i) => {
      const a = 0.03 + i * 0.055 + (i === LIE ? 0.04 : 0);
      const d = i === LIE ? 0.13 : 0.1;
      const t = seg(p, a, a + d);
      impacts.push(a + d * 0.62);
      const s = slam(t);
      let { s: sc, o, b, y } = s;
      let x = 0;
      let rot = 0;
      if (i !== LIE && exit > 0) {
        const side = i < LIE ? -1 : 1;
        const e = ease.in(clamp(exit * 1.25 - Math.abs(i - LIE) * 0.04));
        y += e * 1.8;
        x += side * e * (0.6 + Math.abs(i - LIE) * 0.25);
        rot = side * e * 24;
        o *= 1 - e;
        b += e * 10;
      }
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate(${x}em, ${y}em) scale(${sc}) rotate(${rot}deg)`;
      el.style.filter = b > 0.2 ? `blur(${b.toFixed(1)}px)` : "none";
    });

    const shake = impacts.reduce((acc, at, i) => acc + impulse(p - at) * (i === LIE ? 1.6 : 0.6), 0);
    const sx = Math.sin(p * 900) * shake * 10;
    const sy = Math.cos(p * 700) * shake * 7;
    this.title.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

    const spread = ease.out(seg(p, 0.5, 0.72));
    const collapse = ease.in(seg(p, 0.8, 0.9));
    const zoom = ease.in(seg(p, 0.86, 1));
    for (const g of this.ghosts) {
      const t = ease.out(clamp((spread - g.delay * 0.5) / (1 - g.delay * 0.5)));
      const k = t * (1 - collapse);
      g.el.style.opacity = (k * 0.42).toFixed(3);
      g.el.style.transform = `translate(${(g.dx * k).toFixed(3)}em, ${(g.dy * k).toFixed(3)}em) rotate(${(g.rot * k).toFixed(2)}deg)`;
    }
    this.glitch = ctx.reduced ? 0 : clamp(seg(p, 0.4, 0.5) * (1 - seg(p, 0.86, 0.95)));
    if (ctx.reduced) this.core.style.textShadow = "none";

    this.lie.style.zIndex = "2";
    if (zoom > 0) {
      const lieT = slam(1);
      this.lie.style.transform = `scale(${(lieT.s * (1 + zoom * 9)).toFixed(3)})`;
      this.lie.style.opacity = (1 - ease.in(seg(p, 0.9, 1))).toFixed(3);
      this.lie.style.filter = `blur(${(zoom * 14).toFixed(1)}px)`;
    }

    const cIn = ease.out(seg(p, 0.56, 0.66));
    const cOut = seg(p, 0.78, 0.86);
    this.cap.style.opacity = (cIn * (1 - cOut)).toFixed(3);
    this.cap.style.transform = `translateY(${((1 - cIn) * 14 + cOut * -10).toFixed(1)}px)`;
    this.cap.style.filter = cIn < 1 ? `blur(${((1 - cIn) * 6).toFixed(1)}px)` : "none";

    this.vignette.style.opacity = (seg(p, 0, 0.2) * (1 - seg(p, 0.92, 1) * 0.3)).toFixed(3);
  },
};
