// MonkeCaves — our own raycaster (prototype). One 320×200 frame per tick into an
// ImageData, walls by DDA, textured floor/ceiling rows, billboard sprites
// against a per-column depth buffer. Textures and enemies are drawn here as
// pixel maps; the player's face is their Saga Monke PFP (monkeModel.js).
import { imageFor, loadImage, readGrid } from "/viewer/monkeModel.js";

const TEX = 32;
const view = document.getElementById("view");
const ctx = view.getContext("2d");
// Landscape draws 320×200; portrait a narrower, taller picture so the view
// fills the phone instead of a thin strip (fit()).
let W = 0, H = 0, frame, buf, zbuf;
function setRes(w, h) {
  if (w === W && h === H) return;
  W = w; H = h; view.width = w; view.height = h;
  frame = ctx.createImageData(W, H);
  buf = new Uint32Array(frame.data.buffer);
  zbuf = new Float32Array(W);
}

const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const shade = (c, f) => {
  if (f >= 1) return c;
  return ((255 << 24) | (((c >>> 16) & 255) * f) << 16 | (((c >>> 8) & 255) * f) << 8 | ((c & 255) * f)) >>> 0;
};
const fog = (d) => Math.max(0.12, Math.min(1, 1.25 - d * 0.085));

// ── Seeded noise so textures are the same every load ──
let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function makeTex(paint) {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) t[y * TEX + x] = paint(x, y);
  return t;
}
const TEXTURES = {
  // cave rock: purple-grey blocks with dark mortar and speckle
  "#": makeTex((x, y) => {
    const row = Math.floor(y / 8), off = row % 2 ? 8 : 0;
    const mortar = y % 8 === 0 || (x + off) % 16 === 0;
    const n = 0.75 + rnd() * 0.25;
    return mortar ? rgb(24, 20, 32) : rgb(86 * n, 76 * n, 104 * n);
  }),
  // chart wall: candles on a dark screen, red on the way down
  C: makeTex((x, y) => {
    if (x === 0 || y === 0 || x === TEX - 1 || y === TEX - 1) return rgb(40, 40, 56);
    const col = Math.floor(x / 4), up = col % 3 !== 1;
    const mid = 16 + Math.round(Math.sin(col * 1.7) * 6) + (col > 4 ? (col - 4) * 1 : 0);
    const half = 3 + (col % 2) * 2;
    const inBody = x % 4 !== 0 && Math.abs(y - mid) <= half;
    const wick = x % 4 === 2 && Math.abs(y - mid) <= half + 3;
    if (inBody || wick) return up ? rgb(60, 220, 120) : rgb(235, 60, 80);
    return (y % 8 === 0) ? rgb(22, 26, 38) : rgb(12, 14, 22);
  }),
  // banana crate: planks with a banana stamp
  B: makeTex((x, y) => {
    const plank = y % 8 === 0 || x === 0 || x === TEX - 1;
    const bx = x - 16, by = y - 17;
    const banana = Math.abs(Math.hypot(bx, by + 10) - 11) < 2.2 && by > -4 && Math.abs(bx) < 10;
    if (banana) return rgb(255, 210, 63);
    const n = 0.8 + rnd() * 0.2;
    return plank ? rgb(70, 42, 20) : rgb(150 * n, 98 * n, 50 * n);
  }),
  // exit: pink door with an up arrow
  D: makeTex((x, y) => {
    const edge = x < 2 || x > TEX - 3 || y < 2;
    const arrow = (y > 8 && y < 26 && Math.abs(x - 16) < 2) || (y > 6 && y < 16 && Math.abs(x - 16) < (y - 6));
    if (arrow) return rgb(255, 255, 255);
    return edge ? rgb(120, 10, 60) : rgb(233, 22, 113);
  }),
};
const FLOOR = makeTex((x, y) => { const n = 0.7 + rnd() * 0.3; return ((x >> 3) + (y >> 3)) % 2 ? rgb(46 * n, 40 * n, 52 * n) : rgb(38 * n, 33 * n, 44 * n); });
const CEIL = makeTex(() => { const n = 0.6 + rnd() * 0.4; return rgb(20 * n, 16 * n, 28 * n); });

