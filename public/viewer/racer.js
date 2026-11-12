// Monke RC — 3D drawing, input, sound and flow. The rules live in racer-sim.js.
// three.js scene: jungle ground, the day's track (road ribbon, curbs, bamboo barriers,
// boost pads, start gate), trees, the player's RC buggy (colours from caves-weapons.js
// weaponFor(n), looks only) with their 3D block monke in the seat, and a see-through
// ghost of their best race.
import * as THREE from "three";
import { imageFor, loadImage, readGrid, buildMonke } from "/viewer/monkeModel.js";
import { weaponFor } from "/viewer/caves-weapons.js";
import { RV, DT, LAPS, ROAD_W, SHOULDER, V_MAX, V_BOOST, DRIFT_TIERS, driftTier, launch, buildTrack, createRun, step, speedOf, sideOf, ghostAt, autopilot, todayId, rng } from "/viewer/racer-sim.js";

const params = new URLSearchParams(location.search);
const inApp = (() => { if (window.ReactNativeWebView) return true; try { return parent !== window && parent.location.origin === location.origin; } catch { return false; } })();
const DEMO = !inApp || params.get("mode") === "demo";
const GET_APP = `<a href="https://onlymonkes.app/get" target="_blank" rel="noopener">Get OnlyMonkes</a>`;
const isTouch = matchMedia("(pointer: coarse)").matches;
const AUTO = params.has("auto");

// ── Pilot ──
let n = parseInt(params.get("n") || "", 10);
if (!imageFor(n)) { do n = 1 + Math.floor(Math.random() * 8888); while (!imageFor(n)); }
const looks = weaponFor(n);
const HULL = looks.held.body, TRIM = looks.held.accent;
const GLOW = looks.shot.color === "rainbow" ? "#ff4fd8" : looks.shot.color;

// ── Course ──
const COURSE = DEMO ? "demo" : todayId();
const COURSE_NAME = DEMO ? "DEMO TRACK" : `DAILY · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`;
const T = buildTrack(COURSE);

// ── Storage (per device, never required) ──
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* full or private */ } },
};
const K = { best: `rc:best:${RV}:${COURSE}`, ghost: `rc:ghost:${RV}:${COURSE}`, lap: `rc:lap:${RV}:${COURSE}` };
let best = Number(store.get(K.best)) || null, bestLap = Number(store.get(K.lap)) || null;
let ghost = null; try { ghost = JSON.parse(store.get(K.ghost) || "null"); } catch { ghost = null; }
let ghostOn = store.get("rc:ghostOn") !== "0", soundOn = store.get("rc:sound") !== "0";

// The day's #1 race as a gold ghost (worker racer.ts; only in the app, only once the board is live).
let leader = null;
if (inApp && !DEMO) {
  fetch(`/api/racer/ghost?day=${COURSE}`).then((r) => (r.ok ? r.json() : null)).then((g) => {
    if (g && Array.isArray(g.ghost) && g.ghost.length > 40 && Number.isFinite(g.t)) leader = { name: String(g.name || "Leader").slice(0, 24), t: g.t, ghost: g.ghost }; showLeaderLine();
  }).catch(() => {});
}

// ── Renderer ──
const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 1.5, 2600);
function fit() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener("resize", fit); fit();

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Sky + light
scene.background = canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#5fb2ff"); gr.addColorStop(0.55, "#bfe4ff"); gr.addColorStop(1, "#fff4d6");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, false);
scene.fog = new THREE.Fog(0xcfe9f2, 260, 1100);
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x3a5a2a, 1.25));
const sun = new THREE.DirectionalLight(0xfff1d0, 1.6); sun.position.set(-300, 500, 200); scene.add(sun);

// Ground
const R = rng(T.seed ^ 0x9e37);
const grassTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#3f8a3a"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const s = R(); g.fillStyle = s < 0.5 ? "#4a9a42" : s < 0.8 ? "#367a32" : "#5aa94c"; g.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3); }
});
grassTex.repeat.set(120, 120);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ map: grassTex }));
// Well under the road ribbons: a thin gap z-fights (grass stripes through the road) on some GPUs.
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.6; scene.add(ground);

// Track ribbons: a strip between two side offsets along the centreline.
function ribbon(off0, off1, y, mat, vScale) {
  const N = T.N, pos = [], uv = [], idx = [];
  let v = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = T.pts[k], nn = T.nor[k];
    pos.push(p[0] + nn[0] * off0, y, p[1] + nn[1] * off0, p[0] + nn[0] * off1, y, p[1] + nn[1] * off1);
    uv.push(0, v, 1, v); v += 4 / vScale;
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); scene.add(m); return m;
}
const roadTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = "#4b4d55"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { g.fillStyle = R() < 0.5 ? "#55575f" : "#42444b"; g.fillRect(R() * w, R() * h, 2, 2); }
  g.fillStyle = "#f4f4f0"; g.fillRect(3, 0, 4, h); g.fillRect(w - 7, 0, 4, h);
  g.fillStyle = "#ffd23f"; g.fillRect(w / 2 - 2, 0, 4, h * 0.5);
});
ribbon(-ROAD_W / 2, ROAD_W / 2, 0.06, new THREE.MeshLambertMaterial({ map: roadTex }), ROAD_W * 2);
const curbTex = canvasTex(16, 64, (g, w, h) => { g.fillStyle = "#e8e8e8"; g.fillRect(0, 0, w, h); g.fillStyle = "#e0312b"; g.fillRect(0, 0, w, h / 2); });
const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
ribbon(-ROAD_W / 2 - 2.4, -ROAD_W / 2, 0.08, curbMat, 6);
ribbon(ROAD_W / 2, ROAD_W / 2 + 2.4, 0.08, curbMat, 6);
// dirt shoulder
const dirtTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = "#8a7148"; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = R() < 0.5 ? "#7a6340" : "#9a8156"; g.fillRect(R() * w, R() * h, 2, 2); } });
const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
ribbon(-ROAD_W / 2 - SHOULDER, -ROAD_W / 2 - 2.4, 0.04, dirtMat, 10);
ribbon(ROAD_W / 2 + 2.4, ROAD_W / 2 + SHOULDER, 0.04, dirtMat, 10);

