import { el, seg, ease, localHourOf } from "../util.js";

const START_HOUR = 4.5;
const SPAN_H = 27;
const RAIN_MM = 0.1;

let ui = null;
let t0 = 0;

function letters(text, delay0, stagger) {
  let k = 0;
  return [...text].map((c) => {
    if (c === " ") return '<span class="sp"></span>';
    return `<span class="ch" style="animation-delay:${(delay0 + stagger * k++).toFixed(2)}s">${c}</span>`;
  }).join("");
}

function setO(node, v) {
  const s = v.toFixed(3);
  if (node.__o !== s) { node.__o = s; node.style.opacity = s; }
}
function setT(node, v) {
  if (node.__t !== v) { node.__t = v; node.style.transform = v; }
}

/** the weather this forecast's median member shows at a Date */
export function heroWeather(data, date) {
  const lead = data.leadOf(date);
  const s = data.series;
  const u = data.at(s.u10.mean, lead);
  const v = data.at(s.v10.mean, lead);
  const rains = data.membersAt("precip", lead);
  let wet = 0;
  for (const r of rains) if (r >= RAIN_MM) wet++;
  return {
    tempF: data.at(s.t2m.p50, lead),
    cloud: data.at(s.cloud.p50, lead),
    rain: data.at(s.precip.p50, lead),
    wind: data.at(s.wind.p50, lead),
    windDir: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360,
    rainProb: wet / rains.length,
  };
}

export default {
  length: 4,

  /** Date where the hero's day cycle ends (local 7:30 the morning after the first forecast day) */
  get endTime() { return new Date(t0 + SPAN_H * 3600e3); },

  mount(layer, ctx) {
    const first = ctx.data.valid[0];
    const midnight = +first - localHourOf(first) * 3600e3;
    t0 = midnight + START_HOUR * 3600e3;

    const head = el("div", { class: "hero-head" });
    head.innerHTML = `
      <h1 class="hero-title" aria-label="64 Tomorrows"><em>${letters("64", 0.15, 0.09)}</em><span class="sp"></span>${letters("Tomorrows", 0.42, 0.07)}</h1>
      <p class="hero-sub">Every forecast is really 64 forecasts.</p>`;
    const caption = el("p", { class: "hero-caption" }, "The next day in Harvard Yard, as one forecast tells it.");
    const cueWrap = el("div", { class: "hero-cuewrap" }, '<div class="scroll-cue">Scroll</div>');
    const root = el("div", { class: "hero" });
    root.append(head, caption, cueWrap);
    layer.append(root);
    ui = { head, caption, cueWrap };
  },

  enter(dir, ctx) {
    const { world, hud } = ctx;
    world.setVisible(true);
    world.setUncertainty(0);
    world.setDim(0);
    ctx.veil(0);
    hud.mode("full");
    if (dir < 0) world.setCamera("hero");
  },

  update(p, ctx) {
    if (!ui) return;
    const { world, hud, data } = ctx;

    const out = seg(p, 0.03, 0.17);
    setO(ui.head, 1 - ease.inOut(out));
    setT(ui.head, `translate3d(0, ${(-ease.in(out) * 90).toFixed(1)}px, 0) scale(${(1 - out * 0.04).toFixed(4)})`);
    setO(ui.cueWrap, 1 - seg(p, 0, 0.05));

    const cap = Math.min(seg(p, 0.3, 0.38), 1 - seg(p, 0.6, 0.68));
    setO(ui.caption, ease.inOut(cap));
    setT(ui.caption, `translate3d(-50%, ${((1 - cap) * 14).toFixed(1)}px, 0)`);

    const tp = seg(p, 0.08, 0.97);
    const date = new Date(t0 + tp * SPAN_H * 3600e3);
    world.setTime(date);
    const wx = heroWeather(data, date);
    world.setWeather(wx);
    world.setCameraPath("heroWide", "hero", seg(p, 0, 0.92));

    hud.mode("full");
    hud.show(p > 0.12);
    hud.set({ date, ...wx });
  },

  leave(dir, ctx) {
    if (dir < 0) ctx.hud.show(false);
  },
};