// ── Sprites from character maps ──
function makeSprite(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const data = new Uint32Array(w * h);
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) { const c = pal[r[x]]; data[y * w + x] = c ? rgb(...c) : 0; } });
  return { w, h, data };
}
const PAL = {
  k: [16, 14, 20], g: [46, 160, 80], G: [28, 104, 52], s: [240, 200, 160], r: [255, 40, 60], y: [255, 210, 63], Y: [196, 150, 30],
  w: [245, 245, 250], p: [120, 60, 170], P: [80, 36, 120], o: [240, 120, 40], R: [200, 40, 50], b: [110, 70, 40],
};
// Jeet: hoodie, red eyes, clutching the bag it's about to dump.
const JEET = [
  [
    "................", ".....kkkkkk.....", "....kggggggk....", "...kggGGGGggk...", "...kgGssssGgk...", "...kgsrsssrsk...",
    "...kgsssssssk...", "....kgsskssgk...", "...kkggggggkk...", "..kgggggggggyyk.", "..kgkgggggkgyYyk", "..kgkgggggkkyyk.",
    "....kggkggk.kk..", "....kggkggk.....", "....kkk.kkk.....", "................",
  ],
  [
    "................", ".....kkkkkk.....", "....kggggggk....", "...kggGGGGggk...", "...kgGssssGgk...", "...kgsrsssrsk...",
    "...kgsssssssk...", "....kgsskssgk...", "...kkggggggkk...", "..kgggggggggyyk.", "..kgkgggggkgyYyk", "..kgkgggggkkyyk.",
    "....kggkkggk.kk.", "...kggk..kggk...", "...kkk....kkk...", "................",
  ],
];
// Rug goblin: carries off the floor. Touching it costs you bananas.
const GOBLIN = [
  [
    "................", "..oRoRoRoRoRoR..", "..RoRoRoRoRoRo..", "..kkkkkkkkkkkk..", ".....kpppppk....", "....kpPpppPpk...",
    "....kpwkppwkp...", "....kppppppppk..", ".....kpprrppk...", "......kppppk....", "....kkpppppkk...", "...kp.kppppk.pk.",
    "......kpppk.....", ".....kpk.kpk....", ".....kk...kk....", "................",
  ],
  [
    "................", "..RoRoRoRoRoRo..", "..oRoRoRoRoRoR..", "..kkkkkkkkkkkk..", ".....kpppppk....", "....kpPpppPpk...",
    "....kpwkppwkp...", "....kppppppppk..", ".....kpprrppk...", "......kppppk....", "....kkpppppkk...", "....kp.kpk.pk...",
    "......kpppk.....", "......kpkpk.....", "......kk.kk.....", "................",
  ],
];
// The bear: big, slow, then it rushes you.
const BEAR = [
  "..kk........kk..", ".kbbk......kbbk.", ".kbbbkkkkkkbbbk.", "..kbbbbbbbbbbk..", ".kbbbbbbbbbbbbk.", ".kbbrrbbbbrrbbk.",
  ".kbbbbbbbbbbbbk.", ".kbbbbkkkkbbbbk.", "..kbbbkwwkbbbk..", "..kbbbbkkbbbbk..", ".kbbbbbbbbbbbbk.", "kbbbbbRRRRbbbbbk",
  "kbbkbbbRRbbbkbbk", "kbbkbbbbbbbbkbbk", ".kk.kbbkkbbk.kk.", "....kkk..kkk....",
];
const SPR = {
  bear: [makeSprite(BEAR, PAL), makeSprite(BEAR, PAL)],
  jeet: JEET.map((r) => makeSprite(r, PAL)),
  goblin: GOBLIN.map((r) => makeSprite(r, PAL)),
  banana: makeSprite([
    "................", "................", "...........kk...", "..........kYk...", ".........kyyk...", "........kyyyk...",
    ".......kyyyk....", "......kyyyyk....", "....kkyyyyk.....", "..kkyyyyykk.....", ".kyyyyyykk......", ".kkyyykk........",
    "..kkkk..........", "................", "................", "................",
  ], PAL),
  health: makeSprite([
    "................", "................", "................", "................", "................", "......kkkk......",
    ".....kwwwwk.....", "....kwwrrwwk....", "....kwrrrrwk....", "....kwwrrwwk....", "....kwwwwwwk....", ".....kkkkkk.....",
    "................", "................", "................", "................",
  ], PAL),
};

