import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "../util.js";

export const RIVER = { north: 10, south: 116 };

const C = {
  brick: ["#8e4a3a", "#9a5440", "#874536", "#a05a44", "#93503d"],
  brickDark: "#6e3a2f",
  trim: "#efe6d4",
  white: "#f4f0e6",
  slate: "#3f4652",
  slateWarm: "#4a4644",
  lime: "#d9cfbb",
  blue: "#3f74b8",
  red: "#b33a2c",
  gold: "#d8a94a",
  stone: "#8d8b84",
  lawn: "#58703f",
  lawnDark: "#4b6236",
  path: "#b8ab92",
  road: "#3b3c40",
  glass: "#5b6878",
};

const tmpColor = new THREE.Color();

/** collects flat-shaded parts with color + (window, floodlight) attributes, merged into one geometry */
class Builder {
  constructor() {
    this.parts = [];
    this.footprints = [];
  }

  add(geo, color, win = 0, glow = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const aw = new Float32Array(n * 2);
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpColor.r;
      col[i * 3 + 1] = tmpColor.g;
      col[i * 3 + 2] = tmpColor.b;
      aw[i * 2] = win;
      aw[i * 2 + 1] = glow;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aWin", new THREE.BufferAttribute(aw, 2));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color", "aWin"].includes(k)) g.deleteAttribute(k);
    this.parts.push(g);
    return g;
  }

  place(geo, x, y, z, rotY = 0) {
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    return geo;
  }

  box(x, y, z, w, h, d, color, { rot = 0, win = 0, glow = 0, foot = false } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    this.place(g, x, y, z, rot);
    if (foot) this.foot(x, z, w, d, rot);
    return this.add(g, color, win, glow);
  }

  foot(x, z, w, d, rot = 0, pad = 1.5) {
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const hw = (w * c + d * s) / 2 + pad;
    const hd = (w * s + d * c) / 2 + pad;
    this.footprints.push([x - hw, x + hw, z - hd, z + hd]);
  }

  cyl(x, y, z, rTop, rBot, h, seg, color, { win = 0, glow = 0, rot = 0 } = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
    g.translate(0, h / 2, 0);
    if (seg === 4 || seg === 8) g.rotateY(Math.PI / seg);
    return this.add(this.place(g, x, y, z, rot), color, win, glow);
  }

  cone(x, y, z, r, h, seg, color, { glow = 0, rot = 0 } = {}) {
    const g = new THREE.ConeGeometry(r, h, seg, 1);
    g.translate(0, h / 2, 0);
    if (seg === 4 || seg === 8) g.rotateY(Math.PI / seg);
    return this.add(this.place(g, x, y, z, rot), color, 0, glow);
  }

  dome(x, y, z, r, color, { seg = 10, rings = 4, stretch = 1, glow = 0 } = {}) {
    const g = new THREE.SphereGeometry(r, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, stretch, 1);
    return this.add(this.place(g, x, y, z), color, 0, glow);
  }

  gable(x, y, z, w, d, h, color, { rot = 0, glow = 0 } = {}) {
    const a = [-w / 2, 0, -d / 2];
    const b = [w / 2, 0, -d / 2];
    const c = [w / 2, 0, d / 2];
    const dd = [-w / 2, 0, d / 2];
    const e = [-w / 2, h, 0];
    const f = [w / 2, h, 0];
    const tris = [a, f, b, a, e, f, dd, c, f, dd, f, e, a, dd, e, b, f, c];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return this.add(this.place(g, x, y, z, rot), color, 0, glow);
  }

  hip(x, y, z, w, d, h, color, { rot = 0, glow = 0 } = {}) {
    const g = new THREE.ConeGeometry(1, h, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(w / Math.SQRT2, 1, d / Math.SQRT2);
    g.translate(0, h / 2, 0);
    return this.add(this.place(g, x, y, z, rot), color, 0, glow);
  }

  merged() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return g;
  }
}

const FLOOR = 1.15;
const wallH = (floors) => floors * FLOOR + 0.35;