// Bamboo barriers: vertical walls along both edges.
function wall(off, h) {
  const N = T.N, pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = T.pts[k], nn = T.nor[k], x = p[0] + nn[0] * off, z = p[1] + nn[1] * off;
    pos.push(x, -0.6, z, x, h, z); uv.push(u, 0, u, 1); u += 4 / 6;
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, bambooMat));
}
const bambooTex = canvasTex(64, 32, (g, w, h) => {
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? "#c9b45a" : "#d8c66a"; g.fillRect(i * 16, 0, 16, h); g.fillStyle = "#8f7b2c"; g.fillRect(i * 16, 0, 2, h); g.fillRect(i * 16, h * 0.45, 16, 2); }
  g.fillStyle = "#e0312b"; g.fillRect(0, 0, w, 4);
});
const bambooMat = new THREE.MeshLambertMaterial({ map: bambooTex, side: THREE.DoubleSide });
wall(-ROAD_W / 2 - SHOULDER, 2.6);
wall(ROAD_W / 2 + SHOULDER, 2.6);

// Start line + gate
{
  const p = T.pts[0], t = T.tan[0], a = Math.atan2(t[1], t[0]);
  const chk = canvasTex(64, 8, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#fff"; g.fillRect(x * 4, y * 4, 4, 4); } }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(4, ROAD_W), new THREE.MeshLambertMaterial({ map: chk }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = -a; line.position.set(p[0], 0.1, p[1]); scene.add(line);
  const gate = new THREE.Group();
  const post = new THREE.MeshLambertMaterial({ color: 0x2b2b30 });
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13.6, 1.6), post); m.position.set(0, 6.2, s * (ROAD_W / 2 + 3)); gate.add(m); }
  const banner = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#151515"; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = "#ffd23f"; g.fillRect(x, 0, 16, 6); g.fillRect(x + 16, h - 6, 16, 6); }
    g.fillStyle = "#ffd23f"; g.font = "italic 900 38px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("MONKE RC", w / 2, h / 2 + 2);
  }, false);
  const bm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, ROAD_W + 8), [new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner }), post, post, post, post]);
  bm.position.y = 12; bm.rotation.y = 0; gate.add(bm);
  gate.position.set(p[0], 0, p[1]); gate.rotation.y = -a; scene.add(gate);
}

// Boost pads (scrolling chevrons)
const padTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = "#1a1030"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#ffd23f"; g.lineWidth = 9; g.lineCap = "round";
  for (const y of [14, 46]) { g.beginPath(); g.moveTo(10, y + 10); g.lineTo(32, y - 8); g.lineTo(54, y + 10); g.stroke(); }
});
padTex.repeat.set(1, 2);
const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
for (const pad of T.pads) {
  const p = T.pts[pad.i], nn = T.nor[pad.i], t = T.tan[pad.i];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), padMat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(t[1], t[0]) - Math.PI / 2;
  m.position.set(p[0] + nn[0] * pad.off, 0.12, p[1] + nn[1] * pad.off); scene.add(m);
}

// Scenery: palm-ish trees and giant bananas, never on the track.
function offTrack(x, z, clear) {
  for (let i = 0; i < T.N; i += 3) { const p = T.pts[i]; if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < clear * clear) return false; }
  return true;
}
{
  const spots = [];
  const ext = T.pts.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1])), 0) + 160;
  for (let tries = 0; tries < 5000 && spots.length < 260; tries++) {
    const x = (R() - 0.5) * 2 * ext, z = (R() - 0.5) * 2 * ext;
    if (offTrack(x, z, ROAD_W / 2 + SHOULDER + 7 + R() * 30)) spots.push([x, z, 0.7 + R() * 0.9, R() * 6.28]);
  }
  const trunkG = new THREE.CylinderGeometry(0.9, 1.4, 1, 6); trunkG.translate(0, 0.5, 0);
  const leafG = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x7a5530 }), spots.length);
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshLambertMaterial({ color: 0x2f7d2f, flatShading: true }), spots.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  spots.forEach(([x, z, s, r], i) => {
    const h = 14 * s;
    m4.compose(new THREE.Vector3(x, -0.6, z), q.setFromEuler(e.set(0, r, 0)), new THREE.Vector3(s, h + 0.6, s)); trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, h + 3 * s, z), q.setFromEuler(e.set(R(), r, R())), new THREE.Vector3(7 * s, 4.5 * s, 7 * s)); leaves.setMatrixAt(i * 2, m4);
    m4.compose(new THREE.Vector3(x + 2 * s, h + 0.5 * s, z - 1.5 * s), q.setFromEuler(e.set(R(), r + 1, R())), new THREE.Vector3(5 * s, 3.5 * s, 5 * s)); leaves.setMatrixAt(i * 2 + 1, m4);
  });
  scene.add(trunks, leaves);
  // a few giant bananas lying in the infield/outfield
  const banG = new THREE.TorusGeometry(10, 2.6, 8, 18, Math.PI * 0.75);
  const banM = new THREE.MeshLambertMaterial({ color: 0xffd23f, flatShading: true });
  let placed = 0;
  for (let tries = 0; tries < 800 && placed < 6; tries++) {
    const x = (R() - 0.5) * 2 * ext * 0.8, z = (R() - 0.5) * 2 * ext * 0.8;
    if (!offTrack(x, z, ROAD_W / 2 + SHOULDER + 22)) continue;
    const b = new THREE.Mesh(banG, banM); b.position.set(x, 2.6, z); b.rotation.set(Math.PI / 2, 0, R() * 6.28); scene.add(b); placed++;
  }
}