// The launcher, drawn over the view (32×24, scaled 2×).
const GUN = makeSprite([
  "..............kkkk..............", ".............kyyYk..............", "............kyyyYk..............", "............kyyyk...............",
  "...........kkyyyk...............", "..........kbbkkkkk..............", ".........kbbbbbbbbk.............", "........kbbbbbbbbbbk............",
  "........kbkkkkkkkbbk............", "........kbk.....kbbk............", ".......kbbk.....kbbbk...........", ".......kbbk....ksssbk...........",
  "......kbbbk...ksssssk...........", "......kbbbk..kssssssk...........", ".....kbbbbk.kssssssk............", ".....kbbbbkkssssssk.............",
  "....kbbbbbbssssssk..............", "....kbbbbbbsssssk...............", "...kbbbbbbbsssk.................", "...kbbbbbbbbkk..................",
  "..kbbbbbbbbbk...................", "..kbbbbbbbbbk...................", ".kbbbbbbbbbbk...................", ".kkkkkkkkkkkk...................",
], PAL);

// ── Levels ── # rock, C chart, B crate, D exit, S secret wall (slides open when
// you walk into it), P start, J jeet, G rug goblin, X bear boss (the exit stays
// shut until it's down), b bananas, h health.
const LEVELS = [
  { name: "THE DIP", rows: [
    "########################",
    "#P....#.......#........#",
    "#.....#..b....#...J....#",
    "#..b..#.......C........#",
    "#.....###..####...h....#",
    "#......................#",
    "##C##.....J.......####.#",
    "#.....................B#",
    "#..h..####.##.####.....#",
    "#.....#.......#..#..J..#",
    "#..G..#...b...#..#.....#",
    "#.....#.......C..###.###",
    "###.###..J....#........#",
    "#.............#..b.....#",
    "#..b....####..####.##..#",
    "#.......#..........#...#",
    "#...J...#....G.....#.b.#",
    "#.......#..........C...#",
    "####.#######.######S####",
    "#..................#hbh#",
    "#..B....J......h...#####",
    "#......................D",
    "#.........G............#",
    "########################",
  ] },
  { name: "PAPER HANDS ALLEY", rows: [
    "##########################",
    "#P..#...........#....b...#",
    "#...#..J.....J..#........#",
    "#...C...........S..G.....#",
    "#...#...######..#........#",
    "#.b.#...#hbh.#..####.#####",
    "#...#...#....#.......J...#",
    "#.......##S###...........#",
    "#####.........J....CCCC..#",
    "#.....J....#.............#",
    "#..........#....J....b...#",
    "#..######..#######.#######",
    "#..#....#............#...#",
    "#..#.J..#..G....J....S.h.#",
    "#..#....#............#...#",
    "#..##.###...######...#####",
    "#.........J.#....#.......#",
    "#..h........#.b..#...J...#",
    "#...........C....C.......#",
    "#########.###....####.####",
    "#....J...................#",
    "#..b........J.....G....b.D",
    "##########################",
  ] },
  { name: "BEAR MARKET", rows: [
    "########################",
    "#P...#.........#.......#",
    "#....#...J.....#...J...#",
    "#.b..C.........C.......#",
    "#....#..####...#..##.###",
    "#.......#hh#...........#",
    "###.##..#..#.....G.....#",
    "#.......##.#...........#",
    "#..J.......#######.#####",
    "#......................#",
    "######.####CCCCCC####..#",
    "#......#............#..#",
    "#..b...#............#..#",
    "#......#.....X......#.b#",
    "#..J...S............#..#",
    "#......#............#..#",
    "#..h...#............#..#",
    "#......####CCCCCC####..#",
    "#..........J...........#",
    "#.b....G...........h...D",
    "########################",
  ] },
];
let levelIx = 0;
let MW = 0, MH = 0, secrets = 0, secretsFound = 0, boss = null;
const map = [];
const player = { x: 1.5, y: 1.5, dx: 1, dy: 0, px: 0, py: 0.66, hp: 100, ammo: 20, kills: 0, hurt: 0, cool: 0, kick: 0 };
const things = []; // enemies + pickups
const shots = [];
let door = null;

