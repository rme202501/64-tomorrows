import { glyph, condition, CONDITION_LABEL, fmtLongDow, fmtDate, rng } from "../util.js";
import { targetDay, dailyFor, numWord, median, tweenNumber, flag } from "../decide/common.js";
import { buildParty } from "../decide/partyScene.js";

const HOUR = 15;
const WINDOW = [12, 18];
const STORM_RATE = 2;
const STORM_DAY = 12;
const RAIN_RATE = 0.2;
const DRIZZLE_RATE = 0.02;
const DRIZZLE_DAY = 1;
const GUSTY = 20;
const AUTO_ROLLS = [0.3, 0.46, 0.6];
const P_TRUTH = 0.7;
const P_LINE = 0.8;
const MIN_ROLLS_FOR_TRUTH = 3;

const CATS = [
  { id: "dry", label: "Dry", icon: "partly", color: "#ffc94a" },
  { id: "drizzle", label: "Drizzle", icon: "drizzle", color: "#a9b4c4" },
  { id: "rain", label: "Rain", icon: "rain", color: "#6fc3ff" },
  { id: "storm", label: "Storm", icon: "storm", color: "#c78bff" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));

const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
const pipsSvg = (n) => PIPS[n].map(([x, y]) => `<circle cx="${14 + x * 18}" cy="${14 + y * 18}" r="5.2"/>`).join("");

function classify({ peak, total, wind }) {
  if (peak >= STORM_RATE || (total >= STORM_DAY && peak >= 0.5) || (peak >= 0.5 && wind >= GUSTY)) return "storm";
  if (peak >= RAIN_RATE) return "rain";
  if (peak >= DRIZZLE_RATE || total >= DRIZZLE_DAY) return "drizzle";
  return "dry";
}

