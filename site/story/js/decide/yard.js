import { tempColor, rng } from "../util.js";

function windows(x0, y0, cols, rows, dx, dy, w, h, lit) {
  const r = rng(x0 + y0);
  let s = "";
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const on = r() < lit;
      s += `<rect x="${x0 + i * dx}" y="${y0 + j * dy}" width="${w}" height="${h}" rx="1" fill="${on ? "#ffd58a" : "#2a1d22"}" opacity="${on ? 0.85 : 1}"/>`;
    }
  }
  return s;
}

function elm(x, y, s, tint) {
  const c1 = tint === "fall" ? "#8a4a22" : "#1d3a35";
  const c2 = tint === "fall" ? "#c47a2c" : "#28514a";
  const c3 = tint === "fall" ? "#e3a447" : "#3a6b5d";
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-5 0 Q-3 -40 -10 -70 M5 0 Q4 -45 14 -72 M0 -40 Q-14 -55 -30 -62" stroke="#1a1414" stroke-width="7" fill="none" stroke-linecap="round"/>
    <rect x="-6" y="-40" width="12" height="40" fill="#1a1414"/>
    <g class="yd-canopy">
      <circle cx="-34" cy="-78" r="30" fill="${c1}"/>
      <circle cx="30" cy="-82" r="32" fill="${c1}"/>
      <circle cx="0" cy="-104" r="38" fill="${c2}"/>
      <circle cx="-22" cy="-96" r="22" fill="${c2}"/>
      <circle cx="18" cy="-114" r="18" fill="${c3}" opacity=".55"/>
      <circle cx="-14" cy="-120" r="12" fill="${c3}" opacity=".45"/>
    </g>
  </g>`;
}

function lamp(x, y) {
  return `<g transform="translate(${x} ${y})">
    <circle cx="0" cy="-74" r="26" fill="url(#yd-lampglow)"/>
    <rect x="-2" y="-66" width="4" height="66" fill="#121318"/>
    <rect x="-6" y="-4" width="12" height="5" rx="1" fill="#121318"/>
    <path d="M-7 -66h14l-3 -14h-8z" fill="#ffd58a"/>
    <path d="M-9 -80h18l-9 -6z" fill="#121318"/>
  </g>`;
}

const LEAVES = Array.from({ length: 9 }, (_, k) => k);

const STUDENT = `
<g class="yd-student">
  <ellipse class="yd-shadow" cx="0" cy="2" rx="34" ry="6" fill="rgba(0,0,0,.35)"/>
  <g class="yd-bob">
    <g class="yd-leg yd-leg-b"><path d="M-4 -62 L-8 -4" stroke="#1f2740" stroke-width="13" stroke-linecap="round"/><path d="M-14 -2h14" stroke="#0e0f14" stroke-width="7" stroke-linecap="round"/></g>
    <g class="yd-leg yd-leg-f"><path d="M4 -62 L6 -4" stroke="#2a3557" stroke-width="13" stroke-linecap="round"/><path d="M0 -2h14" stroke="#111216" stroke-width="7" stroke-linecap="round"/></g>
    <rect x="-24" y="-118" width="18" height="38" rx="7" fill="#3b4f6b"/>
    <rect x="-24" y="-112" width="18" height="10" rx="3" fill="#4a6285"/>
    <g class="yd-tee">
      <path d="M-14 -124 q14 -8 28 0 l3 66 h-34z" fill="#a51c30"/>
      <path d="M-6 -124 q6 5 12 0" stroke="#7d1424" stroke-width="2" fill="none"/>
      <g class="yd-arm"><path d="M10 -118 Q20 -96 14 -76" stroke="#a51c30" stroke-width="10" stroke-linecap="round" fill="none"/><path d="M17 -100 Q19 -88 14 -76" stroke="#e0b190" stroke-width="8" stroke-linecap="round" fill="none"/></g>
    </g>
    <g class="yd-coat">
      <path d="M-17 -126 q17 -9 34 0 l4 72 q-21 5 -42 0z" fill="#2f5d8c"/>
      <path d="M-19 -108h38M-20 -92h40M-21 -76h42" stroke="#244a70" stroke-width="2.4"/>
      <path d="M0 -128v72" stroke="#1d3c5c" stroke-width="2"/>
      <path d="M-11 -130 q11 -7 22 0 l-2 8 q-9 -4 -18 0z" fill="#3c71a6"/>
      <g class="yd-arm"><path d="M12 -118 Q24 -96 16 -74" stroke="#2f5d8c" stroke-width="13" stroke-linecap="round" fill="none"/><path d="M16 -102 Q20 -92 18 -86" stroke="#244a70" stroke-width="2" fill="none"/><circle cx="16" cy="-71" r="4.5" fill="#e0b190"/></g>
    </g>
    <path d="M-4 -128 v-6 h8 v6z" fill="#d9a684"/>
    <circle cx="1" cy="-146" r="14" fill="#e0b190"/>
    <path d="M-14 -146 q0 -18 16 -17 q14 1 13 13 q-6 -6 -14 -5 q-8 1 -15 9z" fill="#2a1a12"/>
    <circle cx="9" cy="-146" r="1.6" fill="#1a1010"/>
    <path class="yd-mouth" d="M8 -139 q3 1.5 5 0" stroke="#7a3d2c" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <g class="yd-sparkle" fill="#ffe7a8">
      <path d="M-30 -120 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2z"/>
      <path d="M28 -134 l1.4 -4 l1.4 4 l4 1.4 l-4 1.4 l-1.4 4 l-1.4 -4 l-4 -1.4z"/>
    </g>
    <g class="yd-brr" stroke="#9fd4ff" stroke-width="2.2" fill="none" stroke-linecap="round">
      <path d="M-30 -150 q-6 6 0 12 q6 6 0 12"/>
      <path d="M32 -150 q6 6 0 12 q-6 6 0 12"/>
      <path class="yd-breath" d="M18 -140 q8 -2 12 -8 q2 6 10 4" stroke-width="2" opacity=".8"/>
    </g>
    <g class="yd-sweat" fill="#7fd0ff">
      <path d="M-12 -160 q3 6 0 8 q-3 -2 0 -8z"/>
      <path d="M18 -156 q3 6 0 8 q-3 -2 0 -8z"/>
    </g>
  </g>
</g>`;

export function buildYard(host) {
  host.innerHTML = `
  <svg class="yd" viewBox="0 0 640 560" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A student walking to class through Harvard Yard">
    <defs>
      <linearGradient id="yd-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0b1424"/>
        <stop offset=".45" stop-color="#22324f"/>
        <stop offset=".75" stop-color="#6d6a80"/>
        <stop offset="1" stop-color="#d79a6c"/>
      </linearGradient>
      <radialGradient id="yd-sun" cx=".2" cy=".62" r=".5">
        <stop offset="0" stop-color="#ffcf8a" stop-opacity=".55"/>
        <stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="yd-lawn" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22402f"/>
        <stop offset="1" stop-color="#0d1a13"/>
      </linearGradient>
      <linearGradient id="yd-path" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8c7a6a"/>
        <stop offset="1" stop-color="#5b4b40"/>
      </linearGradient>
      <radialGradient id="yd-lampglow">
        <stop offset="0" stop-color="#ffd58a" stop-opacity=".55"/>
        <stop offset="1" stop-color="#ffd58a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="yd-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset=".6" stop-color="#05070d" stop-opacity="0"/>
        <stop offset="1" stop-color="#05070d" stop-opacity=".85"/>
      </linearGradient>
    </defs>
    <rect width="640" height="560" fill="url(#yd-sky)"/>
    <rect width="640" height="560" fill="url(#yd-sun)"/>
    <g class="yd-clouds" fill="rgba(244,241,234,.08)">
      <path d="M60 120h120a24 24 0 0 0 -10 -46a34 34 0 0 0 -62 4a26 26 0 0 0 -48 42z"/>
      <path d="M420 84h96a20 20 0 0 0 -8 -38a28 28 0 0 0 -52 2a22 22 0 0 0 -36 36z"/>
    </g>

    <g class="yd-church">
      <rect x="452" y="60" width="4" height="40" fill="#e9e3d6"/>
      <path d="M444 104 L454 40 L464 104z" fill="#ece6da"/>
      <rect x="436" y="104" width="36" height="34" fill="#e3dccd"/>
      <rect x="448" y="112" width="12" height="18" rx="6" fill="#2c3346"/>
      <rect x="430" y="138" width="48" height="40" fill="#d9d1c1"/>
      <circle cx="454" cy="156" r="8" fill="#f2ecdf" stroke="#b9b0a0" stroke-width="2"/>
      <path d="M396 230 L454 182 L512 230z" fill="#e8e1d3"/>
      <rect x="388" y="178" width="132" height="6" fill="#cfc7b6"/>
      <rect x="400" y="230" width="108" height="120" fill="#d6cebd"/>
      <g fill="#f1ebde">${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${406 + k * 18}" y="236" width="8" height="112"/>`).join("")}</g>
      <path d="M394 230h120v8h-120z" fill="#bfb6a5"/>
    </g>

    <g class="yd-hall">
      <path d="M16 236 L60 200 H268 L304 236z" fill="#3a2422"/>
      <rect x="30" y="196" width="10" height="22" fill="#5b2f28"/>
      <rect x="250" y="196" width="10" height="22" fill="#5b2f28"/>
      <rect x="20" y="236" width="280" height="120" fill="#7b3a2d"/>
      <rect x="20" y="236" width="280" height="6" fill="#5e2a21"/>
      ${windows(34, 252, 11, 3, 24.5, 32, 12, 20, 0.3)}
      <rect x="146" y="320" width="26" height="36" fill="#2a1712"/>
      <path d="M140 320 h38 l-19 -12z" fill="#e4dccb"/>
    </g>

    ${elm(330, 350, 1, "fall")}
    ${elm(560, 356, 1.1, "green")}
    ${elm(90, 360, 0.95, "green")}

    <path d="M0 340 H640 V560 H0z" fill="url(#yd-lawn)"/>
    <path d="M150 560 C230 470 330 420 452 352 L470 352 C380 420 330 480 330 560z" fill="url(#yd-path)" opacity=".9"/>
    <path d="M0 400 C120 386 240 380 360 384 C460 388 560 396 640 404 V418 C540 410 440 404 360 402 C240 398 120 402 0 416z" fill="#4e4136" opacity=".55"/>

    ${lamp(612, 432)}
    ${lamp(46, 452)}

    <g class="yd-walker" transform="translate(272 520)">
      ${STUDENT}
    </g>

    <g class="yd-chip" transform="translate(272 300)">
      <path d="M0 0 l-7 -9 h14z" class="yd-chip-tail"/>
      <rect class="yd-chip-bg" x="-44" y="-50" width="88" height="42" rx="21"/>
      <text class="yd-chip-t" x="0" y="-21" text-anchor="middle">--</text>
      <text class="yd-chip-l" x="0" y="-58" text-anchor="middle">YOUR APP</text>
    </g>

    <g class="yd-leaves">
      ${LEAVES.map((k) => `<path class="yd-leaf" style="--k:${k}" d="M0 0 q6 -6 12 0 q-6 6 -12 0z" fill="${["#e3a447", "#c4632c", "#d9862f"][k % 3]}"/>`).join("")}
    </g>
    <rect width="640" height="560" fill="url(#yd-fade)" pointer-events="none"/>
  </svg>`;

  const svg = host.querySelector("svg");
  const student = svg.querySelector(".yd-student");
  const chip = svg.querySelector(".yd-chip");
  const chipBg = chip.querySelector(".yd-chip-bg");
  const chipTail = chip.querySelector(".yd-chip-tail");
  const chipT = chip.querySelector(".yd-chip-t");
  const chipL = chip.querySelector(".yd-chip-l");
  let outfit = null;
  let mood = null;

  return {
    svg,
    setOutfit(kind) {
      if (kind === outfit) return;
      outfit = kind;
      svg.dataset.outfit = kind;
    },
    setMood(m) {
      if (m === mood) return;
      mood = m;
      svg.dataset.mood = m;
    },
    setChip(tempF, label) {
      const c = tempColor(tempF);
      chipBg.setAttribute("fill", c);
      chipTail.setAttribute("fill", c);
      chipT.textContent = `${Math.round(tempF)}°`;
      chipL.textContent = label;
      chip.classList.remove("is-pop");
      void host.offsetWidth;
      chip.classList.add("is-pop");
    },
    setWalking(on) { svg.classList.toggle("is-walking", on); },
  };
}