function loadLevel(keepStats = false) {
  const LEVEL = LEVELS[levelIx].rows;
  MW = Math.max(...LEVEL.map((r) => r.length)); MH = LEVEL.length;
  map.length = 0; things.length = 0; shots.length = 0; door = null; boss = null; secrets = 0; secretsFound = 0;
  const carry = keepStats ? { hp: player.hp, ammo: player.ammo, kills: player.kills } : null;
  for (let y = 0; y < MH; y++) {
    const row = [];
    for (let x = 0; x < MW; x++) {
      let c = (LEVEL[y][x] || "#");
      if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) c = c === "D" ? "D" : "#";
      const cx = x + 0.5, cy = y + 0.5;
      if (c === "P") { player.x = cx; player.y = cy; c = "."; }
      else if (c === "J") { things.push({ kind: "jeet", x: cx, y: cy, hp: 3, cool: 0, seen: false, phase: rnd() * 6 }); c = "."; }
      else if (c === "G") { things.push({ kind: "goblin", x: cx, y: cy, hp: 2, cool: 0, seen: false, phase: rnd() * 6 }); c = "."; }
      else if (c === "X") { boss = { kind: "bear", x: cx, y: cy, hp: 18, max: 18, cool: 0, seen: false, phase: 0 }; things.push(boss); c = "."; }
      else if (c === "S") secrets++;
      else if (c === "b") { things.push({ kind: "banana", x: cx, y: cy }); c = "."; }
      else if (c === "h") { things.push({ kind: "health", x: cx, y: cy }); c = "."; }
      else if (c === "D") door = { x: cx, y: cy };
      row.push(c);
    }
    map.push(row);
  }
  Object.assign(player, { dx: 1, dy: 0, px: 0, py: 0.66, hp: 100, ammo: 20, kills: 0, hurt: 0, cool: 0, kick: 0 }, carry || {});
}
const wallAt = (x, y) => { const r = map[Math.floor(y)]; const c = r ? r[Math.floor(x)] : "#"; return c !== "." && c !== undefined ? c : null; };
const isFoe = (t) => t.kind === "jeet" || t.kind === "goblin" || t.kind === "bear";
// Walking into a secret wall slides it open.
function bump(x, y) {
  if (wallAt(x, y) !== "S") return;
  map[Math.floor(y)][Math.floor(x)] = "."; secretsFound++; sfx.secret();
  say("SECRET!", `${secretsFound}/${secrets} found`); setTimeout(() => { if (state === "play") say(""); }, 1200);
}
function lineOfSight(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.ceil(d / 0.15);
  for (let i = 1; i < steps; i++) { const t = i / steps; if (wallAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false; }
  return true;
}

// ── Input ──
const keys = new Set();
const touch = { mx: 0, my: 0, turn: 0, fire: false };
const isTouch = matchMedia("(pointer: coarse)").matches;
if (!isTouch) document.body.classList.add("desktop");
document.getElementById("help").textContent = isTouch ? "Left stick: move · drag right side: turn · FIRE" : "WASD move · mouse / ← → turn · click or space: throw · click to lock the mouse";
addEventListener("keydown", (e) => { keys.add(e.code); if (e.code === "Space") e.preventDefault(); unlockAudio(); });
addEventListener("keyup", (e) => keys.delete(e.code));
view.addEventListener("click", () => { unlockAudio(); if (!isTouch && document.pointerLockElement !== view) view.requestPointerLock?.(); });
addEventListener("mousemove", (e) => { if (document.pointerLockElement === view) turn(e.movementX * 0.0035); });
addEventListener("mousedown", (e) => { if (document.pointerLockElement === view && e.button === 0) touch.fire = true; });
addEventListener("mouseup", () => { if (!isTouch) touch.fire = false; });

const pad = document.getElementById("pad"), knob = document.getElementById("knob");
let padId = null;
pad.addEventListener("pointerdown", (e) => { padId = e.pointerId; pad.setPointerCapture(e.pointerId); movePad(e); unlockAudio(); });
pad.addEventListener("pointermove", (e) => { if (e.pointerId === padId) movePad(e); });
const endPad = () => { padId = null; touch.mx = touch.my = 0; knob.style.transform = ""; };
pad.addEventListener("pointerup", endPad); pad.addEventListener("pointercancel", endPad);
function movePad(e) {
  const r = pad.getBoundingClientRect(), R = r.width / 2;
  let x = e.clientX - r.left - R, y = e.clientY - r.top - R;
  const m = Math.hypot(x, y); if (m > R) { x *= R / m; y *= R / m; }
  knob.style.transform = `translate(${x}px, ${y}px)`;
  touch.mx = x / R; touch.my = y / R;
}
const turnEl = document.getElementById("turn");
let turnId = null, turnX = 0;
turnEl.addEventListener("pointerdown", (e) => { turnId = e.pointerId; turnX = e.clientX; turnEl.setPointerCapture(e.pointerId); });
turnEl.addEventListener("pointermove", (e) => { if (e.pointerId !== turnId) return; turn((e.clientX - turnX) * 0.008); turnX = e.clientX; });
const endTurn = () => { turnId = null; };
turnEl.addEventListener("pointerup", endTurn); turnEl.addEventListener("pointercancel", endTurn);
const fireEl = document.getElementById("fire");
fireEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); touch.fire = true; unlockAudio(); });
fireEl.addEventListener("pointerup", () => { touch.fire = false; });
fireEl.addEventListener("pointercancel", () => { touch.fire = false; });

