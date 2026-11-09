import {
  el, seg, lerp, ease, clamp, glyph, tempColor, fmtDow, fmtHour, fmtDate, localHourOf, CONDITION_LABEL, loop,
} from "../util.js";
import { nowState, memberCondition, rainColor, windColor, luminance, smoothTo, skyGradient } from "../phone/kit.js";

const N = 64;
const COLS = 8;
const HERO = 27;
const CARD_W = 280;
const CARD_H = 560;
const LIFT = 240;

const COLOR = { t2m: tempColor, precip: rainColor, wind: windColor };
const UNIT = { t2m: "", precip: "mm/h", wind: "mph" };
const EXTREME = {
  t2m: ["warmest", "coldest"],
  precip: ["wettest", "driest"],
  wind: ["windiest", "calmest"],
};
const INTRO_CAPS = [
  { at: [0, 0.065], html: "Your app boiled the forecast down to this <em>one number</em>." },
  { at: [0.07, 0.145], html: "But the forecast is really <em>64 forecasts.</em><small>Google's WeatherNext 3 model runs 64 versions of the future, each starting from slightly different guesses about today's weather, since nobody can measure the air perfectly. Your app shows just the middle one.</small>" },
];

const fmtNum = (v, key) => {
  if (key === "t2m") return `${Math.round(v)}`;
  if (key === "wind") return `${Math.round(Math.max(0, v))}`;
  return v < 0.05 ? "0" : v < 9.95 ? v.toFixed(1) : `${Math.round(v)}`;
};
const fmtVal = (v, key) => (key === "t2m" ? `${fmtNum(v, key)}°` : fmtNum(v, key));
const fmtRange = (lo, hi, key) => (key === "t2m"
  ? `${fmtNum(lo, key)}-${fmtNum(hi, key)}°`
  : `${fmtNum(lo, key)}-${fmtNum(hi, key)}<small>${UNIT[key]}</small>`);

let S = null;

/** finale slots: cold to warm column by column, with the 4 center slots holding the middle ranks */
function sortedSlots() {
  const centre = [3 * COLS + 3, 3 * COLS + 4, 4 * COLS + 3, 4 * COLS + 4];
  const rest = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < COLS; r++) if (!centre.includes(r * COLS + c)) rest.push(r * COLS + c);
  return [...rest.slice(0, 30), centre[0], centre[2], centre[1], centre[3], ...rest.slice(30)];
}

function layout() {
  const { root, slot, layer } = S;
  const vw = layer.clientWidth || window.innerWidth;
  const vh = layer.clientHeight || window.innerHeight;
  const mobile = S.ctx.mobile;
  let tile;
  let gap;
  if (mobile) {
    gap = 5;
    tile = Math.min(40, Math.floor((vw - 32 - 7 * gap) / COLS));
  } else {
    const gutter = clamp(0.04 * vw, 16, 48);
    const panelW = clamp(vw * 0.25, 300, 380);
    const availW = vw - 2 * gutter - panelW - 64 - 24;
    const availH = vh - 150;
    tile = Math.min(96, Math.floor(Math.min(availW, availH) / 8.77));
    gap = Math.round(tile * 0.11);
  }
  const grid = COLS * tile + (COLS - 1) * gap;
  root.style.setProperty("--tile", `${tile}px`);
  root.style.setProperty("--gap", `${gap}px`);
  root.style.setProperty("--grid", `${grid}px`);
  const lr = layer.getBoundingClientRect();
  const sr = slot.getBoundingClientRect();
  const x0 = sr.left - lr.left;
  const y0 = sr.top - lr.top;
  const slots = Array.from({ length: N }, (_, k) => ({
    x: x0 + (k % COLS) * (tile + gap),
    y: y0 + Math.floor(k / COLS) * (tile + gap),
  }));
  const gcx = x0 + grid / 2;
  const gcy = y0 + grid / 2;
  const fin = mobile
    ? { cx: gcx, cy: gcy, s: 1 }
    : { cx: vw / 2, cy: vh / 2 + 36, s: Math.min(1, (vh - 250) / grid) };
  const c = (COLS - 1) / 2;
  const maxD = Math.hypot(c, c);
  const dist = slots.map((_, k) => Math.hypot((k % COLS) - c, Math.floor(k / COLS) - c) / maxD);
  S.geo = { vw, vh, tile, gap, grid, slots, gcx, gcy, fin, dist, mobile, liftBig: mobile ? Math.min(220, vw - 120) : Math.min(300, vh * 0.36) };
  S.snap = true;
}

