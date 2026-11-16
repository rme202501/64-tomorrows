import { loadStory } from "./data.js";
import { clamp } from "./util.js";

/**
 * Chapter contract (js/chapters/<id>.js, default export):
 *   length       scroll length in viewport heights (default 3)
 *   interactive  true if the layer needs pointer events while active
 *   fade         false to manage layer opacity yourself (default: crossfade over ~0.4 viewport at each end)
 *   mount(layer, ctx)          build DOM once (called lazily before the chapter is reached)
 *   update(p, ctx)             scroll progress 0..1 inside the chapter, only while active
 *   enter(dir, ctx)            dir = 1 entering from above, -1 from below
 *   leave(dir, ctx)            dir = 1 leaving downward, -1 leaving upward
 */
export const CHAPTERS = [
  "hero", "phone", "grid64", "spread", "why", "wind", "lying", "pdfs", "plinko",
  "northeast", "care", "jacket", "party", "finale",
];

const FADE_VH = 0.45;
const SMOOTH_S = 0.12;

gsap.registerPlugin(ScrollTrigger);

const noop = () => {};
const stubWorld = new Proxy({ ready: Promise.resolve() }, {
  get: (t, k) => (k in t ? t[k] : noop),
});
const stubHud = new Proxy({}, { get: () => noop });

async function optionalImport(path) {
  try {
    return await import(path);
  } catch (err) {
    console.warn(`[story] ${path} not loaded:`, err.message);
    return null;
  }
}

function placeholder(id) {
  return {
    length: 2,
    mount(layer) {
      layer.innerHTML = `<div class="placeholder"><p class="t-kicker">chapter</p><h2 class="t-title">${id}</h2></div>`;
    },
  };
}