function turn(a) {
  const c = Math.cos(a), s = Math.sin(a), p = player;
  [p.dx, p.dy] = [p.dx * c - p.dy * s, p.dx * s + p.dy * c];
  [p.px, p.py] = [p.px * c - p.py * s, p.px * s + p.py * c];
}

// ── Sound: tiny synth, no files ──
let audio = null;
function unlockAudio() { if (!audio) try { audio = new AudioContext(); } catch { /* no audio */ } }
function blip(freq, dur, type = "square", vol = 0.08, slide = 0) {
  if (!audio) return;
  const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
}
const sfx = {
  throw: () => blip(520, 0.12, "square", 0.06, -300),
  hit: () => blip(180, 0.1, "sawtooth", 0.08, -80),
  die: () => { blip(300, 0.25, "sawtooth", 0.08, -250); blip(90, 0.3, "square", 0.05, -40); },
  pick: () => { blip(660, 0.08, "triangle", 0.08); setTimeout(() => blip(990, 0.1, "triangle", 0.08), 70); },
  hurt: () => blip(120, 0.18, "square", 0.1, -60),
  steal: () => blip(900, 0.25, "triangle", 0.07, -700),
  secret: () => [392, 523, 784].forEach((f, i) => setTimeout(() => blip(f, 0.12, "triangle", 0.08), i * 80)),
  roar: () => blip(70, 0.5, "sawtooth", 0.12, -30),
  clear: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.18, "triangle", 0.09), i * 120)),
};

// ── HUD ──
const $ = (id) => document.querySelector(`#${id} b`);
const face = document.getElementById("face").getContext("2d");
let facePx = null;
function drawFace() {
  face.clearRect(0, 0, 16, 16);
  if (facePx) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const [r, g, b] = facePx[y][x];
    const hurt = player.hurt > 0 ? 0.5 : 0;
    face.fillStyle = `rgb(${Math.round(r + (255 - r) * hurt)},${Math.round(g * (1 - hurt))},${Math.round(b * (1 - hurt))})`;
    face.fillRect(x, y, 1, 1);
  }
}
const msg = document.getElementById("msg");
const say = (title, line = "") => { msg.innerHTML = title ? `<h1>${title}</h1><p>${line}</p>` : ""; };

// ── Game state ──
let state = "play", t0 = performance.now(), clearTime = 0;
function post(m) {
  const s = JSON.stringify({ type: "caves", ...m });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (parent !== window) parent.postMessage(s, location.origin);
}