function buildTiles(wrap) {
  return Array.from({ length: N }, () => {
    const node = el("div", { class: "g64-tile" }, '<span class="g64-g"></span><span class="g64-v t-num"></span><span class="g64-u"></span>');
    wrap.append(node);
    return {
      node, g: node.children[0], v: node.children[1], u: node.children[2],
      val: 0, rgb: [40, 50, 70], sx: 0, sy: 0, cond: "", text: "", unit: null, light: null, bg: "", t: "", o: "", cls: "",
    };
  });
}

function setStyle(obj, key, prop, value, node = obj.node) {
  if (obj[key] !== value) { obj[key] = value; node.style[prop] = value; }
}

function frame(dt) {
  if (!S.geo) layout();
  const { geo, tiles, ctx, data } = S;
  const p = S.p;
  const key = S.key;
  const snap = S.snap || ctx.reduced;
  S.snap = false;

  const ffT = seg(p, 0.15, 0.68);
  const lead = lerp(S.lead0, data.maxLead, (ffT + ease.inOut(ffT)) / 2);
  const date = data.timeAt(lead);
  const hour = localHourOf(date);
  const target = data.membersAt(key, lead);
  const precip = key === "precip" ? target : data.membersAt("precip", lead);
  const intro = seg(p, 0, 0.15);
  if (intro < 1) {
    const p50 = data.statsAt(key, lead).p50;
    const k = ease.inOut(seg(intro, 0.3, 1));
    for (let i = 0; i < N; i++) target[i] = lerp(p50, target[i], k);
  }

  const color = COLOR[key];
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    t.val = snap ? target[i] : smoothTo(t.val, target[i], dt, 12);
    const c = d3.rgb(color(t.val));
    for (let j = 0; j < 3; j++) t.rgb[j] = snap ? [c.r, c.g, c.b][j] : smoothTo(t.rgb[j], [c.r, c.g, c.b][j], dt, 9);
  }

  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => tiles[a].val - tiles[b].val);
  const lo = order[0];
  const hi = order[N - 1];
  const med = order[N / 2 - 1];
  const medVal = tiles[med].val;

  const { slots, tile, fin, gcx, gcy } = geo;
  const fA = ease.inOut(seg(p, 0.74, 0.79));
  const fB = ease.inOut(seg(p, 0.84, 0.9));
  const fg = Math.max(fA, fB);
  const gs = lerp(1, fin.s, fg);
  const place = (x, y) => [fin.cx * fg + gcx * (1 - fg) + (x + tile / 2 - gcx) * gs - tile / 2, fin.cy * fg + gcy * (1 - fg) + (y + tile / 2 - gcy) * gs - tile / 2];
  const ex = seg(p, 0.55, 0.61) * (1 - seg(p, 0.71, 0.75));
  const hero = slots[HERO];

  order.forEach((i, r) => {
    const s = slots[S.ring[r]];
    const t = tiles[i];
    const hard = snap || fB === 0;
    t.sx = hard ? s.x : smoothTo(t.sx, s.x, dt, 10);
    t.sy = hard ? s.y : smoothTo(t.sy, s.y, dt, 10);
  });

  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    const d = geo.dist[i];
    const a = i === HERO ? 0.4 : 0.42 + d * 0.35;
    const k = ease.out(seg(intro, a, a + 0.23));
    const gx = lerp(t.sx, slots[i].x, 1 - fB);
    const gy = lerp(t.sy, slots[i].y, 1 - fB);
    const [px, py] = place(gx, gy);
    const x = lerp(hero.x, px, k);
    const y = lerp(hero.y, py, k);
    const sc = lerp(0.45, 1, k) * gs;
    setStyle(t, "t", "transform", `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`);
    let o = k;
    if (i !== hi && i !== lo) o *= 1 - 0.45 * ex;
    o *= 1 - 0.85 * fA * (1 - fB);
    if (i === med && fg > 0) o = 0;
    setStyle(t, "o", "opacity", o.toFixed(3));

    const bg = `rgb(${t.rgb[0] | 0}, ${t.rgb[1] | 0}, ${t.rgb[2] | 0})`;
    setStyle(t, "bg", "backgroundColor", bg);
    const light = luminance(bg) > 0.42;
    if (t.light !== light) { t.light = light; t.node.classList.toggle("is-light", light); }
    const text = fmtVal(t.val, key);
    if (t.text !== text) { t.text = text; t.v.textContent = text; }
    if (t.unit !== key) { t.unit = key; t.u.textContent = UNIT[key]; }
    const cond = memberCondition(data, precip[i], lead, hour);
    if (t.cond !== cond) { t.cond = cond; t.g.innerHTML = glyph(cond, 20); }
    const cls = ex > 0.01 && (i === hi || i === lo) ? (i === hi ? "is-hi" : "is-lo") : "";
    if (t.cls !== cls) {
      t.node.classList.remove("is-hi", "is-lo");
      if (cls) t.node.classList.add(cls);
      t.cls = cls;
    }
  }

  renderIntroCaps(p);
  renderCard(intro, hero, tile);
  renderPanel(p, lead, date, hour, tiles[lo].val, tiles[hi].val, key);
  renderCallouts(ex, hi, lo, key, place);
  renderFinale(p, fA, fB, med, medVal, key, lead, hour, place);
}

