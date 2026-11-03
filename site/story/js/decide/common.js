import { clamp } from "../util.js";

export const SVGNS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

/** furthest complete local day in the run, capped at 14 */
export function targetDay(data) {
  let n = 1;
  for (const d of data.daily) if (d.complete && d.lead_days > n) n = d.lead_days;
  return Math.min(14, n);
}

export function dailyFor(data, days) {
  return data.daily.find((d) => d.lead_days === days) ?? data.daily[data.daily.length - 1];
}

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
export const numWord = (n) => NUM_WORDS[n] ?? String(n);

export const daysPhrase = (n) => (n === 0 ? "this morning" : n === 1 ? "tomorrow" : `${n} days from now`);

/** median of numbers */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Classic beeswarm: dots sorted by x, each placed at the smallest |y| offset that does not collide.
 * Returns positions indexed by rank (ascending value).
 */
export function beeswarm(xs, r) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const placed = [];
  const out = new Array(xs.length);
  const d2 = (2 * r) ** 2;
  order.forEach(([x], rank) => {
    const near = placed.filter((p) => Math.abs(p.x - x) < 2 * r);
    let y = 0;
    const offsets = [0];
    for (const p of near) {
      const dy = Math.sqrt(Math.max(0, d2 - (p.x - x) ** 2));
      offsets.push(p.y + dy + 0.01, p.y - dy - 0.01);
    }
    offsets.sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const o of offsets) {
      if (near.every((p) => (p.x - x) ** 2 + (p.y - o) ** 2 >= d2 - 0.5)) { y = o; break; }
    }
    placed.push({ x, y });
    out[rank] = { x, y, v: x };
  });
  return out;
}

/** animate a number inside a node toward a target, cancelling any previous tween */
export function tweenNumber(node, to, { duration = 0.8, format = (v) => String(Math.round(v)) } = {}) {
  const state = node.__tw ?? (node.__tw = { v: to });
  gsap.killTweensOf(state);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.v = to;
    node.textContent = format(to);
    return;
  }
  gsap.to(state, { v: to, duration, ease: "power3.out", onUpdate: () => { node.textContent = format(state.v); } });
}

export function setNumber(node, v, format = (x) => String(Math.round(x))) {
  if (node.__tw) { gsap.killTweensOf(node.__tw); node.__tw.v = v; }
  node.textContent = format(v);
}

/** scroll the window so a chapter sits at progress p */
export function scrollToProgress(id, p, smooth = true) {
  const s = document.getElementById(`ch-${id}`);
  if (!s) return;
  const y = s.offsetTop + clamp(p) * (s.offsetHeight - innerHeight);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.round(y), behavior: smooth && !reduced ? "smooth" : "auto" });
}

/** toggle a class only when it changes (keeps update() free of redundant style writes) */
export function flag(node, cls, on) {
  if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}

export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export function setStyle(node, prop, value) {
  const key = `__s_${prop}`;
  if (node[key] === value) return;
  node[key] = value;
  node.style.setProperty(prop, value);
}
