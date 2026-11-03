import { loop, rng } from "../util.js";

const cloud = (x, y, s, cls) => `<g class="${cls}" transform="translate(${x} ${y}) scale(${s})">
  <path d="M-70 20q70 16 140 0a32 32 0 0 0 -6 -63a46 46 0 0 0 -86 -6a36 36 0 0 0 -48 69z"/></g>`;

const PEOPLE = [
  { home: 170, shelter: 455, y: 600, s: 1.05, shirt: "#ff8a5c", skin: "#e0b190", hair: "#2a1a12" },
  { home: 250, shelter: 500, y: 612, s: 1.1, shirt: "#6fc3ff", skin: "#8d5a3b", hair: "#120c08" },
  { home: 318, shelter: 545, y: 596, s: 0.95, shirt: "#ffd34a", skin: "#f1c9a5", hair: "#8a5a2b" },
  { home: 905, shelter: 655, y: 604, s: 1.05, shirt: "#3ddc97", skin: "#c58c63", hair: "#1a120c" },
  { home: 985, shelter: 705, y: 614, s: 1.1, shirt: "#c78bff", skin: "#e8bd98", hair: "#3b2416" },
  { home: 1060, shelter: 745, y: 598, s: 0.95, shirt: "#ff5d6c", skin: "#6b4128", hair: "#0d0907" },
  { home: 560, shelter: 580, y: 584, s: 0.9, shirt: "#f4f1ea", skin: "#e0b190", hair: "#5a3a22" },
  { home: 640, shelter: 622, y: 586, s: 0.9, shirt: "#ffb547", skin: "#a8714c", hair: "#1a120c" },
];

function person(p, k) {
  return `<g class="pt-person" style="--home:${p.home}px;--shelter:${p.shelter}px;--k:${k}">
    <g transform="translate(0 ${p.y}) scale(${p.s})">
      <ellipse cx="0" cy="2" rx="18" ry="4" fill="rgba(0,0,0,.28)"/>
      <g class="pt-body">
        <path d="M-6 -30 L-8 0 M6 -30 L8 0" stroke="#1f2740" stroke-width="7" stroke-linecap="round"/>
        <path d="M-15 -62 q15 -9 30 0 l3 34 h-36z" fill="${p.shirt}"/>
        <path class="pt-arm pt-arm-l" d="M-13 -58 q-10 14 -8 28" stroke="${p.shirt}" stroke-width="7" stroke-linecap="round" fill="none"/>
        <path class="pt-arm pt-arm-r" d="M13 -58 q10 14 8 28" stroke="${p.shirt}" stroke-width="7" stroke-linecap="round" fill="none"/>
        <circle cx="0" cy="-74" r="11" fill="${p.skin}"/>
        <path d="M-11 -76 q1 -13 12 -12 q11 1 10 12 q-4 -5 -11 -5 q-7 0 -11 5z" fill="${p.hair}"/>
      </g>
    </g>
  </g>`;
}

function bulbs(d, n, seed) {
  const r = rng(seed);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  const len = path.getTotalLength();
  let s = "";
  for (let k = 1; k < n; k++) {
    const pt = path.getPointAtLength((k / n) * len);
    s += `<circle class="pt-bulb" style="--d:${(r() * 2).toFixed(2)}s" cx="${pt.x.toFixed(1)}" cy="${(pt.y + 5).toFixed(1)}" r="4.2"/>`;
  }
  return s;
}

