import { lerp, seg, ease, smoothstep, fmtLongDow, fmtDate, fmtHour, loop } from "../util.js";
import { WindScene } from "../spread/windscene.js";

const HOUR = 14;
const KINDS = [
  { key: "p10", name: "Calm end", sub: "1 in 10 forecasts is calmer", cls: "is-calm" },
  { key: "p50", name: "Typical", sub: "the middle forecast", cls: "is-mid" },
  { key: "p90", name: "Windy end", sub: "1 in 10 forecasts is windier", cls: "is-windy" },
];

let st = null;

function pickDays(data) {
  const out = [];
  let prev = -Infinity;
  for (let d = 0; d < 40; d++) {
    const lead = data.leadForDay(d, HOUR);
    if (lead <= prev + 12) break;
    prev = lead;
    if (lead < data.leads[0] + 1) continue;
    const s = data.statsAt("wind", lead);
    out.push({ d, lead, date: data.timeAt(lead), p10: s.p10, p50: s.p50, p90: s.p90 });
  }
  return out;
}

const dayName = (d) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days out`);

function mount(layer, ctx) {
  const days = pickDays(ctx.data);
  layer.classList.add("wd");
  layer.innerHTML = `
    <header class="wd-head">
      <div class="wd-when">
        <p class="wd-day"></p>
        <p class="wd-date t-mono"></p>
      </div>
      <div class="wd-meta">
        <p class="wd-cap t-caption">Same afternoon. Three plausible winds.</p>
        <div class="wd-pips" aria-hidden="true">${days.map(() => "<i></i>").join("")}<b class="wd-pip-fill"></b></div>
      </div>
    </header>
    <div class="wd-panels">
      ${KINDS.map((k) => `
        <figure class="wd-panel ${k.cls}">
          <canvas></canvas>
          <figcaption>
            <span class="wd-name">${k.name}</span>
            <span class="wd-mph t-num"><span class="wd-v">0</span><small>mph</small></span>
            <span class="wd-sub">${k.sub}</span>
          </figcaption>
        </figure>`).join("")}
    </div>
  `;
  const panels = [...layer.querySelectorAll(".wd-panel")];
  st = {
    layer,
    days,
    panels,
    head: layer.querySelector(".wd-head"),
    when: layer.querySelector(".wd-when"),
    day: layer.querySelector(".wd-day"),
    date: layer.querySelector(".wd-date"),
    pips: [...layer.querySelectorAll(".wd-pips i")],
    pipFill: layer.querySelector(".wd-pip-fill"),
    vals: panels.map((p) => p.querySelector(".wd-v")),
    scenes: panels.map((p, i) => new WindScene(p.querySelector("canvas"), i + 1, { reduced: ctx.reduced })),
    stop: null,
    shownDay: -1,
    lastP: 0,
  };
  const ro = new ResizeObserver(() => {
    st.scenes.forEach((s) => s.resize(ctx.mobile));
    st.scenes.forEach((s) => s.draw());
  });
  panels.forEach((p) => ro.observe(p));
}

function windAt(p) {
  const { days } = st;
  const n = days.length;
  const u = seg(p, 0.12, 0.9) * (n - 1);
  const i = Math.min(n - 2, Math.floor(u));
  const f = smoothstep(0.3, 0.7, u - i);
  const a = days[Math.max(0, i)];
  const b = days[Math.min(n - 1, i + 1)];
  return {
    vals: KINDS.map((k) => lerp(a[k.key], b[k.key], f)),
    day: f < 0.5 ? a : b,
    frac: (i + f) / Math.max(1, n - 1),
  };
}

function update(p, ctx) {
  if (!st || st.days.length < 2) return;
  st.lastP = p;
  const covered = p > 0.16 && p < 0.84;
  ctx.world.setVisible(!covered);
  ctx.hud.show(!covered);

  const w = windAt(p);
  w.vals.forEach((v, i) => {
    st.scenes[i].setWind(v);
    st.vals[i].textContent = Math.round(v);
  });

  if (w.day.d !== st.shownDay) {
    st.shownDay = w.day.d;
    st.day.textContent = dayName(w.day.d);
    if (!ctx.reduced) {
      st.when.animate([{ opacity: 0, transform: "translateY(10px)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "none" }],
        { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    st.date.textContent = `${fmtLongDow(w.day.date)}, ${fmtDate(w.day.date)} · ${fmtHour(w.day.date)}`;
    st.pips.forEach((el, k) => el.classList.toggle("is-on", k <= st.days.indexOf(w.day)));
  }
  st.pipFill.style.transform = `scaleX(${w.frac})`;

  const hIn = ease.out(seg(p, 0.02, 0.1));
  st.head.style.opacity = hIn;
  st.head.style.transform = `translate3d(0,${(1 - hIn) * -16}px,0)`;
  st.panels.forEach((el, i) => {
    const t = ease.out(seg(p, 0.03 + i * 0.025, 0.12 + i * 0.025));
    el.style.opacity = t;
    el.style.transform = `translate3d(0,${(1 - t) * 48}px,0) scale(${lerp(0.97, 1, t)})`;
  });

  if (ctx.reduced) st.scenes.forEach((s) => { s.step(1); s.draw(); });
}

export default {
  length: 4,
  mount,
  update,
  enter(dir, ctx) {
    if (!st) return;
    const w = windAt(dir > 0 ? 0 : 1);
    st.scenes.forEach((s, i) => {
      if (!s.W) s.resize(ctx.mobile);
      s.setWind(w.vals[i], true);
    });
    st.stop?.();
    if (ctx.reduced) {
      st.scenes.forEach((s) => s.draw());
      return;
    }
    st.stop = loop((dt) => {
      for (const s of st.scenes) {
        s.step(dt);
        s.draw();
      }
    });
  },
  leave(dir, ctx) {
    st?.stop?.();
    if (st) st.stop = null;
    ctx.world.setVisible(true);
    ctx.hud.show(true);
  },
};
