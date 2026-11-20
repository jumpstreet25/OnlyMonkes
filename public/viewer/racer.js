// MonkeKart (was Monke RC until 2026-11-14) — 3D drawing, input, sound and flow. The rules live in racer-sim.js.
// three.js scene: jungle ground, the day's track (road ribbon, curbs, bamboo barriers,
// boost pads, start gate), trees, the player's go-kart (colours from caves-weapons.js
// weaponFor(n), looks only) with their 3D block monke in the seat, and a see-through
// ghost of their best race.
import * as THREE from "three";
import { imageFor, loadImage, readGrid, buildMonke } from "/viewer/monkeModel.js";
import { weaponFor } from "/viewer/caves-weapons.js";
import { themeFor } from "/viewer/racer-themes.js";
import { RV, DT, LAPS, ROAD_W, SHOULDER, V_MAX, V_BOOST, DRIFT_TIERS, driftTier, launch, buildTrack, createRun, step, speedOf, sideOf, ghostAt, autopilot, todayId, nextTrackAt, rng, nearest, heightAt, slopeAt, inTunnel, TUNNEL_H } from "/viewer/racer-sim.js";

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
// ?track=YYYY-MM-DD previews another day's track — demo mode only (no board, no bananas).
const PREVIEW = DEMO && /^\d{4}-\d{2}-\d{2}$/.test(params.get("track") || "") ? params.get("track") : null;
const COURSE = PREVIEW || (DEMO ? "demo" : todayId());
const TH = themeFor(COURSE);
const COURSE_NAME = DEMO && !PREVIEW ? "DEMO TRACK" : `DAILY · ${new Date(`${COURSE}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} · ${TH.name}`;
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
// Quality (Phase 3): high = real sun shadow under the car, glow, full pixel ratio;
// low = blob shadow, 1.25× pixels. Picked from the phone (?q=high|low overrides) and
// dropped to low for good if the first seconds of a race run under ~40 fps.
const QP = params.get("q");
let HIGH = QP ? QP === "high" : (navigator.hardwareConcurrency || 4) > 4 && (navigator.deviceMemory || 4) > 3;
try { if (!QP && localStorage.getItem("racer.q") === "low") HIGH = false; } catch {}
const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(HIGH ? 2 : 1.25, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  gr.addColorStop(0, TH.sky[0]); gr.addColorStop(0.55, TH.sky[1]); gr.addColorStop(1, TH.sky[2]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, false);
scene.fog = new THREE.Fog(TH.fog, TH.snow ? 200 : 260, TH.snow ? 950 : 1100);
scene.add(new THREE.HemisphereLight(TH.hemi[0], TH.hemi[1], 1.25));
const sun = new THREE.DirectionalLight(TH.sun, 1.6); sun.position.set(-300, 500, 200); scene.add(sun, sun.target);
const SUN_DIR = sun.position.clone().normalize();
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 260 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.4;
sun.castShadow = HIGH;
// Jungle skyline: a far ring of hills and canopy, outside the fog, so the horizon isn't bare.
{
  const sky = canvasTex(1024, 128, (g, w, h) => {
    const r = rng(0x51ce);
    g.fillStyle = TH.hills[0]; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, h * (0.25 + 0.3 * Math.abs(Math.sin(x / 140 + 1.3)) + r() * 0.06));
    g.lineTo(w, h); g.fill();
    g.fillStyle = TH.hills[1]; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h * (0.62 + r() * 0.12 - (x % 48 < 10 ? 0.1 : 0)));
    g.lineTo(w, h); g.fill();
  });
  sky.wrapT = THREE.ClampToEdgeWrapping; sky.repeat.set(3, 1);
  const ringR = 1500, ring = new THREE.Mesh(new THREE.CylinderGeometry(ringR, ringR, 260, 48, 1, true), new THREE.MeshBasicMaterial({ map: sky, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  ring.position.y = 100; ring.renderOrder = -1; scene.add(ring);
  const cloudTex = canvasTex(128, 64, (g, w, h) => { g.fillStyle = "rgba(255,255,255,0.9)"; for (const [x, y, r] of [[40, 40, 22], [64, 30, 28], [90, 40, 20], [64, 44, 22]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }, false);
  const cr = rng(0xc10d);
  for (let i = 0; i < 9; i++) {
    const a = cr() * 6.28, d = 900 + cr() * 400, c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    c.position.set(Math.cos(a) * d, 260 + cr() * 160, Math.sin(a) * d); c.scale.set(260 + cr() * 160, 110 + cr() * 50, 1); scene.add(c);
  }
}

// Falling snow on snowy days: a box of flakes around the camera, drifting down and wrapping.
let snowFx = null;
if (TH.snow) {
  const n = HIGH ? TH.snow : Math.round(TH.snow * 0.5), SB = 160, pos = new Float32Array(n * 3), sr = rng(0x5e0f);
  for (let i = 0; i < n; i++) { pos[i * 3] = (sr() - 0.5) * SB * 2; pos[i * 3 + 1] = sr() * 90; pos[i * 3 + 2] = (sr() - 0.5) * SB * 2; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const flake = canvasTex(16, 16, (c, w, h) => { const gr = c.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, h); }, false);
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: flake, size: 1.6, transparent: true, depthWrite: false, fog: true }));
  pts.frustumCulled = false; scene.add(pts);
  snowFx = (dt) => {
    const a = g.attributes.position.array, cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      a[k + 1] -= dt * (6 + (i % 7));
      a[k] += Math.sin((a[k + 1] + i) * 0.05) * dt * 1.5;
      if (a[k + 1] < -1) a[k + 1] += 90;
      // keep every flake inside a box centred on the camera
      a[k] = cx + ((((a[k] - cx) % (SB * 2)) + SB * 3) % (SB * 2)) - SB;
      a[k + 2] = cz + ((((a[k + 2] - cz) % (SB * 2)) + SB * 3) % (SB * 2)) - SB;
    }
    g.attributes.position.needsUpdate = true;
  };
}

// Ground
const R = rng(T.seed ^ 0x9e37);
const grassTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = TH.grass[0]; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const s = R(); g.fillStyle = s < 0.5 ? TH.grass[1] : s < 0.8 ? TH.grass[2] : TH.grass[3]; g.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3); }
  // A dusting of snow over the grass on snowy days.
  if (TH.dust) { g.fillStyle = "rgba(246,248,252,0.9)"; for (let i = 0; i < 2600 * TH.dust; i++) g.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 3); }
});
grassTex.repeat.set(120, 120);

// ── Terrain (RV 3, 2026-11-20) ──
// Height of the ground anywhere: flat at the road's own height (0.7 under it) along the track
// corridor, blending out into rolling hills and a ring of mountains; a mountain over the tunnel;
// a river valley the road bridges. Where two roads cross the lower one wins, so the upper road
// stands on a bridge. groundY() is shared by the terrain mesh, trees, pillars and props.
const CORR = ROAD_W / 2 + SHOULDER + 9;           // flat ground this far from the centreline
const BLEND = 75;                                  // then out to the hills over this distance
const GR = rng(T.seed ^ 0x6e0d);
const yMin = Math.min(...T.y), yMax = Math.max(...T.y);
const EXT = T.pts.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1])), 0) + 820;
const MOUNT = 110 + GR() * 130;                    // the day's mountain height
const hillW = [0, 1, 2].map(() => ({ fx: 0.004 + GR() * 0.01, fz: 0.004 + GR() * 0.01, ph: GR() * 6.28, a: 5 + GR() * 9 }));
const cell = 32, hash = new Map(), hk = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
for (let i = 0; i < T.N; i++) { const k = hk(Math.floor(T.pts[i][0] / cell), Math.floor(T.pts[i][1] / cell)); (hash.get(k) || hash.set(k, []).get(k)).push(i); }
function nearTrack(x, z, rad) {
  let best = -1, bd = rad * rad, low = -1, ld = Infinity;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell), rc = Math.ceil(rad / cell);
  for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
    const list = hash.get(hk(cx + a, cz + b)); if (!list) continue;
    for (const i of list) {
      const d = (T.pts[i][0] - x) ** 2 + (T.pts[i][1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
      if (d < CORR * CORR && T.y[i] < ld) { ld = T.y[i]; low = i; }
    }
  }
  return { i: best, d: Math.sqrt(bd), low };
}
const coarse = []; for (let i = 0; i < T.N; i += 4) coarse.push(T.pts[i]);
function trackDist(x, z) { let m = Infinity; for (const p of coarse) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); }
const tun = T.tunnel ? Array.from({ length: T.tunnel.len + 1 }, (_, k) => (T.tunnel.a + k) % T.N) : [];
const tunTop = (i) => T.y[i] + TUNNEL_H + 5;
let river = null;
if (T.river) {
  let lo = Infinity;
  for (let i = 0; i < T.N; i++) { const p = T.pts[i]; if (Math.abs((p[0] - T.river.x) * T.river.dz - (p[1] - T.river.z) * T.river.dx) < 40) lo = Math.min(lo, T.y[i]); }
  river = { ...T.river, water: lo - 9 };
}
const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function farHeight(x, z, dTrack) {
  let h = yMin - 1;
  for (const w of hillW) h += w.a * Math.sin(x * w.fx + w.ph) * Math.cos(z * w.fz - w.ph);
  const ridge = Math.abs(Math.sin(x * 0.0072 + GR.seed0) * Math.cos(z * 0.0064 - GR.seed0)) + 0.35 * Math.abs(Math.sin(x * 0.021 + z * 0.017));
  const m = MOUNT * smoothstep(170, 540, dTrack) * (0.3 + 0.7 * Math.min(1, ridge));
  h += Math.max(0, m);
  if (tun.length) {
    let dt = Infinity; for (let k = 0; k < tun.length; k += 2) { const p = T.pts[tun[k]]; dt = Math.min(dt, Math.hypot(p[0] - x, p[1] - z)); }
    const top = tunTop(tun[tun.length >> 1]) + 26;
    h = Math.max(h, top * (1 - smoothstep(T.tunnel.len * 2 + 40, T.tunnel.len * 2 + 260, dt)) + h * smoothstep(T.tunnel.len * 2 + 40, T.tunnel.len * 2 + 260, dt));
  }
  return h;
}
GR.seed0 = GR() * 6.28;
/** Ground height at (x, z), and whether it lies over the tunnel (left open: the tube and its cap fill it). */
function ground(x, z) {
  const n = nearTrack(x, z, CORR + BLEND + 10);
  const hf = farHeight(x, z, n.i < 0 ? trackDist(x, z) : n.d);
  let y = hf, hole = false;
  if (n.i >= 0) {
    let ref = T.y[n.i] - 0.7, d = n.d;
    if (n.low >= 0 && T.y[n.low] < T.y[n.i] - 3) { ref = T.y[n.low] - 0.7; d = 0; }
    else if (inTunnel(T, n.i, -1)) { ref = Math.max(tunTop(n.i), hf); hole = n.d < CORR - 2; d = 0; }
    y = ref + (hf - ref) * smoothstep(CORR, CORR + BLEND, d);
  }
  if (river) {
    const dr = Math.abs((x - river.x) * river.dz - (z - river.z) * river.dx), bank = river.water + 1.6;
    if (dr < 18) y = river.water - 5 + (bank - river.water + 5) * smoothstep(0, 18, dr);
    else if (dr < 80) y = bank + (y - bank) * smoothstep(18, 80, dr);
  }
  // fade to a flat rim at the edge of the terrain so the mountains don't end in a cliff
  const rim = smoothstep(EXT * 0.9, EXT, Math.max(Math.abs(x), Math.abs(z)));
  return { y: y + (yMin - 2 - y) * rim, hole };
}
const groundY = (x, z) => ground(x, z).y;
{
  const G = HIGH ? 200 : 140, step = (EXT * 2) / G, pos = new Float32Array((G + 1) * (G + 1) * 3), uv = new Float32Array((G + 1) * (G + 1) * 2), holes = new Uint8Array((G + 1) * (G + 1));
  for (let r = 0; r <= G; r++) for (let c = 0; c <= G; c++) {
    const k = r * (G + 1) + c, x = -EXT + c * step, z = -EXT + r * step, g = ground(x, z);
    pos.set([x, g.y, z], k * 3); uv.set([c / G * 120, r / G * 120], k * 2); holes[k] = g.hole ? 1 : 0;
  }
  const idx = [];
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const a = r * (G + 1) + c, b = a + 1, d = a + G + 1, e = d + 1;
    if (holes[a] || holes[b] || holes[d] || holes[e]) continue;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // steep slopes go to rock, high peaks to snow
  const nrm = g.attributes.normal, col = new Float32Array(pos.length);
  for (let k = 0; k < nrm.count; k++) {
    const steep = smoothstep(0.86, 0.6, nrm.getY(k)), snow = smoothstep(yMax + 70, yMax + 120, pos[k * 3 + 1]);
    const rr = 1 - steep * 0.35 + snow * 0.6, gg = 1 - steep * 0.42 + snow * 0.6, bb = 1 - steep * 0.3 + snow * 0.75;
    col.set([Math.min(1.6, rr), Math.min(1.6, gg), Math.min(1.6, bb)], k * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  grassTex.repeat.set(1, 1);
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true }));
  terrain.receiveShadow = true; scene.add(terrain);
  // flat land to the horizon around the terrain square (a hole where the terrain is, so valleys and the river show)
  const sh = new THREE.Shape([new THREE.Vector2(-4000, -4000), new THREE.Vector2(4000, -4000), new THREE.Vector2(4000, 4000), new THREE.Vector2(-4000, 4000)]);
  const E2 = EXT - step;
  sh.holes.push(new THREE.Path([new THREE.Vector2(-E2, -E2), new THREE.Vector2(-E2, E2), new THREE.Vector2(E2, E2), new THREE.Vector2(E2, -E2)]));
  const rimTex = grassTex.clone(); rimTex.repeat.set(0.03, 0.03); rimTex.needsUpdate = true;
  const rim = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ map: rimTex }));
  rim.rotation.x = -Math.PI / 2; rim.position.y = yMin - 2; scene.add(rim);
}
// River: a water strip along the valley floor.
if (river) {
  const L = EXT * 2.2, w = 15, waterTex = canvasTex(64, 64, (g, w2, h) => { g.fillStyle = "#2d7fb0"; g.fillRect(0, 0, w2, h); for (let i = 0; i < 90; i++) { g.fillStyle = R() < 0.5 ? "#3d93c4" : "#2a6e9a"; g.fillRect(R() * w2, R() * h, 6 + R() * 10, 1.5); } });
  waterTex.repeat.set(2, L / 40);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, L), new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.92 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(-river.dx, -river.dz);
  m.position.set(river.x, river.water, river.z); scene.add(m);
  river.tex = waterTex;
}

// Track ribbons: a strip between two side offsets along the centreline.
function ribbon(off0, off1, y, mat, vScale) {
  const N = T.N, pos = [], uv = [], idx = [];
  let v = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = T.pts[k], nn = T.nor[k];
    const yy = T.y[k] + y;
    pos.push(p[0] + nn[0] * off0, yy, p[1] + nn[1] * off0, p[0] + nn[0] * off1, yy, p[1] + nn[1] * off1);
    uv.push(0, v, 1, v); v += 4 / vScale;
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
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
const dirtTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = TH.dirt[0]; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = R() < 0.5 ? TH.dirt[1] : TH.dirt[2]; g.fillRect(R() * w, R() * h, 2, 2); } });
const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
ribbon(-ROAD_W / 2 - SHOULDER, -ROAD_W / 2 - 2.4, 0.04, dirtMat, 10);
ribbon(ROAD_W / 2 + 2.4, ROAD_W / 2 + SHOULDER, 0.04, dirtMat, 10);

// Bamboo barriers: vertical walls along both edges.
function wall(off, h) {
  const N = T.N, pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = T.pts[k], nn = T.nor[k], x = p[0] + nn[0] * off, z = p[1] + nn[1] * off;
    pos.push(x, T.y[k] - 0.6, z, x, T.y[k] + h, z); uv.push(u, 0, u, 1); u += 4 / 6;
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, bambooMat));
}
const bambooTex = canvasTex(64, 32, (g, w, h) => {
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? TH.bamboo[0] : TH.bamboo[1]; g.fillRect(i * 16, 0, 16, h); g.fillStyle = TH.bamboo[2]; g.fillRect(i * 16, 0, 2, h); g.fillRect(i * 16, h * 0.45, 16, 2); }
  g.fillStyle = "#e0312b"; g.fillRect(0, 0, w, 4);
});
const bambooMat = new THREE.MeshLambertMaterial({ map: bambooTex, side: THREE.DoubleSide });
wall(-ROAD_W / 2 - SHOULDER, 2.6);
wall(ROAD_W / 2 + SHOULDER, 2.6);

// Bridges: wherever the ground drops away under the road (overpass, river, valleys) — a deck
// underside, girders along both edges and pillars down to the ground.
const OUT = ROAD_W / 2 + SHOULDER;
const onBridge = new Uint8Array(T.N);
for (let i = 0; i < T.N; i++) {
  const p = T.pts[i], nn = T.nor[i];
  if (inTunnel(T, i, 2)) continue;
  const gs = [0, -1, 1].map((sg) => groundY(p[0] + nn[0] * sg * OUT * 0.9, p[1] + nn[1] * sg * OUT * 0.9));
  if (Math.min(...gs) < T.y[i] - 2.4) onBridge[i] = 1;
}
for (let i = 0; i < T.N; i++) if (onBridge[i]) for (const d of [-2, -1, 1, 2]) onBridge[(i + d + T.N) % T.N] |= 2; // overlap a little into the banks
{
  const concreteTex = canvasTex(32, 32, (g, w, h) => { g.fillStyle = "#b9b4aa"; g.fillRect(0, 0, w, h); for (let i = 0; i < 120; i++) { g.fillStyle = R() < 0.5 ? "#a9a49a" : "#c6c1b7"; g.fillRect(R() * w, R() * h, 2, 2); } g.fillStyle = "#8f8a80"; g.fillRect(0, h - 3, w, 3); });
  const conc = new THREE.MeshLambertMaterial({ map: concreteTex, side: THREE.DoubleSide });
  const pos = [], uv = [], idx = [], DEPTH = 3.2;
  const quad = (a, b, c, d) => { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...d); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  for (let i = 0; i < T.N; i++) {
    const j = (i + 1) % T.N; if (!onBridge[i] || !onBridge[j]) continue;
    const P = (k, sg, dy) => { const p = T.pts[k], nn = T.nor[k]; return [p[0] + nn[0] * sg * OUT, T.y[k] + dy, p[1] + nn[1] * sg * OUT]; };
    quad(P(i, -1, -DEPTH), P(i, 1, -DEPTH), P(j, 1, -DEPTH), P(j, -1, -DEPTH)); // underside
    for (const sg of [-1, 1]) quad(P(i, sg, -0.6), P(j, sg, -0.6), P(j, sg, -DEPTH), P(i, sg, -DEPTH)); // girders
  }
  const pillars = [];
  for (let i = 0; i < T.N; i += 6) {
    if (!(onBridge[i] & 1)) continue;
    for (const sg of [-1, 1]) {
      const p = T.pts[i], nn = T.nor[i], x = p[0] + nn[0] * sg * (OUT - 3), z = p[1] + nn[1] * sg * (OUT - 3), gy = groundY(x, z);
      const under = nearTrack(x, z, OUT + 4);
      if (under.low >= 0 && T.y[under.low] < T.y[i] - 3) continue; // that ground is the road below
      if (gy < T.y[i] - DEPTH - 0.5) pillars.push([x, z, gy - 1, T.y[i] - DEPTH]);
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); scene.add(new THREE.Mesh(g, conc));
  }
  if (pillars.length) {
    const pg = new THREE.BoxGeometry(3.2, 1, 3.2); pg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pg, conc, pillars.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    pillars.forEach(([x, z, y0, y1], k) => { m4.compose(v.set(x, y0, z), q, sc.set(1, y1 - y0, 1)); im.setMatrixAt(k, m4); });
    im.castShadow = HIGH; scene.add(im);
  }
}

// Tunnel: an arched tube with ceiling lamps, a cap of mountain over it and a stone portal at each mouth.
if (T.tunnel) {
  const K = 12, A = T.tunnel.a, L = T.tunnel.len, pos = [], uv = [], idx = [], lamps = [];
  const tubeTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = "#5d5a55"; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = R() < 0.5 ? "#55524d" : "#67645e"; g.fillRect(R() * w, R() * h, 3, 2); } g.fillStyle = "#4a4743"; g.fillRect(0, 0, w, 2); });
  for (let s2 = 0; s2 <= L + 2; s2++) {
    const k = (A - 1 + s2 + T.N) % T.N, p = T.pts[k], nn = T.nor[k];
    for (let q = 0; q <= K; q++) {
      const th = (q / K) * Math.PI, off = Math.cos(th) * OUT, h = Math.sin(th) * TUNNEL_H;
      pos.push(p[0] + nn[0] * off, T.y[k] - 0.6 + h, p[1] + nn[1] * off); uv.push(q / K * 3, s2 / 2);
      if (s2 <= L + 1 && q < K) { const a = s2 * (K + 1) + q, b = a + K + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    if (s2 % 3 === 1) lamps.push([p[0], T.y[k] + TUNNEL_H - 1.2, p[1], Math.atan2(T.tan[k][1], T.tan[k][0])]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tubeTex, side: THREE.DoubleSide })));
  const lampG = new THREE.BoxGeometry(5, 0.4, 1.2), lampIm = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xfff1c0 }), lamps.length);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  lamps.forEach(([x, y, z, a], k) => { m4.compose(v4.set(x, y, z), q4.setFromEuler(e4.set(0, -a, 0)), one); lampIm.setMatrixAt(k, m4); });
  scene.add(lampIm);
  // cap: a strip of mountain over the tube, as wide as the hole cut in the terrain
  const cap = [], cuv = [], cidx = [], W = CORR + 8;
  for (let s2 = 0; s2 <= L; s2++) {
    const k = (A + s2) % T.N, p = T.pts[k], nn = T.nor[k];
    for (const sg of [-1, 1]) { const x = p[0] + nn[0] * sg * W, z = p[1] + nn[1] * sg * W; cap.push(x, Math.max(tunTop(k), groundY(x, z)) + 0.3, z); cuv.push(sg < 0 ? 0 : 6, s2 / 2); }
    cap.push(p[0], tunTop(k) + 3, p[1]); cuv.push(3, s2 / 2);
    if (s2 < L) { const a = s2 * 3; cidx.push(a, a + 2, a + 3, a + 2, a + 5, a + 3, a + 2, a + 1, a + 5, a + 1, a + 4, a + 5); }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute("position", new THREE.Float32BufferAttribute(cap, 3)); cg.setAttribute("uv", new THREE.Float32BufferAttribute(cuv, 2));
  cg.setIndex(cidx); cg.computeVertexNormals();
  scene.add(new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ map: grassTex, side: THREE.DoubleSide })));
  // portals: a stone wall with an arched opening, facing out of each mouth
  const stoneTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = "#8a8378"; g.fillRect(0, 0, w, h); g.strokeStyle = "#6a645a"; g.lineWidth = 2; for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) g.strokeRect(x, y, 16, 16); });
  stoneTex.repeat.set(0.08, 0.08);
  const stone = new THREE.MeshLambertMaterial({ map: stoneTex, side: THREE.DoubleSide });
  for (const [k, dir] of [[A, -1], [(A + L) % T.N, 1]]) {
    const PW = W + 4, PH = TUNNEL_H + 14, sh = new THREE.Shape();
    sh.moveTo(-PW, -1.5); sh.lineTo(PW, -1.5); sh.lineTo(PW, PH); sh.lineTo(-PW, PH); sh.lineTo(-PW, -1.5);
    const hole = new THREE.Path(); hole.moveTo(-OUT, -0.6);
    for (let q = 0; q <= 16; q++) { const th = (q / 16) * Math.PI; hole.lineTo(-Math.cos(th) * OUT, -0.6 + Math.sin(th) * TUNNEL_H); }
    hole.lineTo(OUT, -0.6); sh.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: false }); geo.translate(0, 0, -1.5);
    const m = new THREE.Mesh(geo, stone), p = T.pts[k], t = T.tan[k];
    m.position.set(p[0] + t[0] * dir * 2, T.y[k], p[1] + t[1] * dir * 2); m.rotation.y = -Math.atan2(t[1], t[0]) + Math.PI / 2;
    scene.add(m);
  }
}

// Start line + gate
{
  const p = T.pts[0], t = T.tan[0], a = Math.atan2(t[1], t[0]);
  const chk = canvasTex(64, 8, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#fff"; g.fillRect(x * 4, y * 4, 4, 4); } }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(4, ROAD_W), new THREE.MeshLambertMaterial({ map: chk }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = -a; line.position.set(p[0], T.y[0] + 0.1, p[1]); scene.add(line);
  const gate = new THREE.Group();
  const post = new THREE.MeshLambertMaterial({ color: 0x2b2b30 });
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13.6, 1.6), post); m.position.set(0, 6.2, s * (ROAD_W / 2 + 3)); gate.add(m); }
  const banner = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#151515"; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = "#ffd23f"; g.fillRect(x, 0, 16, 6); g.fillRect(x + 16, h - 6, 16, 6); }
    g.fillStyle = "#ffd23f"; g.font = "italic 900 38px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("MONKEKART", w / 2, h / 2 + 2);
  }, false);
  const bm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, ROAD_W + 8), [new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner }), post, post, post, post]);
  bm.position.y = 12; bm.rotation.y = 0; gate.add(bm);
  gate.position.set(p[0], T.y[0], p[1]); gate.rotation.y = -a; scene.add(gate);
}

// Boost pads (scrolling chevrons)
const padTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = "#1a1030"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#ffd23f"; g.lineWidth = 9; g.lineCap = "round";
  for (const y of [14, 46]) { g.beginPath(); g.moveTo(10, y + 10); g.lineTo(32, y - 8); g.lineTo(54, y + 10); g.stroke(); }
});
padTex.repeat.set(1, 2);
const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
// Each pad is a quad laid on the road surface (RV 3 roads climb and dip).
for (const pad of T.pads) {
  const p = T.pts[pad.i], nn = T.nor[pad.i], t = T.tan[pad.i], pos = [];
  for (const [f, sd] of [[-3.5, -4.5], [-3.5, 4.5], [3.5, 4.5], [3.5, -4.5]]) {
    const x = p[0] + t[0] * f + nn[0] * (pad.off + sd), z = p[1] + t[1] * f + nn[1] * (pad.off + sd);
    pos.push(x, heightAt(T, pad.i, x, z) + 0.12, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, padMat));
}

// Scenery: palm-ish trees and giant bananas, never on the track.
function offTrack(x, z, clear) {
  for (let i = 0; i < T.N; i += 3) { const p = T.pts[i]; if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < clear * clear) return false; }
  if (river && Math.abs((x - river.x) * river.dz - (z - river.z) * river.dx) < 24) return false;
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
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: TH.trunk }), spots.length);
  // White material so each canopy takes its own colour from the theme (mixed autumn leaves, snow caps).
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), spots.length * 2);
  const leafCol = new THREE.Color();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  spots.forEach(([x, z, s, r], i) => {
    const h = 14 * s;
    const gy = groundY(x, z);
    m4.compose(new THREE.Vector3(x, gy - 0.6, z), q.setFromEuler(e.set(0, r, 0)), new THREE.Vector3(s, h + 0.6, s)); trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, gy + h + 3 * s, z), q.setFromEuler(e.set(R(), r, R())), new THREE.Vector3(7 * s, 4.5 * s, 7 * s)); leaves.setMatrixAt(i * 2, m4);
    m4.compose(new THREE.Vector3(x + 2 * s, gy + h + 0.5 * s, z - 1.5 * s), q.setFromEuler(e.set(R(), r + 1, R())), new THREE.Vector3(5 * s, 3.5 * s, 5 * s)); leaves.setMatrixAt(i * 2 + 1, m4);
    leaves.setColorAt(i * 2, leafCol.setHex(TH.leaves[Math.floor(R() * TH.leaves.length)]));
    leaves.setColorAt(i * 2 + 1, leafCol.setHex(TH.leaves[Math.floor(R() * TH.leaves.length)]));
  });
  scene.add(trunks, leaves);
  // a few giant bananas lying in the infield/outfield
  const banG = new THREE.TorusGeometry(10, 2.6, 8, 18, Math.PI * 0.75);
  const banM = new THREE.MeshLambertMaterial({ color: TH.banana, flatShading: true });
  let placed = 0;
  for (let tries = 0; tries < 800 && placed < 6; tries++) {
    const x = (R() - 0.5) * 2 * ext * 0.8, z = (R() - 0.5) * 2 * ext * 0.8;
    if (!offTrack(x, z, ROAD_W / 2 + SHOULDER + 22)) continue;
    const b = new THREE.Mesh(banG, banM); b.position.set(x, groundY(x, z) + 2.6, z); b.rotation.set(Math.PI / 2, 0, R() * 6.28); scene.add(b); placed++;
  }
}

// Roadside props, close to the road so they stream past: marker posts on both barriers
// every 12 units, plus cones, tyre stacks and flag poles just outside, more of them on corners.
{
  const outer = ROAD_W / 2 + SHOULDER, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const posts = [], cones = [], tyres = [], flags = [];
  const solid = (i) => !onBridge[i] && !inTunnel(T, i, 3);
  for (let i = 0; i < T.N; i += 3) for (const sg of [-1, 1]) if (solid(i)) posts.push([i, sg]);
  for (let i = 6; i < T.N; i += 5) {
    if (!solid(i)) continue;
    const bend = Math.abs(T.curv[i]) > 0.012;
    if (!bend && R() < 0.55) continue;
    const sg = bend ? (T.curv[i] > 0 ? 1 : -1) * (R() < 0.8 ? 1 : -1) : (R() < 0.5 ? -1 : 1);
    const k = R();
    (k < 0.45 ? cones : k < 0.8 ? tyres : flags).push([i, sg, outer + 2.5 + R() * 4]);
  }
  const at = (i, sg, off, y) => { const p = T.pts[i], nn = T.nor[i]; return v.set(p[0] + nn[0] * sg * off, T.y[i] + y, p[1] + nn[1] * sg * off); };
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

// Monke Camp: carved tiki gates over the road on the straights (5 a lap), crate stacks on every bend.
{
  const CR = rng(T.seed ^ 0x71c1), outer = ROAD_W / 2 + SHOULDER;
  const tikiTex = canvasTex(32, 96, (g, w, h) => {
    for (let f = 0; f < 3; f++) {
      const y = f * 32;
      g.fillStyle = ["#8a5a2e", "#a06a36", "#7a4e26"][f]; g.fillRect(0, y, w, 32);
      g.fillStyle = "#3a2410"; g.fillRect(5, y + 7, 8, 6); g.fillRect(19, y + 7, 8, 6);
      g.fillStyle = "#f2e2b0"; g.fillRect(7, y + 9, 4, 3); g.fillRect(21, y + 9, 4, 3);
      g.fillStyle = "#3a2410"; g.fillRect(14, y + 13, 4, 7); g.fillRect(6, y + 22, 20, 6);
      g.fillStyle = "#f2e2b0"; for (let x = 8; x < 25; x += 4) g.fillRect(x, y + 23, 2, 4);
      g.fillStyle = "#e0312b"; g.fillRect(0, y + 30, w, 2);
    }
  }, false);
  const campTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = TH.banner.bg; g.fillRect(0, 0, w, h);
    g.fillStyle = TH.bamboo[0]; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    g.fillStyle = TH.banner.fg; g.font = "italic 900 36px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(TH.banner.text, w / 2, h / 2 + 2); for (const x of [70, w - 70]) { g.strokeStyle = TH.banner.fg; g.lineWidth = 9; g.lineCap = "round"; g.beginPath(); g.arc(x, 14, 22, 0.5, 2.5); g.stroke(); }
  }, false);
  const tikiM = new THREE.MeshLambertMaterial({ map: tikiTex }), barM = new THREE.MeshLambertMaterial({ map: bambooTex }), dark = new THREE.MeshLambertMaterial({ color: 0x5a3a1c });
  const bannerM = new THREE.MeshBasicMaterial({ map: campTex, side: THREE.DoubleSide });
  const leafM = new THREE.MeshLambertMaterial({ color: TH.gateLeaf, flatShading: true, side: THREE.DoubleSide });
  const gateAt = [];
  const straight = (i) => { for (let d = -8; d <= 8; d++) { const k = (i + d + T.N) % T.N; if (Math.abs(T.curv[k]) > 0.01 || onBridge[k] || inTunnel(T, k, 4)) return false; } return true; };
  const nearPad = (i) => T.pads.some((p) => Math.min(Math.abs(p.i - i), T.N - Math.abs(p.i - i)) < 14);
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.88]) {
    for (let d = 0; d < T.N * 0.08; d++) { const i = Math.floor(T.N * f + d) % T.N; if (straight(i) && !nearPad(i) && i > 20) { gateAt.push(i); break; } }
  }
  for (const i of gateAt) {
    const p = T.pts[i], t = T.tan[i], gate = new THREE.Group(), span = outer + 3;
    for (const sg of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(3, 15, 3), [tikiM, tikiM, dark, dark, tikiM, tikiM]); post.position.set(0, 6.9, sg * span); gate.add(post);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.4, 4), leafM); cap.position.set(0, 16, sg * span); cap.rotation.y = Math.PI / 4; gate.add(cap);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, span * 2 + 6, 8), barM); bar.rotation.x = Math.PI / 2; bar.position.y = 14; gate.add(bar);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.1, span * 0.14), bannerM); banner.rotation.y = -Math.PI / 2; banner.position.y = 11.4; gate.add(banner);
    for (let k = -3; k <= 3; k++) { const lf = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), leafM); lf.position.set(0, 12.3, k * span * 0.3 + (k % 2) * 2); lf.rotation.set(0, Math.PI / 2, (k % 2) * 0.3); gate.add(lf); }
    gate.position.set(p[0], T.y[i] - 0.6, p[1]); gate.rotation.y = -Math.atan2(t[1], t[0]);
    gate.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    scene.add(gate);
  }
  // crates
  const crateTex = canvasTex(32, 32, (g, w, h) => {
    g.fillStyle = "#b07a3c"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#8a5a2a"; for (const y of [8, 16, 24]) g.fillRect(0, y, w, 1);
    g.fillStyle = "#6a4420"; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    g.strokeStyle = "#6a4420"; g.lineWidth = 3; g.beginPath(); g.moveTo(3, 3); g.lineTo(w - 3, h - 3); g.stroke();
    g.strokeStyle = "#ffd23f"; g.lineWidth = 3; g.beginPath(); g.arc(w / 2 + 6, 6, 7, 0.6, 2.4); g.stroke();
  }, false);
  // Crates: a stack on the outside of every bend (2026-11-13: was only the sharpest few, ~2 a lap,
  // hidden behind the wall) and a pile at the foot of each tiki gate. C = 4.2 m boxes.
  const crates = [], C = 4.2;
  const pile = (i, sg, off, n) => {
    const base = Math.min(n, 3);
    for (let k = 0; k < base; k++) crates.push([i, sg, off + k * (C + 0.3), C / 2 - 0.6, CR() * 0.5]);
    for (let k = 0; k < n - base; k++) crates.push([i, sg, off + (k + 0.5) * (C + 0.3), C * 1.5 - 0.6, CR() * 0.5]);
  };
  for (let i = 10; i < T.N; i += 9) {
    if (Math.abs(T.curv[i]) < 0.006 || gateAt.some((g) => Math.abs(g - i) < 10) || onBridge[i] || inTunnel(T, i, 4)) continue;
    pile(i, T.curv[i] > 0 ? -1 : 1, outer + 3 + CR() * 3, 2 + Math.floor(CR() * 4));
  }
  for (const i of gateAt) for (const sg of [-1, 1]) pile((i + 3) % T.N, sg, outer + 6.5, 3 + Math.floor(CR() * 3));
  if (crates.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(C, C, C), new THREE.MeshLambertMaterial({ map: crateTex }), crates.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    crates.forEach(([i, sg, off, y, r], j) => {
      const p = T.pts[i], nn = T.nor[i], x = p[0] + nn[0] * sg * off, z = p[1] + nn[1] * sg * off;
      m4.compose(v.set(x, groundY(x, z) + 0.6 + y, z), q.setFromEuler(e.set(0, -Math.atan2(T.tan[i][1], T.tan[i][0]) + r, 0)), one);
      im.setMatrixAt(j, m4);
    });
    scene.add(im);
  }
}

// ── The kart ── (2026-11-14, owner: Monke RC → MonkeKart, "do the go-kart look"): a low tube
// frame, fat slicks, side pods, nose fairing with a number plate, bumpers, steering wheel, bucket
// seat and a side engine with an exhaust (the boost flame comes out of it). Looks only: the
// physics footprint is unchanged. x is forward.
function buildCar(ghostCar) {
  // root (position/heading) → wheels, and chassis (body on its springs: roll, pitch, heave).
  const g = new THREE.Group(), chassis = new THREE.Group(); g.add(chassis);
  const mat = (c) => ghostCar ? new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.32, depthWrite: false }) : new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const hull = mat(HULL), trim = mat(TRIM), dark = mat(0x18181c), steel = mat(0x9aa0a8), glow = ghostCar ? hull : new THREE.MeshBasicMaterial({ color: GLOW });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); chassis.add(o); return o; };
  const tube = (len, r = 0.16) => new THREE.CylinderGeometry(r, r, len, 6);
  // floor tray + tube rails
  add(new THREE.BoxGeometry(6.6, 0.22, 2.6), dark, -0.2, 0.75, 0);
  for (const z of [-1.45, 1.45]) add(tube(7.2), steel, -0.1, 0.85, z, 0, 0, Math.PI / 2);
  // nose fairing (sloped wedge) + number plate
  add(new THREE.BoxGeometry(2.0, 0.7, 3.0), hull, 3.6, 1.15, 0, 0, 0, -0.32);
  add(new THREE.BoxGeometry(0.08, 0.9, 1.3), glow, 4.55, 1.35, 0, 0, 0, -0.32);
  // front bumper bar + rear bumper loop
  add(tube(4.6), steel, 4.7, 0.85, 0, Math.PI / 2);
  add(tube(5.8, 0.2), steel, -4.25, 1.05, 0, Math.PI / 2);
  for (const z of [-2.9, 2.9]) add(tube(1.1, 0.2), steel, -3.75, 1.05, z, 0, 0, Math.PI / 2);
  // side pods between the wheels
  for (const sg of [-1, 1]) add(new THREE.BoxGeometry(3.0, 0.75, 0.9), hull, 0.0, 1.05, sg * 2.15);
  // steering column + wheel
  add(tube(1.7, 0.12), steel, 1.55, 1.55, 0, 0, 0, 1.0);
  const sw = add(new THREE.TorusGeometry(0.62, 0.13, 6, 14), dark, 0.85, 2.1, 0, 0, Math.PI / 2, 0); sw.rotation.z = 0.5;
  // bucket seat
  add(new THREE.BoxGeometry(1.6, 0.35, 1.9), trim, -1.0, 1.05, 0);
  add(new THREE.BoxGeometry(0.35, 1.8, 1.9), trim, -1.85, 1.85, 0, 0, 0, 0.25);
  // engine + exhaust on the left side behind the seat
  add(new THREE.BoxGeometry(1.4, 1.1, 1.2), steel, -2.9, 1.35, -1.5);
  add(new THREE.BoxGeometry(1.0, 0.25, 1.0), dark, -2.9, 1.98, -1.5);
  add(tube(1.8, 0.2), dark, -3.9, 1.6, -1.5, 0, 0, Math.PI / 2);
  // trim stripe on the nose
  add(new THREE.BoxGeometry(1.9, 0.06, 0.5), glow, 3.55, 1.52, 0, 0, 0, -0.32);
  const wheels = [];
  for (const [x, z, r, w] of [[3.0, 2.55, 1.05, 1.0], [3.0, -2.55, 1.05, 1.0], [-2.85, 2.7, 1.25, 1.6], [-2.85, -2.7, 1.25, 1.6]]) {
    const wheelG = new THREE.CylinderGeometry(r, r, w, 14); wheelG.rotateX(Math.PI / 2);
    const hubG = new THREE.CylinderGeometry(r * 0.48, r * 0.48, w + 0.05, 8); hubG.rotateX(Math.PI / 2);
    const pivot = new THREE.Group(); pivot.position.set(x, r, z);
    const wm = new THREE.Mesh(wheelG, dark); wm.add(new THREE.Mesh(hubG, trim));
    pivot.add(wm); g.add(pivot); wheels.push({ pivot, w: wm, front: x > 0 });
  }
  if (!ghostCar) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root: g, chassis, wheels };
}
const car = buildCar(false), ghostCar = buildCar(true), leaderCar = buildCar(true);
leaderCar.root.traverse((o) => { if (o.isMesh) o.material = o.material.clone(), o.material.color?.set(0xffd23f); });
car.root.rotation.order = "YXZ"; ghostCar.root.rotation.order = "YXZ";
scene.add(car.root); scene.add(ghostCar.root); scene.add(leaderCar.root); ghostCar.root.visible = false; leaderCar.root.visible = false;
leaderCar.root.rotation.order = "YXZ";
// blob shadow
const blob = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), new THREE.MeshBasicMaterial({ map: canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.material.opacity = HIGH ? 0.45 : 1; scene.add(blob);
// underglow: the trim colour on the road under the car while boosting (additive)
const glowTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
const underglow = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshBasicMaterial({ map: glowTex, color: GLOW, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
underglow.rotation.x = -Math.PI / 2; scene.add(underglow);
// boost flame
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 8), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.85 }));
flame.rotation.z = Math.PI / 2; flame.position.set(-5.4, 1.6, -1.5); flame.scale.setScalar(0.7); flame.visible = false; car.chassis.add(flame);
if (HIGH) flame.material.blending = THREE.AdditiveBlending;
// driver: the holder's 3D block monke
let driver = null;
loadImage(imageFor(n)).then(readGrid).then((grid) => {
  driver = buildMonke(grid);
  const box = new THREE.Box3().setFromObject(driver.root), size = box.getSize(new THREE.Vector3());
  const s = 3.9 / Math.max(size.x, size.y, size.z);
  driver.root.scale.setScalar(s);
  const seat = new THREE.Group(); seat.add(driver.root);
  const c = box.getCenter(new THREE.Vector3());
  driver.root.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  seat.rotation.y = Math.PI / 2; seat.position.set(-0.9, 1.2, 0); // sitting low in the kart's bucket seat
  driver.seat = seat;
  driver.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  car.chassis.add(seat);
}).catch(() => {});

// ── Particles: drift smoke + sparks ──
const puffTex = canvasTex(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 1, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
const puffs = [];
for (let i = 0; i < 110; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); puffs.push({ s, life: 0, t: 0, vx: 0, vy: 0, vz: 0 }); }
const ADD = THREE.AdditiveBlending, NORMAL = THREE.NormalBlending;
let puffIx = 0;
function puff(x, y, z, colour, size, life, vx = 0, vy = 2, vz = 0, glow = false) {
  const p = puffs[puffIx++ % puffs.length];
  const bl = glow && HIGH ? ADD : NORMAL; if (p.s.material.blending !== bl) { p.s.material.blending = bl; p.s.material.needsUpdate = true; }
  p.s.visible = true; p.s.position.set(x, y, z); p.s.material.color.set(colour); p.s.scale.setScalar(size);
  p.life = life; p.t = 0; p.vx = vx; p.vy = vy; p.vz = vz; p.size = size;
}

// Skid marks: a ring of dark quads laid under the rear wheels while drifting.
const SKIDS = 480;
const skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x15151a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), SKIDS);
skidMesh.count = 0; skidMesh.frustumCulled = false; scene.add(skidMesh);
let skidIx = 0; const skidLast = [null, null];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function skid(k, x, z, a, y = 0) {
  const last = skidLast[k];
  if (last) {
    const dx = x - last[0], dz = z - last[1], len = Math.hypot(dx, dz);
    if (len < 0.8) return;
    if (len < 6) {
      _m.compose(_v.set((x + last[0]) / 2, y + 0.11, (z + last[1]) / 2), _q.setFromEuler(_e.set(0, -Math.atan2(dz, dx), 0)), _s.set(len, 1, 1));
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
const HOW = {
  pads: "Left thumb: slide to <b>steer</b>.<br>Right thumb: hold <b>DRIFT</b> in a turn, let go to <b>boost</b> · <b>BRAKE</b> above it.<br>Controls can be changed in the ‖ menu",
  tilt: "<b>Tilt</b> the phone to steer.<br>Hold <b>DRIFT</b> in a turn, let go to <b>boost</b> · <b>BRAKE</b> above it.<br>Hold the phone how you'll race when the countdown starts",
  swipe: "Drag left / right anywhere to steer.<br>Drag far to <b>drift</b> · let go of a drift for a <b>boost</b>.<br>Two fingers = brake · ⚡ pads boost",
};
const HINT = {
  pads: "Slide left thumb to steer · hold DRIFT in a turn, let go to boost · tap DRIFT right before GO for a start boost",
  tilt: "Tilt to steer · hold DRIFT in a turn, let go to boost · tap DRIFT right before GO for a start boost",
  swipe: "Drag left / right to steer · drag far to drift · hold a drift longer for a bigger boost · tap right before GO for a start boost",
};
function setHint() { if (isTouch) $("hint").textContent = HINT[ctrl]; }
function showCard(html, onAct) {
  card.innerHTML = html; card.hidden = false;
  card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); onAct(b.dataset.act); }));
}

// ── Input (2026-11-13 controls pass) ──
// Touch has three schemes, picked in the pause menu (rc:ctrl):
//   pads  (default) left side = floating thumb stick for steering only (dead zone + curve, the
//         stick follows the thumb past full lock); right side = DRIFT and BRAKE buttons.
//   tilt  tilt the phone to steer (zeroed at the countdown); same DRIFT/BRAKE buttons.
//   swipe the old scheme: drag anywhere, drag far = drift, two fingers = brake.
// Before this, steering hard always started a drift and the brake was an invisible second finger.
const input = { steer: 0, gas: 1, brake: 0, drift: false };
const keys = new Set();
const touches = new Map(); let steerId = null, steerX0 = 0;
const wheel = $("wheel"), pads = $("pads"), driftBtn = $("drift"), brakeBtn = $("brake");
const STEER_SPAN = () => Math.min(innerWidth, 520) * 0.2;
const CTRLS = ["pads", "tilt", "swipe"];
let ctrl = CTRLS.includes(store.get("rc:ctrl")) ? store.get("rc:ctrl") : "pads";
setHint();
const held = { drift: new Set(), brake: new Set() };
const DEAD = 0.08, curve = (d) => { const a = Math.abs(d); return a < DEAD ? 0 : Math.sign(d) * Math.min(1, ((a - DEAD) / (1 - DEAD)) ** 1.25); };
let tiltG = null, tilt0 = 0;
addEventListener("deviceorientation", (e) => {
  if (e.gamma == null) return;
  // Portrait: gamma is left/right tilt. Landscape: beta, signed by which way the phone is turned.
  const ang = screen.orientation?.angle ?? 0;
  tiltG = ang === 90 ? e.beta : ang === 270 || ang === -90 ? -e.beta : e.gamma;
});
const zeroTilt = () => { tilt0 = tiltG ?? 0; };
function showPads() { pads.hidden = !(isTouch && ctrl !== "swipe" && (state === "race" || state === "count")); }
function setStick(dx) { wheel.firstElementChild.style.transform = `translateX(${Math.max(-1, Math.min(1, dx)) * 26}px)`; }
for (const [btn, set] of [[driftBtn, held.drift], [brakeBtn, held.brake]]) {
  btn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); audio(); notePress(); set.add(e.pointerId); btn.classList.add("on"); btn.setPointerCapture?.(e.pointerId); if (set === held.brake) buzz(5); });
  const up = (e) => { set.delete(e.pointerId); if (!set.size) btn.classList.remove("on"); };
  btn.addEventListener("pointerup", up); btn.addEventListener("pointercancel", up); btn.addEventListener("lostpointercapture", up);
}
view.addEventListener("pointerdown", (e) => {
  audio(); notePress();
  touches.set(e.pointerId, e);
  const steerZone = ctrl === "swipe" || (ctrl === "pads" && e.clientX < innerWidth * 0.62);
  if (steerId === null && steerZone) { steerId = e.pointerId; steerX0 = e.clientX; wheel.style.display = "block"; wheel.style.left = `${e.clientX}px`; wheel.style.top = `${e.clientY}px`; setStick(0); }
  view.setPointerCapture?.(e.pointerId);
});
view.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (e.pointerId !== steerId) return;
  let dx = (e.clientX - steerX0) / STEER_SPAN();
  if (ctrl === "pads" && Math.abs(dx) > 1.1) { steerX0 = e.clientX - Math.sign(dx) * 1.1 * STEER_SPAN(); dx = Math.sign(dx) * 1.1; wheel.style.left = `${steerX0}px`; }
  setStick(dx);
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
// Controller (2026-11-13: an 8BitDo had no way to drift — it needed RT+RB together or button 2, whose
// label differs between Xbox and Nintendo layouts). Gas is automatic, so every free button drifts:
// A X Y · LB RB · RT. Brake: B · LT · D-pad down. Steer: stick or D-pad. A/Start starts a race, Start pauses.
const PAD_DRIFT = [0, 2, 3, 4, 5, 7], PAD_BRAKE = [1, 6, 13];
const gamepad = () => [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected) ?? null;
const btn = (p, i) => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.3); };
let padPrev = [];
function pollPadButtons() {
  const pad = gamepad();
  if (!pad) { padPrev = []; return; }
  const now = pad.buttons.map((_, i) => btn(pad, i)), down = (i) => now[i] && !padPrev[i];
  if (now.some((v, i) => v && !padPrev[i])) notePress();
  if (!card.hidden && menu.hidden) { if (down(0) || down(9)) card.querySelector("button.go")?.click(); }
  else if (down(9) && state !== "title") menu.hidden ? openMenu() : resume();
  padPrev = now;
}
function readInput() {
  let steer = 0, brake = 0, drift = false;
  const st = touches.get(steerId);
  if (ctrl === "swipe") {
    if (st) { const dx = (st.clientX - steerX0) / STEER_SPAN(); steer = Math.max(-1, Math.min(1, dx)); drift = Math.abs(dx) > 0.82; }
    if (touches.size >= 2) brake = 1;
  } else {
    if (ctrl === "pads" && st) steer = curve((st.clientX - steerX0) / STEER_SPAN());
    if (ctrl === "tilt" && tiltG != null) steer = curve((tiltG - tilt0) / 24);
    if (held.drift.size) drift = true;
    if (held.brake.size) brake = 1;
  }
  if (keys.has("arrowleft") || keys.has("a")) steer -= 1;
  if (keys.has("arrowright") || keys.has("d")) steer += 1;
  if (keys.has("arrowdown") || keys.has("s")) brake = 1;
  if (keys.has("shift") || keys.has(" ")) drift = true;
  const pad = gamepad();
  if (pad) {
    const ax = pad.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer += ax;
    if (btn(pad, 14)) steer -= 1;
    if (btn(pad, 15)) steer += 1;
    if (PAD_BRAKE.some((i) => btn(pad, i))) brake = 1;
    if (PAD_DRIFT.some((i) => btn(pad, i))) drift = true;
  }
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
  if (window.__rcFreeCam) return; // ?debug test shots aim the camera themselves
  const now = performance.now(), dt = Math.min(0.05, (now - (lastCamT || now)) / 1000); lastCamT = now;
  const a = run.a, fx = Math.cos(a), fz = Math.sin(a), spd = speedOf(run), kv = Math.min(1.3, spd / V_MAX);
  const portrait = innerHeight > innerWidth;
  const back = (portrait ? 16 : 13) + kv * 2, up = portrait ? 9 : 7;
  const want = new THREE.Vector3(run.x - fx * back, carY + up, run.z - fz * back);
  const look = new THREE.Vector3(run.x + fx * 20, T.y[(run.idx + 5) % T.N], run.z + fz * 20);
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
  clearSkids(); lastTier = 0; lastA = null; lastVf = 0; lean = 0;
  for (const k in sus) sus[k][0] = sus[k][1] = 0;
  placeCamera(true);
  updateHud();
}

// The day's track is fixed when the page loads (COURSE). A page left open past 00:00 UTC kept
// yesterday's track (owner 2026-11-14: "hasn't switched tracks yet"), so off the race the page
// reloads onto the new day, and the title says when the next track arrives.
const newDay = () => !DEMO && todayId() !== COURSE;
function nextTrackLine() {
  const next = nextTrackAt(COURSE), m = Math.max(1, Math.round((next - Date.now()) / 60000));
  const at = new Date(next).toLocaleString(undefined, m > 20 * 60 ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" });
  return `New track in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`} (${at})`;
}
const offRace = () => state === "title" || state === "board";
setInterval(() => {
  if (DEMO) return;
  if (newDay() && offRace()) { location.reload(); return; }
  const el = document.getElementById("nexttrack"); if (el) el.textContent = nextTrackLine();
}, 30_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && newDay() && offRace()) location.reload(); });

