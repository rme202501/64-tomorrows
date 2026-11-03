import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { tempColor, clamp, lerp } from "../util.js";
import { BOUNDS, toUv, landMask, shelfMask, stateSegments } from "./geo.js";
import { terrainVert, terrainFrag, cloudVert, cloudFrag } from "./shaders.js";

const MID_LAT = (BOUNDS.south + BOUNDS.north) / 2;
const W = (BOUNDS.east - BOUNDS.west) * Math.cos((MID_LAT * Math.PI) / 180);
const D = BOUNDS.north - BOUNDS.south;
const RELIEF = 0.32;
const LINE_LIFT = 0.004;
const SPREAD_RANGE = [3, 19];
const BG = [5 / 255, 7 / 255, 13 / 255];

const raw = (hex) => {
  const c = new THREE.Color();
  const v = parseInt(hex.slice(1), 16);
  return c.setRGB(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, THREE.LinearSRGBColorSpace);
};

function rampTexture() {
  const n = 512;
  const cv = document.createElement("canvas");
  cv.width = n;
  cv.height = 1;
  const g = cv.getContext("2d");
  for (let k = 0; k < n; k++) {
    g.fillStyle = tempColor((k / (n - 1)) * 100);
    g.fillRect(k, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

function dataTexture(fields) {
  const { t2m_p50: t, t2m_spread: s, precip_p90: r } = fields;
  const { nT, nLat, nLon } = t;
  const size = nLat * nLon;
  const out = new Uint16Array(size * nT * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < size * nT; k++) {
    out[k * 4] = half(Number.isFinite(t.values[k]) ? t.values[k] : 50);
    out[k * 4 + 1] = half(Number.isFinite(s.values[k]) ? s.values[k] : 0);
    out[k * 4 + 2] = half(r && Number.isFinite(r.values[k]) ? r.values[k] : 0);
    out[k * 4 + 3] = half(1);
  }
  const tex = new THREE.DataArrayTexture(out, nLon, nLat, nT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const worldOf = (lon, lat, y = 0, out = new THREE.Vector3()) => {
  const [u, v] = toUv(lon, lat);
  return out.set((u - 0.5) * W, y, -(v - 0.5) * D);
};

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const edgeFade = (u, v) => smooth(0, 0.07, Math.min(u, 1 - u)) * smooth(0, 0.09, Math.min(v, 1 - v));

export function createMap(canvas, { ne, geo, mobile }) {
  const { meta, fields } = ne;
  const leads = meta.leads_h;
  const T = fields.t2m_p50;
  const S = fields.t2m_spread;
  const { nLat, nLon, nT } = T;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color().setRGB(...BG, THREE.LinearSRGBColorSpace), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);

  const maskCanvas = landMask(geo);
  const maskTex = new THREE.CanvasTexture(maskCanvas);
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.minFilter = THREE.LinearMipmapLinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const maskData = (() => {
    const g = maskCanvas.getContext("2d");
    const { data, width, height } = g.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const arr = new Float32Array(width * height);
    for (let k = 0; k < arr.length; k++) arr[k] = data[k * 4] / 255;
    return { arr, width, height };
  })();
  const shelf = shelfMask(maskCanvas);
  const shelfData = { arr: shelf.data, width: shelf.width, height: shelf.height };
  const shelfTex = (() => {
    const bytes = new Uint8Array(shelf.width * shelf.height * 4);
    for (let y = 0; y < shelf.height; y++) {
      for (let x = 0; x < shelf.width; x++) {
        const v = Math.round(shelf.data[(shelf.height - 1 - y) * shelf.width + x] * 255);
        bytes.fill(v, (y * shelf.width + x) * 4, (y * shelf.width + x) * 4 + 4);
      }
    }
    const tex = new THREE.DataTexture(bytes, shelf.width, shelf.height, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  })();
  const sampleMask = ({ arr, width, height }, u, v) => {
    const x = clamp(u) * (width - 1);
    const y = clamp(1 - v) * (height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = arr[y0 * width + x0] * (1 - fx) + arr[y0 * width + x1] * fx;
    const b = arr[y1 * width + x0] * (1 - fx) + arr[y1 * width + x1] * fx;
    return a * (1 - fy) + b * fy;
  };
  const landAt = (u, v) => sampleMask(maskData, u, v);
  const shelfAt = (u, v) => sampleMask(shelfData, u, v);

  const uniforms = {
    uData: { value: dataTexture(fields) },
    uMask: { value: maskTex },
    uShelf: { value: shelfTex },
    uRamp: { value: rampTexture() },
    uL0: { value: 0 },
    uL1: { value: 0 },
    uMix: { value: 0 },
    uGrid: { value: new THREE.Vector2(nLon, nLat) },
    uSize: { value: new THREE.Vector2(W, D) },
    uRelief: { value: RELIEF },
    uTime: { value: 0 },
    uSpread: { value: new THREE.Vector2(...SPREAD_RANGE) },
    uBg: { value: new THREE.Vector3(...BG) },
    uIso: { value: 1 },
  };

  const segX = mobile ? 200 : 300;
  const terrainGeo = new THREE.PlaneGeometry(W, D, segX, Math.round((segX * D) / W));
  terrainGeo.rotateX(-Math.PI / 2);
  const terrain = new THREE.Mesh(terrainGeo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    extensions: { derivatives: true },
  }));
  terrain.frustumCulled = false;
  scene.add(terrain);

  const segs = stateSegments(geo);
  const nSeg = segs.length;
  const base = new Float32Array(nSeg * 6);
  const uvs = new Float32Array(nSeg * 4);
  const colors = new Float32Array(nSeg * 6);
  const tmp = new THREE.Vector3();
  segs.forEach(([lo0, la0, lo1, la1], k) => {
    worldOf(lo0, la0, 0, tmp);
    base.set([tmp.x, 0, tmp.z], k * 6);
    worldOf(lo1, la1, 0, tmp);
    base.set([tmp.x, 0, tmp.z], k * 6 + 3);
    const a = toUv(lo0, la0);
    const b = toUv(lo1, la1);
    uvs.set([...a, ...b], k * 4);
    const fa = edgeFade(...a);
    const fb = edgeFade(...b);
    colors.set([fa, fa, fa, fb, fb, fb], k * 6);
  });
  const lineGeo = new LineSegmentsGeometry();
  lineGeo.setPositions(base);
  lineGeo.setColors(colors);
  const linePos = lineGeo.attributes.instanceStart.data;
  const landSeg = new Float32Array(nSeg * 2);
  for (let k = 0; k < nSeg * 2; k++) landSeg[k] = shelfAt(uvs[k * 2], uvs[k * 2 + 1]) * edgeFade(uvs[k * 2], uvs[k * 2 + 1]);

  const mkLine = (width, opacity, hex) => {
    const m = new LineMaterial({
      color: raw(hex),
      linewidth: width,
      vertexColors: true,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      worldUnits: false,
    });
    const l = new LineSegments2(lineGeo, m);
    l.frustumCulled = false;
    l.renderOrder = 2;
    scene.add(l);
    return m;
  };
  const glowMat = mkLine(4, 0.09, "#8fc4ff");
  const coreMat = mkLine(1.1, 0.7, "#e4efff");

  const cloudGeo = new THREE.PlaneGeometry(W, D, 1, 1);
  cloudGeo.rotateX(-Math.PI / 2);
  const cloudMats = [0.42, 0.62].map((y, k) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uLayer: { value: k }, uOpacity: { value: 1 } },
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(cloudGeo, mat);
    mesh.position.y = y;
    mesh.renderOrder = 3 + k;
    scene.add(mesh);
    return { mat, mesh };
  });

  const frame = { i0: 0, i1: 0, mix: 0, lead: leads[0] };
  const frameOf = (leadH) => {
    if (leadH <= leads[0]) return [0, 0, 0];
    if (leadH >= leads[nT - 1]) return [nT - 1, nT - 1, 0];
    let lo = 0;
    let hi = nT - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (leads[mid] <= leadH) lo = mid; else hi = mid;
    }
    return [lo, hi, (leadH - leads[lo]) / (leads[hi] - leads[lo])];
  };

  const sampleField = (field, u, v) => {
    const x = clamp(u) * (nLon - 1);
    const y = clamp(v) * (nLat - 1);
    const j0 = Math.floor(x);
    const i0 = Math.floor(y);
    const j1 = Math.min(nLon - 1, j0 + 1);
    const i1 = Math.min(nLat - 1, i0 + 1);
    const fx = x - j0;
    const fy = y - i0;
    const one = (t) => {
      const a = field.at(t, i0, j0) * (1 - fx) + field.at(t, i0, j1) * fx;
      const b = field.at(t, i1, j0) * (1 - fx) + field.at(t, i1, j1) * fx;
      return a * (1 - fy) + b * fy;
    };
    return lerp(one(frame.i0), one(frame.i1), frame.mix);
  };

  const heightAt = (u, v, land) => {
    const t = sampleField(T, u, v);
    return RELIEF * (0.15 + 0.85 * clamp((t - 25) / 55)) * land;
  };

  const meanSpread = new Float32Array(nT);
  {
    const step = 2;
    for (let t = 0; t < nT; t++) {
      let sum = 0;
      let wsum = 0;
      for (let i = 0; i < nLat; i += step) {
        for (let j = 0; j < nLon; j += step) {
          const w = landAt(j / (nLon - 1), i / (nLat - 1));
          if (w < 0.5) continue;
          sum += S.at(t, i, j);
          wsum += 1;
        }
      }
      meanSpread[t] = wsum ? sum / wsum : 0;
    }
  }

  function setLead(leadH) {
    const [i0, i1, mix] = frameOf(leadH);
    if (i0 === frame.i0 && i1 === frame.i1 && Math.abs(mix - frame.mix) < 1e-5) return false;
    Object.assign(frame, { i0, i1, mix, lead: leadH });
    uniforms.uL0.value = i0;
    uniforms.uL1.value = i1;
    uniforms.uMix.value = mix;
    const arr = linePos.array;
    for (let k = 0; k < nSeg * 2; k++) {
      arr[k * 3 + 1] = heightAt(uvs[k * 2], uvs[k * 2 + 1], landSeg[k]) + LINE_LIFT;
    }
    linePos.needsUpdate = true;
    const u = smooth(SPREAD_RANGE[0], SPREAD_RANGE[1], spreadAtLead());
    coreMat.opacity = 0.7 - 0.3 * u;
    glowMat.opacity = 0.09 - 0.04 * u;
    return true;
  }

  const spreadAtLead = () => lerp(meanSpread[frame.i0], meanSpread[frame.i1], frame.mix);

  const cambridge = worldOf(-71.1167, 42.377);
  const rig = {
    close: { target: cambridge.clone(), dist: 2.1, polar: 0.98, az: 0.12 },
    wide: { target: new THREE.Vector3(0, 0, 0.25), dist: 14, polar: 0.74, az: 0 },
    shiftClose: new THREE.Vector2(),
    shiftWide: new THREE.Vector2(),
  };
  const view = { k: 1, descend: 0 };
  const size = { w: 1, h: 1, safe: { top: 0, right: 0, bottom: 0, left: 0 } };

  const placeCamera = (target, dist, polar, az, shift) => {
    const sp = Math.sin(polar);
    camera.position.set(
      target.x + dist * sp * Math.sin(az),
      target.y + dist * Math.cos(polar),
      target.z + dist * sp * Math.cos(az),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -shift.x;
    camera.projectionMatrix.elements[9] = -shift.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };

  const safeRect = () => {
    const { w, h, safe } = size;
    return {
      x0: (safe.left / w) * 2 - 1,
      x1: 1 - (safe.right / w) * 2,
      y0: (safe.bottom / h) * 2 - 1,
      y1: 1 - (safe.top / h) * 2,
    };
  };

  let corners = [];
  const setFrame = (portrait) => {
    corners = [];
    rig.wide.polar = portrait ? 0.42 : 0.74;
    rig.close.dist = portrait ? 2.4 : 2.1;
    for (const u of portrait ? [0.27, 0.6, 0.96] : [0.04, 0.5, 0.96]) {
      for (const v of portrait ? [0.08, 0.93] : [0.05, 0.95]) {
        for (const y of [0, RELIEF]) corners.push(new THREE.Vector3((u - 0.5) * W, y, -(v - 0.5) * D));
      }
    }
  };
  const boxAt = (dist, shift) => {
    placeCamera(rig.wide.target, dist, rig.wide.polar, rig.wide.az, shift);
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const c of corners) {
      tmp.copy(c).project(camera);
      x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x);
      y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y);
    }
    return { x0, x1, y0, y1 };
  };

  function fit() {
    const r = safeRect();
    const sw = r.x1 - r.x0;
    const sh = r.y1 - r.y0;
    const zero = new THREE.Vector2();
    let lo = 3;
    let hi = 80;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      const b = boxAt(mid, zero);
      if (b.x1 - b.x0 <= sw && b.y1 - b.y0 <= sh) hi = mid; else lo = mid;
    }
    rig.wide.dist = hi;
    const b = boxAt(hi, zero);
    rig.shiftWide.set((r.x0 + r.x1) / 2 - (b.x0 + b.x1) / 2, (r.y0 + r.y1) / 2 - (b.y0 + b.y1) / 2);
    rig.shiftClose.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 + 0.05);
  }

  const target = new THREE.Vector3();
  const shift = new THREE.Vector2();
  function applyView() {
    const { k, descend } = view;
    target.lerpVectors(rig.close.target, rig.wide.target, k);
    const closeDist = rig.close.dist * lerp(1, 1.9, descend);
    const dist = Math.exp(lerp(Math.log(closeDist), Math.log(rig.wide.dist), k));
    const polar = lerp(rig.close.polar - descend * 0.35, rig.wide.polar, k);
    const az = lerp(rig.close.az + descend * 0.25, rig.wide.az, k);
    shift.lerpVectors(rig.shiftClose, rig.shiftWide, k);
    placeCamera(target, dist, polar, az, shift);
  }

  function setView(k, descend = 0) {
    view.k = k;
    view.descend = descend;
  }

  function resize(w, h, dpr, safe, portrait = mobile) {
    setFrame(portrait);
    size.w = w;
    size.h = h;
    size.safe = safe;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    for (const m of [glowMat, coreMat]) m.resolution.set(w * dpr, h * dpr);
    fit();
  }

  const projV = new THREE.Vector3();
  function project(lon, lat, lift = 0.02) {
    const [u, v] = toUv(lon, lat);
    const h = heightAt(u, v, shelfAt(u, v) * edgeFade(u, v)) + lift;
    worldOf(lon, lat, h, projV).project(camera);
    return {
      x: (projV.x * 0.5 + 0.5) * size.w,
      y: (-projV.y * 0.5 + 0.5) * size.h,
      visible: projV.z < 1 && Math.abs(projV.x) < 1.1 && Math.abs(projV.y) < 1.1,
    };
  }

  function sample(lon, lat) {
    const [u, v] = toUv(lon, lat);
    return { temp: sampleField(T, u, v), spread: sampleField(S, u, v) };
  }

  function render(time, cloudOpacity = 1) {
    uniforms.uTime.value = time;
    for (const { mat, mesh } of cloudMats) {
      mat.uniforms.uOpacity.value = cloudOpacity;
      mesh.visible = cloudOpacity > 0.001;
    }
    applyView();
    renderer.render(scene, camera);
  }

  setLead(leads[0] + 1e-6);
  setLead(leads[0]);

  return {
    leads,
    maxLead: leads[nT - 1],
    meanSpread,
    spreadRange: SPREAD_RANGE,
    setLead,
    setView,
    spreadAtLead,
    resize,
    project,
    sample,
    render,
  };
}
