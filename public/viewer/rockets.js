// Banana Rockets — drawing, input and flow. The game rules live in rockets-sim.js.
// Canvas 2D at device resolution: starfield, gravity zones, spinning planets,
// rocks, bananas, the Moon, and the player's rocket (hull/trim/exhaust colours
// from their monke's traits via caves-weapons.js; looks only, every rocket flies
// the same) with their PFP in the window.
import { weaponFor } from "/viewer/caves-weapons.js";
import { RV, ZONE, LAND_V, buildCourse, createRun, rocketPose, launch, preview, update, runTimeMs, todayId, rng } from "/viewer/rockets-sim.js";

const params = new URLSearchParams(location.search);
const inApp = (() => { if (window.ReactNativeWebView) return true; try { return parent !== window && parent.location.origin === location.origin; } catch { return false; } })();
const isTouch = matchMedia("(pointer: coarse)").matches;

// ── Monke number → Arweave image (same table as monkeModel.js / src/lib/monkeMeme/monkeNumbers.ts;
// copied so this page doesn't load three.js) ──
const BASE_A = "https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE";
const BASE_B = "https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY";
const GIFS = new Set([8986, 8987, 8988]);
const BURNED = new Set([411, 2976, 3109, 3140, 3850, 3970, 4747, 4979, 5203, 5363, 5462, 5952, 6692, 6797, 7894]);
function imageFor(n) {
  if (!Number.isInteger(n) || n < 1 || n > 10014 || BURNED.has(n)) return null;
  return `${n >= 8989 ? BASE_B : BASE_A}/${n}.${GIFS.has(n) ? "gif" : "png"}`;
}
function loadImage(url) {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => reject(new Error("image")); img.src = url; });
}
function readGrid(img) {
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const cell = c.width / 16, px = [];
  for (let y = 0; y < 16; y++) { const row = []; for (let x = 0; x < 16; x++) { const d = g.getImageData(Math.floor((x + 0.5) * cell), Math.floor((y + 0.5) * cell), 1, 1).data; row.push([d[0], d[1], d[2], d[3]]); } px.push(row); }
  return { px };
}

// ── Pilot ──
let n = parseInt(params.get("n") || "", 10);
if (!imageFor(n)) { do n = 1 + Math.floor(Math.random() * 8888); while (!imageFor(n)); }
const looks = weaponFor(n);
const HULL = looks.held.body, TRIM = looks.held.accent;
const FLAME = looks.shot.color === "rainbow" ? "rainbow" : looks.shot.color;
const pfp = document.createElement("canvas"); pfp.width = pfp.height = 16;
let pfpReady = false;
loadImage(imageFor(n)).then(readGrid).then(({ px }) => {
  const g = pfp.getContext("2d"), img = g.createImageData(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const p = px[y][x], i = (y * 16 + x) * 4; img.data.set([p[0], p[1], p[2], 255], i); }
  g.putImageData(img, 0, 0); pfpReady = true;
  document.getElementById("face").getContext("2d").drawImage(pfp, 0, 0);
  document.querySelectorAll(".pilot canvas").forEach((c) => c.getContext("2d").drawImage(pfp, 0, 0));
}).catch(() => {});

// ── Courses ──
const COURSES = [
  { id: () => todayId(), name: () => `DAILY · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`, key: "daily" },
  { id: () => "practice-1", name: () => "PRACTICE 1", key: "p1" },
  { id: () => "practice-2", name: () => "PRACTICE 2", key: "p2" },
  { id: () => "practice-3", name: () => "PRACTICE 3", key: "p3" },
];
let courseIx = Math.max(0, COURSES.findIndex((c) => c.key === params.get("course")));
let world = null, run = null;
const cache = new Map();
function course(ix) {
  const id = COURSES[ix].id();
  if (!cache.has(id)) cache.set(id, buildCourse(id));
  return cache.get(id);
}

// ── Storage (per-device best; never required) ──
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const bestKey = (id) => `rockets:best:${RV}:${id}`;
let soundOn = store.get("rockets:sound") !== "0";