function update(dt) {
  const p = player;
  if (state !== "play") {
    if (keys.has("Space") || keys.has("Enter") || touch.fire) {
      touch.fire = false; keys.clear();
      const next = state === "clear";
      levelIx = next ? levelIx + 1 : 0;
      loadLevel(next); state = "play"; t0 = performance.now();
      say(LEVELS[levelIx].name, `Cave ${levelIx + 1} of ${LEVELS.length}`); setTimeout(() => { if (state === "play") say(""); }, 1800);
    }
    return;
  }
  // move
  let fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - touch.my;
  let side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + touch.mx;
  const rot = (keys.has("ArrowRight") || keys.has("KeyE") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyQ") ? 1 : 0);
  if (rot) turn(rot * 2.6 * dt);
  const len = Math.hypot(fwd, side); if (len > 1) { fwd /= len; side /= len; }
  const speed = 3.2 * dt, R = 0.22;
  const mx = (p.dx * fwd - p.dy * side) * speed, my = (p.dy * fwd + p.dx * side) * speed;
  if (!wallAt(p.x + mx + Math.sign(mx) * R, p.y)) p.x += mx; else if (mx) bump(p.x + mx + Math.sign(mx) * R, p.y);
  if (!wallAt(p.x, p.y + my + Math.sign(my) * R)) p.y += my; else if (my) bump(p.x, p.y + my + Math.sign(my) * R);

  // throw
  p.cool -= dt; p.kick = Math.max(0, p.kick - dt * 5); p.hurt = Math.max(0, p.hurt - dt);
  if ((keys.has("Space") || touch.fire) && p.cool <= 0 && p.ammo > 0) {
    p.ammo--; p.cool = 0.32; p.kick = 1;
    shots.push({ x: p.x + p.dx * 0.3, y: p.y + p.dy * 0.3, vx: p.dx * 9, vy: p.dy * 9, life: 1.4 });
    sfx.throw();
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    let dead = s.life <= 0 || !!wallAt(s.x, s.y);
    for (const e of things) {
      if (dead || !isFoe(e) || e.hp <= 0) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) < (e.kind === "bear" ? 0.8 : 0.42)) {
        dead = true; e.hp--; e.seen = true; e.flash = 0.12;
        if (e.hp <= 0) {
          p.kills++; e.dieAt = performance.now(); sfx.die();
          if (rnd() < 0.5) things.push({ kind: "banana", x: e.x, y: e.y });
        } else sfx.hit();
      }
    }
    if (dead) shots.splice(i, 1);
  }

  // enemies
  for (const e of things) {
    if (!isFoe(e) || e.hp <= 0) continue;
    e.flash = Math.max(0, (e.flash || 0) - dt); e.cool -= dt; e.phase += dt * 8;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (!e.seen && d < 9 && lineOfSight(e.x, e.y, p.x, p.y)) e.seen = true;
    if (!e.seen) continue;
    // Paper hands: a jeet down to its last hit runs away instead of fighting.
    const flee = e.kind === "jeet" && e.hp === 1;
    // The bear charges in bursts: slow, then a rush every few seconds.
    const rush = e.kind === "bear" && Math.sin(performance.now() / 700) > 0.6;
    const sp = (e.kind === "goblin" ? 2.3 : e.kind === "bear" ? (rush ? 3.4 : 0.9) : 1.5) * dt * (flee ? -1.3 : 1);
    if (d > (e.kind === "bear" ? 1.1 : 0.6) || flee) {
      const ux = dx / d, uy = dy / d;
      if (!wallAt(e.x + ux * sp * 1.5, e.y)) e.x += ux * sp;
      if (!wallAt(e.x, e.y + uy * sp * 1.5)) e.y += uy * sp;
    }
    if (d < (e.kind === "bear" ? 1.3 : 0.75) && e.cool <= 0 && !flee) {
      if (e.kind === "jeet") { p.hp -= 9; p.hurt = 0.3; e.cool = 0.8; sfx.hurt(); }
      else if (e.kind === "bear") { p.hp -= 22; p.hurt = 0.5; e.cool = 1.2; sfx.hurt(); sfx.roar(); }
      else {
        // The rug pull: grabs bananas and vanishes somewhere else in the cave.
        const took = Math.min(p.ammo, 4); p.ammo -= took; e.cool = 1.5; sfx.steal();
        for (let k = 0; k < 40; k++) {
          const nx = 1.5 + Math.floor(rnd() * (MW - 2)), ny = 1.5 + Math.floor(rnd() * (MH - 2));
          if (!wallAt(nx, ny) && Math.hypot(nx - p.x, ny - p.y) > 6) { e.x = nx; e.y = ny; e.seen = false; break; }
        }
      }
    }
  }

  // pickups
  for (let i = things.length - 1; i >= 0; i--) {
    const t = things[i];
    if (t.kind !== "banana" && t.kind !== "health") continue;
    if (Math.hypot(t.x - p.x, t.y - p.y) < 0.5) {
      if (t.kind === "banana") p.ammo += 5; else if (p.hp < 100) p.hp = Math.min(100, p.hp + 25); else continue;
      things.splice(i, 1); sfx.pick();
    }
  }
  // drop corpses after a moment
  for (let i = things.length - 1; i >= 0; i--) if (things[i].dieAt && performance.now() - things[i].dieAt > 700) things.splice(i, 1);

  if (p.hp <= 0) { p.hp = 0; state = "dead"; say("REKT", `${isTouch ? "Tap FIRE" : "Space"} to start over`); }
  else if (door && Math.hypot(door.x - p.x, door.y - p.y) < 1.05) {
    if (boss && boss.hp > 0) { if (!p.lockedSaid) { say("LOCKED", "The bear holds the exit. Take it down."); p.lockedSaid = true; setTimeout(() => { say(""); p.lockedSaid = false; }, 1600); } }
    else {
      clearTime = performance.now() - t0; sfx.clear();
      const last = levelIx === LEVELS.length - 1, tap = isTouch ? "tap FIRE" : "Space";
      state = last ? "won" : "clear";
      say(last ? "BEAR MARKET OVER" : "LEVEL CLEAR",
        `${fmt(clearTime)} · ${p.kills} jeets · secrets ${secretsFound}/${secrets} · ${tap} ${last ? "to play again" : "for the next cave"}`);
      post({ event: "clear", level: levelIx + 1, timeMs: Math.round(clearTime), kills: p.kills, secrets: secretsFound });
    }
  }
}