// Roadside props, close to the road so they stream past: marker posts on both barriers
// every 12 units, plus cones, tyre stacks and flag poles just outside, more of them on corners.
{
  const outer = ROAD_W / 2 + SHOULDER, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const posts = [], cones = [], tyres = [], flags = [];
  for (let i = 0; i < T.N; i += 3) for (const sg of [-1, 1]) posts.push([i, sg]);
  for (let i = 6; i < T.N; i += 5) {
    const bend = Math.abs(T.curv[i]) > 0.012;
    if (!bend && R() < 0.55) continue;
    const sg = bend ? (T.curv[i] > 0 ? 1 : -1) * (R() < 0.8 ? 1 : -1) : (R() < 0.5 ? -1 : 1);
    const k = R();
    (k < 0.45 ? cones : k < 0.8 ? tyres : flags).push([i, sg, outer + 2.5 + R() * 4]);
  }
  const at = (i, sg, off, y) => { const p = T.pts[i], nn = T.nor[i]; return v.set(p[0] + nn[0] * sg * off, y, p[1] + nn[1] * sg * off); };
  const yaw = (i) => q.setFromEuler(e.set(0, -Math.atan2(T.tan[i][1], T.tan[i][0]), 0));
  const inst = (geo, mat, list, place) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((it, j) => { place(it); im.setMatrixAt(j, m4); });
    im.count = list.length; scene.add(im); return im;
  };
  const postTex = canvasTex(8, 32, (g, w, h) => { g.fillStyle = "#f4f4f0"; g.fillRect(0, 0, w, h); g.fillStyle = "#e0312b"; g.fillRect(0, 0, w, h * 0.3); g.fillStyle = "#ffd23f"; g.fillRect(0, h * 0.3, w, h * 0.08); }, false);
  const postG = new THREE.BoxGeometry(0.7, 4.4, 0.7); postG.translate(0, 2.2, 0);
  inst(postG, new THREE.MeshLambertMaterial({ map: postTex }), posts, ([i, sg]) => m4.compose(at(i, sg, outer + 0.6, -0.6), yaw(i), sc.set(1, 1, 1)));
  const coneG = new THREE.ConeGeometry(1.1, 3, 8); coneG.translate(0, 1.5, 0);
  inst(coneG, new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true }), cones, ([i, sg, off]) => m4.compose(at(i, sg, off, -0.1), yaw(i), sc.set(1, 1, 1)));
  const tyreG = new THREE.TorusGeometry(1.5, 0.75, 6, 12); tyreG.rotateX(Math.PI / 2);
  const tyreM = new THREE.MeshLambertMaterial({ color: 0x1d1d22, flatShading: true });
  for (const lvl of [0, 1, 2]) inst(tyreG, tyreM, tyres, ([i, sg, off]) => m4.compose(at(i, sg, off, 0.2 + lvl * 1.45), yaw(i), sc.set(1, 1, 1)));
  const poleG = new THREE.CylinderGeometry(0.25, 0.25, 9, 5); poleG.translate(0, 4.5, 0);
  inst(poleG, new THREE.MeshLambertMaterial({ color: 0x2b2b30 }), flags, ([i, sg, off]) => m4.compose(at(i, sg, off, -0.6), yaw(i), sc.set(1, 1, 1)));
  const flagG = new THREE.PlaneGeometry(3.4, 2.2); flagG.translate(1.7, 7.4, 0);
  const flagTex = canvasTex(32, 20, (g, w, h) => { g.fillStyle = "#ffd23f"; g.fillRect(0, 0, w, h); g.fillStyle = "#151515"; for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) if ((x + y) % 2) g.fillRect(x * 8, y * 7, 8, 7); }, false);
  inst(flagG, new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }), flags, ([i, sg, off]) => m4.compose(at(i, sg, off, -0.6), yaw(i), sc.set(1, 1, 1)));
}

// ── The buggy ──
function buildCar(ghostCar) {
  const g = new THREE.Group();
  const mat = (c) => ghostCar ? new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.32, depthWrite: false }) : new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const hull = mat(HULL), trim = mat(TRIM), dark = mat(0x18181c), glow = ghostCar ? hull : new THREE.MeshBasicMaterial({ color: GLOW });
  const body = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.4, 4.2), hull); body.position.y = 1.9; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 3.6), trim); nose.position.set(4.6, 1.75, 0); nose.rotation.z = -0.25; g.add(nose);
  const pod = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 4.8), trim); pod.position.set(-0.6, 2.2, 0); g.add(pod);
  const wingPost = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), dark); wingPost.position.set(-3.8, 3.2, 0); g.add(wingPost);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 5.6), trim); wing.position.set(-4.1, 4.05, 0); wing.rotation.z = 0.12; g.add(wing);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.12, 0.6), glow); strip.position.set(0.3, 2.66, 0); g.add(strip);
  const wheels = [];
  const wheelG = new THREE.CylinderGeometry(1.35, 1.35, 1.2, 14); wheelG.rotateX(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(0.6, 0.6, 1.25, 8); hubG.rotateX(Math.PI / 2);
  for (const [x, z] of [[3.1, 2.7], [3.1, -2.7], [-2.9, 2.8], [-2.9, -2.8]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.35, z);
    const w = new THREE.Mesh(wheelG, dark); const hub = new THREE.Mesh(hubG, trim); w.add(hub);
    pivot.add(w); g.add(pivot); wheels.push({ pivot, w, front: x > 0 });
  }
  return { root: g, body: [body, nose, pod, wing, wingPost, strip], wheels };
}
const car = buildCar(false), ghostCar = buildCar(true), leaderCar = buildCar(true);
leaderCar.root.traverse((o) => { if (o.isMesh) o.material = o.material.clone(), o.material.color?.set(0xffd23f); });
car.root.rotation.order = "YXZ"; ghostCar.root.rotation.order = "YXZ";
scene.add(car.root); scene.add(ghostCar.root); scene.add(leaderCar.root); ghostCar.root.visible = false; leaderCar.root.visible = false;
leaderCar.root.rotation.order = "YXZ";
// blob shadow
const blob = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), new THREE.MeshBasicMaterial({ map: canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; scene.add(blob);
// boost flame
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 8), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.85 }));
flame.rotation.z = Math.PI / 2; flame.position.set(-5.2, 2.0, 0); flame.visible = false; car.root.add(flame);
// driver: the holder's 3D block monke
let driver = null;
loadImage(imageFor(n)).then(readGrid).then((grid) => {
  driver = buildMonke(grid);
  const box = new THREE.Box3().setFromObject(driver.root), size = box.getSize(new THREE.Vector3());
  const s = 3.6 / Math.max(size.x, size.y, size.z);
  driver.root.scale.setScalar(s);
  const seat = new THREE.Group(); seat.add(driver.root);
  const c = box.getCenter(new THREE.Vector3());
  driver.root.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  seat.rotation.y = Math.PI / 2; seat.position.set(-0.4, 2.55, 0);
  car.root.add(seat);
}).catch(() => {});

