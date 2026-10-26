import { manifest } from "./data.js";

const VIEWS = {
  fanHook: () => import("./views/fanHook.js"),
  tempSpread: () => import("./views/tempSpread.js"),
  feelsMap: () => import("./views/feelsMap.js"),
  cloudMap: () => import("./views/cloudMap.js"),
  freezeTimeline: () => import("./views/freezeTimeline.js"),
  rangeGrowth: () => import("./views/rangeGrowth.js"),
  fogMap: () => import("./views/fogMap.js"),
  horizonMap: () => import("./views/horizonMap.js"),
  roulette: () => import("./views/roulette.js"),
  windFlow: () => import("./views/windFlow.js"),
  timeMachine: () => import("./views/timeMachine.js"),
  stormCone: () => import("./views/stormCone.js"),
  routePlanner: () => import("./views/routePlanner.js"),
};

function setupTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("theme");
    if (saved) root.dataset.theme = saved;
  } catch { /* storage unavailable */ }
  document.querySelector(".theme-toggle").addEventListener("click", () => {
    const dark = root.dataset.theme === "dark"
      || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage unavailable */ }
    document.dispatchEvent(new Event("themechange"));
  });
}

async function runInfo() {
  const m = await manifest();
  document.getElementById("run-info").textContent =
    `Forecast run: ${d3.timeFormat("%A %B %-d, %-I %p")(m.init)} (local time) · New England, 7 days ahead`;
}

function lazyInit() {
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e) => {
      io.unobserve(e.target);
      const name = e.target.dataset.view;
      e.target.classList.add("loading");
      VIEWS[name]()
        .then((mod) => mod.default(e.target))
        .catch((err) => {
          console.error(name, err);
          e.target.insertAdjacentHTML("beforeend", `<p class="error">This view failed to load.</p>`);
        })
        .finally(() => e.target.classList.remove("loading"));
    });
  }, { rootMargin: "400px 0px" });
  document.querySelectorAll("section.view").forEach((s) => io.observe(s));
}

setupTheme();
runInfo();
lazyInit();
