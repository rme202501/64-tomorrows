import { el, seg, lerp, ease, clamp } from "../util.js";
import { buildApp, SCREEN_W, SCREEN_H } from "../phone/app.js";

const BEZEL = 10;
const DEV_W = SCREEN_W + BEZEL * 2;
const DEV_H = SCREEN_H + BEZEL * 2;

let ui = null;
let geo = null;
let lastP = 0;

function measure() {
  const card = ui.app.tenCard;
  geo = {
    vw: window.innerWidth,
    vh: ui.layer.clientHeight || window.innerHeight,
    card: { x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight },
    list: { y: ui.app.tenList.offsetTop, h: ui.app.tenList.offsetHeight },
  };
}

function setT(node, value) {
  if (node.__t !== value) { node.__t = value; node.style.transform = value; }
}
function setO(node, value) {
  const v = value.toFixed(3);
  if (node.__o !== v) { node.__o = v; node.style.opacity = v; }
}

const HOLD = 0.88;

const CAPS = [
  { at: [0.04, 0.42], html: "You check your weather app." },
  { at: [0.5, 0.8], html: "It shows <em>one</em> temperature for now, and one for each hour ahead." },
  { at: [0.86, 1.01], html: "Tap the 10-day forecast: one high and one low per day. Simple, and confident." },
];

function render(raw, ctx) {
  const p = raw <= 0.45 ? raw : Math.min(1, 0.45 + ((raw - 0.45) * 0.55) / (HOLD - 0.45));
  if (!geo) measure();
  const { vw, vh, card } = geo;
  const { app, device, screen, island, glare, backdrop } = ui;
  const mobile = ctx.mobile;

  const r = seg(p, 0, 0.25);
  const rise = ease.out(r);
  const straighten = ease.inOut(r);
  const z = ease.inOut(seg(p, 0.25, 0.45));

  const sRise = Math.min((0.64 * vh) / DEV_H, (0.78 * vw) / DEV_W);
  const sFill = mobile ? Math.max(vw / SCREEN_W, vh / SCREEN_H) : Math.min((0.94 * vh) / DEV_H, (0.9 * vw) / DEV_W);
  const s = lerp(sRise, sFill, z);
  const ty = lerp(vh * 0.95, 0, rise);
  const rx = lerp(42, 0, straighten);
  const ry = lerp(-18, 0, straighten);
  const rz = lerp(-7, 0, straighten);
  setT(device, `translate3d(0, ${ty.toFixed(1)}px, 0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)})`);
  setO(device, clamp(r * 4));

  const radius = mobile ? lerp(54, 0, z) : 54;
  const rs = `${radius.toFixed(1)}px`;
  if (screen.__r !== rs) { screen.__r = rs; screen.style.borderRadius = rs; }
  setO(island, mobile ? 1 - z : 1);
  setO(app.status, mobile ? 1 - z : 1);
  setO(glare, lerp(1, 0.35, straighten) * (mobile ? 1 - z : 1));
  setT(glare, `translate3d(${lerp(-30, 12, straighten).toFixed(1)}%, 0, 0)`);
  setO(backdrop, z);

  ctx.world.setCameraPath("hero", "street", r);
  const now = app.now;
  ctx.world.setTime(now.date);
  ctx.world.setWeather({ tempF: now.t, cloud: now.cloud, rain: now.rain, wind: now.wind });
  ctx.world.setDim(clamp(0.15 * rise + 0.7 * z));
  ctx.hud.show(p < 0.06);

  const lockOut = ease.inOut(seg(p, 0.41, 0.5));
  setO(app.lock, 1 - lockOut);
  setT(app.lock, `translate3d(0, ${(-24 * lockOut).toFixed(1)}px, 0) scale(${lerp(1, 0.96, lockOut).toFixed(4)})`);

  app.stagger.forEach((node, k) => {
    const a = 0.46 + k * 0.022;
    const t = ease.out(seg(p, a, a + 0.08));
    setO(node, t);
    setT(node, `translate3d(0, ${((1 - t) * 22).toFixed(1)}px, 0)`);
  });
  setT(app.strip, `translate3d(${(-ease.inOut(seg(p, 0.6, 0.72)) * app.hourWidth * 3).toFixed(1)}px, 0, 0)`);

  const fx = card.x + card.w * 0.62;
  const fy = card.y + card.h * 0.55;
  const fin = ease.out(seg(p, 0.71, 0.78));
  const press = seg(p, 0.78, 0.8) - seg(p, 0.8, 0.83);
  const fout = ease.inOut(seg(p, 0.83, 0.88));
  const fingerX = lerp(SCREEN_W + 40, fx, fin) + fout * 40;
  const fingerY = lerp(SCREEN_H + 60, fy, fin) + fout * 70;
  setT(app.finger, `translate3d(${(fingerX - 26).toFixed(1)}px, ${(fingerY - 26).toFixed(1)}px, 0) scale(${(1 - 0.16 * press).toFixed(3)})`);
  setO(app.finger, Math.min(fin, 1 - fout));

  const rp = seg(p, 0.785, 0.845);
  setT(app.ripple, `translate3d(${(fx - card.x - 20).toFixed(1)}px, ${(fy - card.y - 20).toFixed(1)}px, 0) scale(${(0.2 + ease.out(rp) * 12).toFixed(3)})`);
  setO(app.ripple, rp > 0 && rp < 1 ? 0.4 * (1 - rp) : 0);
  const glow = (seg(p, 0.78, 0.8) - seg(p, 0.84, 0.9)).toFixed(3);
  if (app.tenCard.__g !== glow) {
    app.tenCard.__g = glow;
    app.tenCard.style.setProperty("--press", glow);
    app.tenList.style.setProperty("--press", glow);
  }

  const m = ease.inOut(seg(p, 0.84, 0.93));
  const list = geo.list;
  app.tenView.style.visibility = m > 0 ? "visible" : "hidden";
  app.tenCard.style.visibility = m > 0 ? "hidden" : "visible";
  setO(app.tenBg, m);
  setT(app.nowView, `scale(${lerp(1, 0.94, m).toFixed(4)})`);
  setO(app.nowView, 1 - m);
  setT(app.tenList, `translate3d(0, ${lerp(card.y - list.y, 0, m).toFixed(1)}px, 0)`);
  const clip = `inset(0 0 ${lerp(list.h - card.h, 0, m).toFixed(1)}px 0 round 18px)`;
  if (app.tenList.__c !== clip) { app.tenList.__c = clip; app.tenList.style.clipPath = clip; }

  const head = ease.out(seg(p, 0.87, 0.93));
  setO(app.tenHead, head);
  setT(app.tenHead, `translate3d(0, ${((1 - head) * 16).toFixed(1)}px, 0)`);
  const n = app.rows.length;
  const step = Math.min(0.012, 0.06 / Math.max(1, n - 3));
  app.rows.forEach((row, k) => {
    if (k < 3) return;
    const a = 0.87 + (k - 3) * step;
    const t = ease.out(seg(p, a, a + 0.05));
    setO(row, t);
    setT(row, `translate3d(0, ${((1 - t) * -14).toFixed(1)}px, 0)`);
  });
  setO(app.tenNote, seg(p, 0.95, 1));

  ui.caps.forEach((node, k) => {
    const [a, b] = CAPS[k].at;
    const t = Math.min(seg(raw, a, a + 0.05), 1 - seg(raw, b - 0.05, b));
    setO(node, ease.inOut(t));
    setT(node, `translate3d(0, ${((1 - t) * 12).toFixed(1)}px, 0)`);
  });
}

