import {
  el, glyph, tempColor, fmtF, fmtHour, fmtClock, fmtDow, CONDITION_LABEL, condition,
} from "../util.js";
import { skyGradient, nowState, feelsLike, compass, median, rainChance } from "./kit.js";

export const SCREEN_W = 393;
export const SCREEN_H = 852;

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });

/** days for the 10-day list: today plus every complete day after it, up to 10 */
export function forecastDays(data) {
  const days = data.daily.filter((d, k) => k === 0 || d.complete).slice(0, 10);
  return days.map((d, k) => {
    const rain = median(d.precip_total);
    const wet = d.precip_total.filter((v) => v >= 1).length / d.precip_total.length;
    return {
      label: k === 0 ? "Today" : d.dow,
      hi: d.high_p50,
      lo: d.low_p50,
      cond: condition(d.cloud_mean, rain / 8, 12),
      wet,
    };
  });
}

function dayRow(day, lo, hi, nowT) {
  const span = Math.max(1, hi - lo);
  const a = (day.lo - lo) / span;
  const b = (day.hi - lo) / span;
  const dot = nowT == null ? "" : `<i class="wx-bar-dot" style="left:${(((nowT - lo) / span) * 100).toFixed(2)}%"></i>`;
  const wet = day.wet >= 0.2 ? `<span class="wx-wet">${Math.round(day.wet * 10) * 10}%</span>` : "";
  return el("div", { class: "wx-row" }, `
    <span class="wx-row-day">${day.label}</span>
    <span class="wx-row-glyph">${glyph(day.cond, 26)}${wet}</span>
    <span class="wx-row-lo t-num">${fmtF(day.lo)}</span>
    <span class="wx-bar"><i class="wx-bar-fill" style="left:${(a * 100).toFixed(2)}%;right:${((1 - b) * 100).toFixed(2)}%;background:linear-gradient(90deg, ${tempColor(day.lo)}, ${tempColor(day.hi)})"></i>${dot}</span>
    <span class="wx-row-hi t-num">${fmtF(day.hi)}</span>`);
}

const ICON_CAL = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_WIND = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 6h8.5a2.2 2.2 0 1 0-2.2-2.2M1.5 10h11a2.2 2.2 0 1 1-2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_DROP = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5C5.5 5 3.8 7.4 3.8 9.8a4.2 4.2 0 0 0 8.4 0C12.2 7.4 10.5 5 8 1.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const ICON_TEMP = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.8a1.5 1.5 0 0 1 3 0v6.4a3 3 0 1 1-3 0z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const STATUS_ICONS = `<span class="wx-status-icons" aria-hidden="true">
  <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.2c2.4 0 4.6.9 6.2 2.4l1.3-1.4A10.9 10.9 0 0 0 8 .3 10.9 10.9 0 0 0 .5 3.2l1.3 1.4A9 9 0 0 1 8 2.2zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.3-1.4A7.3 7.3 0 0 0 8 3.9a7.3 7.3 0 0 0-5 1.9l1.3 1.4c1-.9 2.3-1.4 3.7-1.4zM8 9.4c-.6 0-1.2.2-1.6.6L8 11.7 9.6 10c-.4-.4-1-.6-1.6-.6z" fill="currentColor"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4a2 2 0 0 0 0-4z" fill="currentColor" fill-opacity=".45"/></svg>
</span>`;

function summary(states) {
  const first = states[0];
  const change = states.find((s) => s.cond !== first.cond && CONDITION_LABEL[s.cond] !== CONDITION_LABEL[first.cond]);
  const now = CONDITION_LABEL[first.cond];
  if (!change) return `${now} for the rest of the day.`;
  return `${now} now. ${CONDITION_LABEL[change.cond]} around ${fmtHour(change.date)}.`;
}