// ── Particles: drift smoke + sparks ──
const puffTex = canvasTex(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 1, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
const puffs = [];
for (let i = 0; i < 110; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); puffs.push({ s, life: 0, t: 0, vx: 0, vy: 0, vz: 0 }); }
let puffIx = 0;
function puff(x, y, z, colour, size, life, vx = 0, vy = 2, vz = 0) {
  const p = puffs[puffIx++ % puffs.length];
  p.s.visible = true; p.s.position.set(x, y, z); p.s.material.color.set(colour); p.s.scale.setScalar(size);
  p.life = life; p.t = 0; p.vx = vx; p.vy = vy; p.vz = vz; p.size = size;
}

// Skid marks: a ring of dark quads laid under the rear wheels while drifting.
const SKIDS = 480;
const skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x15151a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), SKIDS);
skidMesh.count = 0; skidMesh.frustumCulled = false; scene.add(skidMesh);
let skidIx = 0; const skidLast = [null, null];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function skid(k, x, z, a) {
  const last = skidLast[k];
  if (last) {
    const dx = x - last[0], dz = z - last[1], len = Math.hypot(dx, dz);
    if (len < 0.8) return;
    if (len < 6) {
      _m.compose(_v.set((x + last[0]) / 2, 0.11, (z + last[1]) / 2), _q.setFromEuler(_e.set(0, -Math.atan2(dz, dx), 0)), _s.set(len, 1, 1));
      skidMesh.setMatrixAt(skidIx % SKIDS, _m); skidIx++;
      skidMesh.count = Math.min(SKIDS, skidIx); skidMesh.instanceMatrix.needsUpdate = true;
    }
  }
  skidLast[k] = [x, z];
}
function clearSkids() { skidIx = 0; skidMesh.count = 0; skidLast[0] = skidLast[1] = null; }

// Speed lines: streaks from the screen edges, from 75% of top speed and strongest on boost.
const lines = document.getElementById("lines"), lctx = lines.getContext("2d");
const streaks = Array.from({ length: 34 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), w: 1 + Math.random() * 2 }));
function drawLines(spd, boosting, dt) {
  const w = innerWidth, h = innerHeight;
  if (lines.width !== w || lines.height !== h) { lines.width = w; lines.height = h; } else lctx.clearRect(0, 0, w, h);
  const k = Math.max(0, (spd - V_MAX * 0.75) / (V_BOOST - V_MAX * 0.75)) + (boosting ? 0.35 : 0);
  if (k <= 0.02 || state !== "race") return;
  const cx = w / 2, cy = h * 0.42, R0 = Math.hypot(w, h) * 0.5;
  lctx.lineCap = "round";
  for (const st of streaks) {
    st.r += dt * (1.6 + k * 2.4); if (st.r > 1) { st.r = Math.random() * 0.2; st.a = Math.random() * Math.PI * 2; }
    const r1 = R0 * (0.55 + st.r * 0.5), r2 = r1 + R0 * (0.08 + k * 0.14), ca = Math.cos(st.a), sa = Math.sin(st.a);
    lctx.strokeStyle = boosting ? `rgba(255,214,120,${Math.min(0.55, k * 0.5)})` : `rgba(255,255,255,${Math.min(0.4, k * 0.4)})`;
    lctx.lineWidth = st.w;
    lctx.beginPath(); lctx.moveTo(cx + ca * r1, cy + sa * r1); lctx.lineTo(cx + ca * r2, cy + sa * r2); lctx.stroke();
  }
}