// ── Sound: tiny WebAudio synth, started on the first touch ──
let ac = null;
function audio() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } } if (ac?.state === "suspended") ac.resume(); return ac; }
function tone(f0, f1, dur, type = "sine", vol = 0.12, delay = 0) {
  if (!soundOn) return; const a = audio(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, lp = 900) {
  if (!soundOn) return; const a = audio(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  f.type = "lowpass"; f.frequency.value = lp; g.gain.value = vol; s.buffer = buf; s.connect(f).connect(g).connect(a.destination); s.start();
}
const sfx = {
  launch: (p) => { noise(0.35 + p * 0.2, 0.18, 500 + p * 900); tone(160, 420 + p * 300, 0.3, "sawtooth", 0.05); },
  land: (soft) => { tone(soft ? 220 : 140, 90, 0.12, "triangle", 0.18); noise(0.08, 0.1, 400); },
  banana: () => { tone(880, 1320, 0.09, "square", 0.06); tone(1320, 1760, 0.12, "square", 0.05, 0.08); },
  crash: () => { noise(0.6, 0.35, 700); tone(120, 40, 0.5, "sawtooth", 0.08); },
  lost: () => { tone(500, 120, 0.7, "sine", 0.1); },
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, "square", 0.06, i * 0.11)),
};
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* not allowed */ } };

// ── Canvas + camera ──
const view = document.getElementById("view"), ctx = view.getContext("2d");
let W = 0, H = 0, DPR = 1;
function fit() {
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  view.width = Math.round(W * DPR); view.height = Math.round(H * DPR);
}
addEventListener("resize", fit); fit();
const cam = { x: 0, y: 0, s: 1 };
const baseScale = () => Math.min(W / 470, H / 760);
const toScreen = (x, y) => [W / 2 + (x - cam.x) * cam.s, H / 2 - (y - cam.y) * cam.s];
const toWorldDir = (dx, dy) => [dx, -dy];

function nextTarget() {
  if (!run) return null;
  const visited = run.landed;
  const order = world.planets.filter((p) => !visited.has(p));
  const here = run.mode === "landed" ? run.planet : null;
  const above = order.filter((p) => !here || p.y > here.y - 40).sort((a, b) => (here ? Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y) : a.y - b.y));
  return above[0] || world.moon;
}

function moveCamera(dt) {
  if (!run) return;
  const pose = rocketPose(run);
  let tx, ty, ts = baseScale();
  if (run.mode === "flying") {
    tx = pose.x + pose.vx * 0.22; ty = pose.y + pose.vy * 0.22;
    ts *= 0.92;
  } else {
    const t = nextTarget();
    tx = pose.x; ty = pose.y;
    if (t) { tx = pose.x * 0.6 + t.x * 0.4; ty = pose.y * 0.6 + t.y * 0.4; const span = Math.hypot(t.x - pose.x, t.y - pose.y) + 220; ts = Math.min(ts, Math.min(W, H * 0.8) / span); }
  }
  const k = 1 - Math.exp(-dt * 3.2);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.s += (Math.max(baseScale() * 0.55, ts) - cam.s) * k;
}

// ── Background: three star layers, fixed per course ──
let stars = [];
function makeStars(seed) {
  const r = rng(seed);
  stars = [];
  for (let i = 0; i < 260; i++) stars.push({ x: r() * 2400 - 1200, y: r() * 4000 - 600, z: 0.15 + r() * 0.5, a: 0.3 + r() * 0.7, tw: r() * 6.28 });
}

const LOOK = {
  jungle: ["#2f8f4e", "#164d2b", "#7fe08a"], banana: ["#f2c230", "#9a6c08", "#fff0a0"], rock: ["#8a7f76", "#3f3833", "#c9beb3"],
  ice: ["#7fd3f0", "#2f7ea3", "#e6fbff"], lava: ["#c2412b", "#4a130d", "#ffb347"], candy: ["#e05aa8", "#7a2357", "#ffc2e6"],
};

