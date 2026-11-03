import { loadNortheast, loadGeo } from "../data.js";
import { clamp, lerp, seg, ease, smoothstep, loop, el, fmtDow, fmtDate, fmtHour } from "../util.js";
import { CITIES } from "../northeast/geo.js";

const FADE = 0.045;
const T_INTRO = [0.12, 0.3];
const T_PLAY = [0.3, 0.93];

const MOODS = [
  [4, "sharp."],
  [6, "a little soft."],
  [9, "blurring."],
  [13, "clouding over."],
  [Infinity, "mostly fog."],
];

const moodOf = (spread) => MOODS.find(([max]) => spread < max)[1];
const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

export default {
  length: 6,
  fade: false,

  mount(layer, ctx) {
    this.ctx = ctx;
    this.layer = layer;
    this.p = 0;
    this.map = null;
    layer.classList.add("ne");
    layer.innerHTML = `
      <div class="ne-stage">
        <canvas class="ne-canvas" aria-hidden="true"></canvas>
        <div class="ne-pins" aria-hidden="true"></div>
      </div>
      <div class="ne-cloudpass" aria-hidden="true">
        <div class="ne-cloud ne-cloud-a"></div>
        <div class="ne-cloud ne-cloud-b"></div>
        <div class="ne-cloud ne-cloud-c"></div>
      </div>
      <div class="ne-white" aria-hidden="true"></div>
      <div class="ne-ui">
        <div class="ne-readout">
          <p class="t-kicker">The Northeast</p>
          <p class="ne-day" aria-live="polite"><span class="ne-day-word">Day</span> <span class="ne-day-num">1</span></p>
          <p class="ne-when"></p>
        </div>
        <p class="ne-caption"><span></span><span></span></p>
        <div class="ne-timeline">
          <div class="ne-track">
            <div class="ne-track-bg"></div>
            <div class="ne-track-fill"></div>
            <div class="ne-ticks"></div>
            <div class="ne-playhead"></div>
          </div>
          <p class="ne-key"><span class="ne-key-swatch"></span>color = temperature<span class="ne-key-fog"></span>fog = the 64 forecasts disagree</p>
        </div>
      </div>`;

    const q = (s) => layer.querySelector(s);
    this.dom = {
      canvas: q(".ne-canvas"),
      stage: q(".ne-stage"),
      pins: q(".ne-pins"),
      cloudpass: q(".ne-cloudpass"),
      clouds: [...layer.querySelectorAll(".ne-cloud")],
      white: q(".ne-white"),
      readout: q(".ne-readout"),
      dayNum: q(".ne-day-num"),
      when: q(".ne-when"),
      caption: q(".ne-caption"),
      capSpans: [...layer.querySelectorAll(".ne-caption span")],
      timeline: q(".ne-timeline"),
      track: q(".ne-track"),
      trackBg: q(".ne-track-bg"),
      fill: q(".ne-track-fill"),
      ticks: q(".ne-ticks"),
      playhead: q(".ne-playhead"),
    };
    this.text = { day: "", when: "", caption: "", capIdx: 0 };
    this.pins = CITIES.map((c) => {
      const node = el("div", { class: `ne-pin${c.home ? " is-home" : ""}` },
        `<span class="ne-pin-dot"></span><span class="ne-pin-label"><span class="ne-pin-name">${c.name}</span><span class="ne-pin-range"></span></span>`);
      this.dom.pins.append(node);
      return { ...c, node, range: node.querySelector(".ne-pin-range"), text: "" };
    });

    this.ready = Promise.all([loadNortheast(), loadGeo(), import("../northeast/map.js")])
      .then(([ne, geo, mod]) => {
        this.map = mod.createMap(this.dom.canvas, { ne, geo, mobile: ctx.mobile });
        this.init = new Date(+new Date(ne.meta.valid[0]) - ne.meta.leads_h[0] * 3600e3);
        this.buildTimeline();
        this.resize();
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(layer);
        this.apply();
        this.dirty = true;
      })
      .catch((err) => console.error("[northeast] load failed", err));
  },

  buildTimeline() {
    const { map } = this;
    const lead0 = map.leads[0];
    const span = map.maxLead - lead0;
    const days = Math.ceil(map.maxLead / 24);
    const frag = document.createDocumentFragment();
    for (let d = 0; d <= days; d++) {
      const lead = clamp(d * 24, lead0, map.maxLead);
      const x = (lead - lead0) / span;
      frag.append(el("span", { class: "ne-tick", style: `left:${(x * 100).toFixed(3)}%` }));
      if (d < days) {
        const mid = (clamp(d * 24, lead0, map.maxLead) + clamp((d + 1) * 24, lead0, map.maxLead)) / 2;
        const xm = (mid - lead0) / span;
        frag.append(el("span", { class: "ne-tick-label", style: `left:${(xm * 100).toFixed(3)}%` },
          `<b>${d + 1}</b><i>${fmtDow(this.timeAt(mid))}</i>`));
      }
    }
    this.dom.ticks.replaceChildren(frag);

    const [s0, s1] = map.spreadRange;
    const stops = [];
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const lead = lead0 + (span * k) / n;
      const u = smoothstep(s0, s1, this.meanSpreadAt(lead));
      const c = d3.interpolateLab("#8fd0ff", "#7a7f88")(u);
      stops.push(`${c} ${((k / n) * 100).toFixed(1)}%`);
    }
    const grad = `linear-gradient(90deg, ${stops.join(",")})`;
    this.dom.trackBg.style.background = grad;
    this.dom.fill.style.background = grad;
  },

  timeAt(leadH) {
    return new Date(+this.init + leadH * 3600e3);
  },

  meanSpreadAt(leadH) {
    const { leads, meanSpread } = this.map;
    if (leadH <= leads[0]) return meanSpread[0];
    const n = leads.length;
    if (leadH >= leads[n - 1]) return meanSpread[n - 1];
    let k = 1;
    while (leads[k] < leadH) k++;
    const t = (leadH - leads[k - 1]) / (leads[k] - leads[k - 1]);
    return lerp(meanSpread[k - 1], meanSpread[k], t);
  },

  resize() {
    if (!this.map) return;
    const { ctx } = this;
    const w = this.layer.clientWidth || innerWidth;
    const h = this.layer.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, ctx.mobile ? 1.5 : 2) * (this.quality ?? 1);
    const mobile = ctx.mobile;
    const safe = mobile
      ? { top: 168, right: 18, bottom: 150, left: 18 }
      : { top: 70, right: 90, bottom: 150, left: Math.min(400, w * 0.27) };
    this.map.resize(w, h, dpr, safe, mobile);
    for (const pin of this.pins) {
      const side = (mobile && pin.mobileSide) || pin.side;
      for (const s of ["left", "right", "up"]) pin.node.classList.toggle(`is-${s}`, s === side);
    }
    this.dirty = true;
  },

  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.world.setVisible(true);
    ctx.world.setDim(0);
    ctx.world.setUncertainty(0);
    this.stop?.();
    let lastDraw = -1;
    let slow = 0;
    this.stop = loop((dt, now) => {
      if (!this.map || this.mapOpacity <= 0.001) return;
      const animate = !ctx.reduced;
      if (!this.dirty && (!animate || now - lastDraw < 1 / 31)) return;
      if (lastDraw > 0 && now - lastDraw > 1 / 24) slow++; else slow = Math.max(0, slow - 1);
      if (slow > 24 && (this.quality ?? 1) > 0.5) {
        this.quality = (this.quality ?? 1) * 0.8;
        slow = 0;
        this.resize();
      }
      lastDraw = now;
      this.map.render(animate ? now : 0, this.cloudOpacity);
      this.placePins();
      this.dirty = false;
    });
  },

  leave(dir, ctx) {
    this.stop?.();
    this.stop = null;
    ctx.world.setVisible(true);
  },

  update(p, ctx) {
    this.p = p;
    const { dom } = this;

    const layerOpacity = clamp((1 - p) / FADE);
    this.layer.style.opacity = String(layerOpacity);

    const rise = ease.inOut(seg(p, 0, 0.08));
    ctx.world.setCameraPath("high", "sky", rise);
    ctx.veil(p < 0.1 ? 1 - seg(p, 0, 0.03) : 0);
    ctx.world.setVisible(p < 0.105 || p > 1 - FADE);

    const c = seg(p, 0.03, 0.135);
    const cloudOp = Math.sin(Math.PI * c) ** 0.8;
    dom.cloudpass.style.opacity = cloudOp.toFixed(3);
    dom.clouds.forEach((node, k) => {
      const s = lerp(0.7 + k * 0.15, 2.6 + k * 0.6, ease.in(c) * 0.6 + c * 0.4);
      node.style.transform = `translate3d(0, ${((0.5 - c) * (18 + k * 10)).toFixed(2)}%, 0) scale(${s.toFixed(3)})`;
    });
    dom.white.style.opacity = (0.92 * bell(p, 0.088, 0.022)).toFixed(3);

    this.mapOpacity = smoothstep(0.072, 0.098, p);
    dom.stage.style.opacity = this.mapOpacity.toFixed(3);

    this.apply();
  },

  apply() {
    const { map, dom, p, ctx } = this;
    if (!map || !ctx) return;

    const descend = 1 - ease.out(seg(p, 0.07, 0.13));
    const k = ease.inOut(seg(p, ...T_INTRO));
    map.setView(k, descend);

    const tl = seg(p, ...T_PLAY);
    const lead = lerp(map.leads[0], map.maxLead, tl);
    map.setLead(lead);
    this.cloudOpacity = smoothstep(0.2, 0.32, p);
    this.dirty = true;

    const days = Math.ceil(map.maxLead / 24);
    const day = Math.min(days, Math.floor(lead / 24) + 1);
    const spread = this.meanSpreadAt(lead);

    const uiIn = smoothstep(0.24, 0.31, p);
    dom.readout.style.opacity = uiIn.toFixed(3);
    dom.readout.style.transform = `translate3d(0, ${((1 - uiIn) * 14).toFixed(1)}px, 0)`;
    dom.timeline.style.opacity = uiIn.toFixed(3);
    dom.timeline.style.transform = `translate3d(0, ${((1 - uiIn) * 18).toFixed(1)}px, 0)`;

    const capIn = smoothstep(0.125, 0.16, p);
    dom.caption.style.opacity = capIn.toFixed(3);

    if (String(day) !== this.text.day) {
      const prev = this.text.day;
      this.text.day = String(day);
      dom.dayNum.textContent = this.text.day;
      if (prev && !ctx.reduced) {
        const up = +this.text.day > +prev ? 1 : -1;
        dom.dayNum.animate([
          { transform: `translateY(${up * 0.35}em)`, opacity: 0, filter: "blur(6px)" },
          { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
        ], { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      }
    }

    const date = this.timeAt(lead);
    const when = `${fmtDow(date)} ${fmtDate(date)} · ${fmtHour(date)}`;
    if (when !== this.text.when) {
      this.text.when = when;
      dom.when.textContent = when;
    }

    const caption = p < 0.28
      ? "Harvard is one pin on a big map."
      : `Day ${day}: ${moodOf(spread)}`;
    this.setCaption(caption);

    const x = tl * 100;
    dom.fill.style.clipPath = `inset(0 ${(100 - x).toFixed(3)}% 0 0)`;
    dom.playhead.style.left = `${x.toFixed(3)}%`;

    const pinIn = smoothstep(0.1, 0.14, p);
    for (const pin of this.pins) {
      const s = map.sample(pin.lon, pin.lat);
      const lo = Math.round(s.temp - s.spread / 2);
      const hi = Math.round(s.temp + s.spread / 2);
      const txt = hi - lo < 1 ? `${Math.round(s.temp)}°` : `${lo}-${hi}°`;
      if (txt !== pin.text) {
        pin.text = txt;
        pin.range.textContent = txt;
      }
      pin.fade = pinIn * (pin.home ? 1 : smoothstep(0.24, 0.3, p));
    }
  },

  setCaption(text) {
    if (text === this.text.caption) return;
    this.text.caption = text;
    const [a, b] = this.dom.capSpans;
    const next = this.text.capIdx === 0 ? b : a;
    const cur = this.text.capIdx === 0 ? a : b;
    next.textContent = text;
    next.classList.add("is-on");
    cur.classList.remove("is-on");
    this.text.capIdx = this.text.capIdx === 0 ? 1 : 0;
  },

  placePins() {
    const { map } = this;
    for (const pin of this.pins) {
      const pr = map.project(pin.lon, pin.lat);
      const op = pr.visible ? pin.fade : 0;
      pin.node.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`;
      pin.node.style.opacity = op.toFixed(3);
    }
  },
};