function renderIntroCaps(p) {
  S.introCaps.forEach((node, k) => {
    const [a, b] = INTRO_CAPS[k].at;
    const t = Math.min(a === 0 ? 1 : seg(p, a, a + 0.015), 1 - seg(p, b - 0.015, b));
    setStyle(S.introS[k], "o", "opacity", ease.inOut(t).toFixed(3), node);
    setStyle(S.introS[k], "t", "transform", `translate3d(0, ${((1 - t) * 12).toFixed(1)}px, 0)`, node);
  });
}

function renderCard(intro, hero, tile) {
  const { card, geo } = S;
  const shrink = ease.inOut(seg(intro, 0.15, 0.55));
  const big = Math.min((geo.vh * 0.84) / CARD_H, (geo.vw * 0.9) / CARD_W);
  const s = lerp(big, tile / CARD_W, shrink);
  const cx = lerp(geo.vw / 2, hero.x + tile / 2, shrink);
  const cy = lerp(geo.vh / 2, hero.y + tile / 2, shrink);
  const inset = ((CARD_H - CARD_W) / 2) * ease.inOut(seg(intro, 0.2, 0.55));
  const radius = lerp(44, 14 * (CARD_W / tile) * (geo.mobile ? 0.6 : 1), shrink);
  const o = 1 - seg(intro, 0.5, 0.62);
  setStyle(S.cardS, "o", "opacity", o.toFixed(3), card);
  card.style.visibility = o > 0 ? "visible" : "hidden";
  if (o <= 0) return;
  setStyle(S.cardS, "t", "transform", `translate3d(${(cx - CARD_W / 2).toFixed(1)}px, ${(cy - CARD_H / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)})`, card);
  setStyle(S.cardS, "c", "clipPath", `inset(${inset.toFixed(1)}px 0 round ${radius.toFixed(1)}px)`, card);
  setStyle(S.cardS, "x", "opacity", (1 - seg(intro, 0.2, 0.4)).toFixed(3), S.cardExtra);
}