function drawPlanet(p, hot) {
  const [sx, sy] = toScreen(p.x, p.y), r = p.r * cam.s, [base, dark, light] = LOOK[p.look] || LOOK.rock;
  // gravity zone
  ctx.save();
  ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
  ctx.strokeStyle = hot ? "rgba(255,210,63,0.35)" : "rgba(160,170,255,0.12)";
  ctx.beginPath(); ctx.arc(sx, sy, p.r * ZONE * cam.s, 0, 6.2832); ctx.stroke();
  ctx.restore();
  // glow
  const glow = ctx.createRadialGradient(sx, sy, r * 0.8, sx, sy, r * 1.6);
  glow.addColorStop(0, base + "55"); glow.addColorStop(1, base + "00");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, r * 1.6, 0, 6.2832); ctx.fill();
  // body
  const g = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r);
  g.addColorStop(0, light); g.addColorStop(0.45, base); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
  // surface detail, turning with the planet
  ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.clip();
  ctx.translate(sx, sy); ctx.rotate(-(p.turn || 0));
  const R = rng(p.seed);
  ctx.globalAlpha = 0.35;
  if (p.look === "banana" || p.look === "candy") {
    ctx.strokeStyle = p.look === "banana" ? dark : light; ctx.lineWidth = Math.max(1.5, r * 0.12);
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(0, i * r * 0.32, r * 1.1, r * 0.12, 0.25, 0, 6.2832); ctx.stroke(); }
  } else if (p.look === "jungle") {
    ctx.fillStyle = dark;
    for (let i = 0; i < 9; i++) { const a = R() * 6.28, d = R() * r * 0.8; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.12 + R() * 0.18), 0, 6.2832); ctx.fill(); }
  } else if (p.look === "lava") {
    ctx.strokeStyle = light; ctx.lineWidth = Math.max(1, r * 0.06);
    for (let i = 0; i < 6; i++) { ctx.beginPath(); let a = R() * 6.28, d = R() * r; ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); for (let k = 0; k < 3; k++) { a += (R() - 0.5) * 1.4; d = R() * r; ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d); } ctx.stroke(); }
  } else {
    ctx.fillStyle = dark;
    for (let i = 0; i < 7; i++) { const a = R() * 6.28, d = R() * r * 0.8; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.08 + R() * 0.12), 0, 6.2832); ctx.fill(); }
  }
  ctx.restore(); ctx.globalAlpha = 1;
  // flag on planets you've landed on
  if (run?.landed.has(p) && p !== world.planets[0]) {
    const a = p.flagAng ?? (p.flagAng = run.mode === "landed" && run.planet === p ? run.ang + 0.6 : Math.PI / 2);
    const fa = a + (p.turn || 0) - (p.turnAtFlag ?? (p.turnAtFlag = p.turn || 0));
    const bx = sx + Math.cos(fa) * r, by = sy - Math.sin(fa) * r, tx = sx + Math.cos(fa) * (r + 14 * cam.s), ty = sy - Math.sin(fa) * (r + 14 * cam.s);
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = "#FFD23F"; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 9 * cam.s, ty + 3 * cam.s); ctx.lineTo(tx + 1, ty + 7 * cam.s); ctx.fill();
  }
}

function drawMoon(t) {
  const m = world.moon, [sx, sy] = toScreen(m.x, m.y), r = m.r * cam.s;
  const pulse = 1 + Math.sin(t * 3) * 0.06;
  ctx.strokeStyle = "rgba(255,210,63,0.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, r * 1.45 * pulse, 0, 6.2832); ctx.stroke();
  const glow = ctx.createRadialGradient(sx, sy, r * 0.9, sx, sy, r * 2.2);
  glow.addColorStop(0, "rgba(255,245,210,0.35)"); glow.addColorStop(1, "rgba(255,245,210,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, r * 2.2, 0, 6.2832); ctx.fill();
  const g = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
  g.addColorStop(0, "#fffbe8"); g.addColorStop(0.6, "#e9e2c4"); g.addColorStop(1, "#a59c7c");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
  ctx.fillStyle = "rgba(120,110,85,0.35)";
  for (const [a, d, cr] of [[0.6, 0.45, 0.2], [2.4, 0.5, 0.14], [4.1, 0.3, 0.17], [5.3, 0.62, 0.1], [3.3, 0.7, 0.08]]) { ctx.beginPath(); ctx.arc(sx + Math.cos(a) * d * r, sy + Math.sin(a) * d * r, cr * r, 0, 6.2832); ctx.fill(); }
  ctx.fillStyle = "#FFD23F"; ctx.font = `700 ${Math.max(10, 12 * cam.s)}px ui-monospace, monospace`; ctx.textAlign = "center";
  ctx.fillText("MOON", sx, sy - r * 1.45 * pulse - 6);
}

function drawRock(a, t) {
  const [sx, sy] = toScreen(a.x, a.y), r = a.r * cam.s, R = rng(Math.floor(a.x * 13 + a.y * 7));
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(a.spin + t * 0.4);
  ctx.fillStyle = "#6b6159"; ctx.strokeStyle = "#2a2522"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const ang = (i / 8) * 6.2832, rr = r * (0.75 + R() * 0.35); i ? ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr) : ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#544b44"; ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.15, r * 0.25, 0, 6.2832); ctx.fill();
  ctx.restore();
}

