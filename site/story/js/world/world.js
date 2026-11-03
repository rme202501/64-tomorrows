import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng, tempColor, ease, clamp, smoothstep } from "../util.js";
import { skyState } from "./astro.js";
import { createPalette, samplePalette } from "./palette.js";
import { SkyShader, WaterShader, RainShader, FractureShader, patchBuildings, patchTrees } from "./shaders.js";
import { buildCampus, lampPositions, treePlacements, cityBlocks, RIVER, CITY_COLORS, TREE_COLORS } from "./campus.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** camera presets. minH = minimum horizontal fov (deg) kept on narrow screens; m = portrait override */
const PRESETS = {
  heroWide: { pos: V(-58, 12, 132), tgt: V(-2, 11, -40), fov: 26, minH: 34, m: { pos: V(-30, 12, 132), tgt: V(-6, 11, -40), minH: 30 } },
  hero: { pos: V(-34, 3.2, 124), tgt: V(-4, 9.5, -40), fov: 28, minH: 36, m: { pos: V(-16, 3.2, 126), tgt: V(-6, 9, -40), minH: 30 } },
  street: { pos: V(36, 1.75, -95), tgt: V(0, 7.5, -116), fov: 48, minH: 44, m: { pos: V(40, 1.75, -93), tgt: V(2, 8, -115), minH: 32 } },
  high: { pos: V(150, 95, 125), tgt: V(-10, 0, -55), fov: 36, minH: 40 },
  sky: { pos: V(30, 880, 150), tgt: V(0, 0, -60), fov: 38, minH: 40 },
};

const LIT = [[0, 0.32], [2, 0.18], [5, 0.12], [7, 0.32], [9, 0.25], [16, 0.4], [19, 0.62], [22, 0.55], [24, 0.32]];