const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ── Render ──
function render() {
  const p = player, half = H / 2;
  // floor + ceiling, row by row
  const r0x = p.dx - p.px, r0y = p.dy - p.py, r1x = p.dx + p.px, r1y = p.dy + p.py;
  for (let y = half + 1; y < H; y++) {
    const dist = half / (y - half);
    const sx = dist * (r1x - r0x) / W, sy = dist * (r1y - r0y) / W;
    let fx = p.x + dist * r0x, fy = p.y + dist * r0y;
    const f = fog(dist), yc = H - y - 1;
    for (let x = 0; x < W; x++) {
      const tx = (TEX * (fx - Math.floor(fx))) & (TEX - 1), ty = (TEX * (fy - Math.floor(fy))) & (TEX - 1);
      buf[y * W + x] = shade(FLOOR[ty * TEX + tx], f);
      buf[yc * W + x] = shade(CEIL[ty * TEX + tx], f);
      fx += sx; fy += sy;
    }
  }
  // walls
  for (let x = 0; x < W; x++) {
    const cam = 2 * x / W - 1, rx = p.dx + p.px * cam, ry = p.dy + p.py * cam;
    let mx = Math.floor(p.x), my = Math.floor(p.y);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
    const stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1;
    let sdx = (rx < 0 ? p.x - mx : mx + 1 - p.x) * ddx, sdy = (ry < 0 ? p.y - my : my + 1 - p.y) * ddy;
    let side = 0, cell = null;
    for (let i = 0; i < 64; i++) {
      if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; } else { sdy += ddy; my += sty; side = 1; }
      cell = map[my]?.[mx]; if (cell !== ".") break;
    }
    const perp = side === 0 ? sdx - ddx : sdy - ddy;
    zbuf[x] = perp;
    const lh = Math.floor(H / perp);
    const top = Math.max(0, Math.floor(half - lh / 2)), bot = Math.min(H - 1, Math.floor(half + lh / 2));
    let wx = side === 0 ? p.y + perp * ry : p.x + perp * rx; wx -= Math.floor(wx);
    let tx = Math.floor(wx * TEX); if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = TEX - tx - 1;
    const tex = TEXTURES[cell] || TEXTURES["#"];
    const f = fog(perp) * (side ? 0.78 : 1), step = TEX / lh;
    let tpos = (top - half + lh / 2) * step;
    for (let y = top; y <= bot; y++) { buf[y * W + x] = shade(tex[((tpos & (TEX - 1)) * TEX) + tx], f); tpos += step; }
  }
  // sprites, far to near
  const sprites = [];
  for (const t of things) {
    let spr, scale = 0.62;
    if (isFoe(t)) { spr = SPR[t.kind][Math.floor(t.phase || 0) % 2]; if (t.kind === "bear") scale = 1.1; }
    else { spr = SPR[t.kind]; scale = 0.4; }
    sprites.push({ x: t.x, y: t.y, spr, scale, flash: t.flash > 0, dying: !!t.dieAt });
  }
  for (const s of shots) sprites.push({ x: s.x, y: s.y, spr: SPR.banana, scale: 0.18, lift: 0.18 });
  for (const s of sprites) s.d = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
  sprites.sort((a, b) => b.d - a.d);
  const inv = 1 / (p.px * p.dy - p.dx * p.py);
  for (const s of sprites) {
    const sx = s.x - p.x, sy = s.y - p.y;
    const tX = inv * (p.dy * sx - p.dx * sy), tY = inv * (-p.py * sx + p.px * sy);
    if (tY <= 0.1) continue;
    const scrX = Math.floor((W / 2) * (1 + tX / tY));
    const size = Math.floor((H / tY) * s.scale * (s.dying ? 0.6 : 1));
    const floorY = Math.floor(half + (H / tY) / 2 - (s.lift || 0) * (H / tY));
    const y0 = floorY - size, x0 = scrX - (size >> 1), f = fog(tY);
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + size); x++) {
      if (tY >= zbuf[x]) continue;
      const tx = Math.floor((x - x0) * s.spr.w / size);
      for (let y = Math.max(0, y0); y < Math.min(H, floorY); y++) {
        const c = s.spr.data[Math.floor((y - y0) * s.spr.h / size) * s.spr.w + tx];
        if (c) buf[y * W + x] = s.flash ? rgb(255, 255, 255) : shade(c, s.dying ? f * 0.5 : f);
      }
    }
  }
  // launcher
  const bob = Math.sin(performance.now() / 160) * (Math.abs(touch.mx) + Math.abs(touch.my) + (keys.size ? 1 : 0) > 0 ? 2 : 0);
  const gx = W / 2 + 6, gy = H - GUN.h * 2 + 6 + Math.round(player.kick * 8 + bob);
  for (let y = 0; y < GUN.h; y++) for (let x = 0; x < GUN.w; x++) {
    const c = GUN.data[y * GUN.w + x]; if (!c) continue;
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const px = gx + x * 2 + xx, py = gy + y * 2 + yy;
      if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = c;
    }
  }
  if (player.hurt > 0) for (let i = 0; i < buf.length; i += 1) { const c = buf[i]; buf[i] = ((255 << 24) | ((c >>> 16) & 255) * 0.6 << 16 | ((c >>> 8) & 255) * 0.6 << 8 | Math.min(255, (c & 255) + 70)) >>> 0; }
  if (boss && boss.hp > 0 && boss.seen) {
    const bw = Math.floor(W * 0.6), bx = (W - bw) >> 1, fill = Math.floor(bw * boss.hp / boss.max);
    for (let y = 6; y < 11; y++) for (let x = bx - 1; x <= bx + bw; x++) buf[y * W + x] = x - bx < fill && x >= bx && y > 6 && y < 10 ? rgb(235, 60, 80) : rgb(20, 16, 28);
  }
  ctx.putImageData(frame, 0, 0);

  $("hp").textContent = Math.max(0, Math.round(player.hp));
  $("ammo").textContent = player.ammo;
  $("kills").textContent = player.kills;
  $("clock").textContent = fmt(state === "play" ? performance.now() - t0 : clearTime);
  drawFace();
}