export function buildParty(host) {
  const lightsA = "M320 330 Q 380 400 446 404";
  const lightsB = "M754 404 Q 820 400 880 330";
  const lightsC = "M446 404 Q 600 470 754 404";
  host.innerHTML = `
  <svg class="pt" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      ${[
    ["dry", "#2b5f97", "#78acd6", "#f0d3a0"],
    ["drizzle", "#46536a", "#7d8aa0", "#b9b7ad"],
    ["rain", "#252d3b", "#4a5566", "#6f7680"],
    ["storm", "#0b0c14", "#221f33", "#3d3346"],
  ].map(([id, a, b, c]) => `<linearGradient id="pt-sky-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset=".62" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`).join("")}
      <radialGradient id="pt-sunglow"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".9"/><stop offset=".35" stop-color="#ffd27a" stop-opacity=".35"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
      <radialGradient id="pt-bulbglow"><stop offset="0" stop-color="#ffd58a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd58a" stop-opacity="0"/></radialGradient>
      <linearGradient id="pt-lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6b3a"/><stop offset="1" stop-color="#1c3220"/></linearGradient>
      <linearGradient id="pt-tent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7ee"/><stop offset="1" stop-color="#ddd5c4"/></linearGradient>
      <linearGradient id="pt-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#05070d" stop-opacity="0"/><stop offset="1" stop-color="#05070d" stop-opacity=".9"/></linearGradient>
      <linearGradient id="pt-topfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070d" stop-opacity=".55"/><stop offset=".3" stop-color="#05070d" stop-opacity="0"/></linearGradient>
    </defs>
    <g class="pt-skies">
      <rect class="pt-sky" data-k="dry" width="1200" height="700" fill="url(#pt-sky-dry)"/>
      <rect class="pt-sky" data-k="drizzle" width="1200" height="700" fill="url(#pt-sky-drizzle)"/>
      <rect class="pt-sky" data-k="rain" width="1200" height="700" fill="url(#pt-sky-rain)"/>
      <rect class="pt-sky" data-k="storm" width="1200" height="700" fill="url(#pt-sky-storm)"/>
    </g>
    <g class="pt-sun"><circle cx="860" cy="170" r="150" fill="url(#pt-sunglow)"/><circle cx="860" cy="170" r="44" fill="#ffe3a0"/></g>
    <path class="pt-bolt" d="M300 60 L270 170 L304 170 L262 300 L344 150 L308 150 L338 60z" fill="#fff6c8"/>
    <g class="pt-clouds">
      <g class="pt-cl pt-cl-light">${cloud(820, 330, 0.5, "")}${cloud(700, 70, 0.55, "")}${cloud(1060, 210, 0.8, "")}</g>
      <g class="pt-cl pt-cl-mid">${cloud(120, 120, 1.3, "")}${cloud(480, 90, 1.5, "")}${cloud(860, 120, 1.4, "")}${cloud(1160, 100, 1.2, "")}</g>
      <g class="pt-cl pt-cl-dark">${cloud(60, 60, 1.8, "")}${cloud(380, 40, 2, "")}${cloud(740, 60, 1.9, "")}${cloud(1100, 50, 1.8, "")}</g>
    </g>
    <g class="pt-far">
      <path d="M150 440 V350 h40 v-18 h200 v18 h40 v90z" fill="#1d2433" opacity=".7"/>
      <g fill="#273049" opacity=".75">${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<rect x="${200 + k * 24}" y="358" width="10" height="70"/>`).join("")}</g>
      <path d="M160 350 L310 300 L460 350z" fill="#1d2433" opacity=".7"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => `<circle cx="${k * 110 + (k % 2) * 30}" cy="${438 - (k % 3) * 12}" r="${46 + (k % 3) * 12}" fill="${k % 2 ? "#18291f" : "#1d3326"}"/>`).join("")}
    </g>
    <rect y="436" width="1200" height="264" fill="url(#pt-lawn)"/>
    <g class="pt-puddles" fill="rgba(160,190,220,.28)">
      <ellipse cx="250" cy="640" rx="70" ry="7"/><ellipse cx="930" cy="655" rx="90" ry="8"/><ellipse cx="610" cy="672" rx="60" ry="6"/>
    </g>
    <g class="pt-lights">
      <path d="M320 330 V600 M880 330 V600" stroke="#2b2420" stroke-width="5"/>
      <path d="${lightsA} M754 404 Q 820 400 880 330 ${lightsC}" stroke="#2b2420" stroke-width="1.6" fill="none"/>
      <g class="pt-bulbs">${bulbs(lightsA, 6, 1)}${bulbs(lightsB, 6, 2)}${bulbs(lightsC, 10, 3)}</g>
    </g>
    <g class="pt-tent">
      <path d="M408 420 V588 M600 340 V588 M792 420 V588" stroke="#b9ae9a" stroke-width="5"/>
      <path class="pt-back" d="M420 430 H780 V560 H420z" fill="rgba(30,26,22,.35)"/>
      <g class="pt-tables">
        <ellipse cx="520" cy="560" rx="50" ry="10" fill="#f4efe4"/><path d="M470 560 h100 v24 q-50 8 -100 0z" fill="#ebe4d6"/>
        <ellipse cx="690" cy="560" rx="50" ry="10" fill="#f4efe4"/><path d="M640 560 h100 v24 q-50 8 -100 0z" fill="#ebe4d6"/>
        <path d="M676 550 h28 v-14 h-28z" fill="#ff9f8a"/><path d="M676 536 h28 v-4 h-28z" fill="#fff"/>
        <path d="M688 532 v-8" stroke="#ffd34a" stroke-width="2"/>
        <circle cx="506" cy="552" r="7" fill="#6fc3ff" opacity=".85"/><circle cx="530" cy="553" r="6" fill="#ffb547"/>
      </g>
      <g class="pt-roof">
        <path d="M384 424 L600 328 L816 424z" fill="url(#pt-tent)"/>
        <path d="M600 328 L520 424 M600 328 L680 424" stroke="#d6cdbb" stroke-width="2"/>
        <path class="pt-valance" d="M384 424 ${Array.from({ length: 12 }, (_, k) => `q 18 ${k % 2 ? 22 : 22} 36 0`).join(" ")} z" fill="#f6f1e6"/>
        <path d="M384 424 H816" stroke="#e0d6c3" stroke-width="2"/>
        <path d="M600 328 v-22" stroke="#b9ae9a" stroke-width="3"/>
        <path class="pt-flag" d="M600 306 l26 7 l-26 7z" fill="#ff5d6c"/>
      </g>
      <g class="pt-bunting">
        ${Array.from({ length: 9 }, (_, k) => {
    const x = 420 + k * 42;
    const y = 444 + Math.sin((k / 8) * Math.PI) * 14;
    return `<path d="M${x} ${y} l14 0 l-7 14z" fill="${["#ff5d6c", "#ffb547", "#6fc3ff", "#3ddc97"][k % 4]}"/>`;
  }).join("")}
      </g>
    </g>
    <g class="pt-people">${PEOPLE.map(person).join("")}</g>
    <rect class="pt-dim" width="1200" height="700" fill="#05070d"/>
    <rect width="1200" height="700" fill="url(#pt-topfade)"/>
    <rect width="1200" height="700" fill="url(#pt-fade)"/>
  </svg>
  <canvas class="pt-rain"></canvas>
  <div class="pt-flash"></div>`;

  const svg = host.querySelector("svg");
  const canvas = host.querySelector("canvas");
  const flash = host.querySelector(".pt-flash");
  const g = canvas.getContext("2d");
  let drops = [];
  let intensity = 0;
  let target = 0;
  let windSlant = 0.2;
  let stop = null;
  let W = 0;
  let H = 0;
  let nextBolt = 0;
  let storm = false;
  let reduced = false;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, innerWidth < 720 ? 1.5 : 2);
    W = host.clientWidth;
    H = host.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const strike = () => {
    svg.classList.remove("is-strike");
    flash.classList.remove("is-strike");
    void host.offsetWidth;
    svg.classList.add("is-strike");
    flash.classList.add("is-strike");
  };

  const frame = (dt, t) => {
    intensity += (target - intensity) * Math.min(1, Math.max(0, dt) * 2.5);
    const want = Math.max(0, Math.round(intensity * (W * H) / 2600));
    while (drops.length < want) drops.push({ x: Math.random() * (W + 200) - 100, y: Math.random() * H, v: 0.7 + Math.random() * 0.6 });
    if (drops.length > want) drops.length = want;
    g.clearRect(0, 0, W, H);
    if (drops.length) {
      g.strokeStyle = "rgba(190, 215, 240, 0.42)";
      g.lineWidth = 1.2;
      g.beginPath();
      const speed = 900 + intensity * 500;
      for (const d of drops) {
        d.y += speed * d.v * Math.max(0, dt);
        d.x += speed * d.v * Math.max(0, dt) * windSlant;
        if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 200) - 100 - windSlant * 200; }
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - windSlant * 18 * d.v, d.y - 18 * d.v);
      }
      g.stroke();
    }
    if (storm && !reduced && t > nextBolt) {
      strike();
      nextBolt = t + 2.4 + Math.random() * 3;
    }
  };

  return {
    svg,
    set(state, { wind = 8 } = {}) {
      svg.dataset.wx = state;
      target = { claim: 0, dry: 0, drizzle: 0.25, rain: 0.7, storm: 1 }[state] ?? 0;
      windSlant = Math.min(0.6, 0.08 + wind / 45);
      svg.style.setProperty("--flap", `${Math.min(6, 0.6 + wind / 4).toFixed(2)}deg`);
      svg.style.setProperty("--flapdur", `${Math.max(0.35, 1.6 - wind / 25).toFixed(2)}s`);
      storm = state === "storm";
      if (storm && !reduced) { strike(); nextBolt = performance.now() / 1000 + 2; }
    },
    start(isReduced) {
      reduced = isReduced;
      svg.classList.add("is-live");
      if (!stop) stop = loop(frame);
    },
    stop() {
      svg.classList.remove("is-live");
      stop?.();
      stop = null;
      g.clearRect(0, 0, W, H);
      drops = [];
      intensity = 0;
    },
  };
}