function title() {
  if (newDay()) { location.reload(); return; }
  state = "title"; showPads();
  showCard(`
    <h1>MONKEKART</h1>
    <div class="tag">${COURSE_NAME}</div>
    <div>MONKE #${n} <span class="dim">· <span class="swatch" style="background:${HULL}"></span>body <span class="swatch" style="background:${TRIM}"></span>trim</span></div>
    <div class="how">${isTouch ? HOW[ctrl] : "← → steer · Shift drift (let go to boost)<br>↓ brake · Esc pause<br>🎮 stick steer · A / RB / RT drift · B / LT brake · Start pause"}</div>
    <div class="dim">${LAPS} laps${best ? ` · your best ${fmt(best)}` : ""}${ghost && ghostOn ? " · racing your ghost" : ""}</div>
    <div class="dim" id="leaderline"></div>
    ${!DEMO ? `<div class="dim">Finish today's track for bananas · fastest time tops the daily board</div><div class="dim" id="nexttrack">${nextTrackLine()}</div>` : ""}
    ${DEMO ? `<div class="dim">The daily track, leaderboard and bananas are for Saga Monke holders · ${GET_APP}</div>` : ""}
    <div class="row"><button class="go" data-act="go">RACE</button><button data-act="board">BOARD</button></div>
  `, (act) => { if (newDay()) location.reload(); else if (act === "go") countdown(); else if (act === "board") boardCard(); });
  showLeaderLine();
}
// Today's daily board (worker racer.ts, public GET while RACER_BOARD is "on").
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function boardCard() {
  const day = todayId();
  showCard(`<h1>DAILY BOARD</h1><div class="tag">${esc(day)} · UTC</div><div class="stats" id="boardrows"><span>Loading…</span><b></b></div><div class="row"><button class="go" data-act="back">BACK</button></div>`, () => title());
  fetch(`/api/racer/board?day=${day}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    const rows = document.getElementById("boardrows"); if (!rows) return;
    const top = Array.isArray(d?.top) ? d.top : null;
    rows.innerHTML = !top ? `<span>Board not open yet</span><b></b>` : !top.length ? `<span>No times yet today — be first</span><b></b>`
      : top.slice(0, 10).map((r, i) => `<span>${i + 1}. ${esc(r.name || "Monke")}${r.n === n ? " (you)" : ""}</span><b>${fmt(r.t)}</b>`).join("");
  }).catch(() => { const rows = document.getElementById("boardrows"); if (rows) rows.innerHTML = `<span>Couldn't load the board</span><b></b>`; });
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
  zeroTilt(); setHint(); showPads();
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
  state = "done"; showPads();
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