function drawBanana(x, y, t, s = 1) {
  const [sx, sy] = toScreen(x, y), r = 11 * cam.s * s, bob = Math.sin(t * 2.5 + x) * 3 * cam.s;
  ctx.save(); ctx.translate(sx, sy + bob); ctx.rotate(-0.5 + Math.sin(t * 1.7 + y) * 0.15);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2); glow.addColorStop(0, "rgba(255,210,63,0.45)"); glow.addColorStop(1, "rgba(255,210,63,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, 6.2832); ctx.fill();
  ctx.fillStyle = "#FFD23F"; ctx.strokeStyle = "#6b4b00"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -r * 0.6, r * 1.2, 0.35, Math.PI - 0.35); ctx.arc(0, -r * 1.25, r * 1.45, Math.PI - 0.55, 0.55, true); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#6b4b00"; ctx.fillRect(r * 1.0, -r * 0.2, r * 0.3, r * 0.3);
  ctx.restore();
}

function flameColour(t) {
  if (FLAME !== "rainbow") return FLAME;
  return `hsl(${(t * 120) % 360} 95% 60%)`;
}

function drawRocket(pose, t, thrust) {
  const [sx, sy] = toScreen(pose.x, pose.y), s = cam.s * 1.45;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(-pose.heading);
  // exhaust
  if (thrust > 0) {
    const L = (14 + thrust * 18 + Math.sin(t * 40) * 3) * s;
    const g = ctx.createLinearGradient(-10 * s, 0, -10 * s - L, 0);
    g.addColorStop(0, "#fff"); g.addColorStop(0.25, flameColour(t)); g.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-9 * s, -4 * s); ctx.lineTo(-9 * s - L, 0); ctx.lineTo(-9 * s, 4 * s); ctx.fill();
  }
  // fins
  ctx.fillStyle = TRIM; ctx.strokeStyle = "#0b0a10"; ctx.lineWidth = 1.5;
  for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-4 * s, k * 5 * s); ctx.lineTo(-12 * s, k * 11 * s); ctx.lineTo(-11 * s, k * 3 * s); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // body: a banana-curved capsule
  ctx.fillStyle = HULL;
  ctx.beginPath(); ctx.moveTo(16 * s, 0); ctx.quadraticCurveTo(8 * s, -8 * s, -10 * s, -6 * s); ctx.lineTo(-10 * s, 6 * s); ctx.quadraticCurveTo(8 * s, 8 * s, 16 * s, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = TRIM; ctx.beginPath(); ctx.moveTo(16 * s, 0); ctx.quadraticCurveTo(12 * s, -4 * s, 9 * s, -5 * s); ctx.lineTo(9 * s, 5 * s); ctx.quadraticCurveTo(12 * s, 4 * s, 16 * s, 0); ctx.fill();
  // window with the pilot
  ctx.save(); ctx.beginPath(); ctx.arc(1.5 * s, 0, 4.6 * s, 0, 6.2832); ctx.fillStyle = "#0d1b2a"; ctx.fill(); ctx.clip();
  if (pfpReady) { ctx.translate(1.5 * s, 0); ctx.rotate(pose.heading); ctx.imageSmoothingEnabled = false; ctx.drawImage(pfp, -5 * s, -5.5 * s, 10 * s, 10 * s); }
  ctx.restore();
  ctx.strokeStyle = "#cfd8e3"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(1.5 * s, 0, 4.6 * s, 0, 6.2832); ctx.stroke();
  ctx.restore();
}

// ── Particles ──
const parts = [];
function burst(x, y, n, colours, speed, life, grav = 0) {
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, v = speed * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, t: 0, c: colours[i % colours.length], g: grav, r: 1.5 + Math.random() * 2.5 }); }
}
function trail(pose, t) {
  const back = pose.heading + Math.PI, v = 60 + Math.random() * 40;
  parts.push({ x: pose.x + Math.cos(back) * 10, y: pose.y + Math.sin(back) * 10, vx: Math.cos(back + (Math.random() - 0.5) * 0.6) * v + pose.vx * 0.3, vy: Math.sin(back + (Math.random() - 0.5) * 0.6) * v + pose.vy * 0.3, life: 0.45, t: 0, c: flameColour(t), g: 0, r: 2 + Math.random() * 2 });
}
const floats = [];
function floatText(x, y, text, colour = "#FFD23F") { floats.push({ x, y, text, colour, t: 0 }); }