// ── Sound ──
let ac = null, engine = null;
function audio() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } } if (ac?.state === "suspended") ac.resume(); return ac; }
function tone(f0, f1, dur, type = "square", vol = 0.08, delay = 0) {
  if (!soundOn) return; const a = audio(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBuf(a) { const len = a.sampleRate, b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; }
function startEngine() {
  const a = audio(); if (!a || engine) return;
  const o1 = a.createOscillator(), o2 = a.createOscillator(), lp = a.createBiquadFilter(), g = a.createGain();
  o1.type = "sawtooth"; o2.type = "square"; o2.detune.value = 9; lp.type = "lowpass"; lp.frequency.value = 600; g.gain.value = 0;
  o1.connect(lp); o2.connect(lp); lp.connect(g).connect(a.destination); o1.start(); o2.start();
  const ns = a.createBufferSource(), nf = a.createBiquadFilter(), ng = a.createGain();
  ns.buffer = noiseBuf(a); ns.loop = true; nf.type = "bandpass"; nf.frequency.value = 1800; nf.Q.value = 0.8; ng.gain.value = 0;
  ns.connect(nf).connect(ng).connect(a.destination); ns.start();
  // wind (rises with speed²), wall scrape (bright noise), drift charge (sine climbing with the charge)
  const ws = a.createBufferSource(), wf = a.createBiquadFilter(), wg = a.createGain();
  ws.buffer = noiseBuf(a); ws.loop = true; wf.type = "lowpass"; wf.frequency.value = 900; wg.gain.value = 0;
  ws.connect(wf).connect(wg).connect(a.destination); ws.start();
  const ss = a.createBufferSource(), sf = a.createBiquadFilter(), sg = a.createGain();
  ss.buffer = noiseBuf(a); ss.loop = true; sf.type = "highpass"; sf.frequency.value = 2600; sg.gain.value = 0;
  ss.connect(sf).connect(sg).connect(a.destination); ss.start();
  const dc = a.createOscillator(), dg = a.createGain();
  dc.type = "sine"; dc.frequency.value = 300; dg.gain.value = 0; dc.connect(dg).connect(a.destination); dc.start();
  engine = { o1, o2, lp, g, ng, wf, wg, sg, dc, dg };
}
function setEngine(spd, drifting, boosting, scraping = false, charge = 0) {
  if (!engine || !ac) return;
  const t = ac.currentTime, k = Math.min(1.4, spd / V_MAX), on = soundOn && state === "race" && !paused;
  engine.o1.frequency.setTargetAtTime(48 + k * 120 + (boosting ? 30 : 0), t, 0.05);
  engine.o2.frequency.setTargetAtTime(96 + k * 240, t, 0.05);
  engine.lp.frequency.setTargetAtTime(500 + k * 1600, t, 0.08);
  engine.g.gain.setTargetAtTime(on ? 0.035 + k * 0.03 : 0, t, 0.08);
  engine.ng.gain.setTargetAtTime(on && drifting ? 0.06 : 0, t, 0.05);
  const kw = Math.min(1.2, spd / V_BOOST);
  engine.wg.gain.setTargetAtTime(on ? kw * kw * 0.07 + (boosting ? 0.02 : 0) : 0, t, 0.1);
  engine.wf.frequency.setTargetAtTime(500 + kw * 1800, t, 0.1);
  engine.sg.gain.setTargetAtTime(on && scraping ? 0.05 : 0, t, 0.03);
  engine.dc.frequency.setTargetAtTime(260 + charge * 520, t, 0.05);
  engine.dg.gain.setTargetAtTime(on && drifting && charge > 0.1 ? 0.025 : 0, t, 0.04);
}
const sfx = {
  beep: (hi) => tone(hi ? 880 : 440, hi ? 880 : 440, hi ? 0.45 : 0.18, "square", 0.08),
  wall: () => { tone(110, 50, 0.18, "sawtooth", 0.12); },
  pad: () => { tone(300, 1200, 0.35, "sawtooth", 0.05); },
  boost: (s) => { tone(200, 900 + s * 400, 0.3, "triangle", 0.08); },
  lap: () => [660, 880].forEach((f, i) => tone(f, f, 0.14, "square", 0.06, i * 0.1)),
  finish: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.2, "square", 0.06, i * 0.1)),
};
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* not allowed */ } };

