import { seg, ease, rng } from "../util.js";
import { targetDay, flag, setStyle } from "../decide/common.js";

const WORDS = [
  { t: "But", line: 0 },
  { t: "do", line: 0 },
  { t: "you", line: 0 },
  { t: "really", line: 1, em: true },
  { t: "care", line: 1 },
];

const SHRUG = `
<svg class="care-shrug" viewBox="0 0 160 150" aria-hidden="true">
  <g class="care-shrug-cloud">
    <path d="M38 42h46a13 13 0 0 0 1.5-25.9A20 20 0 0 0 47 19a15 15 0 0 0-9 23z" fill="rgba(244,241,234,.3)"/>
  </g>
  <g class="care-shrug-body">
    <path d="M58 140c0-26 9-44 22-44s22 18 22 44z" fill="#ffb547"/>
    <g class="care-shrug-arms" fill="none" stroke="#f4f1ea" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <path class="arm-l" d="M64 106 44 112 34 92"/>
      <path class="arm-r" d="M96 106l20 6 10-20"/>
    </g>
    <circle cx="80" cy="78" r="15" fill="#f4f1ea"/>
    <path d="M73 77q2-2 4 0M83 77q2-2 4 0" stroke="#05070d" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M74 84q6 4 12 0" stroke="#05070d" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;

export default {
  length: 2.4,

  mount(layer, ctx) {
    layer.classList.add("care");
    const r = rng(17);
    const words = WORDS.map((w) => ({
      ...w,
      dx: -60 - r() * 80,
      dy: (r() - 0.5) * 50,
      rot: (r() - 0.5) * 10,
    }));
    const line = (k) => words.filter((w) => w.line === k).map((w) => {
      const i = words.indexOf(w);
      return `<span class="care-word${w.em ? " is-em" : ""}" data-i="${i}">${w.t}</span>`;
    }).join(" ");
    layer.innerHTML = `
      <div class="care-vignette"></div>
      <div class="care-inner">
        <h2 class="t-display care-q">
          <span class="care-line">${line(0)}</span>
          <span class="care-line">${line(1)}<span class="care-mark" data-i="5">?</span></span>
        </h2>
        ${SHRUG}
        <p class="t-caption care-cap">Two plans. Two very different answers.</p>
      </div>`;
    this.words = words;
    this.wordEls = [...layer.querySelectorAll(".care-word")];
    this.mark = layer.querySelector(".care-mark");
    this.shrug = layer.querySelector(".care-shrug");
    this.cap = layer.querySelector(".care-cap");
    this.layer = layer;
    const n = targetDay(ctx.data);
    this.time = ctx.data.timeAt(ctx.data.leadForDay(Math.min(1, n), 10.5));
  },

  enter(dir, ctx) {
    const { world, data } = ctx;
    world.setVisible(true);
    world.setCamera("street");
    world.setTime(this.time);
    const lead = data.leadOf(this.time);
    world.setWeather({
      tempF: data.statsAt("t2m", lead).p50,
      cloud: Math.min(35, data.statsAt("cloud", lead).p50),
      rain: 0,
      wind: data.statsAt("wind", lead).p50,
    });
    world.setUncertainty(0);
    world.setDim(0.25);
    ctx.veil(0);
    ctx.hud.show(false);
  },

  update(p, ctx) {
    const reduced = ctx.reduced;
    this.wordEls.forEach((node, i) => {
      const w = this.words[i];
      const t = reduced ? 1 : ease.out(seg(p, 0.06 + i * 0.07, 0.34 + i * 0.07));
      setStyle(node, "opacity", t.toFixed(3));
      setStyle(node, "filter", `blur(${((1 - t) * 14).toFixed(1)}px)`);
      setStyle(node, "transform",
        `translate3d(${((1 - t) * w.dx).toFixed(1)}px, ${((1 - t) * w.dy).toFixed(1)}px, 0) rotate(${((1 - t) * w.rot).toFixed(2)}deg)`);
    });
    const m = reduced ? 1 : ease.out(seg(p, 0.42, 0.6));
    setStyle(this.mark, "opacity", m.toFixed(3));
    setStyle(this.mark, "--drop", `${((1 - m) * -80).toFixed(1)}px`);
    flag(this.mark, "is-wobbling", m >= 1);
    const s = ease.out(seg(p, 0.55, 0.72));
    setStyle(this.shrug, "opacity", s.toFixed(3));
    setStyle(this.shrug, "transform", `translateY(${((1 - s) * 24).toFixed(1)}px)`);
    flag(this.shrug, "is-shrugging", s >= 1);
    const c = ease.out(seg(p, 0.66, 0.8));
    setStyle(this.cap, "opacity", c.toFixed(3));
    setStyle(this.cap, "transform", `translateY(${((1 - c) * 14).toFixed(1)}px)`);
  },
};
