import { seg, ease, lerp, autoplay } from "../util.js";

const WORDS = ["Your", "weather", "app", "is", "lying", "to", "you."];
const LIE = 4;

export default {
  length: 2.2,
  fade: false,

  mount(layer, ctx) {
    layer.classList.add("lying");
    const word = (w, i) => (i === LIE
      ? `<span class="ly-word ly-lie" data-i="${i}">lying<span class="ly-strike" aria-hidden="true"></span></span>`
      : `<span class="ly-word" data-i="${i}">${w}</span>`);
    layer.innerHTML = `
      <div class="ly-vignette"></div>
      <div class="ly-stage">
        <h2 class="ly-title" aria-label="Your weather app is lying to you.">
          <span class="ly-line">${WORDS.slice(0, 3).map((w, i) => word(w, i)).join(" ")}</span>
          <span class="ly-line">${WORDS.slice(3).map((w, i) => word(w, i + 3)).join(" ")}</span>
        </h2>
        <p class="ly-cap">Well, not lying. It's leaving out 63 other forecasts.</p>
      </div>`;
    this.layer = layer;
    this.words = [...layer.querySelectorAll(".ly-word")];
    this.lie = layer.querySelector(".ly-lie");
    this.strike = layer.querySelector(".ly-strike");
    this.cap = layer.querySelector(".ly-cap");
    this.vignette = layer.querySelector(".ly-vignette");
    this.auto = autoplay((q) => this.render(q), [{ at: 0.04, to: 1, dur: 2.8 }]);
    this.render(0);
  },

  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.world.setVisible(true);
    ctx.world.setDim(1);
    if (dir < 0) this.auto.snap(1);
    else this.auto.snap(0);
  },

  leave(dir, ctx) {
    this.auto.kill();
    if (dir < 0) {
      ctx.veil(0);
      ctx.world.setDim(0);
      ctx.hud.show(true);
    }
  },

  render(q) {
    this.words.forEach((el, i) => {
      const a = 0.02 + i * 0.065;
      const t = ease.out(seg(q, a, a + 0.14));
      el.style.opacity = t.toFixed(3);
      el.style.transform = `translateY(${((1 - t) * 0.22).toFixed(3)}em)`;
    });
    const s = ease.inOut(seg(q, 0.58, 0.7));
    this.strike.style.transform = `scaleX(${s.toFixed(3)})`;
    const c = ease.out(seg(q, 0.76, 0.92));
    this.cap.style.opacity = c.toFixed(3);
    this.cap.style.transform = `translateY(${((1 - c) * 12).toFixed(1)}px)`;
  },

  update(p, ctx) {
    this.auto.update(p, ctx.reduced);
    ctx.veil(lerp(0.6, 0.96, ease.out(seg(p, 0, 0.3))));
    ctx.world.setDim(1);
    this.layer.style.opacity = (1 - ease.inOut(seg(p, 0.82, 1))).toFixed(3);
    this.vignette.style.opacity = seg(p, 0, 0.2).toFixed(3);
  },
};