// ── Layout: the view fills the width (landscape: the height), crisp pixels ──
function fit() {
  const hud = document.getElementById("hud");
  const hudH = 64;
  const portrait = innerHeight > innerWidth * 1.15;
  // Portrait leaves room under the HUD for the stick and FIRE (touch only).
  const controls = portrait && isTouch ? 190 : 0;
  if (portrait) setRes(240, Math.max(200, Math.min(400, Math.round(240 * (innerHeight - hudH - controls) / innerWidth))));
  else setRes(320, 200);
  const s = Math.min(innerWidth / W, (innerHeight - hudH - controls) / H);
  document.getElementById("wrap").style.justifyContent = controls ? "flex-start" : "center";
  view.style.width = `${Math.floor(W * s)}px`; view.style.height = `${Math.floor(H * s)}px`;
  hud.style.width = view.style.width;
}
addEventListener("resize", fit);
fit();

// ── Start ──
const params = new URLSearchParams(location.search);
let n = parseInt(params.get("n") || "", 10);
if (!imageFor(n)) { do n = 1 + Math.floor(Math.random() * 8888); while (!imageFor(n)); }
loadImage(imageFor(n)).then(readGrid).then((g) => { facePx = g.px; }).catch(() => { /* face stays blank */ });
loadLevel();
say("MONKECAVES", `Cave 1: ${LEVELS[0].name}. Hunt the jeets, find the pink exit.`);
setTimeout(() => { if (state === "play") say(""); }, 2200);

let last = performance.now();
window.__caves = { player, things, get state() { return state; }, frames: 0 };
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); window.__caves.frames++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