function renderPanel(p, lead, date, hour, lo, hi, key) {
  const P = S.panel;
  const hourKey = Math.floor(lead);
  if (P.hourKey !== hourKey) {
    P.hourKey = hourKey;
    P.dow.textContent = fmtDow(date);
    P.time.textContent = fmtHour(date);
    P.date.textContent = fmtDate(date);
    const h = Math.round(lead - S.lead0);
    P.lead.textContent = h < 1 ? "now" : h < 48 ? `+${h}h` : `+${Math.floor(h / 24)}d ${h % 24}h`;
  }
  const f = (lead - S.lead0) / (S.data.maxLead - S.lead0);
  P.fill.style.transform = `scaleX(${f.toFixed(4)})`;
  P.knob.style.left = `${(f * 100).toFixed(2)}%`;

  const day = hour >= 6 && hour < 18;
  const u = day ? (hour - 6) / 12 : (((hour - 18) + 24) % 24) / 12;
  const ang = Math.PI * (1 - u);
  const x = 100 + 84 * Math.cos(ang);
  const y = 96 - 84 * Math.sin(ang);
  P.body.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  if (P.day !== day) {
    P.day = day;
    P.sun.style.opacity = day ? "1" : "0";
    P.moon.style.opacity = day ? "0" : "1";
    P.arcPath.classList.toggle("is-night", !day);
  }
  P.trail.setAttribute("stroke-dasharray", `${(u * Math.PI * 84).toFixed(1)} 400`);

  const range = fmtRange(lo, hi, key);
  if (P.rangeText !== range) { P.rangeText = range; P.rangeVal.innerHTML = range; }
  const r = seg(p, 0.5, 0.58);
  P.range.style.opacity = (r * (1 - seg(p, 0.73, 0.77))).toFixed(3);
  P.range.style.transform = `translate3d(0, ${((1 - ease.out(r)) * 16).toFixed(1)}px, 0)`;

  const caps = [
    seg(p, 0.145, 0.18) * (1 - seg(p, 0.3, 0.34)),
    seg(p, 0.32, 0.36) * (1 - seg(p, 0.5, 0.54)),
    seg(p, 0.52, 0.56) * (1 - seg(p, 0.71, 0.75)),
  ];
  P.caps.forEach((c, k) => {
    c.style.opacity = caps[k].toFixed(3);
    c.style.transform = `translate3d(0, ${((1 - caps[k]) * 8).toFixed(1)}px, 0)`;
  });

  const headIn = seg(p, 0.14, 0.19);
  const out = 1 - seg(p, 0.72, 0.76);
  P.head.style.opacity = (headIn * out).toFixed(3);
  P.scrub.style.opacity = (headIn * out).toFixed(3);
  P.chips.style.opacity = headIn.toFixed(3);
  P.chips.style.pointerEvents = headIn > 0.5 ? "auto" : "none";
  S.foot.style.opacity = (headIn * 0.9).toFixed(3);
}