// ── Flow ──
let state = "title", paused = false, aim = null, thrustFx = 0, best = null, lastT = performance.now(), t = 0;
const card = document.getElementById("card"), menu = document.getElementById("menu"), toastEl = document.getElementById("toast"), hint = document.getElementById("hint");
const fmt = (ms) => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };
const swatch = (c) => c === "rainbow" ? "linear-gradient(90deg,#f44,#fd4,#4f6,#4cf,#a4f)" : c;
let toastTimer = 0;
function toast(text, small = "", ms = 1600) { toastEl.innerHTML = `${text}${small ? `<small>${small}</small>` : ""}`; toastEl.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), ms); }

function post(m) {
  const s = JSON.stringify({ type: "rockets", v: RV, ...m });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (parent !== window) parent.postMessage(s, location.origin);
}

function showCard(html, onGo) {
  card.innerHTML = html; card.hidden = false;
  card.querySelectorAll(".pilot canvas").forEach((c) => { if (pfpReady) c.getContext("2d").drawImage(pfp, 0, 0); });
  card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); onGo(b.dataset.act); }));
}

function loadCourse(ix) {
  courseIx = ix;
  world = course(ix);
  for (const p of world.planets) { p.turn = 0; delete p.flagAng; delete p.turnAtFlag; }
  run = createRun(world);
  best = Number(store.get(bestKey(world.id))) || null;
  makeStars(world.planets[0].seed);
  const pose = rocketPose(run);
  cam.x = pose.x; cam.y = pose.y + 120; cam.s = baseScale();
  parts.length = 0; floats.length = 0;
  updateHud();
}

function title() {
  state = "title";
  const c = COURSES[courseIx];
  showCard(`
    <h1>BANANA ROCKETS</h1>
    <div class="tag">${c.name()}</div>
    <div class="pilot"><canvas width="16" height="16"></canvas><div style="text-align:left"><div>MONKE #${n}</div><div class="dim"><span class="swatch" style="background:${HULL}"></span>hull <span class="swatch" style="background:${swatch(FLAME)}"></span>flame</div></div></div>
    <div class="how">${isTouch ? "Drag back" : "Click, drag back"} and let go to launch.<br>Land softly on planets · grab 🍌 · reach the Moon.<br><span class="dim">Planets spin, so wait for your angle. Crash = +3 s.</span></div>
    ${best ? `<div class="dim">Your best: ${fmt(best)}</div>` : ""}
    <div class="row"><button class="go" data-act="go">LAUNCH</button></div>
  `, (act) => { if (act === "go") start(); });
}

function start() {
  card.hidden = true; audio();
  loadCourse(courseIx);
  state = "play";
  hint.textContent = isTouch ? "Drag back and let go to launch" : "Click and drag back, let go to launch";
  hint.classList.remove("gone"); setTimeout(() => hint.classList.add("gone"), 5000);
  toast(COURSES[courseIx].name(), "the clock starts on your first launch");
}

function finish(ms) {
  state = "clear";
  const got = run.got.size, isBest = !best || ms < best;
  if (isBest) { best = ms; store.set(bestKey(world.id), String(ms)); }
  post({ event: "clear", course: world.id, ms, launches: run.launches, crashes: run.crashes, bananas: got, n });
  setTimeout(() => showCard(`
    <h1>TO THE MOON</h1>
    <div class="dim">${COURSES[courseIx].name()}</div>
    <div class="big">${fmt(ms)}</div>
    ${isBest ? `<div class="tag">NEW BEST</div>` : `<div class="dim">Best ${fmt(best)}</div>`}
    <div class="stats"><span>Launches</span><b>${run.launches}</b><span>Crashes</span><b>${run.crashes}</b><span>Bananas</span><b>${got}/3</b><span>Par</span><b>${fmt(world.par * 1000)}</b></div>
    <div class="row"><button class="go" data-act="again">AGAIN</button>${courseIx === 0 ? `<button data-act="practice">PRACTICE</button>` : `<button data-act="next">${courseIx < COURSES.length - 1 ? "NEXT" : "DAILY"}</button>`}</div>
  `, (act) => {
    if (act === "again") start();
    else if (act === "practice") { courseIx = 1; start(); }
    else { courseIx = courseIx < COURSES.length - 1 ? courseIx + 1 : 0; start(); }
  }), 900);
}