/** neo-Georgian brick block: windows, white cornice, slate gable roof, chimneys */
function georgian(B, x, z, w, d, floors, rot, r, { roof = "gable", color } = {}) {
  const h = wallH(floors);
  const brick = color ?? C.brick[Math.floor(r() * C.brick.length)];
  B.box(x, 0, z, w, h, d, brick, { rot, win: 1, foot: true });
  B.box(x, h - 0.05, z, w + 0.35, 0.3, d + 0.35, C.trim, { rot });
  const roofH = Math.min(d, w) * 0.32 + 0.6;
  const along = w >= d;
  if (roof === "hip") B.hip(x, h + 0.25, z, w + 0.2, d + 0.2, roofH, C.slate, { rot });
  else if (roof === "gable") {
    B.gable(x, h + 0.25, z, along ? w + 0.2 : d + 0.2, along ? d + 0.4 : w + 0.4, roofH, C.slate, { rot: rot + (along ? 0 : Math.PI / 2) });
  }
  if (roof !== "flat") {
    const cx = Math.cos(rot);
    const sx = Math.sin(rot);
    const span = (along ? w : d) * 0.36;
    for (const s of [-1, 1]) {
      const lx = along ? s * span : 0;
      const lz = along ? 0 : s * span;
      B.box(x + lx * cx + lz * sx, h, z - lx * sx + lz * cx, 0.7, roofH * 0.9 + 0.6, 0.9, C.brickDark, { rot });
    }
  }
  return h;
}

/** a residential House: ring of brick blocks around a courtyard with an opening toward the river */
function houseQuad(B, cx, cz, w, d, r, opts = {}) {
  const t = opts.thick ?? 5;
  const floors = opts.floors ?? 5;
  georgian(B, cx, cz - d / 2 + t / 2, w, t, floors, 0, r);
  const sideLen = d - t;
  georgian(B, cx - w / 2 + t / 2, cz + t / 2 - 0.01, t, sideLen, floors, 0, r, { roof: "gable" });
  georgian(B, cx + w / 2 - t / 2, cz + t / 2 - 0.01, t, sideLen, floors, 0, r, { roof: "gable" });
  const gap = opts.gap ?? w * 0.34;
  const seg = (w - gap) / 2;
  georgian(B, cx - w / 2 + seg / 2, cz + d / 2 - t / 2, seg, t, floors - 1, 0, r);
  georgian(B, cx + w / 2 - seg / 2, cz + d / 2 - t / 2, seg, t, floors - 1, 0, r);
  B.box(cx, 0.02, cz + t / 2, w - 2 * t, 0.06, d - 2 * t, C.lawn);
}