// ── HUD ──
const $ = (id) => document.getElementById(id);
const fmt = (ms) => { if (ms == null) return "--"; const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, "0")}`; };
let toastTimer = 0, deltaTimer = 0;
function toast(text, small = "", ms = 1500) { $("toast").innerHTML = `${text}${small ? `<small>${small}</small>` : ""}`; $("toast").classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("on"), ms); }
function showDelta(sec) {
  const el = $("delta"); el.textContent = `${sec < 0 ? "−" : "+"}${Math.abs(sec).toFixed(2)}`;
  el.className = `on ${sec < 0 ? "good" : "bad"}`; clearTimeout(deltaTimer); deltaTimer = setTimeout(() => el.classList.remove("on"), 1600);
}
function countPop(text) { const el = $("count"); el.textContent = text; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
function post(m) {
  const s = JSON.stringify({ type: "racer", v: RV, ...m });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (parent !== window) parent.postMessage(s, location.origin);
}
const card = $("card"), menu = $("menu");
function showCard(html, onAct) {
  card.innerHTML = html; card.hidden = false;
  card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); onAct(b.dataset.act); }));
}

// ── Input: drag anywhere to steer (a virtual wheel where the thumb lands) ──
const input = { steer: 0, gas: 1, brake: 0, drift: false };
const keys = new Set();
const touches = new Map(); let steerId = null, steerX0 = 0;
const wheel = $("wheel");
const STEER_SPAN = () => Math.min(innerWidth, 520) * 0.2;
view.addEventListener("pointerdown", (e) => {
  audio(); notePress();
  touches.set(e.pointerId, e);
  if (steerId === null) { steerId = e.pointerId; steerX0 = e.clientX; wheel.style.display = "block"; wheel.style.left = `${e.clientX}px`; wheel.style.top = `${e.clientY}px`; wheel.firstElementChild.style.transform = ""; }
  view.setPointerCapture?.(e.pointerId);
});
view.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (e.pointerId === steerId) { const dx = Math.max(-1.25, Math.min(1.25, (e.clientX - steerX0) / STEER_SPAN())); wheel.firstElementChild.style.transform = `translateX(${dx * 24}px)`; }
});
const lift = (e) => { touches.delete(e.pointerId); if (e.pointerId === steerId) { steerId = null; wheel.style.display = "none"; } };
view.addEventListener("pointerup", lift); view.addEventListener("pointercancel", lift);
addEventListener("keydown", (e) => {
  if (!e.repeat) notePress();
  keys.add(e.key.toLowerCase());
  if (e.key === "Escape") { e.preventDefault(); menu.hidden ? openMenu() : resume(); }
  if ((e.key === "Enter" || e.key === " ") && !card.hidden) card.querySelector("button.go")?.click();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
function readInput() {
  let steer = 0, brake = 0, drift = false;
  const st = touches.get(steerId);
  if (st) { const dx = (st.clientX - steerX0) / STEER_SPAN(); steer = Math.max(-1, Math.min(1, dx)); drift = Math.abs(dx) > 0.82; }
  if (touches.size >= 2) brake = 1;
  if (keys.has("arrowleft") || keys.has("a")) steer -= 1;
  if (keys.has("arrowright") || keys.has("d")) steer += 1;
  if (keys.has("arrowdown") || keys.has("s")) brake = 1;
  if (keys.has("shift") || keys.has(" ")) drift = true;
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (pad) { const ax = pad.axes[0] || 0; if (Math.abs(ax) > 0.12) steer += ax; if (pad.buttons[6]?.pressed || pad.buttons[1]?.pressed) brake = 1; if (pad.buttons[7]?.value > 0.5 && pad.buttons[5]?.pressed || pad.buttons[2]?.pressed) drift = true; }
  input.steer = Math.max(-1, Math.min(1, steer)); input.brake = brake; input.drift = drift; input.gas = brake ? 0 : 1;
  return input;
}

// ── Flow ──
let state = "title", paused = false, run = null, countT = 0, acc = 0, lastT = performance.now(), wallFx = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

// Phase 2 camera (2026-11-12): lower and closer than before (was 21 back / 10 up in portrait)
// and aimed far ahead so the car sits low on screen and the road rushes under it; eases with real frame time; widens with speed, more on boost;
// a slight shake near top speed.
let lastCamT = 0;
function placeCamera(snap) {
  const now = performance.now(), dt = Math.min(0.05, (now - (lastCamT || now)) / 1000); lastCamT = now;
  const a = run.a, fx = Math.cos(a), fz = Math.sin(a), spd = speedOf(run), kv = Math.min(1.3, spd / V_MAX);
  const portrait = innerHeight > innerWidth;
  const back = (portrait ? 16 : 13) + kv * 2, up = portrait ? 9 : 7;
  const want = new THREE.Vector3(run.x - fx * back, up, run.z - fz * back);
  const look = new THREE.Vector3(run.x + fx * 20, 0, run.z + fz * 20);
  if (snap) { camPos.copy(want); camLook.copy(look); }
  else { camPos.lerp(want, 1 - Math.exp(-dt * 7)); camLook.lerp(look, 1 - Math.exp(-dt * 12)); }
  camera.position.copy(camPos);
  const shake = wallFx + Math.max(0, kv - 0.9) * 0.6 + (run.boost > 0 ? 0.12 : 0);
  if (shake > 0 && state === "race") camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake));
  camera.lookAt(camLook);
  // Portrait screens are narrow: a wider vertical view keeps the road and corners in sight.
  const fov = (portrait ? 78 : 60) + kv * 12 + (run.boost > 0 ? 9 : 0);
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * (run.boost > 0 ? 9 : 4))); camera.updateProjectionMatrix();
}

function newRace() {
  run = createRun(T);
  acc = 0; countT = 0;
  for (const p of puffs) { p.s.visible = false; p.life = 0; }
  clearSkids(); lastTier = 0;
  placeCamera(true);
  updateHud();
}

function title() {
  state = "title";
  showCard(`
    <h1>MONKE RC</h1>
    <div class="tag">${COURSE_NAME}</div>
    <div>MONKE #${n} <span class="dim">· <span class="swatch" style="background:${HULL}"></span>body <span class="swatch" style="background:${TRIM}"></span>trim</span></div>
    <div class="how">${isTouch ? "Drag left / right anywhere to steer.<br>Drag far to <b>drift</b> · let go of a drift for a <b>boost</b>.<br>Two fingers = brake · ⚡ pads boost" : "← → steer · Shift drift (let go to boost)<br>↓ brake · Esc pause"}</div>
    <div class="dim">${LAPS} laps${best ? ` · your best ${fmt(best)}` : ""}${ghost && ghostOn ? " · racing your ghost" : ""}</div>
    <div class="dim" id="leaderline"></div>
    ${!DEMO ? `<div class="dim">Finish today's track for bananas · fastest time tops the daily board</div>` : ""}
    ${DEMO ? `<div class="dim">The daily track, leaderboard and bananas are for Saga Monke holders · ${GET_APP}</div>` : ""}
    <div class="row"><button class="go" data-act="go">RACE</button></div>
  `, (act) => { if (act === "go") countdown(); });
  showLeaderLine();
}
function showLeaderLine() {
  const el = document.getElementById("leaderline");
  if (el && leader) el.textContent = `Gold ghost: today's #1, ${leader.name} · ${fmt(leader.t)}`;
}

// Start boost: press in the last beat before GO (best within 0.35 s of it), or just after.
const GO_MS = 2100;
let goAt = 0, pressAt = null, launched = true;
function notePress() {
  if (state === "count" && pressAt === null) pressAt = performance.now();
  else if (state === "race" && !launched) doLaunch(performance.now());
}
function doLaunch(now) {
  if (launched || !run) return;
  launched = true;
  let q = 0;
  if (pressAt !== null) {
    const early = goAt - pressAt;
    q = early > 700 ? 0 : early > 350 ? 1 - (early - 350) / 350 : 1;
    if (early > 700) toast("TOO EARLY");
  } else if (now - goAt <= 200) q = 0.5;
  const s = launch(run, q);
  if (s > 0.15) { sfx.boost(s); buzz(15); toast(q >= 0.95 ? "PERFECT START" : "GOOD START"); }
}

function countdown() {
  lastReply = null;
  card.hidden = true; audio(); startEngine();
  newRace();
  state = "count"; countT = 0; pressAt = null; launched = false; goAt = performance.now() + GO_MS;
  $("hint").classList.remove("gone"); setTimeout(() => $("hint").classList.add("gone"), 6000);
  [3, 2, 1].forEach((k, i) => setTimeout(() => { if (state === "count") { countPop(String(k)); sfx.beep(false); } }, i * 700));
  setTimeout(() => {
    if (state !== "count") return;
    countPop("GO!"); sfx.beep(true); state = "race";
    if (pressAt !== null) doLaunch(performance.now());
    else setTimeout(() => { if (!launched) launched = true; }, 220);
  }, GO_MS);
}

