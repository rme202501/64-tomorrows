import { skyState } from "../world/astro.js";
import { lerp, seg, ease } from "../util.js";
import { targetDay, setStyle, flag } from "../decide/common.js";

const LINES = [
  { html: "Further out, expect <em>more uncertainty.</em>", at: 0.1 },
  { html: "Short term, you'll be <em>okay.</em>", at: 0.26 },
  { html: "When a plan depends on the weather, look at the spread.", at: 0.42 },
  { html: "Most of the time, you don't <em>really</em> care.", at: 0.54, cls: "is-coda" },
];
const P_CREDITS = 0.68;

const fmtRun = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", hourCycle: "h23",
});

function goldenHour(data) {
  const out = { sun: { set() {} }, moon: { set() {} } };
  const noon = +data.timeAt(data.leadForDay(1, 12));
  for (let m = 0; m <= 8 * 60; m += 5) {
    const ms = noon + m * 60e3;
    skyState(ms, out);
    if (out.sunAlt <= 6) return new Date(ms);
  }
  return new Date(noon + 5 * 3600e3);
}

export default {
  length: 4,
  interactive: true,

  mount(layer, ctx) {
    const { data } = ctx;
    const N = targetDay(data);
    this.time = goldenHour(data);
    this.farMembers = data.membersAt("t2m", data.leadForDay(N, 15));
    this.nearMembers = data.membersAt("t2m", data.leadForDay(1, 15));
    this.members = this.farMembers.slice();
    const lat = data.meta.grid_lat ?? data.meta.lat;
    const lon = data.meta.grid_lon ?? data.meta.lon;
    const run = `${fmtRun.format(data.init).replace(/, (\d+)$/, " $1")}Z`;

    layer.classList.add("fn");
    layer.innerHTML = `
      <div class="fn-shade"></div>
      <div class="fn-inner">
        <div class="fn-lines">
          ${LINES.map((l) => `<p class="fn-line ${l.cls ?? ""}">${l.html.split(" ").map((w) => `<span class="fn-w">${w}</span>`).join(" ")}</p>`).join("")}
        </div>
        <footer class="fn-credits">
          <p class="fn-data"><b>Data</b> Google WeatherNext 3 ensemble statistics, run ${data.meta.run} (${run}), Harvard Yard grid point (${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°W). Members reconstructed from stored quantiles (p10-p90).</p>
          <p class="fn-team"><b>Team</b> Henry Mattoni, Ryan Eto, Luke Tan. CS1710.</p>
          <nav class="fn-links">
            <a class="btn is-primary" href="../">Explore the classic site</a>
            <a class="btn" href="../dashboards/uncertainty/">Uncertainty dashboards</a>
            <button type="button" class="btn fn-top">Back to the top</button>
          </nav>
        </footer>
      </div>`;
    this.lines = [...layer.querySelectorAll(".fn-line")].map((node, i) => ({ node, words: [...node.querySelectorAll(".fn-w")], at: LINES[i].at }));
    this.credits = layer.querySelector(".fn-credits");
    this.layer = layer;
    const pinEnd = () => {
      const section = document.getElementById("ch-finale");
      if (section && scrollY < section.offsetTop - 2 && layer.classList.contains("is-active")) {
        layer.classList.remove("is-active");
        layer.style.opacity = "0";
        return;
      }
      const atEnd = scrollY >= document.documentElement.scrollHeight - innerHeight - 2;
      if (!atEnd || layer.classList.contains("is-active")) return;
      layer.classList.add("is-active");
      layer.style.opacity = "1";
      this.enter(1, ctx);
      this.update(1, ctx);
    };
    addEventListener("scroll", () => requestAnimationFrame(pinEnd), { passive: true });
    requestAnimationFrame(pinEnd);
    layer.querySelector(".fn-top").addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: ctx.reduced ? "auto" : "smooth" });
    });
  },

  enter(dir, ctx) {
    const { world } = ctx;
    world.setVisible(true);
    world.setCamera("hero");
    world.setTime(this.time);
    world.setWeather({ cloud: 25, rain: 0, wind: 6 });
    world.setDim(0.35);
    ctx.hud.show(false);
  },

  leave(dir, ctx) {
    if (dir > 0) {
      this.layer.classList.add("is-active");
      return;
    }
    ctx.world.setUncertainty(0);
  },

  update(p, ctx) {
    ctx.veil(1 - ease.out(seg(p, 0, 0.12)));
    const u = 1 - ease.inOut(seg(p, 0.06, 0.6));
    for (let k = 0; k < 64; k++) this.members[k] = lerp(this.nearMembers[k], this.farMembers[k], u);
    ctx.world.setUncertainty(u * 0.95 + 0.05 * (1 - seg(p, 0.6, 0.8)), { members: this.members });

    const reduced = ctx.reduced;
    this.lines.forEach((line, li) => {
      line.words.forEach((w, i) => {
        const t = reduced ? (p >= line.at ? 1 : 0) : ease.out(seg(p, line.at + i * 0.012, line.at + 0.1 + i * 0.012));
        setStyle(w, "opacity", t.toFixed(3));
        setStyle(w, "transform", `translate3d(0, ${((1 - t) * 0.5).toFixed(3)}em, 0)`);
        setStyle(w, "filter", `blur(${((1 - t) * 10).toFixed(1)}px)`);
      });
      const dim = li < 2 ? 1 - 0.4 * seg(p, LINES[2].at, LINES[2].at + 0.08) : 1;
      setStyle(line.node, "--dim", dim.toFixed(3));
    });
    const c = reduced ? (p >= P_CREDITS ? 1 : 0) : ease.out(seg(p, P_CREDITS, P_CREDITS + 0.14));
    setStyle(this.credits, "opacity", c.toFixed(3));
    setStyle(this.credits, "transform", `translateY(${((1 - c) * 24).toFixed(1)}px)`);
    flag(this.credits, "is-live", c > 0.5);
  },
};