export default {
  length: 5.5,
  interactive: true,

  mount(layer, ctx) {
    const { data } = ctx;
    const N = targetDay(data);
    this.N = N;
    this.ctx = ctx;
    const day = dailyFor(data, N);
    const lead = data.leadForDay(N, HOUR);
    const hours = [];
    for (let h = WINDOW[0]; h <= WINDOW[1]; h++) hours.push(data.leadForDay(N, h));
    const precipAt = hours.map((l) => data.membersAt("precip", l));
    const temps = data.membersAt("t2m", lead);
    const winds = data.membersAt("wind", lead);
    this.members = temps.map((t, k) => {
      const m = {
        k,
        temp: t,
        wind: winds[k],
        peak: Math.max(...precipAt.map((row) => row[k])),
        total: day.precip_total[k],
      };
      m.cat = classify(m);
      return m;
    });
    this.truth = Object.fromEntries(CATS.map((c) => [c.id, this.members.filter((m) => m.cat === c.id).length]));

    const claimCond = condition(day.cloud_mean, median(day.precip_total) / 24, 13);
    const when = data.timeAt(lead);
    this.claim = { cond: claimCond, high: day.high_p50 ?? median(day.high) };
    this.rand = rng(Date.now() & 0xffff);

    layer.classList.add("pt-layer");
    layer.innerHTML = `
      <div class="pt-scene"></div>
      <div class="pt-top">
        <p class="t-kicker">${fmtLongDow(when)}, ${fmtDate(when)} · 3 PM</p>
        <div class="pt-titles">
          <h2 class="t-title pt-title">A party on the lawn, ${N === 1 ? "tomorrow" : `${numWord(N)} days from now`}.</h2>
          <h2 class="t-title pt-moral">It's much harder to <em>move a party.</em></h2>
        </div>
        <div class="pt-claim glass">
          ${glyph(claimCond, 30)}
          <div><b>${CONDITION_LABEL[claimCond]}, ${Math.round(this.claim.high)}°</b><span>Your weather app</span></div>
        </div>
      </div>
      <div class="pt-panel glass">
        <div class="pt-row">
          <button type="button" class="pt-die" aria-label="Roll the weather">
            <svg class="pt-die-face" viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="2" width="60" height="60" rx="14"/><g class="pt-pips">${pipsSvg(5)}</g></svg>
          </button>
          <div class="pt-result" aria-live="polite">
            <p class="pt-res-kicker">Roll the weather</p>
            <p class="pt-res-main">Each roll is one of the 64 forecasts.</p>
          </div>
        </div>
        <div class="pt-tally">
          <div class="pt-chips"></div>
          <p class="pt-count"><b class="t-num">0</b> rolls</p>
        </div>
        <div class="pt-truth">
          <div class="pt-bar">${this.members.slice().sort((a, b) => CATS.findIndex((c) => c.id === a.cat) - CATS.findIndex((c) => c.id === b.cat))
    .map((m) => `<i style="--c:${CAT[m.cat].color}"></i>`).join("")}</div>
          <p class="pt-truth-l">${CATS.filter((c) => this.truth[c.id]).map((c) => `<span style="--c:${c.color}"><b>${this.truth[c.id]}</b> ${c.label.toLowerCase()}</span>`).join("")}<em>of all 64</em></p>
        </div>
      </div>`;

    this.layer = layer;
    this.scene = buildParty(layer.querySelector(".pt-scene"));
    this.scene.set("claim", { wind: median(winds) });
    this.die = layer.querySelector(".pt-die");
    this.dieFace = layer.querySelector(".pt-die-face");
    this.pips = layer.querySelector(".pt-pips");
    this.resKicker = layer.querySelector(".pt-res-kicker");
    this.resMain = layer.querySelector(".pt-res-main");
    this.chips = layer.querySelector(".pt-chips");
    this.countEl = layer.querySelector(".pt-count b");
    this.rolls = [];
    this.userRolled = false;
    this.autoFired = new Set();
    this.rolling = false;
    this.die.addEventListener("click", () => { this.userRolled = true; this.roll(); });
  },

  roll() {
    if (this.rolling) return;
    this.rolling = true;
    const m = this.members[Math.floor(this.rand() * 64)];
    const reduced = this.ctx.reduced;
    const face = (m.k % 6) + 1;
    flag(this.layer, "is-rolling", true);
    const finish = () => {
      this.pips.innerHTML = pipsSvg(face);
      this.rolling = false;
      flag(this.layer, "is-rolling", false);
      this.land(m);
    };
    if (reduced) { finish(); return; }
    let last = 0;
    const tl = gsap.timeline({ onComplete: finish });
    tl.to(this.dieFace, {
      keyframes: [
        { y: -46, rotation: 200, scale: 1.08, duration: 0.32, ease: "power2.out" },
        { y: 0, rotation: 400, scale: 1, duration: 0.3, ease: "bounce.out" },
        { y: -14, rotation: 520, duration: 0.16, ease: "power1.out" },
        { y: 0, rotation: 720, duration: 0.2, ease: "power2.in" },
      ],
      onUpdate: () => {
        const t = tl.time();
        if (t - last > 0.08) { last = t; this.pips.innerHTML = pipsSvg(1 + Math.floor(Math.random() * 6)); }
      },
    });
    tl.set(this.dieFace, { rotation: 0 });
  },

  land(m) {
    this.rolls.push(m);
    const c = CAT[m.cat];
    this.scene.set(m.cat, { wind: m.wind });
    this.resKicker.textContent = `Tomorrow #${m.k + 1}`;
    const rain = m.peak < 0.05 ? "dry" : `${m.peak.toFixed(1)} mm/h`;
    this.resMain.innerHTML = `<b style="color:${c.color}">${c.label}</b> <span>${Math.round(m.temp)}° · ${rain} · ${Math.round(m.wind)} mph</span>`;
    this.resMain.classList.remove("is-in");
    void this.resMain.offsetWidth;
    this.resMain.classList.add("is-in");
    const chip = document.createElement("span");
    chip.className = "pt-chip";
    chip.style.setProperty("--c", c.color);
    chip.innerHTML = glyph(c.icon, 20);
    chip.title = c.label;
    this.chips.append(chip);
    const max = this.ctx.mobile ? 9 : 14;
    while (this.chips.children.length > max) this.chips.firstElementChild.remove();
    tweenNumber(this.countEl, this.rolls.length, { duration: 0.4 });
    const tally = CATS.map((x) => [x, this.rolls.filter((r) => r.cat === x.id).length]).filter(([, n]) => n);
    this.layer.querySelector(".pt-count").innerHTML = `<b class="t-num">${this.rolls.length}</b> ${this.rolls.length === 1 ? "roll" : "rolls"}: ${tally.map(([x, n]) => `<span style="color:${x.color}">${n} ${x.label.toLowerCase()}</span>`).join(", ")}`;
    this.countEl = this.layer.querySelector(".pt-count b");
    flag(this.layer, "has-rolls", true);
    this.updateTruth();
  },

  updateTruth() {
    flag(this.layer, "show-truth", this.rolls.length >= MIN_ROLLS_FOR_TRUTH || this.p >= P_TRUTH);
  },

  enter(dir, ctx) {
    ctx.hud.show(false);
    ctx.veil(1);
    ctx.world.setVisible(false);
    this.scene.start(ctx.reduced);
  },

  leave(dir, ctx) {
    this.scene.stop();
    if (dir > 0) ctx.world.setVisible(true);
  },

  update(p, ctx) {
    this.p = p;
    ctx.veil(1);
    ctx.world.setVisible(false);
    if (!this.userRolled) {
      for (const t of AUTO_ROLLS) {
        if (p >= t && !this.autoFired.has(t) && !this.rolling) {
          this.autoFired.add(t);
          this.roll();
          break;
        }
      }
    }
    this.updateTruth();
    flag(this.layer, "is-moral", p >= P_LINE);
  },
};