function litFraction(h) {
  for (let i = 0; i < LIT.length - 1; i++) {
    const a = LIT[i];
    const b = LIT[i + 1];
    if (h >= a[0] && h <= b[0]) return a[1] + ((h - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return 0.3;
}

function tzOffsetMs(ms) {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(d);
  const get = (t) => +parts.find((p) => p.type === t).value;
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return local - Math.floor(ms / 60000) * 60000;
}

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function desaturate(color, amt, out) {
  const l = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  out.setRGB(color.r + (l - color.r) * amt, color.g + (l - color.g) * amt, color.b + (l - color.b) * amt);
  return out;
}

export async function createWorld(canvas, ctx) {
  const mobile = ctx.mobile;
  const reduced = ctx.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dprCap = mobile ? 1.5 : 2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1224, 0.0016);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.4, 9000);

  const shared = {
    uTime: { value: 0 },
    uNight: { value: 1 },
    uLit: { value: 0.3 },
    uGlow: { value: 0.5 },
    uDay: { value: 0 },
    uWind: { value: 5 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
  };

  const hemi = new THREE.HemisphereLight(0x22355e, 0x0b0d14, 0.5);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffffff, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sunLight.shadow.camera;
  sc.left = -170; sc.right = 170; sc.top = 170; sc.bottom = -170; sc.near = 1; sc.far = 900;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.35;
  sunLight.target.position.set(-5, 0, -55);
  scene.add(sunLight, sunLight.target);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, depthTest: false }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const su = sky.material.uniforms;
  su.uTime = shared.uTime;

  const r = rng(1710);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groundColor = (x, z, out) => {
    const n = Math.sin(x * 0.013 + z * 0.007) * 0.5 + Math.sin(x * 0.031 - z * 0.023) * 0.5;
    const park = smoothstep(0.35, 0.8, n) * 0.6;
    out.set("#58564f").lerp(tmpA.set("#4f5e3a"), park);
    const yard = Math.abs(x + 4) < 70 && z < -70 && z > -165 ? 1 : 0;
    if (yard) out.lerp(tmpA.set("#55693b"), 0.85);
    return out;
  };
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  const tmpC = new THREE.Color();
  for (const [z0, z1] of [[-1500, RIVER.north], [RIVER.south, 1400]]) {
    const g = new THREE.PlaneGeometry(3000, z1 - z0, 60, Math.max(4, Math.round((z1 - z0) / 50)));
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      groundColor(pos.getX(i), pos.getZ(i), tmpB);
      col[i * 3] = tmpB.r; col[i * 3 + 1] = tmpB.g; col[i * 3 + 2] = tmpB.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, groundMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  const { geometry: campusGeo, footprints } = buildCampus(r);
  campusGeo.computeVertexNormals();
  const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchBuildings(buildingMat, shared);
  const campus = new THREE.Mesh(campusGeo, buildingMat);
  campus.castShadow = true;
  campus.receiveShadow = true;
  scene.add(campus);

  const blocks = cityBlocks(footprints, mobile ? 900 : 1800, r);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  {
    const n = boxGeo.attributes.position.count;
    const nrm = boxGeo.attributes.normal;
    const col = new Float32Array(n * 3);
    const aw = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const top = nrm.getY(i) > 0.5;
      const k = top ? 0.42 : 1;
      col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 1.04;
      aw[i * 2] = top ? 0 : 1;
    }
    boxGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    boxGeo.setAttribute("aWin", new THREE.BufferAttribute(aw, 2));
  }
  const cityMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchBuildings(cityMat, shared);
  const city = new THREE.InstancedMesh(boxGeo, cityMat, blocks.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const vp = new THREE.Vector3();
  const vs = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const cityColors = CITY_COLORS.map((c) => new THREE.Color(c));
  blocks.forEach(([x, z, w, d, h, rot, ci], i) => {
    q.setFromAxisAngle(yAxis, rot);
    m4.compose(vp.set(x, 0, z), q, vs.set(w, h, d));
    city.setMatrixAt(i, m4);
    city.setColorAt(i, tmpA.copy(cityColors[ci]).multiplyScalar(0.9 + r() * 0.2));
  });
  city.castShadow = true;
  city.receiveShadow = true;
  scene.add(city);

  const trees = treePlacements(footprints, mobile ? 420 : 820, r);
  const flat = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.computeVertexNormals();
    return n;
  };
  const crownGeo = flat(mergeGeometries([
    new THREE.IcosahedronGeometry(1, 0).scale(1, 1.05, 1).translate(0, 1.45, 0),
    new THREE.IcosahedronGeometry(0.72, 0).rotateY(0.6).translate(0.28, 2.25, 0.12),
  ].map((g) => { g.deleteAttribute("uv"); return g; })));
  const pineGeo = flat(new THREE.ConeGeometry(0.8, 2.8, 6, 1).translate(0, 2.0, 0));
  const trunkGeo = flat(new THREE.CylinderGeometry(0.09, 0.15, 1.3, 5, 1, true).translate(0, 0.65, 0));
  const crownMat = new THREE.MeshLambertMaterial();
  patchTrees(crownMat, shared, "crown");
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2c24 });
  patchTrees(trunkMat, shared, "trunk");
  const decid = trees.filter((t) => t[3] === 0);
  const pines = trees.filter((t) => t[3] === 1);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, decid.length);
  const pineMesh = new THREE.InstancedMesh(pineGeo, crownMat, pines.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const treeColors = TREE_COLORS.map((c) => new THREE.Color(c));
  const pineColor = new THREE.Color("#2f4a2e");
  let ti = 0;
  const placeTree = (mesh, list, color) => list.forEach(([x, z, s], i) => {
    const sc2 = s * 2.0;
    q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
    m4.compose(vp.set(x, 0, z), q, vs.set(sc2 * (0.9 + r() * 0.25), sc2 * (0.85 + r() * 0.35), sc2 * (0.9 + r() * 0.25)));
    mesh.setMatrixAt(i, m4);
    trunks.setMatrixAt(ti++, m4);
    const c = color ?? treeColors[Math.floor(r() * treeColors.length)];
    mesh.setColorAt(i, tmpA.copy(c).multiplyScalar(0.85 + r() * 0.3));
  });
  placeTree(crowns, decid);
  placeTree(pineMesh, pines, pineColor);
  for (const mesh of [crowns, pineMesh, trunks]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const lamps = lampPositions();
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lampHeads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.14, 1), lampMat, lamps.length);
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 1, 5);
  poleGeo.translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x23262b }), lamps.length);
  lamps.forEach(([x, y, z, base = 0], i) => {
    m4.makeTranslation(x, y, z);
    lampHeads.setMatrixAt(i, m4);
    m4.compose(vp.set(x, base, z), q.identity(), vs.set(1, y - base - 0.15, 1));
    poles.setMatrixAt(i, m4);
  });
  scene.add(lampHeads, poles);

  const reflScale = mobile ? 0.4 : 0.5;
  const water = new Reflector(new THREE.PlaneGeometry(3000, RIVER.south - RIVER.north + 4), {
    shader: WaterShader,
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.003,
    color: 0xb4c0cc,
    multisample: 0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.32, (RIVER.north + RIVER.south) / 2);
  water.material.fog = true;
  const wu = water.material.uniforms;
  wu.uTime = shared.uTime;
  scene.add(water);

  const rainN = mobile ? 2500 : 6000;
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  rainGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const offs = new Float32Array(rainN * 4);
  for (let i = 0; i < rainN; i++) {
    offs[i * 4] = r(); offs[i * 4 + 1] = r(); offs[i * 4 + 2] = r(); offs[i * 4 + 3] = r();
  }
  rainGeo.setAttribute("aOff", new THREE.InstancedBufferAttribute(offs, 4));
  rainGeo.instanceCount = rainN;
  const rainMat = new THREE.ShaderMaterial({ ...RainShader, uniforms: THREE.UniformsUtils.clone(RainShader.uniforms), transparent: true, depthWrite: false });
  rainMat.uniforms.uTime = shared.uTime;
  const rain = new THREE.Mesh(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.95);
  composer.addPass(bloom);
  const fracture = new ShaderPass(FractureShader);
  composer.addPass(fracture);
  composer.addPass(new OutputPass());
  const fu = fracture.uniforms;
  const memberBytes = new Uint8Array(64 * 4);
  const membersTex = new THREE.DataTexture(memberBytes, 64, 1, THREE.RGBAFormat);
  membersTex.magFilter = THREE.NearestFilter;
  membersTex.minFilter = THREE.NearestFilter;
  membersTex.needsUpdate = true;
  fu.uMembers.value = membersTex;
  fu.uCols.value = mobile ? 32 : 64;
  su.uMembers.value = membersTex;
  su.uN.value = mobile ? 32 : 64;
  fu.uTime = shared.uTime;

  const order = Array.from({ length: 64 }, (_, i) => i);
  {
    const rr = rng(64);
    for (let i = 63; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  let width = 0;
  let height = 0;
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    const dpr = Math.min(devicePixelRatio || 1, dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    fu.uRes.value.set(w * dpr, h * dpr);
    water.getRenderTarget().setSize(Math.round(w * dpr * reflScale), Math.round(h * dpr * reflScale));
    camera.aspect = w / h;
    camState.dirty = true;
  }

  const data = ctx.data;
  const state = {
    timeMs: +(data?.valid?.[0] ?? Date.now()),
    targetMs: +(data?.valid?.[0] ?? Date.now()),
    tzOff: 0,
    tzAt: -Infinity,
    w: { tempF: 55, cloud: 20, rain: 0, wind: 6, windDir: 270 },
    tw: { tempF: 55, cloud: 20, rain: 0, wind: 6, windDir: 270 },
    u: 0,
    tu: 0,
    membersIn: null,
    rainIn: null,
    memberKey: NaN,
    autoLead: NaN,
    dim: 0,
    tdim: 0,
    cloudOff: new THREE.Vector2(),
  };
  state.tzOff = tzOffsetMs(state.targetMs);
  state.tzAt = state.targetMs;

  const camState = {
    pos: V(0, 0, 0), tgt: V(0, 0, 0), fov: 36,
    dPos: V(0, 0, 0), dTgt: V(0, 0, 0), dFov: 36,
    rate: 2, init: false, dirty: true,
    a: null, b: null, t: 0, single: "hero",
  };
  const tmpPos = V(0, 0, 0);
  const tmpTgt = V(0, 0, 0);
  const tmpPos2 = V(0, 0, 0);
  const tmpTgt2 = V(0, 0, 0);

  function presetInto(name, pos, tgt) {
    const p = PRESETS[name] ?? PRESETS.hero;
    const aspect = camera.aspect || 1;
    const t = p.m ? smoothstep(1.1, 0.6, aspect) : 0;
    pos.copy(p.pos);
    tgt.copy(p.tgt);
    if (t > 0) {
      pos.lerp(p.m.pos, t);
      tgt.lerp(p.m.tgt, t);
    }
    const rad = Math.PI / 180;
    const minH = p.m?.minH ? p.minH + (p.m.minH - p.minH) * t : p.minH;
    return Math.max(p.fov, (2 * Math.atan(Math.tan((minH * rad) / 2) / aspect)) / rad);
  }

  function resolveCamera() {
    if (camState.a && camState.b) {
      const fa = presetInto(camState.a, tmpPos, tmpTgt);
      const fb = presetInto(camState.b, tmpPos2, tmpTgt2);
      const e = ease.inOut(clamp(camState.t));
      const dist = tmpPos.distanceTo(tmpPos2);
      camState.dPos.copy(tmpPos).lerp(tmpPos2, e);
      camState.dPos.y += Math.sin(Math.PI * e) * Math.min(60, dist * 0.18);
      camState.dTgt.copy(tmpTgt).lerp(tmpTgt2, e);
      camState.dFov = fa + (fb - fa) * e;
    } else {
      camState.dFov = presetInto(camState.single, camState.dPos, camState.dTgt);
    }
  }

  const astro = { sun: V(0, 1, 0), moon: V(0, -1, 0), sunAlt: 0, moonAlt: 0, moonFraction: 0.5 };
  const pal = createPalette();
  const fogCol = new THREE.Color();
  const lightDir = V(0, 1, 0);
  const tint = fu.uTint.value;
  const moonColor = new THREE.Color("#9db4e6");
  const drift = V(0, 0, 0);

  function applyEnvironment(dt) {
    skyState(state.timeMs, astro);
    const sunAlt = astro.sunAlt;
    samplePalette(sunAlt, pal);
    const w = state.w;
    const cloud = clamp(w.cloud / 100);
    const rainK = smoothstep(0, 3, w.rain);
    const over = clamp(cloud * 0.8 + rainK * 0.35);
    const day = smoothstep(-6, 12, sunAlt);

    desaturate(pal.zenith, over * 0.75, tmpA).multiplyScalar(1 - over * 0.25 * day);
    su.uZenith.value.copy(tmpA);
    desaturate(pal.horizon, over * 0.7, su.uHorizon.value);
    su.uGlow.value.copy(pal.glow);
    desaturate(pal.fog, over * 0.6, fogCol).multiplyScalar(1 - rainK * 0.2);
    su.uFog.value.copy(fogCol);
    scene.fog.color.copy(fogCol);
    su.uSun.value.copy(astro.sun);
    su.uMoon.value.copy(astro.moon);
    su.uSunI.value = smoothstep(-3, 2, sunAlt) * (1 - over * 0.92);
    su.uGlowI.value = (Math.exp(-((sunAlt / 7) ** 2)) * 0.9 + 0.08 * day) * (1 - over * 0.75);
    su.uStars.value = (1 - smoothstep(-15, -5, sunAlt)) * (1 - over);
    su.uMoonI.value = smoothstep(-0.02, 0.06, astro.moon.y) * (1 - 0.8 * smoothstep(-6, 4, sunAlt)) * (1 - over * 0.9);
    su.uCloud.value = cloud;
    su.uCloudDark.value = rainK * 0.8;
    su.uCityGlow.value = 1 - day;
    tmpB.copy(pal.light).lerp(pal.hemiSky, 0.4).multiplyScalar(0.25 + day * 0.85);
    su.uCloudLit.value.copy(tmpB).lerp(tmpC.setRGB(0.32, 0.2, 0.14), (1 - day) * 0.35);
    su.uCloudShade.value.copy(fogCol).multiplyScalar(0.55 + day * 0.35);
    const k = 0.004 * (w.wind + 3);
    state.cloudOff.x += shared.uWindDir.value.x * k * dt;
    state.cloudOff.y += shared.uWindDir.value.y * k * dt;
    su.uCloudOff.value.copy(state.cloudOff);

    const sunI = pal.lightI * (1 - over * 0.8);
    const moonI = 0.55 * astro.moonFraction * smoothstep(0, 0.12, astro.moon.y) * (1 - smoothstep(-10, -4, sunAlt)) * (1 - over * 0.8);
    if (sunAlt > -4) {
      lightDir.copy(astro.sun);
      sunLight.color.copy(pal.light);
      sunLight.intensity = sunI;
    } else {
      lightDir.copy(astro.moon);
      sunLight.color.copy(moonColor);
      sunLight.intensity = moonI;
    }
    if (lightDir.y < 0.06) lightDir.y = 0.06;
    lightDir.normalize();
    sunLight.position.copy(sunLight.target.position).addScaledVector(lightDir, 400);
    desaturate(pal.hemiSky, over * 0.6, hemi.color);
    hemi.groundColor.copy(pal.hemiGround);
    hemi.intensity = pal.hemiI * (1 + over * 0.15);
    renderer.toneMappingExposure = pal.exposure * (1 + over * 0.12);

    const lh = (((state.timeMs + state.tzOff) / 3600e3) % 24 + 24) % 24;
    const night = 1 - smoothstep(-7, 3, sunAlt);
    shared.uNight.value = Math.min(1, night + over * 0.18 * day);
    shared.uLit.value = litFraction(lh);
    shared.uGlow.value = night * 0.6;
    shared.uDay.value = day;
    const lampK = smoothstep(0.15, 0.7, night + over * 0.3);
    lampMat.color.setRGB(0.18 + lampK * 3.2, 0.17 + lampK * 2.1, 0.15 + lampK * 1.0);

    const camY = camera.position.y;
    scene.fog.density = (0.0017 * (1 + over * 0.5 + rainK * 1.1)) / (1 + Math.max(0, camY - 10) / 70);

    wu.uWind.value = w.wind;
    wu.uRain.value = smoothstep(0.05, 4, w.rain) * 0.6;
    wu.uSky.value.copy(su.uHorizon.value);
    bloom.strength = 0.2 + night * 0.38;

    const density = clamp(Math.sqrt(w.rain / 8));
    rain.visible = density > 0.01;
    rainMat.uniforms.uDensity.value = density;
    rainMat.uniforms.uCam.value.copy(camera.position);
    rainMat.uniforms.uWind.value.copy(shared.uWindDir.value).multiplyScalar(w.wind * 0.18);
    rainMat.uniforms.uColor.value.setRGB(0.5, 0.56, 0.66).multiplyScalar(0.35 + day * 0.9);

    const cold = smoothstep(50, 15, w.tempF);
    const warm = smoothstep(70, 95, w.tempF);
    tint.set(1 + 0.07 * warm - 0.05 * cold, 1 + 0.01 * warm - 0.005 * cold, 1 - 0.08 * warm + 0.07 * cold);
  }

  function updateMembers() {
    let temps = state.membersIn;
    let rains = state.rainIn;
    if (!temps && data) {
      const lead = clamp(data.leadOf(new Date(state.timeMs)), data.leads[0], data.maxLead);
      if (Math.abs(lead - state.autoLead) < 0.5) return;
      state.autoLead = lead;
      temps = data.membersAt("t2m", lead);
      rains = data.membersAt("precip", lead);
    }
    if (!temps) return;
    let key = 0;
    for (let i = 0; i < temps.length; i++) key += temps[i] * (i + 1) + (rains ? rains[i] * 7.1 * (i + 3) : 0);
    if (key === state.memberKey) return;
    state.memberKey = key;
    let mean = 0;
    for (let i = 0; i < temps.length; i++) mean += temps[i];
    mean /= temps.length;
    for (let s = 0; s < 64; s++) {
      const i = order[s] % temps.length;
      tmpA.setStyle(tempColor(60 + (temps[i] - mean) * 2.2));
      memberBytes[s * 4] = Math.round(clamp(tmpA.r) * 255);
      memberBytes[s * 4 + 1] = Math.round(clamp(tmpA.g) * 255);
      memberBytes[s * 4 + 2] = Math.round(clamp(tmpA.b) * 255);
      memberBytes[s * 4 + 3] = rains ? Math.round(smoothstep(0.15, 1.2, rains[i]) * 255) : 0;
    }
    membersTex.needsUpdate = true;
  }

  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });
  let firstFrame = true;

  function step(dt) {
    elapsed += dt;
    shared.uTime.value = elapsed;
    resize();

    const diff = state.targetMs - state.timeMs;
    if (Math.abs(diff) > 36 * 3600e3) state.timeMs = state.targetMs;
    else state.timeMs += diff * damp(5, dt);

    const w = state.w;
    const tw = state.tw;
    const kw = damp(3, dt);
    w.tempF += (tw.tempF - w.tempF) * kw;
    w.cloud += (tw.cloud - w.cloud) * kw;
    w.rain += (tw.rain - w.rain) * kw;
    w.wind += (tw.wind - w.wind) * kw;
    let dd = ((tw.windDir - w.windDir + 540) % 360) - 180;
    w.windDir += dd * kw;
    const wr = (w.windDir * Math.PI) / 180;
    shared.uWindDir.value.set(-Math.sin(wr), Math.cos(wr));
    shared.uWind.value = w.wind;

    state.u += (state.tu - state.u) * damp(4, dt);
    if (state.tu === 0 && state.u < 0.002) state.u = 0;
    fu.uU.value = state.u;
    su.uU.value = state.u;
    if (state.u > 0) updateMembers();
    state.dim += (state.tdim - state.dim) * damp(5, dt);
    fu.uDim.value = state.dim;

    if (camState.dirty) {
      resolveCamera();
      camState.dirty = false;
    }
    if (!camState.init) {
      camState.pos.copy(camState.dPos);
      camState.tgt.copy(camState.dTgt);
      camState.fov = camState.dFov;
      camState.init = true;
    } else {
      const kc = damp(camState.rate, dt);
      camState.pos.lerp(camState.dPos, kc);
      camState.tgt.lerp(camState.dTgt, kc);
      camState.fov += (camState.dFov - camState.fov) * kc;
    }
    const amp = reduced ? 0 : camState.pos.distanceTo(camState.tgt) * 0.005;
    drift.set(Math.sin(elapsed * 0.13) * 1.2, Math.sin(elapsed * 0.19 + 1) * 0.35, Math.cos(elapsed * 0.11) * 0.8).multiplyScalar(amp);
    camera.position.copy(camState.pos).add(drift);
    if (camera.position.y < 0.8) camera.position.y = 0.8;
    camera.lookAt(camState.tgt);
    if (Math.abs(camera.fov - camState.fov) > 1e-3) {
      camera.fov = camState.fov;
      camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    camera.updateMatrixWorld();
    su.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    su.uCamPos.value.copy(camera.position);

    applyEnvironment(dt);
    composer.render(dt);
    if (firstFrame) {
      firstFrame = false;
      resolveReady();
    }
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    step(dt);
  }

  function syncRunning() {
    const want = visible && !document.hidden;
    if (want && !running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!want && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }
  document.addEventListener("visibilitychange", syncRunning);
  window.addEventListener("resize", () => { camState.dirty = true; });

  resolveCamera();
  syncRunning();

  const api = {
    ready,
    scene,
    camera,
    renderer,
    get time() { return new Date(state.timeMs); },
    setTime(date) {
      const ms = +date;
      if (!Number.isFinite(ms)) return;
      state.targetMs = ms;
      if (Math.abs(ms - state.tzAt) > 6 * 3600e3) {
        state.tzOff = tzOffsetMs(ms);
        state.tzAt = ms;
      }
    },
    setWeather(wx = {}) {
      const tw = state.tw;
      for (const k of ["tempF", "cloud", "rain", "wind", "windDir"]) if (Number.isFinite(wx[k])) tw[k] = wx[k];
    },
    setUncertainty(u, opts = {}) {
      state.tu = clamp(+u || 0);
      state.membersIn = opts.members ?? null;
      state.rainIn = opts.rain ?? null;
      if (opts.members) state.autoLead = NaN;
    },
    setCamera(name) {
      if (camState.single === name && !camState.a) return;
      camState.single = name;
      camState.a = null;
      camState.b = null;
      camState.rate = 1.4;
      camState.dirty = true;
    },
    setCameraPath(from, to, t) {
      camState.a = from;
      camState.b = to;
      camState.t = t;
      camState.single = t >= 0.5 ? to : from;
      camState.rate = 9;
      camState.dirty = true;
    },
    settle() {
      state.timeMs = state.targetMs;
      Object.assign(state.w, state.tw);
      state.u = state.tu;
      state.dim = state.tdim;
      camState.dirty = true;
      camState.init = false;
    },
    setVisible(v) {
      visible = !!v;
      canvas.style.visibility = visible ? "visible" : "hidden";
      syncRunning();
    },
    setDim(x) { state.tdim = clamp(+x || 0); },
  };
  return api;
}