function updateHud() {
  document.querySelector("#time b").textContent = fmt(run ? runTimeMs(run) : 0);
  document.querySelector("#launches b").textContent = run ? run.launches : 0;
  document.querySelector("#bananas b").textContent = `${run ? run.got.size : 0}/3`;
}

// ── Input: drag back from anywhere, let go to launch ──
const DRAG_FULL = () => Math.min(W, H) * 0.34;
function aimFrom(e) {
  const dx = aim.x0 - e.clientX, dy = aim.y0 - e.clientY, len = Math.hypot(dx, dy);
  aim.len = len; aim.power = Math.min(1, len / DRAG_FULL());
  [aim.dx, aim.dy] = toWorldDir(dx, dy);
}
view.addEventListener("pointerdown", (e) => {
  if (state !== "play" || paused || run.mode !== "landed") return;
  audio();
  aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, len: 0, power: 0, dx: 0, dy: 0 };
  view.setPointerCapture?.(e.pointerId);
});
view.addEventListener("pointermove", (e) => { if (aim && e.pointerId === aim.id) { aim.x = e.clientX; aim.y = e.clientY; aimFrom(e); } });
const release = (e) => {
  if (!aim || e.pointerId !== aim.id) return;
  aimFrom(e);
  const a = aim; aim = null;
  if (a.len < 14 || state !== "play" || run.mode !== "landed") return;
  if (launch(run, a.dx, a.dy, a.power)) { sfx.launch(a.power); buzz(12); thrustFx = 0.35 + a.power * 0.4; hint.classList.add("gone"); }
};
view.addEventListener("pointerup", release);
view.addEventListener("pointercancel", () => { aim = null; });