function renderCallouts(ex, hi, lo, key, place) {
  const { geo, callouts, tiles } = S;
  [hi, lo].forEach((i, k) => {
    const c = callouts[k];
    const [x, y] = place(geo.slots[i].x, geo.slots[i].y);
    const row = Math.floor(i / COLS);
    const below = row === 0;
    const txt = `${EXTREME[key][k]} <b>${fmtVal(tiles[i].val, key)}${key === "t2m" ? "" : ` ${UNIT[key]}`}</b>`;
    if (c.__txt !== txt) { c.__txt = txt; c.innerHTML = txt; }
    if (c.__below !== below) { c.__below = below; c.classList.toggle("is-below", below); }
    const cx = clamp(x + geo.tile / 2, 70, geo.vw - 70);
    const cy = below ? y + geo.tile + 8 : y - 8;
    c.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, ${below ? "0" : "-100%"}) scale(${lerp(0.9, 1, ex).toFixed(3)})`;
    c.style.opacity = ex.toFixed(3);
  });
}

function renderFinale(p, fA, fB, med, medVal, key, lead, hour, place) {
  const { geo, lift, finale } = S;
  finale.dim.style.opacity = (fA * (1 - fB)).toFixed(3);
  const blur = (4 * fA * (1 - fB)).toFixed(1);
  if (S.blur !== blur) { S.blur = blur; S.tilesWrap.style.filter = +blur > 0.05 ? `blur(${blur}px)` : ""; }
  const tA = seg(p, 0.76, 0.8) * (1 - seg(p, 0.83, 0.85));
  const tB = seg(p, 0.88, 0.92);
  finale.a.style.opacity = tA.toFixed(3);
  finale.a.style.transform = `translate3d(0, ${((1 - tA) * 14).toFixed(1)}px, 0)`;
  finale.b.style.opacity = tB.toFixed(3);
  finale.b.style.transform = `translate3d(0, ${((1 - tB) * 14).toFixed(1)}px, 0)`;

  const on = fA > 0;
  lift.root.style.visibility = on ? "visible" : "hidden";
  if (!on) return;
  const [sx, sy] = place(geo.slots[med].x, geo.slots[med].y);
  const gsNow = lerp(1, geo.fin.s, Math.max(fA, fB));
  const fromS = (geo.tile * gsNow) / LIFT;
  const bigS = geo.liftBig / LIFT;
  const block = ((2 * geo.tile + geo.gap) * geo.fin.s + 10) / LIFT;
  const s = lerp(lerp(fromS, bigS, fA), block, fB);
  const fromX = sx + (geo.tile * gsNow) / 2;
  const fromY = sy + (geo.tile * gsNow) / 2;
  const midX = geo.vw / 2;
  const midY = geo.mobile ? geo.vh * 0.5 : geo.vh / 2 + 36;
  const cx = lerp(lerp(fromX, midX, fA), geo.fin.cx, fB);
  const cy = lerp(lerp(fromY, midY, fA), geo.fin.cy, fB);
  lift.root.style.transform = `translate3d(${(cx - LIFT / 2).toFixed(1)}px, ${(cy - LIFT / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)})`;
  const date = S.data.timeAt(lead);
  const st = nowState(S.data, lead);
  const cond = st.cond;
  const val = fmtVal(medVal, key);
  const sig = `${key}|${val}|${cond}|${Math.floor(hour)}`;
  if (lift.sig !== sig) {
    lift.sig = sig;
    lift.val.textContent = val;
    lift.g.innerHTML = glyph(cond, 30);
    lift.cond.textContent = key === "t2m" ? CONDITION_LABEL[cond] : UNIT[key];
    lift.when.textContent = `${fmtDow(date)} ${fmtHour(date)}`;
    lift.root.style.background = skyGradient(cond, hour);
  }
  lift.meta.style.opacity = (1 - fB).toFixed(3);
}

function setVar(key) {
  if (!S || S.key === key) return;
  S.key = key;
  S.chipBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
  S.root.dataset.var = key;
}

export default {
  length: 7,
  interactive: true,

  mount(layer, ctx) {
    const data = ctx.data;
    const root = el("div", { class: "g64", "data-var": "t2m" });
    const layout_ = el("div", { class: "g64-layout" });
    const panel = el("div", { class: "g64-panel" });

    const head = el("div", { class: "g64-head passthrough" }, `
      <p class="t-kicker">64 forecasts, one place</p>
      <div class="g64-clock">
        <p class="g64-when"><span class="g64-dow"></span> <span class="g64-time t-num"></span></p>
        <p class="g64-sub"><span class="g64-date"></span><span class="g64-lead t-num"></span></p>
      </div>
      <svg class="g64-arc" viewBox="0 0 200 108" aria-hidden="true">
        <path class="g64-arc-base" d="M16 96 A84 84 0 0 1 184 96" />
        <path class="g64-arc-trail" d="M16 96 A84 84 0 0 1 184 96" />
        <line x1="4" y1="96" x2="196" y2="96" class="g64-horizon" />
        <g class="g64-body">
          <g class="g64-sun"><circle r="13" fill="rgba(255,201,74,.18)"/><circle r="7.5" fill="#ffc94a"/></g>
          <g class="g64-moon"><circle r="7.5" fill="#e8e6ff"/><circle r="6.5" cx="4" cy="-3" fill="var(--bg)"/></g>
        </g>
      </svg>`);
    const scrub = el("div", { class: "g64-scrub passthrough" }, `
      <div class="g64-track"><i class="g64-fill"></i><i class="g64-knob"></i></div>
      <div class="g64-scrub-labels"><span>Now</span><span class="g64-end"></span></div>`);
    const track = scrub.querySelector(".g64-track");
    const days = Math.floor((data.maxLead - data.leads[0]) / 24);
    for (let d = 1; d <= days; d++) {
      const tick = el("i", { class: "g64-tick" });
      tick.style.left = `${((d * 24) / (data.maxLead - data.leads[0])) * 100}%`;
      track.append(tick);
    }
    scrub.querySelector(".g64-end").textContent = `+${Math.round((data.maxLead - data.leads[0]) / 24)} days`;

    const stats = el("div", { class: "g64-stats passthrough" });
    const range = el("div", { class: "g64-range" }, '<p class="g64-range-k">range</p><p class="g64-range-v t-num"></p>');
    const capWrap = el("div", { class: "g64-caps" });
    const caps = ["Each square is one forecast for Harvard Yard. At first, they all agree.", "Now fast-forward. Each day further out, they drift apart.", "Same place, same hour. Very different days."]
      .map((t) => el("p", { class: "g64-cap" }, t));
    capWrap.append(...caps);
    stats.append(capWrap, range);

    const chips = el("div", { class: "g64-chips chips", role: "group", "aria-label": "Variable" });
    const chipBtns = Object.entries({ t2m: "Temp", precip: "Rain", wind: "Wind" }).map(([key, label]) => {
      const b = el("button", { type: "button", class: "chip", "data-key": key, "aria-pressed": String(key === "t2m") }, label);
      b.addEventListener("click", () => setVar(key));
      chips.append(b);
      return b;
    });

    panel.append(head, scrub, stats, chips);
    const slot = el("div", { class: "g64-slot passthrough" });
    layout_.append(panel, slot);

    const tilesWrap = el("div", { class: "g64-tiles passthrough" });
    const tiles = buildTiles(tilesWrap);
    const callouts = [el("p", { class: "g64-callout is-hi" }), el("p", { class: "g64-callout is-lo" })];
    tilesWrap.append(...callouts);

    const now = nowState(data, data.leads[0]);
    const card = el("div", { class: "g64-card passthrough" });
    card.style.cssText = `width:${CARD_W}px;height:${CARD_H}px;background:${skyGradient(now.cond, now.hour)}`;
    const cardExtra = el("div", { class: "g64-card-extra" }, `<p class="g64-card-place">Harvard Yard</p>`);
    card.append(cardExtra, el("div", { class: "g64-card-core" }, `
      <span class="g64-card-g">${glyph(now.cond, 34)}</span>
      <p class="g64-card-t t-num">${Math.round(now.t)}°</p>
      <p class="g64-card-c">${CONDITION_LABEL[now.cond]}</p>`));

    const dim = el("div", { class: "g64-dim passthrough" });
    const titleA = el("h2", { class: "g64-title t-title" }, "This is what your weather app showed.");
    const titleB = el("h2", { class: "g64-title t-title" }, "The forecast says all of these are possible.");
    const titles = el("div", { class: "g64-titles passthrough" });
    titles.append(titleA, titleB);
    const liftRoot = el("div", { class: "g64-lift passthrough" }, `
      <div class="g64-lift-meta"><p class="g64-lift-place">Harvard Yard</p><p class="g64-lift-when"></p></div>
      <span class="g64-lift-g"></span>
      <p class="g64-lift-v t-num"></p>
      <p class="g64-lift-c"></p>`);
    liftRoot.style.width = `${LIFT}px`;
    liftRoot.style.height = `${LIFT}px`;

    const foot = el("p", { class: "g64-foot" }, "64 members reconstructed from WeatherNext 3 ensemble quantiles");

    const introWrap = el("div", { class: "st-caps g64-intro passthrough" });
    const introCaps = INTRO_CAPS.map((c) => el("p", { class: "st-cap" }, c.html));
    introWrap.append(...introCaps);

    root.append(layout_, tilesWrap, card, dim, liftRoot, titles, introWrap, foot);
    layer.append(root);

    const ring = sortedSlots();
    S = {
      introCaps, introS: introCaps.map(() => ({})),
      ctx, data, layer, root, slot, tiles, tilesWrap, callouts, card, cardExtra, cardS: {}, chipBtns, foot, ring,
      lead0: data.leads[0], p: 0, key: "t2m", geo: null, snap: true, stop: null,
      panel: {
        head, scrub, chips, range,
        rangeVal: range.querySelector(".g64-range-v"),
        caps,
        dow: head.querySelector(".g64-dow"),
        time: head.querySelector(".g64-time"),
        date: head.querySelector(".g64-date"),
        lead: head.querySelector(".g64-lead"),
        body: head.querySelector(".g64-body"),
        sun: head.querySelector(".g64-sun"),
        moon: head.querySelector(".g64-moon"),
        arcPath: head.querySelector(".g64-arc"),
        trail: head.querySelector(".g64-arc-trail"),
        fill: scrub.querySelector(".g64-fill"),
        knob: scrub.querySelector(".g64-knob"),
      },
      lift: {
        root: liftRoot,
        meta: liftRoot.querySelector(".g64-lift-meta"),
        when: liftRoot.querySelector(".g64-lift-when"),
        g: liftRoot.querySelector(".g64-lift-g"),
        val: liftRoot.querySelector(".g64-lift-v"),
        cond: liftRoot.querySelector(".g64-lift-c"),
      },
      finale: { dim, a: titleA, b: titleB },
    };
    window.addEventListener("resize", () => { S.geo = null; });
    document.fonts?.ready.then(() => { S.geo = null; });
  },

  enter(dir, ctx) {
    S.geo = null;
    S.snap = true;
    ctx.hud.show(false);
    ctx.world.setDim(0.85);
    S.stop?.();
    S.stop = loop((dt) => {
      frame(dt);
      ctx.hud.show(false);
      ctx.world.setVisible(S.p < 0.1);
    });
  },

  update(p) {
    S.p = p;
  },

  leave(dir, ctx) {
    S.stop?.();
    S.stop = null;
    ctx.world.setVisible(true);
  },
};