async function boot() {
  const mobileQuery = matchMedia("(max-width: 720px)");
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const bus = new EventTarget();

  const data = await loadStory();
  const veilEl = document.getElementById("world-veil");
  let veilOpacity = 0;
  let occludeTimer = 0;
  const ctx = {
    data,
    bus,
    gsap,
    get mobile() { return mobileQuery.matches; },
    get reduced() { return reducedQuery.matches; },
    world: stubWorld,
    hud: stubHud,
    veil(opacity) {
      const o = +opacity;
      if (o === veilOpacity) return;
      veilOpacity = o;
      veilEl.style.opacity = String(o);
      clearTimeout(occludeTimer);
      if (o >= 0.995) occludeTimer = setTimeout(() => ctx.world.setOccluded(true), 700);
      else ctx.world.setOccluded(false);
    },
    scrollToChapter(id) {
      const sec = document.getElementById(`ch-${id}`);
      if (sec) window.scrollTo({ top: sec.offsetTop, behavior: reducedQuery.matches ? "auto" : "smooth" });
    },
    active: null,
  };
  window.__story = ctx;

  const tag = document.getElementById("archive-tag");
  const made = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: data.meta.tz ?? "America/New_York" }).format(data.init);
  tag.textContent = `Archived forecast from ${made}. Not live.`;
  tag.hidden = false;

  const [worldMod, hudMod, ...chapterMods] = await Promise.all([
    optionalImport("./world/world.js"),
    optionalImport("./world/hud.js"),
    ...CHAPTERS.map((id) => optionalImport(`./chapters/${id}.js`)),
  ]);

  if (worldMod?.createWorld) {
    try {
      ctx.world = await worldMod.createWorld(document.getElementById("world"), ctx);
    } catch (err) {
      console.error("[story] world failed", err);
    }
  }
  if (hudMod?.createHud) ctx.hud = hudMod.createHud(document.getElementById("hud"), ctx);

  const story = document.getElementById("story");
  const layers = document.getElementById("layers");
  const nav = document.getElementById("progress");

  const chapters = CHAPTERS.map((id, k) => {
    const mod = chapterMods[k]?.default ?? placeholder(id);
    const section = document.createElement("section");
    section.className = "chapter";
    section.id = `ch-${id}`;
    section.dataset.chapter = id;
    story.append(section);
    const layer = document.createElement("div");
    layer.className = "layer";
    layer.dataset.layer = id;
    if (mod.interactive) layer.classList.add("is-interactive");
    layers.append(layer);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", id);
    dot.addEventListener("click", () => ctx.scrollToChapter(id));
    nav.append(dot);
    return { id, mod, section, layer, dot, mounted: false, active: false, progress: 0, target: 0, shown: 0, span: 1, opacity: "" };
  });

  const sizeSections = () => {
    for (const ch of chapters) ch.section.style.height = `${(ch.mod.length ?? 3) * 100}lvh`;
  };
  sizeSections();

  const mount = (ch) => {
    if (ch.mounted) return;
    ch.mounted = true;
    try {
      ch.mod.mount?.(ch.layer, ctx);
    } catch (err) {
      console.error(`[story] mount ${ch.id}`, err);
    }
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) mount(chapters.find((c) => c.section === e.target));
  }, { rootMargin: "150% 0px 150% 0px" });
  chapters.forEach((ch) => io.observe(ch.section));
  mount(chapters[0]);

  const applyFade = (ch) => {
    if (ch.mod.fade === false) return;
    const f = (FADE_VH * window.innerHeight) / Math.max(1, ch.span);
    const p = ch.shown;
    const fadeIn = ch === chapters[0] ? 1 : clamp(p / f);
    const fadeOut = ch === chapters[chapters.length - 1] ? 1 : clamp((1 - p) / f);
    const o = Math.min(fadeIn, fadeOut).toFixed(3);
    if (ch.opacity !== o) { ch.opacity = o; ch.layer.style.opacity = o; }
  };

  const render = (ch) => {
    applyFade(ch);
    try { ch.mod.update?.(ch.shown, ctx); } catch (err) { console.error(`[story] update ${ch.id}`, err); }
  };

  /*
   * Scroll input arrives in steps (mouse wheels jump ~100px a notch), so chapters are fed a progress value
   * that eases toward the real scroll position each frame instead of jumping with it.
   */
  let ticking = false;
  let lastT = 0;
  const tick = (now) => {
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    const k = 1 - Math.exp(-dt / SMOOTH_S);
    let moving = false;
    for (const ch of chapters) {
      if (!ch.active || ch.shown === ch.target) continue;
      const d = ch.target - ch.shown;
      ch.shown = ctx.reduced || Math.abs(d) < 2e-4 ? ch.target : ch.shown + d * k;
      if (ch.shown !== ch.target) moving = true;
      render(ch);
    }
    if (moving) requestAnimationFrame(tick);
    else { ticking = false; lastT = 0; }
  };
  const kick = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(tick);
  };

  chapters.forEach((ch, k) => {
    ScrollTrigger.create({
      trigger: ch.section,
      start: k === 0 ? -1 : "top top",
      end: k === chapters.length - 1 ? "bottom bottom" : "bottom bottom-=1",
      onRefresh(self) { ch.span = self.end - self.start; },
      onToggle(self) {
        if (k === chapters.length - 1 && !self.isActive && self.direction > 0) return;
        ch.active = self.isActive;
        ch.span = self.end - self.start;
        ch.target = self.progress;
        ch.shown = self.progress;
        ch.layer.classList.toggle("is-active", self.isActive);
        ch.dot.classList.toggle("is-active", self.isActive);
        if (self.isActive) {
          mount(ch);
          ctx.active = ch.id;
          chapters.forEach((c, j) => c.dot.classList.toggle("is-done", j < k));
          try { ch.mod.enter?.(self.direction, ctx); } catch (err) { console.error(err); }
          render(ch);
        } else {
          ch.opacity = "0";
          ch.layer.style.opacity = "0";
          try { ch.mod.leave?.(self.direction, ctx); } catch (err) { console.error(err); }
        }
      },
      onUpdate(self) {
        ch.progress = self.progress;
        ch.target = self.progress;
        if (ch.active) kick();
      },
    });
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { sizeSections(); ScrollTrigger.refresh(); }, 150);
  });

  await ctx.world.ready;
  ScrollTrigger.refresh();
  document.getElementById("loader").classList.add("is-done");
}

boot().catch((err) => {
  console.error(err);
  const p = document.querySelector("#loader p");
  if (p) p.textContent = "Could not load the forecast data.";
});
