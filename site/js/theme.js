export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function isDark() {
  return document.documentElement.dataset.theme === "dark"
    || (document.documentElement.dataset.theme !== "light"
      && matchMedia("(prefers-color-scheme: dark)").matches);
}

const BLUE = ["#0d366b", "#184f95", "#2a78d6", "#6da7ec", "#b7d3f6"];
const RED = ["#f6c9c4", "#ef8f89", "#e34948", "#b52f2f", "#7a1d1d"];

export function divergingTemp(minC, midC, maxC) {
  const mid = "#ecebe6";
  const cold = d3.scaleLinear().domain(d3.range(5).map((k) => minC + (k / 5) * (midC - minC)).concat(midC))
    .range([...BLUE, mid]).interpolate(d3.interpolateLab).clamp(true);
  const warm = d3.scaleLinear().domain([midC, ...d3.range(1, 6).map((k) => midC + (k / 5) * (maxC - midC))])
    .range([mid, ...RED]).interpolate(d3.interpolateLab).clamp(true);
  const f = (v) => (v < midC ? cold(v) : warm(v));
  f.domain = () => [minC, maxC];
  return f;
}

export function sequentialBlue(min, max) {
  const lo = isDark() ? "#1a1a19" : "#eef4fc";
  return d3.scaleLinear().domain(d3.range(6).map((k) => min + (k / 5) * (max - min)))
    .range([lo, "#9ec5f4", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"])
    .interpolate(d3.interpolateLab).clamp(true);
}

export function sequentialOrange(min, max) {
  const lo = isDark() ? "#1a1a19" : "#fdf0ea";
  return d3.scaleLinear().domain(d3.range(5).map((k) => min + (k / 4) * (max - min)))
    .range([lo, "#f6c2a8", "#eb6834", "#b8461c", "#6e2a10"])
    .interpolate(d3.interpolateLab).clamp(true);
}

export const SERIES = () => (isDark()
  ? ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]
  : ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]);

export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

export const cToF = (c) => c * 9 / 5 + 32;
export const fmtF = (c) => `${Math.round(cToF(c))}°F`;
export const fmtPct = (p) => `${Math.round(p * 100)}%`;
export const fmtTime = d3.timeFormat("%a %-I %p");
export const fmtDay = d3.timeFormat("%a %b %-d");

export function onThemeChange(fn) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
  document.addEventListener("themechange", fn);
}

export function tooltip() {
  let el = document.querySelector(".tooltip");
  if (!el) {
    el = document.createElement("div");
    el.className = "tooltip";
    document.body.appendChild(el);
  }
  return {
    show(html, x, y) {
      el.innerHTML = html;
      el.style.opacity = 1;
      const r = el.getBoundingClientRect();
      const left = Math.min(x + 14, window.innerWidth - r.width - 8);
      const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
      el.style.transform = `translate(${left}px, ${top}px)`;
    },
    hide() { el.style.opacity = 0; },
  };
}