// ── Menu ──
const coursesEl = document.getElementById("courses");
function renderMenu() {
  coursesEl.innerHTML = COURSES.map((c, i) => `<button data-i="${i}" class="${i === courseIx ? "on" : ""}">${c.key === "daily" ? "DAILY" : c.name()}</button>`).join("");
  coursesEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { menu.hidden = true; paused = false; courseIx = Number(b.dataset.i); start(); }));
  document.getElementById("sound").textContent = `Sound: ${soundOn ? "on" : "off"}`;
}
document.getElementById("pause").addEventListener("click", () => { if (state === "title") return; paused = true; aim = null; renderMenu(); menu.hidden = false; });
document.getElementById("resume").addEventListener("click", () => { menu.hidden = true; paused = false; lastT = performance.now(); });
document.getElementById("restart").addEventListener("click", () => { menu.hidden = true; paused = false; start(); });
document.getElementById("sound").addEventListener("click", () => { soundOn = !soundOn; store.set("rockets:sound", soundOn ? "1" : "0"); renderMenu(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") { paused = true; renderMenu(); menu.hidden = false; } });
addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.getElementById(menu.hidden ? "pause" : "resume").click();
  if ((e.key === " " || e.key === "Enter") && !card.hidden) card.querySelector("button.go")?.click();
});

// ── Frame ──
function handle(events) {
  for (const ev of events) {
    if (ev.type === "banana") { sfx.banana(); buzz(8); burst(ev.x, ev.y, 14, ["#FFD23F", "#fff3b0"], 120, 0.6); floatText(ev.x, ev.y + 20, "🍌"); }
    if (ev.type === "land") { sfx.land(ev.soft); buzz(ev.soft ? 10 : 25); burst(ev.x, ev.y, 10, ["#d9d2c5", "#a89e8f"], 60, 0.5); if (ev.first) floatText(ev.x, ev.y + 24, ev.soft ? "SOFT LANDING" : "LANDED", ev.soft ? "#8fffb0" : "#FFD23F"); }
    if (ev.type === "crash") { sfx.crash(); buzz(60); burst(ev.x, ev.y, 34, [flameColour(t), "#ff6a3d", "#ffd23f", "#777"], 220, 0.9); toast("CRASH", ev.speed > LAND_V ? "too fast · +3 s" : "+3 s"); }
    if (ev.type === "lost") { sfx.lost(); buzz(40); toast("LOST IN SPACE", "back to your last planet · +3 s"); }
    if (ev.type === "finish") { sfx.finish(); buzz(80); for (let i = 0; i < 4; i++) burst(ev.x, ev.y, 24, ["#FFD23F", "#E91671", "#8fd3ff", "#fff"], 260, 1.4, -120); finish(ev.ms); }
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; t += dt;
  if (state === "play" && !paused && run) {
    handle(update(run, dt));
    if (run.mode === "flying") { thrustFx = Math.max(0, thrustFx - dt * 0.8); if (Math.random() < 0.7) trail(rocketPose(run), t); }
    updateHud();
  } else if (run && state !== "play") {
    for (const p of world.planets) p.turn = ((p.turn || 0) + p.spin * dt) % 6.2832;
  }
  if (run) moveCamera(dt);
  draw(dt);
  requestAnimationFrame(frame);
}

function draw(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0720"); bg.addColorStop(1, "#05040c");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!run) return;
  for (const s of stars) {
    const sx = W / 2 + (s.x - cam.x * s.z) * cam.s * 0.6, sy = H / 2 - (s.y - cam.y * s.z) * cam.s * 0.6;
    const x = ((sx % W) + W) % W, y = ((sy % H) + H) % H;
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 2 + s.tw)); ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, s.z > 0.45 ? 2 : 1, s.z > 0.45 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  const pose = rocketPose(run);
  for (const p of world.planets) drawPlanet(p, run.mode === "flying" && Math.hypot(pose.x - p.x, pose.y - p.y) < p.r * ZONE);
  drawMoon(t);
  for (const a of world.rocks) drawRock(a, t);
  for (const b of world.bananas) if (!run.got.has(b)) drawBanana(b.x, b.y, t);
  // aim line
  if (aim && aim.len >= 14 && run.mode === "landed") {
    const pts = preview(run, aim.dx, aim.dy, aim.power);
    pts.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); ctx.globalAlpha = 1 - i / pts.length; ctx.fillStyle = "#FFD23F"; ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, 6.2832); ctx.fill(); });
    ctx.globalAlpha = 1;
    // power ring at the finger
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(aim.x0, aim.y0, 20, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = aim.power >= 1 ? "#E91671" : "#FFD23F"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(aim.x0, aim.y0, 20, -Math.PI / 2, -Math.PI / 2 + aim.power * 6.2832); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(aim.x0, aim.y0); ctx.lineTo(aim.x, aim.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt; if (p.t >= p.life) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const [sx, sy] = toScreen(p.x, p.y); ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(sx, sy, p.r * Math.max(0.6, cam.s), 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (state !== "clear" || run.mode !== "won") drawRocket(pose, t, run.mode === "flying" ? Math.max(0.15, thrustFx) : 0);
  // floating words
  ctx.textAlign = "center"; ctx.font = "700 13px ui-monospace, monospace";
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.t += dt; if (f.t > 1.3) { floats.splice(i, 1); continue; }
    const [sx, sy] = toScreen(f.x, f.y + f.t * 40); ctx.globalAlpha = 1 - f.t / 1.3; ctx.fillStyle = f.colour; ctx.fillText(f.text, sx, sy);
  }
  ctx.globalAlpha = 1;
  // where's the Moon? (arrow at the edge when it's off screen)
  const [mx, my] = toScreen(world.moon.x, world.moon.y);
  if (mx < 0 || mx > W || my < 0 || my > H) {
    // Point on the screen's edge (inset, clear of the HUD) toward the Moon.
    const a = Math.atan2(my - H / 2, mx - W / 2), c = Math.cos(a), sn = Math.sin(a);
    const hx = W / 2 - 30, hy = H / 2 - (sn < 0 ? 80 : 50);
    const k = Math.min(Math.abs(c) > 1e-6 ? hx / Math.abs(c) : Infinity, Math.abs(sn) > 1e-6 ? hy / Math.abs(sn) : Infinity);
    const ex = W / 2 + c * k, ey = H / 2 + sn * k;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = "rgba(255,210,63,0.8)";
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.fill(); ctx.restore();
    ctx.fillStyle = "#e9e2c4"; ctx.beginPath(); ctx.arc(ex - Math.cos(a) * 18, ey - Math.sin(a) * 18, 6, 0, 6.2832); ctx.fill();
  }
}

loadCourse(courseIx);
title();
requestAnimationFrame(frame);

if (params.has("debug")) window.__rockets = { get run() { return run; }, get world() { return world; }, get state() { return state; }, cam, launch: (dx, dy, p) => launch(run, dx, dy, p), start, inApp };