export default {
  length: 5,

  mount(layer, ctx) {
    const app = buildApp(ctx.data);
    const stage = el("div", { class: "ph-stage" });
    const backdrop = el("div", { class: "ph-backdrop" });
    backdrop.style.setProperty("--sky", app.root.style.getPropertyValue("--sky"));
    const device = el("div", { class: "ph-device" });
    device.style.cssText = `width:${DEV_W}px;height:${DEV_H}px;margin:${-DEV_H / 2}px 0 0 ${-DEV_W / 2}px`;
    const frame = el("div", { class: "ph-frame" }, '<i class="ph-btn ph-btn-a"></i><i class="ph-btn ph-btn-b"></i><i class="ph-btn ph-btn-c"></i><i class="ph-btn ph-btn-d"></i>');
    const screen = el("div", { class: "ph-screen" });
    screen.style.cssText = `width:${SCREEN_W}px;height:${SCREEN_H}px`;
    screen.append(app.root);
    const island = el("i", { class: "ph-island" });
    const glare = el("i", { class: "ph-glare" });
    const glareWrap = el("div", { class: "ph-glare-wrap" });
    glareWrap.append(glare);
    frame.append(screen, island, glareWrap);
    device.append(frame);
    const capWrap = el("div", { class: "st-caps" });
    const caps = CAPS.map((c) => el("p", { class: "st-cap" }, c.html));
    capWrap.append(...caps);
    stage.append(backdrop, device);
    layer.append(stage, capWrap);
    layer.classList.add("ph-layer");
    ui = { layer, app, device, screen, island, glare, backdrop, caps };
    const remeasure = () => { geo = null; render(lastP, ctx); };
    window.addEventListener("resize", remeasure);
    document.fonts?.ready.then(remeasure);
    render(0, ctx);
  },

  enter(dir, ctx) {
    geo = null;
    ctx.world.setVisible(true);
  },

  update(p, ctx) {
    lastP = p;
    render(p, ctx);
  },

  leave(dir, ctx) {
    if (dir < 0) {
      ctx.world.setDim(0);
      ctx.hud.show(true);
    }
  },
};