function finish(ms) {
  state = "done";
  const lapBest = Math.min(...run.laps), isBest = !best || ms < best;
  if (isBest) { best = ms; store.set(K.best, String(ms)); store.set(K.ghost, JSON.stringify(run.ghost)); ghost = run.ghost; }
  if (!bestLap || lapBest < bestLap) { bestLap = lapBest; store.set(K.lap, String(lapBest)); }
  post({ event: "clear", course: COURSE, ms, laps: run.laps, n, ghost: DEMO ? undefined : run.ghost });
  setTimeout(() => { showCard(`
    <h1>FINISH</h1>
    <div class="dim">${COURSE_NAME}</div>
    <div class="big">${fmt(ms)}</div>
    ${isBest ? `<div class="tag">NEW BEST</div>` : `<div class="dim">Best ${fmt(best)}</div>`}
    <div class="stats">${run.laps.map((l, i) => `<span>Lap ${i + 1}</span><b>${fmt(l)}${l === lapBest ? " ★" : ""}</b>`).join("")}</div>
    <div id="board"></div>
    ${DEMO ? `<div class="dim">Daily track, leaderboard and bananas for Saga Monke holders<br>${GET_APP}</div>` : ""}
    <div class="row"><button class="go" data-act="again">RACE AGAIN</button></div>
  `, (act) => { if (act === "again") countdown(); }); if (lastReply) showBoard(lastReply); }, 1400);
}

// Daily board: the app sends the race (worker racer.ts) and hands back
// { type: "racerRun", best, improved, rank, top, paid }; shown on the finish card.
let lastReply = null;
function showBoard(d) {
  const slot = document.getElementById("board");
  if (state !== "done" || !slot || card.hidden) { lastReply = d; return; }
  lastReply = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  slot.replaceChildren(); slot.style.cssText = "display:grid;gap:8px;justify-items:center";
  if (d.paid > 0) slot.append(el("div", "tag", `+${d.paid} 🍌 DAILY BANANAS`));
  const board = el("div", "stats");
  board.append(el("span", null, "TODAY'S BOARD"), el("b"));
  d.top.slice(0, 5).forEach((r, i) => board.append(el("span", null, `${i + 1}. ${r.name}`), el("b", null, fmt(r.t))));
  slot.append(board, el("div", d.improved && d.rank ? "tag" : "dim",
    d.rank ? `${d.improved ? "NEW DAY BEST · " : ""}#${d.rank} today · best ${fmt(d.best)}` : `Your best today ${fmt(d.best)} · top 10 make the board`));
}
if (inApp) {
  const onHost = (e) => {
    if (!window.ReactNativeWebView && e.origin !== location.origin) return;
    let d = e.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
    if (d?.type === "racerRun" && d.ok && Array.isArray(d.top) && d.day === COURSE) showBoard(d);
  };
  addEventListener("message", onHost); document.addEventListener("message", onHost);
}

function openMenu() { if (state === "title") return; paused = true; touches.clear(); steerId = null; wheel.style.display = "none"; renderMenu(); menu.hidden = false; }
function resume() { menu.hidden = true; paused = false; lastT = performance.now(); }
function renderMenu() { $("ghostbtn").textContent = `Ghost: ${ghostOn ? "on" : "off"}`; $("sound").textContent = `Sound: ${soundOn ? "on" : "off"}`; }
$("pause").addEventListener("click", openMenu);
$("resume").addEventListener("click", resume);
$("restart").addEventListener("click", () => { menu.hidden = true; paused = false; countdown(); });
$("ghostbtn").addEventListener("click", () => { ghostOn = !ghostOn; store.set("rc:ghostOn", ghostOn ? "1" : "0"); renderMenu(); });
$("sound").addEventListener("click", () => { soundOn = !soundOn; store.set("rc:sound", soundOn ? "1" : "0"); renderMenu(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && (state === "race" || state === "count")) openMenu(); });

function updateHud() {
  $("lap").firstElementChild.textContent = `${Math.min(LAPS, run.lap + 1)}/${LAPS}`;
  $("time").firstElementChild.textContent = fmt(run.t * 1000);
  $("bestlap").firstElementChild.textContent = fmt(bestLap);
  $("speed").firstChild.nodeValue = String(Math.round(speedOf(run) * 1.6));
  const charge = run.boost > 0 ? 1 : Math.min(1, run.driftCharge / DRIFT_TIERS[DRIFT_TIERS.length - 1].charge);
  $("boostbar").firstElementChild.style.width = `${Math.round(charge * 100)}%`;
}