function openMenu() { if (state === "title") return; paused = true; touches.clear(); held.drift.clear(); held.brake.clear(); driftBtn.classList.remove("on"); brakeBtn.classList.remove("on"); steerId = null; wheel.style.display = "none"; renderMenu(); menu.hidden = false; }
function resume() { menu.hidden = true; paused = false; lastT = performance.now(); }
const CTRL_NAME = { pads: "Buttons", tilt: "Tilt", swipe: "Swipe (old)" };
function renderMenu() { $("ghostbtn").textContent = `Ghost: ${ghostOn ? "on" : "off"}`; $("sound").textContent = `Sound: ${soundOn ? "on" : "off"}`; $("ctrlbtn").textContent = `Controls: ${CTRL_NAME[ctrl]}`; $("ctrlbtn").hidden = !isTouch; }
$("ctrlbtn").addEventListener("click", () => { ctrl = CTRLS[(CTRLS.indexOf(ctrl) + 1) % CTRLS.length]; store.set("rc:ctrl", ctrl); zeroTilt(); renderMenu(); setHint(); });
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
    if (e.type === "wall") { sfx.wall(); buzz(25); wallFx = Math.min(1.6, e.speed / 25); sparks(10); sus.heave[1] += Math.min(4, e.speed / 12); sus.roll[1] += (Math.random() - 0.5) * 1.5; }
    if (e.type === "pad") { sfx.pad(); buzz(15); toast("BOOST"); sus.pitch[1] += 0.9; sus.heave[1] += 1.2; }
    if (e.type === "driftBoost") { sfx.boost(e.s); buzz(8 + e.tier * 6); toast(["BOOST", "SUPER BOOST", "ULTRA BOOST"][e.tier - 1]); sus.pitch[1] += 0.4 + e.tier * 0.25; }
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
  pollPadButtons();
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
  if (river) river.tex.offset.y -= dt * 0.25;
  if (snowFx) snowFx(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let spin = 0, lastTier = 0, lastA = null, lastVf = 0, lean = 0;
// Chassis springs: x = current, v = rate. Slightly under-damped so it settles with a little bounce.
const sus = { roll: [0, 0], pitch: [0, 0], heave: [0, 0] };
function spring(k, target, dt, K = 130, C = 15) { const s = sus[k]; s[1] += ((target - s[0]) * K - s[1] * C) * dt; s[0] += s[1] * dt; return s[0]; }
let fpsT = 0, fpsN = 0;
let carY = 0, carPitch = 0, gIdx = 0, lIdx = 0;
function poseY(x, z, hint) { const i = nearest(T, x, z, hint); return [heightAt(T, i, x, z), i]; }
function sparks(nSp) {
  const sg = Math.sign(sideOf(T, run.idx, run.x, run.z)) || 1, nn = T.nor[run.idx];
  const x = run.x + nn[0] * sg * 2.6, z = run.z + nn[1] * sg * 2.6, ca = Math.cos(run.a), sa = Math.sin(run.a);
  for (let i = 0; i < nSp; i++) puff(x, carY + 1 + Math.random(), z, Math.random() < 0.5 ? "#ffd23f" : "#ff8a1a", 0.6 + Math.random() * 0.5, 0.3, -ca * 14 + (Math.random() - 0.5) * 16, 3 + Math.random() * 7, -sa * 14 + (Math.random() - 0.5) * 16);
}
function drawCar(dt) {
  carY = heightAt(T, run.idx, run.x, run.z);
  const along = Math.cos(run.a) * T.tan[run.idx][0] + Math.sin(run.a) * T.tan[run.idx][1];
  carPitch += (Math.atan(slopeAt(T, run.idx) * along) - carPitch) * Math.min(1, dt * 8);
  car.root.position.set(run.x, carY, run.z);
  car.root.rotation.set(0, -run.a, carPitch, "YZX");
  // Suspension: the body rolls out of the turn, squats on throttle, dives on the brake,
  // bounces on grass, wall hits and boost kicks. The driver leans into the turn.
  if (dt > 0) {
    let da = lastA == null ? 0 : run.a - lastA; da = Math.atan2(Math.sin(da), Math.cos(da));
    const latA = run.vf * da / dt, lonA = (run.vf - lastVf) / dt;
    lastA = run.a; lastVf = run.vf;
    const r = spring("roll", -Math.max(-0.11, Math.min(0.11, latA * 0.0022)), dt);
    const pt = spring("pitch", Math.max(-0.07, Math.min(0.07, lonA * 0.0007)), dt, 110, 13);
    if (run.grass && speedOf(run) > 15 && Math.random() < 0.25) sus.heave[1] += (Math.random() - 0.3) * 3;
    const hv = spring("heave", 0, dt, 160, 11);
    car.chassis.rotation.set(r, 0, pt, "YXZ"); car.chassis.position.y = hv;
    lean += (Math.max(-0.25, Math.min(0.25, latA * 0.004)) - lean) * Math.min(1, dt * 6);
    if (driver?.seat) driver.seat.rotation.z = -lean * 0.6;
  }
  spin += run.vf * dt / 1.35;
  for (const w of car.wheels) { w.w.rotation.z = -spin; if (w.front) w.pivot.rotation.y = -run.steer * 0.45; }
  if (HIGH) { sun.position.set(run.x + SUN_DIR.x * 120, carY + SUN_DIR.y * 120, run.z + SUN_DIR.z * 120); sun.target.position.set(run.x, carY, run.z); }
  underglow.position.set(run.x, carY + 0.14, run.z); underglow.rotation.z = -run.a;
  underglow.material.opacity += ((run.boost > 0 ? (HIGH ? 0.55 : 0.35) : 0) - underglow.material.opacity) * Math.min(1, dt * 10);
  underglow.visible = underglow.material.opacity > 0.02;
  // Auto quality: average fps over the first 4 s of racing; under 40 drops to low for good.
  if (HIGH && !QP && state === "race" && fpsT < 4) { fpsT += dt; fpsN++; if (fpsT >= 4 && fpsN / fpsT < 40) setLow(); }
  blob.position.set(run.x, carY + 0.15, run.z); blob.rotation.z = -run.a;
  flame.visible = run.boost > 0; if (flame.visible) { flame.scale.set(0.55, 0.45 + Math.random() * 0.35, 0.55); flame.material.color.set(run.boost > 1 ? GLOW : "#ffb030"); }
  // drift smoke and spark colour by charge (blue → yellow → pink)
  const spd = speedOf(run), ca = Math.cos(run.a), sa = Math.sin(run.a);
  if (state === "race" && (run.drifting || (run.grass && spd > 20)) && Math.random() < 0.7) {
    for (const side of [-1, 1]) {
      const x = run.x - ca * 3.2 - sa * side * 2.8, z = run.z - sa * 3.2 + ca * side * 2.8;
      puff(x, carY + 0.8, z, run.grass ? "#a08a60" : "#e8e8e8", 2.2 + Math.random() * 1.5, 0.7, (Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3);
    }
    if (run.drifting) {
      const tier = driftTier(run.driftCharge);
      if (tier > lastTier) { tone(500 + tier * 220, 900 + tier * 300, 0.12, "triangle", 0.06); buzz(6); }
      lastTier = tier;
      const c = ["#9aa4b0", "#6cf", "#ffd23f", "#ff4fd8"][tier];
      for (const side of [-1, 1]) puff(run.x - ca * 3 - sa * side * 2.8, carY + 0.6, run.z - sa * 3 + ca * side * 2.8, c, 0.9, 0.25, (Math.random() - 0.5) * 10, 4 + Math.random() * 4, (Math.random() - 0.5) * 10);
    }
  }
  if (!run.drifting) lastTier = 0;
  if (state === "race" && run.hitWall > 0.15 && spd > 25 && Math.random() < 0.6) sparks(2);
  if (state === "race" && !run.grass && (run.drifting || Math.abs(run.vl) > 9)) {
    for (const k of [0, 1]) { const side = k ? 1 : -1; skid(k, run.x - ca * 2.9 - sa * side * 2.8, run.z - sa * 2.9 + ca * side * 2.8, run.a, carY); }
  } else skidLast[0] = skidLast[1] = null;
  if (run.boost > 0 && Math.random() < 0.6) puff(run.x - ca * 6.5, carY + 2, run.z - sa * 6.5, run.boost > 1 ? GLOW : "#ffb030", 1.6, 0.25, -ca * 8, 1, -sa * 8, true);
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.t += dt; if (p.t >= p.life) { p.life = 0; p.s.visible = false; continue; }
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.s.material.opacity = 0.75 * (1 - p.t / p.life); p.s.scale.setScalar(p.size * (1 + p.t / p.life * 1.5));
  }
  // ghost
  const gp = ghostOn && ghost && run.started && state !== "title" ? ghostAt(ghost, run.t) : null;
  ghostCar.root.visible = !!gp && !gp.done;
  if (!run.started) gIdx = lIdx = run.idx;
  if (gp) { const [gy, gi] = poseY(gp.x, gp.z, gIdx); gIdx = gi; ghostCar.root.position.set(gp.x, gy, gp.z); ghostCar.root.rotation.y = -gp.a; }
  const lp = ghostOn && leader && run.started && state !== "title" ? ghostAt(leader.ghost, run.t) : null;
  leaderCar.root.visible = !!lp && !lp.done;
  if (lp) { const [ly, li] = poseY(lp.x, lp.z, lIdx); lIdx = li; leaderCar.root.position.set(lp.x, ly, lp.z); leaderCar.root.rotation.y = -lp.a; }
  wallFx = Math.max(0, wallFx - dt * 4);
  placeCamera(false);
}

function setLow() {
  HIGH = false; sun.castShadow = false; blob.material.opacity = 1; flame.material.blending = NORMAL; flame.material.needsUpdate = true;
  renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1)); fit();
  try { localStorage.setItem("racer.q", "low"); } catch {}
}

// ── Start ──
newRace();
$("loading").remove();
title();
requestAnimationFrame(frame);
if (AUTO) setTimeout(() => card.querySelector("button.go")?.click(), 600);
if (params.has("debug")) window.__rc = { get run() { return run; }, get state() { return state; }, T, countdown, inApp, DEMO, camera, scene, groundY, river };