/** builds the weather app screen (lock screen, now view, 10-day view) at SCREEN_W x SCREEN_H design pixels */
export function buildApp(data) {
  const lead0 = data.leads[0];
  const now = nowState(data, lead0);
  const days = forecastDays(data);
  const lo = Math.min(...days.map((d) => d.lo));
  const hi = Math.max(...days.map((d) => d.hi));
  const dew = data.at(data.series.d2m.p50 ?? data.series.d2m.mean, lead0);
  const feels = feelsLike(now.t, now.wind, dew);
  const dir = compass(data.at(data.series.u10.mean, lead0), data.at(data.series.v10.mean, lead0));
  const chance = rainChance(data, lead0, 12);
  const today = days[0];

  const hours = [];
  for (let k = 0; k < 24; k++) {
    const lead = Math.min(data.maxLead, lead0 + k);
    hours.push({ ...nowState(data, lead), wet: rainChance(data, lead, 0) });
  }

  const root = el("div", { class: "wx" });
  root.style.setProperty("--sky", skyGradient(now.cond, now.hour));

  const sky = el("div", { class: "wx-sky" });
  const lock = el("div", { class: "wx-lock" }, `
    <p class="wx-lock-date">${dayFmt.format(now.date)}</p>
    <p class="wx-lock-time t-num">${fmtClock(now.date).replace(/\s?[AP]M$/, "")}</p>
    <div class="wx-lock-widget">${glyph(now.cond, 22)}<span class="t-num">${fmtF(now.t)}</span><span>Harvard Yard</span></div>`);
  const status = el("div", { class: "wx-status" }, `<span class="wx-status-time t-num">${fmtClock(now.date).replace(/\s?[AP]M$/, "")}</span>${STATUS_ICONS}`);

  const head = el("header", { class: "wx-head" }, `
    <p class="wx-place">Harvard Yard</p>
    <p class="wx-sub">Cambridge, MA</p>
    <p class="wx-temp t-num">${Math.round(now.t)}<span>°</span></p>
    <p class="wx-cond"><span class="wx-cond-glyph">${glyph(now.cond, 22)}</span>${CONDITION_LABEL[now.cond]}</p>
    <p class="wx-hl t-num">H:${fmtF(today.hi)}&nbsp;&nbsp;L:${fmtF(today.lo)}</p>`);

  const strip = el("div", { class: "wx-strip-track" });
  hours.forEach((h, k) => {
    const wet = h.wet >= 0.2 ? `<span class="wx-wet">${Math.round(h.wet * 10) * 10}%</span>` : "";
    strip.append(el("div", { class: "wx-hour" }, `
      <span class="wx-hour-time">${k === 0 ? "Now" : fmtHour(h.date).replace(" ", "")}</span>
      <span class="wx-hour-glyph">${glyph(h.cond, 26)}${wet}</span>
      <span class="wx-hour-temp t-num">${fmtF(h.t)}</span>`));
  });
  const hourly = el("section", { class: "wx-card wx-hourly" }, `<p class="wx-card-line">${summary(hours)}</p>`);
  const stripView = el("div", { class: "wx-strip" });
  stripView.append(strip);
  hourly.append(stripView);

  const feelsNote = Math.round(feels) < Math.round(now.t) ? "Wind makes it feel colder." : Math.round(feels) > Math.round(now.t) ? "Humidity makes it feel warmer." : "Same as the actual temperature.";
  const small = el("div", { class: "wx-smalls" }, `
    <section class="wx-card wx-small">
      <p class="wx-card-title">${ICON_WIND}Wind</p>
      <p class="wx-small-val t-num">${Math.round(now.wind)}<small>mph</small></p>
      <p class="wx-small-note"><i class="wx-arrow" style="transform:rotate(${Math.round(dir.deg + 180)}deg)"></i>From ${dir.name}</p>
    </section>
    <section class="wx-card wx-small">
      <p class="wx-card-title">${ICON_DROP}Rain</p>
      <p class="wx-small-val t-num">${Math.round(chance * 100)}<small>%</small></p>
      <p class="wx-small-note">Next 12 hours</p>
    </section>
    <section class="wx-card wx-small">
      <p class="wx-card-title">${ICON_TEMP}Feels like</p>
      <p class="wx-small-val t-num">${fmtF(feels)}</p>
      <p class="wx-small-note">${feelsNote}</p>
    </section>`);

  const tenTitle = `<p class="wx-card-title">${ICON_CAL}${days.length}-day forecast</p>`;
  const tenCard = el("section", { class: "wx-card wx-ten" }, tenTitle);
  days.slice(0, 3).forEach((d, k) => tenCard.append(dayRow(d, lo, hi, k === 0 ? now.t : null)));
  const ripple = el("i", { class: "wx-ripple" });
  tenCard.append(ripple);

  const nowView = el("div", { class: "wx-now" });
  nowView.append(head, hourly, small, tenCard);

  const tenBg = el("div", { class: "wx-tenbg" });
  const tenView = el("div", { class: "wx-tenview" });
  const tenHead = el("header", { class: "wx-tenhead" }, `
    <p class="wx-place">Harvard Yard</p>
    <p class="wx-tenhead-now t-num">${fmtF(now.t)} <span>|</span> ${CONDITION_LABEL[now.cond]}</p>`);
  const tenList = el("section", { class: "wx-card wx-tenlist" }, tenTitle);
  const rows = days.map((d, k) => {
    const r = dayRow(d, lo, hi, k === 0 ? now.t : null);
    tenList.append(r);
    return r;
  });
  const tenNote = el("p", { class: "wx-tennote" }, `${fmtDow(now.date)} ${fmtHour(now.date)} forecast, one number per day`);
  tenView.append(tenHead, tenList, tenNote);

  const finger = el("i", { class: "wx-finger" });
  root.append(sky, lock, nowView, tenBg, tenView, status, finger);

  return {
    root,
    now,
    days,
    lock,
    status,
    stagger: [head.children[0], head.children[1], head.children[2], head.children[3], head.children[4], hourly, small, tenCard],
    strip,
    nowView,
    tenView,
    tenBg,
    tenCard,
    tenHead,
    tenList,
    tenNote,
    rows,
    ripple,
    finger,
    hourWidth: 56,
  };
}