function lowellTower(B, x, z) {
  const y0 = 9.6;
  B.box(x, 0, z, 4.8, y0, 4.8, C.brick[1], { foot: true });
  B.box(x, y0 - 0.2, z, 5.4, 0.5, 5.4, C.trim, { glow: 1 });
  B.box(x, y0 + 0.3, z, 4.0, 2.8, 4.0, C.white, { glow: 1 });
  B.box(x, y0 + 3.1, z, 4.5, 0.35, 4.5, C.trim, { glow: 1 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cyl(x + dx * 1.78, y0 + 0.3, z + dz * 1.78, 0.2, 0.2, 2.8, 6, C.trim, { glow: 1 });
  B.cyl(x, y0 + 3.45, z, 1.75, 1.85, 1.9, 8, C.white, { glow: 1 });
  B.cyl(x, y0 + 5.35, z, 1.95, 1.95, 0.28, 8, C.trim, { glow: 1 });
  B.dome(x, y0 + 5.63, z, 1.8, C.blue, { seg: 12, rings: 5, stretch: 1.15, glow: 1 });
  B.cyl(x, y0 + 7.5, z, 0.45, 0.5, 1.0, 8, C.white, { glow: 1 });
  B.dome(x, y0 + 8.5, z, 0.5, C.blue, { seg: 8, rings: 3, glow: 1 });
  B.cone(x, y0 + 8.9, z, 0.11, 1.5, 4, C.gold, { glow: 1 });
}

function dunsterTower(B, x, z) {
  B.box(x, 0, z, 4.6, 11, 4.6, C.brick[2], { foot: true });
  B.box(x, 10.8, z, 5.1, 0.45, 5.1, C.trim, { glow: 1 });
  B.box(x, 11.25, z, 3.9, 2.6, 3.9, C.white, { glow: 1 });
  B.box(x, 13.85, z, 4.3, 0.3, 4.3, C.trim, { glow: 1 });
  B.cyl(x, 14.15, z, 1.55, 1.7, 1.6, 8, C.white, { glow: 1 });
  B.dome(x, 15.75, z, 1.75, C.red, { seg: 8, rings: 4, stretch: 1.55, glow: 1 });
  B.cyl(x, 18.4, z, 0.35, 0.4, 0.7, 8, C.white, { glow: 1 });
  B.cone(x, 19.1, z, 0.3, 1.3, 8, C.red, { glow: 1 });
}

function eliotTower(B, x, z) {
  B.box(x, 0, z, 4.8, 12.5, 4.8, C.brick[3], { foot: true });
  B.box(x, 12.3, z, 5.3, 0.45, 5.3, C.trim, { glow: 1 });
  B.box(x, 12.75, z, 4.0, 2.4, 4.0, C.white, { glow: 1 });
  B.box(x, 15.15, z, 4.4, 0.3, 4.4, C.trim, { glow: 1 });
  B.cyl(x, 15.45, z, 1.45, 1.55, 2.4, 8, C.white, { glow: 1 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    B.cyl(x + Math.cos(a) * 1.62, 15.45, z + Math.sin(a) * 1.62, 0.12, 0.12, 2.4, 5, C.trim, { glow: 1 });
  }
  B.cyl(x, 17.85, z, 1.7, 1.7, 0.3, 8, C.trim, { glow: 1 });
  B.dome(x, 18.15, z, 1.45, C.white, { seg: 8, rings: 3, stretch: 0.8, glow: 1 });
  B.cone(x, 19.2, z, 0.55, 3.6, 8, C.white, { glow: 1 });
  B.cone(x, 22.6, z, 0.08, 1.0, 4, C.gold, { glow: 1 });
}

function memorialChurch(B, x, z) {
  const navW = 10;
  const navL = 28;
  const navH = 8;
  B.box(x - navL / 2 - 2, 0, z, navL, navH, navW, C.brick[0], { foot: true });
  B.box(x - navL / 2 - 2, navH - 0.1, z, navL + 0.3, 0.35, navW + 0.4, C.trim);
  B.gable(x - navL / 2 - 2, navH + 0.2, z, navL + 0.2, navW + 0.6, 3.6, C.slate);
  B.box(x + 2.2, 0, z, 3.4, 0.6, navW + 1, C.lime);
  for (let k = 0; k < 4; k++) B.cyl(x + 2.9, 0.6, z - 3.3 + k * 2.2, 0.32, 0.36, 6.6, 8, C.white, { glow: 0.6 });
  B.box(x + 2.2, 7.2, z, 3.0, 0.9, navW + 0.6, C.white, { glow: 0.6 });
  B.gable(x + 2.2, 8.1, z, navW + 0.6, 3.2, 2.6, C.white, { rot: Math.PI / 2, glow: 0.6 });

  B.box(x - 1.5, 0, z, 5, 11, 5, C.brick[0], { foot: true });
  B.box(x - 1.5, 10.8, z, 5.5, 0.45, 5.5, C.trim, { glow: 1 });
  B.box(x - 1.5, 11.25, z, 4.2, 3.6, 4.2, C.white, { glow: 1 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cyl(x - 1.5 + dx * 1.85, 11.25, z + dz * 1.85, 0.2, 0.2, 3.6, 6, C.trim, { glow: 1 });
  B.box(x - 1.5, 14.85, z, 4.8, 0.4, 4.8, C.trim, { glow: 1 });
  B.cyl(x - 1.5, 15.25, z, 1.75, 1.85, 2.8, 8, C.white, { glow: 1 });
  B.cyl(x - 1.5, 18.05, z, 2.0, 2.0, 0.35, 8, C.trim, { glow: 1 });
  B.cyl(x - 1.5, 18.4, z, 1.25, 1.35, 2.1, 8, C.white, { glow: 1 });
  B.cyl(x - 1.5, 20.5, z, 1.45, 1.45, 0.3, 8, C.trim, { glow: 1 });
  B.cone(x - 1.5, 20.8, z, 1.05, 8.2, 8, C.white, { glow: 1 });
  B.cone(x - 1.5, 28.6, z, 0.06, 1.2, 4, C.gold, { glow: 1 });
}

/** Widener Library: wide neoclassical block facing +x with a colonnade over broad steps */
function widener(B, x, z) {
  const depth = 18;
  const width = 28;
  const h = 8.2;
  const cx = x - depth / 2;
  B.box(cx, 0, z, depth, 0.9, width + 0.6, C.lime, { foot: true });
  B.box(cx, 0.9, z, depth, h - 0.9, width, C.brick[4], { win: 1 });
  B.box(cx, h, z, depth + 0.5, 0.55, width + 0.5, C.lime);
  B.box(cx, h + 0.55, z, depth - 0.4, 1.0, width - 0.4, C.brick[4]);
  B.box(cx, h + 1.55, z, depth, 0.3, width + 0.2, C.lime);
  B.box(cx - 1, h + 1.85, z, depth - 6, 1.2, width - 8, C.slateWarm);
  for (const s of [-1, 1]) B.box(x + 0.15, 0.9, z + s * 10.6, 1.0, h - 0.9, 6.0, C.lime);
  const colZ0 = z - 7.2;
  const n = 12;
  const pitch = 14.4 / (n - 1);
  B.box(x + 0.1, 0.9, z, 0.3, h - 0.9, 15.4, "#3c3533");
  for (let k = 0; k < n; k++) {
    const zz = colZ0 + k * pitch;
    B.cyl(x + 1.4, 0.9, zz, 0.42, 0.42, 0.35, 8, C.lime, { glow: 0.5 });
    B.cyl(x + 1.4, 1.25, zz, 0.36, 0.42, h - 1.85, 10, C.lime, { glow: 0.5 });
    B.cyl(x + 1.4, h - 0.6, zz, 0.55, 0.38, 0.6, 8, C.lime, { glow: 0.5 });
  }
  B.box(x + 0.95, h, z, 1.6, 0.55, 15.9, C.lime, { glow: 0.5 });
  for (let s = 0; s < 6; s++) {
    const d = 2.2 + s * 0.85;
    B.box(x + d / 2 - 0.2, 0, z, d, 0.9 - s * 0.15, 17 - s * 0.2, C.lime);
  }
  B.foot(x + 3, z, 6, 18, 0, 0.5);
}

/** Weeks Footbridge: three arches across the river along z */
function weeksBridge(B, x) {
  const z0 = RIVER.north - 3;
  const z1 = RIVER.south + 3;
  const len = z1 - z0;
  const s = new THREE.Shape();
  s.moveTo(0, -1.2);
  s.lineTo(len, -1.2);
  s.lineTo(len, 0.2);
  s.quadraticCurveTo(len / 2, 2.4, 0, 0.2);
  s.lineTo(0, -1.2);
  const pier = 1.8;
  const side = (len - 8 - 2 * pier) * 0.29;
  const spans = [[4, 4 + side], [4 + side + pier, len - 4 - side - pier], [len - 4 - side, len - 4]];
  for (const [a, b] of spans) {
    const hole = new THREE.Path();
    const mid = (a + b) / 2;
    const top = b - a > side + 1 ? 0.9 : 0.4;
    hole.moveTo(a, -1.2);
    hole.lineTo(a, -0.6);
    hole.quadraticCurveTo(mid, top + Math.min(2.2, (b - a) * 0.07), b, -0.6);
    hole.lineTo(b, -1.2);
    hole.lineTo(a, -1.2);
    s.holes.push(hole);
  }
  const w = 4.2;
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 8 });
  g.rotateY(-Math.PI / 2);
  g.translate(x - w / 2, 0, z0);
  B.add(g, "#a3624c");
  const rail = new THREE.Shape();
  rail.moveTo(0, 0.2);
  rail.quadraticCurveTo(len / 2, 2.4, len, 0.2);
  rail.lineTo(len, 0.75);
  rail.quadraticCurveTo(len / 2, 2.95, 0, 0.75);
  rail.lineTo(0, 0.2);
  for (const side of [-1, 1]) {
    const rg = new THREE.ExtrudeGeometry(rail, { depth: 0.3, bevelEnabled: false, curveSegments: 10 });
    rg.rotateY(-Math.PI / 2);
    rg.translate(x + side * (w / 2 - 0.15) - 0.15, 0, z0);
    B.add(rg, C.trim, 0, 0.4);
  }
}

function boston(B, r) {
  const towers = [
    [420, -720, 9, 9, 52], [438, -705, 7, 12, 40], [405, -740, 8, 8, 34], [460, -740, 10, 7, 46],
    [382, -705, 7, 7, 26], [475, -700, 8, 8, 30], [446, -760, 6, 6, 58], [492, -730, 9, 9, 24],
    [362, -730, 6, 9, 22], [420, -680, 12, 6, 20], [510, -755, 8, 7, 36], [348, -755, 6, 6, 18],
    [530, -720, 7, 7, 28], [396, -780, 7, 7, 30],
  ];
  for (const [x, z, w, d, h] of towers) {
    const col = r() < 0.5 ? "#8b93a3" : "#a49a8e";
    B.box(x, 0, z, w, h, d, col, { win: 1 });
    if (h > 34) B.box(x, h, z, w * 0.7, h * 0.06, d * 0.7, col, { win: 1 });
  }
  B.box(436, 0, -728, 11, 66, 11, "#9aa1ac", { win: 1 });
  B.box(436, 66, -728, 8, 4, 8, "#9aa1ac");
  B.cyl(436, 70, -728, 0.3, 0.4, 14, 4, "#b8bcc4");
  const hk = new THREE.BoxGeometry(14, 68, 5);
  hk.translate(0, 34, 0);
  hk.rotateY(0.55);
  hk.translate(416, 0, -748);
  B.add(hk, "#6f8fb5", 1);
}

export function buildCampus(rand) {
  const r = rand ?? rng(7);
  const B = new Builder();

  houseQuad(B, -48, -18, 34, 30, r, { floors: 5 });
  eliotTower(B, -48, -3.5);
  houseQuad(B, -8, -36, 32, 30, r, { floors: 5, gap: 9 });
  lowellTower(B, -8, -22);
  houseQuad(B, 36, -18, 30, 28, r, { floors: 5 });
  dunsterTower(B, 36, -4.5);
  georgian(B, -84, -16, 22, 9, 5, 0.04, r);
  georgian(B, -84, -40, 9, 26, 4, 0, r);
  georgian(B, 6, -10, 9, 16, 4, 0, r);
  georgian(B, 64, -14, 9, 20, 6, 0, r);
  georgian(B, 64, -40, 20, 9, 5, 0, r);
  georgian(B, 86, -22, 9, 28, 7, 0, r, { roof: "flat" });
  georgian(B, -28, -62, 24, 10, 4, 0, r);
  georgian(B, 16, -66, 18, 10, 4, 0, r);
  georgian(B, 46, -64, 12, 18, 5, 0, r);
  georgian(B, -60, -66, 18, 10, 4, 0.08, r);

  widener(B, 6, -112);
  memorialChurch(B, -22, -132);
  georgian(B, 56, -112, 10, 34, 4, 0, r, { roof: "hip" });
  georgian(B, 40, -152, 30, 9, 4, 0, r);
  georgian(B, 64, -146, 9, 22, 4, 0, r);
  georgian(B, -70, -108, 9, 30, 4, 0, r, { roof: "hip" });
  georgian(B, 18, -82, 26, 8, 4, 0, r);
  georgian(B, -30, -84, 18, 8, 4, 0, r);
  B.box(-4, 0.02, -116, 120, 0.05, 80, C.lawn);

  weeksBridge(B, 14);
  boston(B, r);

  B.box(0, -0.02, 0, 1400, 0.06, 5, C.road);
  B.box(0, -0.02, RIVER.south + 6, 1400, 0.06, 5, C.road);
  B.box(0, 0.0, 6.5, 1400, 0.04, 6.5, C.lawn);
  B.box(0, 0.0, RIVER.south + 2.5, 1400, 0.04, 3.2, C.lawn);
  B.box(0, 0.04, 8.2, 1400, 0.03, 1.1, C.path);
  B.box(0, 0.04, RIVER.south + 1.8, 1400, 0.03, 1.1, C.path);
  B.box(30, 0.05, -102, 46, 0.03, 2.2, C.path);
  B.box(30, 0.05, -122, 46, 0.03, 2.2, C.path);
  B.box(20, 0.05, -112, 2.2, 0.03, 70, C.path);
  B.box(-2, -0.02, -74, 600, 0.05, 4.5, C.road);
  B.box(76, -0.02, -120, 4.5, 0.05, 200, C.road);
  for (const zz of [RIVER.north, RIVER.south]) B.box(0, -1.4, zz, 1400, 1.5, 1.2, C.stone);

  const geometry = B.merged();
  return { geometry, footprints: B.footprints };
}

/** street lamps along both banks and on the footbridge: positions for an instanced glow */
export function lampPositions() {
  const out = [];
  for (let x = -260; x <= 260; x += 13) {
    out.push([x, 3.3, 3.0]);
    if (Math.abs(x - 10) > 22 && (x < -110 || x > 70)) out.push([x + 6, 3.3, RIVER.south + 4.8]);
  }
  const z0 = RIVER.north - 3;
  const len = RIVER.south + 3 - z0;
  for (let z = RIVER.north + 2; z <= RIVER.south - 2; z += 9) {
    const t = (z - z0) / len;
    const deck = (1 - t) * (1 - t) * 0.2 + 2 * t * (1 - t) * 2.4 + t * t * 0.2;
    for (const s of [-1, 1]) out.push([14 + s * 1.95, deck + 2.6, z, deck]);
  }
  return out;
}

function inside(fps, x, z) {
  for (const f of fps) if (x > f[0] && x < f[1] && z > f[2] && z < f[3]) return true;
  return false;
}

/** tree placements [x, z, scale, kind] avoiding buildings, river, and camera sightlines */
export function treePlacements(footprints, count, r) {
  const out = [];
  const blocked = (x, z) => {
    if (z > RIVER.north - 1.5 && z < RIVER.south + 1.5) return true;
    if (Math.abs(z) < 3.5 || Math.abs(z - RIVER.south - 6) < 3.5 || Math.abs(z + 74) < 3.5) return true;
    if (x > 8 && x < 46 && z > -125 && z < -90) return true;
    if (x > -62 && x < 80 && z > RIVER.south && z < 280) return true;
    if (Math.abs(x - 14) < 4 && z > 0 && z < 60) return true;
    return inside(footprints, x, z);
  };
  const push = (x, z, s, kind) => { if (!blocked(x, z)) out.push([x, z, s, kind]); };

  for (let x = -330; x <= 330; x += 8.5) {
    push(x + (r() - 0.5) * 3, 6 + (r() - 0.5) * 2.5, 0.95 + r() * 0.4, 0);
    push(x + (r() - 0.5) * 3, RIVER.south + 9 + r() * 6, 0.9 + r() * 0.5, r() < 0.15 ? 1 : 0);
  }
  for (const [x, z] of [[-70, 106], [-84, 126], [-68, 144], [-96, 164], [92, 100], [104, 118], [88, 138], [120, 154], [-110, 104], [130, 104]]) push(x, z, 1.5 + r() * 0.4, 0);

  let guard = 0;
  const target = Math.floor(count * 0.32);
  while (out.length < target && guard++ < 20000) {
    const x = -70 + r() * 150;
    const z = -175 + r() * 100;
    push(x, z, 1.05 + r() * 0.5, 0);
  }
  guard = 0;
  const target2 = Math.floor(count * 0.55);
  while (out.length < target2 && guard++ < 20000) {
    const x = -110 + r() * 220;
    const z = -75 + r() * 80;
    push(x, z, 0.85 + r() * 0.5, r() < 0.12 ? 1 : 0);
  }
  guard = 0;
  while (out.length < count && guard++ < 40000) {
    const x = -600 + r() * 1200;
    const z = -620 + r() * 1100;
    if (Math.abs(x) < 120 && z > -180 && z < 120) continue;
    push(x, z, 0.8 + r() * 0.6, r() < 0.2 ? 1 : 0);
  }
  return out;
}

/** generic city blocks: [x, z, w, d, h, rot, colorIndex] */
export function cityBlocks(footprints, count, r) {
  const out = [];
  const step = 18;
  const fp = [...footprints, [-120, 110, -185, 70], [-160, 140, RIVER.south, 280], [300, 560, -800, -640]];
  const cells = [];
  for (let x = -720; x <= 720; x += step) for (let z = -900; z <= 680; z += step) cells.push([x, z]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (const [cx, cz] of cells) {
    if (out.length >= count) break;
    if (cz > RIVER.north - 8 && cz < RIVER.south + 8) continue;
    if (Math.hypot(cx, cz + 60) > 820) continue;
    const x = cx + (r() - 0.5) * 4;
    const z = cz + (r() - 0.5) * 4;
    const w = 7 + r() * 8;
    const d = 7 + r() * 8;
    if (inside(fp, x, z)) continue;
    const far = Math.hypot(x, z);
    const east = x > 250 && z < -100 && z > -640;
    let h = 2.4 + Math.floor(r() * 4) * 1.15;
    if (east && r() < 0.4) h += 8 + r() * 18;
    else if (far > 260 && r() < 0.08) h += 6 + r() * 10;
    out.push([x, z, w, d, h, (r() - 0.5) * 0.12, Math.floor(r() * 5)]);
  }
  return out;
}

export const CITY_COLORS = ["#8a5446", "#9b8f7e", "#7d6f63", "#a29684", "#6f5a50"];
export const TREE_COLORS = ["#4f6a34", "#5d7536", "#6c7a33", "#8a7a2e", "#a5682a", "#b0552c", "#41592f", "#73843a"];