function handle(events) {
  for (const e of events) {
    if (e.type === "wall") { sfx.wall(); buzz(25); wallFx = Math.min(1.6, e.speed / 25); sparks(10); }
    if (e.type === "pad") { sfx.pad(); buzz(15); toast("BOOST"); }
    if (e.type === "driftBoost") { sfx.boost(e.s); buzz(8 + e.tier * 6); toast(["BOOST", "SUPER BOOST", "ULTRA BOOST"][e.tier - 1]); }
    if (e.type === "checkpoint" && ghost && ghostOn) {
      // compare with where the ghost was at this checkpoint: the ghost frame closest to this spot
      const gi = ghostIndexNear(run.x, run.z, run.t);
      if (gi != null) showDelta(run.t - gi * DT * 3);
    }
    if (e.type === "lap") {
      if (run.lap < LAPS) { sfx.lap(); toast(run.lap === LAPS - 1 ? "FINAL LAP" : `LAP ${run.lap + 1}`, fmt(e.ms)); }
    }
    if (e.type === "finish") { sfx.finish(); buzz(60); finish(e.ms); }
  }
}
function ghostIndexNear(x, z, t) {
  if (!ghost) return null;
  const c = Math.floor(t / (DT * 3)); let bi = null, bd = Infinity;
  for (let i = Math.max(0, c - 400); i < Math.min(ghost.length, c + 400); i++) { const d = (ghost[i][0] - x) ** 2 + (ghost[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
  return bd < 900 ? bi : null;
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (run && !paused && (state === "race" || state === "count" || state === "done")) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const inp = state === "race" ? (AUTO ? autopilot(run) : readInput()) : state === "done" ? { steer: 0, gas: 0, brake: 0.3, drift: false } : { steer: 0, gas: 0, brake: 0, drift: false };
      handle(step(run, inp));
    }
    updateHud();
  }
  if (run) drawCar(dt);
  setEngine(run ? speedOf(run) : 0, run?.drifting, run?.boost > 0, !!run && run.hitWall > 0.1, run ? Math.min(1, run.driftCharge / DRIFT_TIERS[DRIFT_TIERS.length - 1].charge) : 0);
  drawLines(run ? speedOf(run) : 0, !!run && run.boost > 0, dt);
  padTex.offset.y -= dt * 1.6;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let spin = 0, roll = 0, lastTier = 0;
function sparks(nSp) {
  const sg = Math.sign(sideOf(T, run.idx, run.x, run.z)) || 1, nn = T.nor[run.idx];
  const x = run.x + nn[0] * sg * 2.6, z = run.z + nn[1] * sg * 2.6, ca = Math.cos(run.a), sa = Math.sin(run.a);
  for (let i = 0; i < nSp; i++) puff(x, 1 + Math.random(), z, Math.random() < 0.5 ? "#ffd23f" : "#ff8a1a", 0.6 + Math.random() * 0.5, 0.3, -ca * 14 + (Math.random() - 0.5) * 16, 3 + Math.random() * 7, -sa * 14 + (Math.random() - 0.5) * 16);
}
function drawCar(dt) {
  car.root.position.set(run.x, 0, run.z);
  car.root.rotation.y = -run.a;
  // lean into the slide, pitch on throttle
  roll += ((run.drifting ? 0.12 : 0.05) * run.steer - roll) * Math.min(1, dt * 8);
  car.root.rotation.x = roll;
  spin += run.vf * dt / 1.35;
  for (const w of car.wheels) { w.w.rotation.z = -spin; if (w.front) w.pivot.rotation.y = -run.steer * 0.45; }
  car.root.position.y = run.grass ? Math.abs(Math.sin(performance.now() / 45)) * 0.18 : 0;
  blob.position.set(run.x, 0.15, run.z); blob.rotation.z = -run.a;
  flame.visible = run.boost > 0; if (flame.visible) { flame.scale.set(0.55, 0.45 + Math.random() * 0.35, 0.55); flame.material.color.set(run.boost > 1 ? GLOW : "#ffb030"); }
  // drift smoke and spark colour by charge (blue → yellow → pink)
  const spd = speedOf(run), ca = Math.cos(run.a), sa = Math.sin(run.a);
  if (state === "race" && (run.drifting || (run.grass && spd > 20)) && Math.random() < 0.7) {
    for (const side of [-1, 1]) {
      const x = run.x - ca * 3.2 - sa * side * 2.8, z = run.z - sa * 3.2 + ca * side * 2.8;
      puff(x, 0.8, z, run.grass ? "#a08a60" : "#e8e8e8", 2.2 + Math.random() * 1.5, 0.7, (Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3);
    }
    if (run.drifting) {
      const tier = driftTier(run.driftCharge);
      if (tier > lastTier) { tone(500 + tier * 220, 900 + tier * 300, 0.12, "triangle", 0.06); buzz(6); }
      lastTier = tier;
      const c = ["#9aa4b0", "#6cf", "#ffd23f", "#ff4fd8"][tier];
      for (const side of [-1, 1]) puff(run.x - ca * 3 - sa * side * 2.8, 0.6, run.z - sa * 3 + ca * side * 2.8, c, 0.9, 0.25, (Math.random() - 0.5) * 10, 4 + Math.random() * 4, (Math.random() - 0.5) * 10);
    }
  }
  if (!run.drifting) lastTier = 0;
  if (state === "race" && run.hitWall > 0.15 && spd > 25 && Math.random() < 0.6) sparks(2);
  if (state === "race" && !run.grass && (run.drifting || Math.abs(run.vl) > 9)) {
    for (const k of [0, 1]) { const side = k ? 1 : -1; skid(k, run.x - ca * 2.9 - sa * side * 2.8, run.z - sa * 2.9 + ca * side * 2.8, run.a); }
  } else skidLast[0] = skidLast[1] = null;
  if (run.boost > 0 && Math.random() < 0.6) puff(run.x - ca * 6.5, 2, run.z - sa * 6.5, run.boost > 1 ? GLOW : "#ffb030", 1.6, 0.25, -ca * 8, 1, -sa * 8);
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.t += dt; if (p.t >= p.life) { p.life = 0; p.s.visible = false; continue; }
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.s.material.opacity = 0.75 * (1 - p.t / p.life); p.s.scale.setScalar(p.size * (1 + p.t / p.life * 1.5));
  }
  // ghost
  const gp = ghostOn && ghost && run.started && state !== "title" ? ghostAt(ghost, run.t) : null;
  ghostCar.root.visible = !!gp && !gp.done;
  if (gp) { ghostCar.root.position.set(gp.x, 0, gp.z); ghostCar.root.rotation.y = -gp.a; }
  const lp = ghostOn && leader && run.started && state !== "title" ? ghostAt(leader.ghost, run.t) : null;
  leaderCar.root.visible = !!lp && !lp.done;
  if (lp) { leaderCar.root.position.set(lp.x, 0, lp.z); leaderCar.root.rotation.y = -lp.a; }
  wallFx = Math.max(0, wallFx - dt * 4);
  placeCamera(false);
}

// ── Start ──
newRace();
$("loading").remove();
title();
requestAnimationFrame(frame);
if (AUTO) setTimeout(() => card.querySelector("button.go")?.click(), 600);
if (params.has("debug")) window.__rc = { get run() { return run; }, get state() { return state; }, T, countdown, inApp, DEMO, camera };
