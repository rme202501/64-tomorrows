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
  "hero", "phone", "grid64", "spread", "wind", "lying", "pdfs", "plinko",
  "northeast", "care", "jacket", "party", "finale",
];

const FADE_VH = 0.45;

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
  const ctx = {
    data,
    bus,
    gsap,
    get mobile() { return mobileQuery.matches; },
    get reduced() { return reducedQuery.matches; },
    world: stubWorld,
    hud: stubHud,
    veil(opacity) { document.getElementById("world-veil").style.opacity = String(opacity); },
    scrollToChapter(id) {
      const sec = document.getElementById(`ch-${id}`);
      if (sec) window.scrollTo({ top: sec.offsetTop, behavior: reducedQuery.matches ? "auto" : "smooth" });
    },
    active: null,
  };
  window.__story = ctx;

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
    return { id, mod, section, layer, dot, mounted: false, active: false, progress: 0 };
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

  const applyFade = (ch, self) => {
    if (ch.mod.fade === false) return;
    const vh = window.innerHeight;
    const span = Math.max(1, self.end - self.start);
    const f = (FADE_VH * vh) / span;
    const p = self.progress;
    const fadeIn = ch === chapters[0] ? 1 : clamp(p / f);
    const fadeOut = ch === chapters[chapters.length - 1] ? 1 : clamp((1 - p) / f);
    ch.layer.style.opacity = String(Math.min(fadeIn, fadeOut));
  };

  chapters.forEach((ch, k) => {
    ScrollTrigger.create({
      trigger: ch.section,
      start: k === 0 ? -1 : "top top",
      end: k === chapters.length - 1 ? "bottom bottom" : "bottom bottom-=1",
      onToggle(self) {
        if (k === chapters.length - 1 && !self.isActive && self.direction > 0) return;
        ch.active = self.isActive;
        ch.layer.classList.toggle("is-active", self.isActive);
        ch.dot.classList.toggle("is-active", self.isActive);
        if (self.isActive) {
          mount(ch);
          ctx.active = ch.id;
          chapters.forEach((c, j) => c.dot.classList.toggle("is-done", j < k));
          try { ch.mod.enter?.(self.direction, ctx); } catch (err) { console.error(err); }
          try { ch.mod.update?.(self.progress, ctx); } catch (err) { console.error(err); }
        } else {
          ch.layer.style.opacity = "0";
          try { ch.mod.leave?.(self.direction, ctx); } catch (err) { console.error(err); }
        }
        applyFade(ch, self);
      },
      onUpdate(self) {
        ch.progress = self.progress;
        if (!ch.active) return;
        applyFade(ch, self);
        try { ch.mod.update?.(self.progress, ctx); } catch (err) { console.error(`[story] update ${ch.id}`, err); }
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
