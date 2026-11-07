// MonkeCaves — our own raycaster (prototype). One 320×200 frame per tick into an
// ImageData, walls by DDA, textured floor/ceiling rows, billboard sprites
// against a per-column depth buffer. Textures and enemies are drawn here as
// pixel maps; the player's face is their Saga Monke PFP (monkeModel.js).
import { imageFor, loadImage, readGrid } from "/viewer/monkeModel.js";
import { weaponFor, heldSprite, shotMask, shotColour } from "/viewer/caves-weapons.js";
import { LEVELS } from "/viewer/caves-levels.js";
import { paintFace } from "/viewer/caves-face.js";
import { WALL_PAINT, FLOOR_PAINT, SKY_PAINT, DECOR_PAL, DECOR_ROWS, DECOR_LETTERS, DECOR_BLOCKS } from "/viewer/caves-world.js";
import { FOE_ROWS, FOE_PAL, AD_PAL2, XSHOT, BEAM, FOES, FOE_LETTERS } from "/viewer/caves-foes.js";

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
// Badges: 1 blue, 2 pink, 3 gold (pickups) open doors 7, 8, 9.
const BADGES = { 1: { name: "BLUE", c: [60, 140, 255] }, 2: { name: "PINK", c: [233, 22, 113] }, 3: { name: "GOLD", c: [255, 210, 63] } };
const DOOR_BADGE = { 7: 1, 8: 2, 9: 3 };
const badgeDoorTex = ([r, g, b]) => makeTex((x, y) => {
  const edge = x < 2 || x > TEX - 3 || y < 2 || y > TEX - 3, seam = x === 15 || x === 16;
  const card = x > 10 && x < 21 && y > 9 && y < 24, clip = x > 13 && x < 18 && y > 7 && y < 11;
  if (clip) return rgb(30, 26, 40);
  if (card) return (y > 12 && y < 15) ? rgb(255, 255, 255) : rgb(r, g, b);
  const n = 0.85 + rnd() * 0.15;
  return edge || seam ? rgb(r * 0.35, g * 0.35, b * 0.35) : rgb(70 * n, 74 * n, 90 * n);
});
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
  7: badgeDoorTex(BADGES[1].c), 8: badgeDoorTex(BADGES[2].c), 9: badgeDoorTex(BADGES[3].c),
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
// Jungle temple (caves-world.js): walls, floors, sky. A level with theme "jungle" swaps
// its rock for temple stone; floor/ceil rows pick a texture per cell.
const fromPaint = (paint) => makeTex((x, y) => { const [r, g, b] = paint(x, y, rnd); return rgb(Math.round(r), Math.round(g), Math.round(b)); });
const JUNGLE = Object.fromEntries(Object.entries(WALL_PAINT).map(([k, f]) => [k, fromPaint(f)]));
const ROCK = { "#": TEXTURES["#"], S: TEXTURES["#"] };
const FLOORS = Object.fromEntries(Object.entries(FLOOR_PAINT).map(([k, f]) => [k, fromPaint(f)]));
const SKY = fromPaint(SKY_PAINT);
const ROOTS = makeTex((x, y) => { const n = 0.6 + rnd() * 0.4, root = Math.abs((((x + Math.round(Math.sin(y * Math.PI / 8) * 3)) % 16) + 16) % 16 - 8) < 1; return root ? rgb(52 * n, 36 * n, 22 * n) : rgb(22 * n, 26 * n, 18 * n); });
for (const k of ["V", "T", "Z", "W", "d"]) TEXTURES[k] = JUNGLE[k];
let floorAt = new Array(1), ceilAt = new Array(1), light = new Float32Array(1), blockers = new Set();
let baseFloor = FLOOR, baseCeil = CEIL;

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
// The Banana Phone: the back of a sleek phone with a banana where the logo
// goes, a two-lens camera bump, cable arms and little legs. First it wears a
// case; shoot the case off and it fights faster.
const PHONE = (legs) => [
  "................", "....kkkkkkkk....", "...kwwwwwwwwk...", "...kwkkkwwwwk...", "...kwkLkwwwwk...", "...kwkLkwwwwk...",
  ".c.kwkkkwwwwk.c.", ".ckkwwwwyywwkkc.", "..ckwwwwyyywkc..", "...kwwwyyyywk...", "...kwwyyyywwk...", "...kwwwyywwwk...",
  "...kwwwwwwwwk...", "....kkkkkkkk....", legs ? "....kg....kg...." : ".....kg..kg.....", legs ? "....kk....kk...." : ".....kk..kk.....",
];
const PHONE_PAL = { ...PAL, w: [214, 220, 230], L: [60, 70, 90], c: [235, 235, 240], g: [140, 146, 158], y: [255, 210, 63] };
const CASE_PAL = { ...PHONE_PAL, w: [46, 60, 92], y: [255, 210, 63] };
const SLIME = makeSprite(["................", "................", ".....kkkk.......", "....kGGGGk......", "...kGgggGGk.....", "...kGgwgggk.....",
  "...kGggggGk.....", "....kGGGGk......", ".....kkkk.......", "................", "................", "................",
  "................", "................", "................", "................"], { ...PAL, G: [80, 200, 60], g: [125, 255, 80] });
const SPR = {
  phone: [makeSprite(PHONE(0), PHONE_PAL), makeSprite(PHONE(1), PHONE_PAL)],
  phoneCase: [makeSprite(PHONE(0), CASE_PAL), makeSprite(PHONE(1), CASE_PAL)],
  bear: [makeSprite(BEAR, PAL), makeSprite(BEAR, PAL)],
  jeet: JEET.map((r) => makeSprite(r, PAL)),
  cookie: FOE_ROWS.cookie.map((r) => makeSprite(r, FOE_PAL)),
  bat: FOE_ROWS.bat.map((r) => makeSprite(r, FOE_PAL)),
  ad: [makeSprite(FOE_ROWS.ad[0], FOE_PAL), makeSprite(FOE_ROWS.ad[1], AD_PAL2)],
  keeper: FOE_ROWS.keeper.map((r) => makeSprite(r, FOE_PAL)),
  keeperBack: FOE_ROWS.keeperBack.map((r) => makeSprite(r, FOE_PAL)),
  eye: FOE_ROWS.eye.map((r) => makeSprite(r, FOE_PAL)),
  xshot: makeSprite(XSHOT, FOE_PAL),
  ...Object.fromEntries(Object.entries(DECOR_ROWS).map(([k, rows]) => [k, makeSprite(rows, DECOR_PAL)])),
  // Ammo: a Seeker battery (small) and a Seeker phone (big pack). Health: small kit, big kit.
  ammo: makeSprite([
    "................", "................", "................", "................", "................", "......kkkk......",
    ".....kggggk.....", ".....kgwwgk.....", ".....kggggk.....", ".....kgGGgk.....", ".....kgGGgk.....", ".....kgGGgk.....",
    ".....kkkkkk.....", "................", "................", "................",
  ], { ...PAL, g: [60, 220, 170], G: [30, 140, 110] }),
  ammoBig: makeSprite([
    "................", "................", "................", ".....kkkkkk.....", "....kSSSSSSk....", "....kSccccSk....",
    "....kScwwcSk....", "....kSccccSk....", "....kScwwcSk....", "....kSccccSk....", "....kSccccSk....", "....kSccccSk....",
    "....kSSkkSSk....", ".....kkkkkk.....", "................", "................",
  ], { ...PAL, S: [40, 44, 56], c: [60, 220, 170] }),
  healthBig: makeSprite([
    "................", "................", "................", "....kkkkkkkk....", "...kwwwwwwwwk...", "...kwwwrrwwwk...",
    "...kwwwrrwwwk...", "...kwrrrrrrwk...", "...kwrrrrrrwk...", "...kwwwrrwwwk...", "...kwwwrrwwwk...", "...kwwwwwwwwk...",
    "....kkkkkkkk....", "................", "................", "................",
  ], PAL),
  // A lanyard ID badge in its colour.
  badge: Object.fromEntries(Object.entries(BADGES).map(([k, v]) => [k, makeSprite([
    "................", "......kkkk......", ".....k....k.....", "....k......k....", "....k......k....", "...kkkkkkkkkk...",
    "...kxxxxxxxxk...", "...kxwwwwwwxk...", "...kxwkkkkwxk...", "...kxwwwwwwxk...", "...kxxxxxxxxk...", "...kxwwxxwwxk...",
    "...kxxxxxxxxk...", "...kkkkkkkkkk...", "................", "................",
  ], { ...PAL, x: v.c })])),
  beam: makeSprite(BEAM, FOE_PAL),
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

// The held weapon comes from the player's monke (caves-weapons.js), set at start.
let WEAPON = null, GUN = null, SHOT = null;
function equip(n) {
  WEAPON = weaponFor(n); GUN = heldSprite(WEAPON);
  SHOT = shotMask(WEAPON.shot.shape);
}

// ── Levels ── map letters are listed in scripts/caves/build-levels.py.
// Speed-run board (worker caves.ts) only takes runs from this level set. Change a
// level → bump this and CAVES_VERSION/MIN_MS in worker-actions/src/caves.ts together.
const CAVES_VERSION = 2;
// Levels: caves-levels.js (built by scripts/caves/build-levels.py).
let levelIx = 0;
let MW = 0, MH = 0, secrets = 0, secretsFound = 0, boss = null;
const map = [];
// Ammo: one shared type for every weapon (Seeker batteries +10, Seeker phones +40).
const AMMO_START = 50, AMMO_MAX = 150;
const player = { x: 1.5, y: 1.5, dx: 1, dy: 0, px: 0, py: 0.66, hp: 100, bananas: 0, ammo: AMMO_START, kills: 0, hurt: 0, slime: 0, cool: 0, kick: 0, flash: 0, popup: 0, popupX: 0 };
const things = []; // enemies + pickups
const shots = [], spits = [];
let door = null;
let seen = new Uint8Array(1); // map cells the player has seen (automap)
let totals = { foes: 0, items: 0 };

function loadLevel(keepStats = false) {
  const LEVEL = LEVELS[levelIx].rows;
  MW = Math.max(...LEVEL.map((r) => r.length)); MH = LEVEL.length;
  const lv = LEVELS[levelIx], jungle = lv.theme === "jungle";
  Object.assign(TEXTURES, jungle ? { "#": JUNGLE["#"], S: JUNGLE.S } : ROCK);
  baseFloor = jungle ? FLOORS.m : FLOOR; baseCeil = jungle ? ROOTS : CEIL;
  blockers = new Set();
  map.length = 0; things.length = 0; shots.length = 0; spits.length = 0; door = null; boss = null; secrets = 0; secretsFound = 0;
  const carry = keepStats ? { hp: player.hp, bananas: player.bananas, ammo: player.ammo, kills: player.kills } : null;
  for (let y = 0; y < MH; y++) {
    const row = [];
    for (let x = 0; x < MW; x++) {
      let c = (LEVEL[y][x] || "#");
      if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) c = c === "D" ? "D" : "#";
      const cx = x + 0.5, cy = y + 0.5;
      if (c === "P") { player.x = cx; player.y = cy; c = "."; }
      else if (c === "J") { things.push({ kind: "jeet", x: cx, y: cy, hp: 3, cool: 0, seen: false, phase: rnd() * 6 }); c = "."; }
      else if (c === "G") { things.push({ kind: "goblin", x: cx, y: cy, hp: 2, cool: 0, seen: false, phase: rnd() * 6 }); c = "."; }
      else if (FOE_LETTERS[c]) { const kind = FOE_LETTERS[c]; things.push({ kind, x: cx, y: cy, hp: FOES[kind].hp, cool: rnd(), seen: false, phase: rnd() * 6, face: rnd() * 6.3 }); c = "."; }
      else if (c === "X") {
        boss = LEVELS[levelIx].boss === "phone"
          ? { kind: "phone", x: cx, y: cy, hp: 22, max: 22, armour: 8, cool: 1, spit: 1.5, tax: 6, seen: false, phase: 0 }
          : { kind: "bear", x: cx, y: cy, hp: 18, max: 18, cool: 0, seen: false, phase: 0 };
        things.push(boss); c = ".";
      }
      else if (c === "S") secrets++;
      else if (c === "I") { things.push({ kind: "idol", x: cx, y: cy }); c = "."; }
      else if (DECOR_LETTERS[c]) { const d = DECOR_LETTERS[c]; things.push({ kind: "decor", d, x: cx, y: cy }); if (DECOR_BLOCKS.has(d)) blockers.add(y * MW + x); c = "."; }
      else if (c === "b") { things.push({ kind: "banana", x: cx, y: cy }); c = "."; }
      else if (c === "h" || c === "H") { things.push({ kind: "health", x: cx, y: cy, big: c === "H" }); c = "."; }
      else if (c === "q" || c === "Q") { things.push({ kind: "ammo", x: cx, y: cy, big: c === "Q" }); c = "."; }
      else if (BADGES[c]) { things.push({ kind: "badge", x: cx, y: cy, b: +c }); c = "."; }
      else if (c === "D") door = { x: cx, y: cy };
      row.push(c);
    }
    map.push(row);
  }
  Object.assign(player, { dx: 1, dy: 0, px: 0, py: 0.66, hp: 100, bananas: 0, ammo: AMMO_START, kills: 0, hurt: 0, slime: 0, cool: 0, kick: 0, flash: 0, badges: new Set(), lockedAt: 0, look: 0, lookUntil: 0, ouch: 0, grin: 0 }, carry || {});
  seen = new Uint8Array(MW * MH);
  if (lv.face != null) {
    const a = lv.face * Math.PI / 180;
    Object.assign(player, { dx: Math.cos(a), dy: Math.sin(a), px: -Math.sin(a) * 0.66, py: Math.cos(a) * 0.66 });
  }
  // Per-cell floor/ceiling and light: sunlit clearings (sky) are bright, tunnels are
  // dim, and torches warm everything within a few tiles.
  floorAt = new Array(MW * MH); ceilAt = new Array(MW * MH); light = new Float32Array(MW * MH);
  const torches = things.filter((t) => t.kind === "decor" && t.d === "torch");
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, fc = lv.floor?.[y]?.[x], cc = lv.ceil?.[y]?.[x];
    floorAt[i] = FLOORS[fc] || baseFloor; ceilAt[i] = cc === "o" ? SKY : baseCeil;
    let l = !jungle ? 1 : cc === "o" ? 1.15 : 0.78;
    for (const t of torches) { const d = Math.hypot(t.x - x - 0.5, t.y - y - 0.5); if (d < 4.5) l += 0.38 * (1 - d / 4.5); }
    light[i] = Math.min(1.35, l);
  }
  doors = new Map();
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (DOOR_CHARS.has(map[y][x])) {
    // A door between walls left and right runs along x (its slab sits at y + 0.5).
    const solid = (c) => c && c !== "." && !DOOR_CHARS.has(c);
    doors.set(y * MW + x, { x, y, alongX: solid(map[y][x - 1]) && solid(map[y][x + 1]), open: 0, want: 0, wait: 0, stay: false });
  }
  totals = { foes: things.filter(isFoe).length, items: things.filter((t) => t.kind === "banana" || t.kind === "idol").length };
  player.items = 0;
}
// Doors (d, and badge doors 7 8 9) slide sideways along the middle of their cell.
// open: 0 shut … 1 open; a plain door shuts again 4 s after it's left clear.
const DOOR_CHARS = new Set(["d", "7", "8", "9"]);
let doors = new Map();
const doorAt = (x, y) => doors.get(Math.floor(y) * MW + Math.floor(x));
const wallAt = (x, y) => {
  const r = map[Math.floor(y)]; const c = r ? r[Math.floor(x)] : "#";
  if (c === "." || c === undefined) return null;
  if (DOOR_CHARS.has(c)) { const d = doorAt(x, y); if (d && d.open > 0.85) return null; }
  return c;
};
// Walls plus the decorations you can't walk through (trees, torches).
const solidAt = (x, y) => wallAt(x, y) || (blockers.has(Math.floor(y) * MW + Math.floor(x)) ? "Y" : null);
function openDoor(d) { if (d.want !== 1) { d.want = 1; sfx.door(); } d.wait = 4; }
function tickDoors(dt) {
  for (const d of doors.values()) {
    d.open = Math.max(0, Math.min(1, d.open + (d.want ? 2 : -2) * dt));
    if (d.want && !d.stay && d.open >= 1) {
      // Don't shut on anyone standing in the doorway.
      const busy = Math.floor(player.x) === d.x && Math.floor(player.y) === d.y || things.some((t) => isFoe(t) && t.hp > 0 && Math.floor(t.x) === d.x && Math.floor(t.y) === d.y);
      if (busy) d.wait = 1; else if ((d.wait -= dt) <= 0) { d.want = 0; sfx.door(); }
    }
  }
}
const isFoe = (t) => t.kind === "jeet" || t.kind === "goblin" || t.kind === "bear" || t.kind === "phone" || !!FOES[t.kind];
// Every cave hits a little harder than the one before (one difficulty for everyone).
const dmg = (n) => Math.round(n * (1 + 0.15 * levelIx));
// Walking into a secret wall slides it open.
function bump(x, y) {
  const w = wallAt(x, y), need = DOOR_BADGE[w];
  if (need) {
    if (player.badges.has(need)) { const d = doorAt(x, y); if (d) { d.stay = true; openDoor(d); } }
    else if (performance.now() - player.lockedAt > 1800) {
      player.lockedAt = performance.now(); sfx.hurt();
      say(`${BADGES[need].name} BADGE NEEDED`, "Find it somewhere in this cave."); setTimeout(() => { if (state === "play") say(""); }, 1500);
    }
    return;
  }
  if (w === "d") { const d = doorAt(x, y); if (d) openDoor(d); return; }
  if (w !== "S") return;
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
document.getElementById("help").textContent = isTouch ? "Left stick: move · drag right side: turn · FIRE · MAP" : "WASD move · mouse / ← → turn · click or space: fire · M map · click to lock the mouse";
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
// Drag to turn, scaled by the turn-speed setting; slower while the crosshair is on an
// enemy (aim assist) so a swipe doesn't skate past it.
turnEl.addEventListener("pointermove", (e) => {
  if (e.pointerId !== turnId) return;
  const sticky = settings.assist && assistTarget(0.07, 14) ? 0.55 : 1;
  turn((e.clientX - turnX) * 0.008 * settings.sens * sticky); turnX = e.clientX;
});
const endTurn = () => { turnId = null; };
turnEl.addEventListener("pointerup", endTurn); turnEl.addEventListener("pointercancel", endTurn);
const fireEl = document.getElementById("fire");
fireEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); touch.fire = true; unlockAudio(); });
fireEl.addEventListener("pointerup", () => { touch.fire = false; });
fireEl.addEventListener("pointercancel", () => { touch.fire = false; });

function turn(a) {
  if (state === "play" && !t0 && a) t0 = performance.now();
  const c = Math.cos(a), s = Math.sin(a), p = player;
  [p.dx, p.dy] = [p.dx * c - p.dy * s, p.dx * s + p.dy * c];
  [p.px, p.py] = [p.px * c - p.py * s, p.px * s + p.py * c];
}

// ── Sound: tiny synth, no files ──
let audio = null;
// Per-device conveniences (sound, best times). Storage can be blocked; the game works without it.
const store = { get(k) { try { return localStorage.getItem(`caves:${k}`); } catch { return null; } }, set(k, v) { try { localStorage.setItem(`caves:${k}`, v); } catch { /* blocked */ } } };
let muted = store.get("muted") === "1";
// Phone aiming settings (pause menu), kept on this device.
const settings = {
  sens: Math.max(0.4, Math.min(2.2, parseFloat(store.get("sens") || "1") || 1)),
  assist: store.get("assist") !== "0",
  // New key: tilt starts off for everyone (the first version was on and too much).
  tilt: store.get("tilt2") === "1",
};
function unlockAudio() { if (!audio) try { audio = new AudioContext(); } catch { /* no audio */ } }
function blip(freq, dur, type = "square", vol = 0.08, slide = 0) {
  if (!audio || muted) return;
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
  spit: () => blip(240, 0.15, "triangle", 0.07, 200),
  crack: () => { blip(1400, 0.08, "square", 0.07, -900); setTimeout(() => blip(700, 0.2, "sawtooth", 0.07, -500), 60); },
  tax: () => [880, 660, 440].forEach((f, i) => setTimeout(() => blip(f, 0.1, "square", 0.06), i * 70)),
  empty: () => blip(90, 0.05, "square", 0.05),
  clear: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.18, "triangle", 0.09), i * 120)),
  ping: () => { blip(1320, 0.07, "sine", 0.08); setTimeout(() => blip(1760, 0.1, "sine", 0.08), 90); },
  pop: () => blip(700, 0.06, "square", 0.06, 500),
  clink: () => blip(2200, 0.05, "square", 0.05, -1200),
  beam: () => blip(330, 0.35, "sine", 0.07, -200),
  munch: () => blip(260, 0.05, "square", 0.05, -100),
  door: () => { blip(110, 0.35, "sawtooth", 0.07, 60); setTimeout(() => blip(660, 0.12, "triangle", 0.07), 250); },
  badge: () => [659, 880, 1175].forEach((f, i) => setTimeout(() => blip(f, 0.12, "triangle", 0.09), i * 90)),
};

// ── HUD ──
const $ = (id) => document.querySelector(`#${id} b`);
const faceEl = document.getElementById("face"), face = faceEl.getContext("2d");
let facePx = null, crop = { x: 0, y: 0, n: 16 };
// Crop the PFP to the monke itself (its pixels, not the background) so it fills the frame.
let faceSolid = null;
function setFace(g) {
  facePx = g.px; faceSolid = g.solid;
  let x0 = 16, y0 = 16, x1 = -1, y1 = -1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (g.solid[y][x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return;
  const n = Math.max(8, Math.min(16, Math.max(x1 - x0 + 1, Math.min(y1 - y0 + 1, 13))));
  crop = { x: Math.max(0, Math.min(16 - n, Math.round((x0 + x1 + 1) / 2 - n / 2))), y: Math.max(0, Math.min(16 - n, y0 - 1)), n };
  faceEl.width = faceEl.height = n;
}
function drawFace() {
  const { n } = crop;
  face.clearRect(0, 0, n, n);
  if (!facePx) return;
  const now = performance.now(), p = player;
  const img = paintFace(facePx, faceSolid, crop, { hp: p.hp, look: now < p.lookUntil ? p.look : 0, ouch: p.ouch, grin: p.grin, hurt: p.hurt, t: now });
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const c = img[y][x]; if (!c) continue; face.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; face.fillRect(x, y, 1, 1); }
}
// Every hit on the player goes through here: the face glances toward the attacker
// (DOOM's status face does the same) and pulls an "ouch" on a big hit.
function hurtPlayer(amount, from, flash = 0.3) {
  const p = player;
  p.hp -= amount; p.hurt = flash; sfx.hurt();
  if (amount >= 20) p.ouch = 0.6;
  if (from) {
    const a = Math.atan2(from.y - p.y, from.x - p.x) - Math.atan2(p.dy, p.dx), d = Math.atan2(Math.sin(a), Math.cos(a));
    p.look = Math.abs(d) < 0.35 ? 0 : d > 0 ? 1 : -1; p.lookUntil = performance.now() + 900;
  }
}
const msg = document.getElementById("msg");
const say = (title, line = "") => { msg.className = ""; msg.innerHTML = title ? `<h1>${title}</h1><p>${line}</p>` : ""; };
// A framed card for the title and cave-clear screens (our own strings only, never user text).
const card = (title, lines) => { msg.className = "card"; msg.innerHTML = `<h1>${title}</h1>${lines.join("")}`; };

// ── Game state ──
// title → play → clear | dead | won. t0 = 0 until the first move, turn or shot, so a
// speed run starts on the player's first input, not when the cave loads.
let state = "title", t0 = 0, clearTime = 0, paused = 0;
const runTime = () => (t0 ? performance.now() - t0 : 0);
function post(m) {
  const s = JSON.stringify({ type: "caves", ...m });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (parent !== window) parent.postMessage(s, location.origin);
}

function update(dt) {
  const p = player;
  if (paused) return;
  if (state !== "play") {
    if (keys.has("Space") || keys.has("Enter") || touch.fire) {
      touch.fire = false; keys.clear();
      // A clear goes on to the next cave; dying restarts the same cave; winning starts over.
      const next = state === "clear";
      levelIx = next ? levelIx + 1 : state === "won" ? 0 : levelIx;
      startCave(next);
    }
    return;
  }
  tickDoors(dt);
  // move
  let fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - touch.my;
  let side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + touch.mx;
  const rot = (keys.has("ArrowRight") || keys.has("KeyE") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyQ") ? 1 : 0);
  if (!t0 && (fwd || side || rot || touch.fire || keys.has("Space"))) t0 = performance.now();
  if (rot) turn(rot * 2.6 * dt);
  const len = Math.hypot(fwd, side); if (len > 1) { fwd /= len; side /= len; }
  const speed = 3.2 * dt, R = 0.22;
  const mx = (p.dx * fwd - p.dy * side) * speed, my = (p.dy * fwd + p.dx * side) * speed;
  if (!solidAt(p.x + mx + Math.sign(mx) * R, p.y)) p.x += mx; else if (mx) bump(p.x + mx + Math.sign(mx) * R, p.y);
  if (!solidAt(p.x, p.y + my + Math.sign(my) * R)) p.y += my; else if (my) bump(p.x, p.y + my + Math.sign(my) * R);

  // throw
  p.cool -= dt; p.kick = Math.max(0, p.kick - dt * 5); p.hurt = Math.max(0, p.hurt - dt);
  // Every weapon plays the same: 1 damage, one shot per 0.32 s, speed 9, 1 ammo per shot.
  p.flash = Math.max(0, p.flash - dt);
  if ((keys.has("Space") || touch.fire) && p.cool <= 0 && p.ammo <= 0) {
    p.cool = 0.45; sfx.empty();
    if (performance.now() - (p.emptySaid || 0) > 2500) { p.emptySaid = performance.now(); say("OUT OF AMMO", "Find Seeker batteries"); setTimeout(() => { if (state === "play") say(""); }, 1200); }
  }
  if ((keys.has("Space") || touch.fire) && p.cool <= 0 && p.ammo > 0) {
    p.cool = 0.32; p.kick = 1; p.flash = 0.06; p.ammo--;
    // Phones: aim assist bends the shot onto an enemy within ~6° of the crosshair
    // (DOOM's auto-aim checks a few degrees either side the same way).
    let vx = p.dx, vy = p.dy;
    if (isTouch && settings.assist) {
      const t = assistTarget(0.105, 14);
      if (t) { const d = Math.hypot(t.x - p.x, t.y - p.y); vx = (t.x - p.x) / d; vy = (t.y - p.y) / d; }
    }
    shots.push({ x: p.x + vx * 0.3, y: p.y + vy * 0.3, vx: vx * 9, vy: vy * 9, life: 1.4, born: performance.now() });
    sfx.throw();
    // Gunfire carries through open floor and open doors (a shut door muffles it),
    // like DOOM's sound flood, and wakes whatever hears it.
    const heard = hearing(Math.floor(p.x), Math.floor(p.y), 16);
    for (const e of things) if (isFoe(e) && !e.seen && e.hp > 0 && heard.has(Math.floor(e.y) * MW + Math.floor(e.x))) e.seen = true;
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    let dead = s.life <= 0 || !!wallAt(s.x, s.y);
    for (const e of things) {
      if (dead || !isFoe(e) || e.hp <= 0) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) < (e.kind === "bear" ? 0.8 : FOES[e.kind]?.r ?? 0.42)) {
        dead = true; e.seen = true;
        // The Gatekeeper's padlock shield stops anything that hits it from the front.
        if (e.kind === "keeper" && Math.cos(e.face) * s.vx + Math.sin(e.face) * s.vy < -0.35 * Math.hypot(s.vx, s.vy)) { sfx.clink(); continue; }
        e.hp--; e.flash = 0.12;
        if (e.kind === "phone" && e.armour > 0 && --e.armour === 0) {
          sfx.crack(); say("CASE CRACKED", "SALE! UPGRADE NOW"); setTimeout(() => { if (state === "play") say(""); }, 1300);
        }
        if (e.hp <= 0 && e.kind === "phone") {
          for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; const bx = e.x + Math.cos(a) * 0.9, by = e.y + Math.sin(a) * 0.9; if (!wallAt(bx, by)) things.push({ kind: "banana", x: bx, y: by }); }
          say("PERMISSIONLESS", "The Banana Phone is down. The exit is open."); setTimeout(() => { if (state === "play") say(""); }, 2000);
        }
        if (e.hp <= 0) {
          p.kills++; e.dieAt = performance.now(); sfx.die();
          const r = rnd();
          if (r < 0.4) things.push({ kind: "ammo", x: e.x, y: e.y }); else if (r < 0.7) things.push({ kind: "banana", x: e.x, y: e.y, dropped: true });
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
    if (!e.seen && d < 9 && lineOfSight(e.x, e.y, p.x, p.y)) { e.seen = true; if (e.kind === "bat") sfx.ping(); }
    if (!e.seen) continue;
    if (e.kind === "phone") { phoneAI(e, dx, dy, d, dt); continue; }
    if (FOES[e.kind]) { foeAI(e, dx, dy, d, dt); continue; }
    // Paper hands: a jeet down to its last hit runs away instead of fighting.
    const flee = e.kind === "jeet" && e.hp === 1;
    // The bear charges in bursts: slow, then a rush every few seconds.
    const rush = e.kind === "bear" && Math.sin(performance.now() / 700) > 0.6;
    const sp = (e.kind === "goblin" ? 2.3 : e.kind === "bear" ? (rush ? 3.4 : 0.9) : 1.5) * dt * (flee ? -1.3 : 1);
    if (d > (e.kind === "bear" ? 1.1 : 0.6) || flee) {
      const [ux, uy] = chase(e, dx, dy, d);
      if (!wallAt(e.x + ux * sp * 1.5, e.y)) e.x += ux * sp;
      if (!wallAt(e.x, e.y + uy * sp * 1.5)) e.y += uy * sp;
    }
    if (d < (e.kind === "bear" ? 1.3 : 0.75) && e.cool <= 0 && !flee) {
      if (e.kind === "jeet") { hurtPlayer(dmg(10), e); e.cool = 0.7; }
      else if (e.kind === "bear") { hurtPlayer(dmg(22), e, 0.5); e.cool = 1.2; sfx.roar(); }
      else {
        // The rug pull: grabs bananas and vanishes somewhere else in the cave.
        const took = Math.min(p.bananas, 4); p.bananas -= took; e.cool = 1.5; sfx.steal();
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
    if (t.kind !== "banana" && t.kind !== "health" && t.kind !== "badge" && t.kind !== "ammo" && t.kind !== "idol") continue;
    if (Math.hypot(t.x - p.x, t.y - p.y) < 0.5) {
      if (t.kind === "badge") {
        p.badges.add(t.b); p.grin = 1.5; things.splice(i, 1); sfx.badge();
        say(`${BADGES[t.b].name} BADGE`, `Opens the ${BADGES[t.b].name.toLowerCase()} doors.`); setTimeout(() => { if (state === "play") say(""); }, 1500);
        continue;
      }
      // Health and ammo stay on the floor when you're already full.
      if (t.kind === "banana") { p.bananas += 5; if (!t.dropped) p.items++; }
      else if (t.kind === "idol") { p.bananas += 25; p.items++; p.grin = 1.5; say("MONKE IDOL", "+25 bananas"); setTimeout(() => { if (state === "play") say(""); }, 1100); }
      else if (t.kind === "ammo") { if (p.ammo >= AMMO_MAX) continue; p.ammo = Math.min(AMMO_MAX, p.ammo + (t.big ? 40 : 10)); }
      else if (p.hp < 100) p.hp = Math.min(100, p.hp + (t.big ? 25 : 10)); else continue;
      things.splice(i, 1); sfx.pick();
    }
  }
  // Banana Phone slime
  p.slime = Math.max(0, p.slime - dt); p.popup = Math.max(0, p.popup - dt); p.ouch = Math.max(0, p.ouch - dt); p.grin = Math.max(0, p.grin - dt);
  for (let i = spits.length - 1; i >= 0; i--) {
    const s = spits[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    if (Math.hypot(s.x - p.x, s.y - p.y) < 0.35) { hurtPlayer(s.dmg ?? dmg(8), { x: s.x - s.vx, y: s.y - s.vy }, 0.25); if (!s.spr) p.slime = 1.4; spits.splice(i, 1); continue; }
    if (s.life <= 0 || wallAt(s.x, s.y)) spits.splice(i, 1);
  }
  // drop corpses after a moment
  for (let i = things.length - 1; i >= 0; i--) if (things[i].dieAt && performance.now() - things[i].dieAt > 700) things.splice(i, 1);

  if (p.hp <= 0) { p.hp = 0; state = "dead"; say("REKT", `${isTouch ? "Tap FIRE" : "Space"} to try ${LEVELS[levelIx].name} again`); }
  else if (door && Math.hypot(door.x - p.x, door.y - p.y) < 1.05) {
    if (boss && boss.hp > 0) { if (!p.lockedSaid) { say("LOCKED", boss.kind === "phone" ? "The Banana Phone holds the exit. Take it down." : "The bear holds the exit. Take it down."); p.lockedSaid = true; setTimeout(() => { say(""); p.lockedSaid = false; }, 1600); } }
    else {
      clearTime = runTime(); sfx.clear();
      const last = levelIx === LEVELS.length - 1, tap = isTouch ? "Tap FIRE" : "Space";
      state = last ? "won" : "clear";
      const best = parseInt(store.get(`best:${CAVES_VERSION}:${levelIx + 1}`) || "0", 10);
      const isBest = !best || clearTime < best;
      if (isBest) store.set(`best:${CAVES_VERSION}:${levelIx + 1}`, String(Math.round(clearTime)));
      const pct = (a, b) => `${b ? Math.round((100 * a) / b) : 100}%`, par = (LEVELS[levelIx].par || 0) * 1000;
      card(last ? "YOU ESCAPED" : "CAVE CLEAR", [
        `<div class="big">${fmtRun(clearTime)}</div>`,
        par ? `<div class="${clearTime <= par ? "tag" : "dim"}">PAR ${fmt(par)}${clearTime <= par ? " · BEAT IT" : ""}</div>` : "",
        isBest ? `<div class="tag">${best ? "NEW BEST" : "FIRST CLEAR"}</div>` : `<div class="dim">best ${fmtRun(best)}</div>`,
        `<div class="stats"><span>KILLS</span><b>${pct(p.kills, totals.foes)}</b><span>ITEMS</span><b>${pct(p.items, totals.items)}</b><span>SECRETS</span><b>${pct(secretsFound, secrets)}</b></div>`,
        `<div class="cta">${tap} ${last ? "to play again" : `for cave ${levelIx + 2}`}</div>`,
      ]);
      if (t0) post({ event: "clear", v: CAVES_VERSION, level: levelIx + 1, timeMs: Math.round(clearTime), kills: p.kills, secrets: secretsFound, bananas: p.bananas });
    }
  }
}

// Open cells within `depth` steps of (sx, sy) through floor and open doors.
function hearing(sx, sy, depth) {
  const start = sy * MW + sx, dist = new Map([[start, 0]]), q = [start];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], v = dist.get(i) + 1;
    if (v > depth) continue;
    for (const j of [i + 1, i - 1, i + MW, i - MW]) {
      if (dist.has(j)) continue;
      const c = map[(j / MW) | 0][j % MW];
      if (c === "." || (DOOR_CHARS.has(c) && (doors.get(j)?.open ?? 0) > 0.5)) { dist.set(j, v); q.push(j); }
    }
  }
  return dist;
}

// The nearest live enemy within `cone` radians of the crosshair, in sight, within `range`.
function assistTarget(cone, range) {
  const p = player, face = Math.atan2(p.dy, p.dx);
  let best = null, bestD = range;
  for (const e of things) {
    if (!isFoe(e) || e.hp <= 0 || e.dieAt) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d >= bestD) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x) - face;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > cone + 0.25 / Math.max(1, d)) continue;
    if (!lineOfSight(p.x, p.y, e.x, e.y)) continue;
    best = e; bestD = d;
  }
  return best;
}

// Tilt to aim (phones, off by default): fine aim on top of the thumb drag, the way
// mobile shooters do gyro. It only works while the right thumb is down (turn area or
// FIRE): lift it to bring the phone back to a comfy angle without turning, so nobody
// has to spin in their chair. A small wrist twist turns 1.8× as far, with a dead
// zone and smoothing so hand shake doesn't jitter the view. Uses the gyro's rotation
// rate (never drifts): yaw is the phone's long axis in portrait, short in landscape.
const TILT_GAIN = 1.8, TILT_DEADZONE = 3; // deg/s
let tiltRate = 0;
addEventListener("devicemotion", (e) => {
  if (!isTouch || !settings.tilt || state !== "play" || paused) return;
  if (turnId === null && !touch.fire) { tiltRate = 0; return; }
  const r = e.rotationRate; if (!r) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  const raw = ang === 90 ? -(r.beta || 0) : ang === 270 || ang === -90 ? (r.beta || 0) : -(r.gamma || 0);
  tiltRate = tiltRate * 0.55 + raw * 0.45;
  const mag = Math.abs(tiltRate) - TILT_DEADZONE;
  if (mag <= 0) return;
  const dt = Math.min(0.05, (e.interval || 16) / ((e.interval || 16) > 1 ? 1000 : 1));
  const sticky = settings.assist && assistTarget(0.07, 14) ? 0.55 : 1;
  turn(Math.sign(tiltRate) * mag * Math.PI / 180 * dt * TILT_GAIN * settings.sens * sticky);
});

// Chasing around walls: a distance-to-player field over the open floor, rebuilt
// when the player changes cell. An awake enemy that can't see you walks downhill on it.
let flow = new Int16Array(1), flowCell = -1;
function buildFlow() {
  const sx = Math.floor(player.x), sy = Math.floor(player.y), cell = sy * MW + sx;
  if (cell === flowCell && flow.length === MW * MH) return;
  flowCell = cell; flow = new Int16Array(MW * MH).fill(32767); flow[cell] = 0;
  const q = [cell];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], v = flow[i] + 1;
    if (v > 40) continue;
    for (const j of [i + 1, i - 1, i + MW, i - MW]) { const c = map[(j / MW) | 0][j % MW]; if (flow[j] > v && (c === "." || c === "d")) { flow[j] = v; q.push(j); } }
  }
}
const flowAt = (x, y) => { buildFlow(); return flow[Math.floor(y) * MW + Math.floor(x)]; };
function chase(e, dx, dy, d) {
  if (d < 1.5 || lineOfSight(e.x, e.y, player.x, player.y)) return [dx / d, dy / d];
  buildFlow();
  const cx = Math.floor(e.x), cy = Math.floor(e.y);
  let best = flow[cy * MW + cx], tx = null, ty = null;
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = flow[(cy + oy) * MW + cx + ox]; if (v < best) { best = v; tx = cx + ox + 0.5; ty = cy + oy + 0.5; } }
  if (tx === null) return [dx / d, dy / d];
  const nd = doors.get(Math.floor(ty) * MW + Math.floor(tx));
  if (nd && map[nd.y][nd.x] === "d" && nd.open < 1) openDoor(nd);
  const vx = tx - e.x, vy = ty - e.y, n = Math.hypot(vx, vy) || 1;
  return [vx / n, vy / n];
}

// The Big Tech crowd (caves-foes.js).
function move(e, mx, my) {
  if (!solidAt(e.x + mx * 2, e.y)) e.x += mx;
  if (!solidAt(e.x, e.y + my * 2)) e.y += my;
}
function bite(e, f) { hurtPlayer(dmg(f.hit), e); e.cool = f.cool; }
function foeAI(e, dx, dy, d, dt) {
  const f = FOES[e.kind], sp = f.speed * dt, [ux, uy] = e.kind === "eye" ? [dx / d, dy / d] : chase(e, dx, dy, d);
  if (e.kind === "cookie") {
    // Swarms straight at you and nibbles.
    if (d > 0.45) move(e, ux * sp, uy * sp);
    else if (e.cool <= 0) { bite(e, f); sfx.munch(); }
  } else if (e.kind === "bat") {
    // Zigzags in, faster once it's close.
    const zig = Math.sin(e.phase * 0.55) * 1.2, k = d < 3 ? 1.6 : 1;
    if (d > 0.55) move(e, (ux - uy * zig) * sp * k, (uy + ux * zig) * sp * k);
    else if (e.cool <= 0) bite(e, f);
  } else if (e.kind === "ad") {
    // Hangs back at range and fires X's; drifts in close enough to pop over your screen.
    const sees = lineOfSight(e.x, e.y, player.x, player.y);
    const want = d > 6 ? 1 : d < 3.5 ? -0.6 : 0, side = Math.sin(e.phase * 0.25);
    move(e, (ux * want - uy * side) * sp, (uy * want + ux * side) * sp);
    if (sees && d < f.range && e.cool <= 0) { e.cool = f.cool; sfx.pop(); spits.push({ x: e.x, y: e.y, vx: ux * 4.5, vy: uy * 4.5, life: 3, dmg: dmg(f.hit), spr: "xshot" }); }
    if (d < 1.8 && player.popup <= 0) { player.popup = 1.2; player.popupX = rnd(); sfx.pop(); }
  } else if (e.kind === "keeper") {
    // Turns slowly to keep its shield on you; walk around it and hit it from behind.
    const want = Math.atan2(dy, dx); let diff = want - e.face;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.face += Math.max(-f.turn * dt, Math.min(f.turn * dt, diff));
    if (d > 0.8 && Math.abs(diff) < 0.6) move(e, Math.cos(e.face) * sp, Math.sin(e.face) * sp);
    if (d < 1 && e.cool <= 0) bite(e, f);
  } else if (e.kind === "eye") {
    if (d < f.range && e.cool <= 0 && lineOfSight(e.x, e.y, player.x, player.y)) {
      e.cool = f.cool; sfx.beam(); spits.push({ x: e.x, y: e.y, vx: ux * 3.2, vy: uy * 3.2, life: 5, dmg: dmg(f.hit), spr: "beam" });
    }
  }
}

// The Banana Phone keeps its distance, side-steps, slings propaganda slime,
// whips you with its cable up close and taxes 30% of your bananas now and then.
function phoneAI(e, dx, dy, d, dt) {
  const p = player, bare = e.armour <= 0, ux = dx / d, uy = dy / d;
  const want = d > 4.5 ? 1 : d < 2.6 ? -1 : 0;
  const strafe = Math.sin(performance.now() / (bare ? 380 : 620));
  const sp = (bare ? 2.6 : 1.7) * dt;
  const mx = (ux * want - uy * strafe) * sp, my = (uy * want + ux * strafe) * sp;
  if (!wallAt(e.x + mx * 2, e.y)) e.x += mx;
  if (!wallAt(e.x, e.y + my * 2)) e.y += my;
  const sees = lineOfSight(e.x, e.y, p.x, p.y);
  e.spit -= dt; e.tax -= dt;
  if (sees && e.spit <= 0) {
    e.spit = bare ? 0.85 : 1.4; sfx.spit();
    const spread = bare ? [-0.18, 0, 0.18] : [0];
    for (const a of spread) { const c = Math.cos(a), s2 = Math.sin(a); spits.push({ x: e.x, y: e.y, vx: (ux * c - uy * s2) * 5, vy: (uy * c + ux * s2) * 5, life: 3 }); }
  }
  if (d < 1.2 && e.cool <= 0) { hurtPlayer(dmg(14), e, 0.4); e.cool = 1.2; }
  if (sees && e.tax <= 0) {
    e.tax = 9; const took = Math.floor(p.bananas * 0.3);
    if (took > 0) { p.bananas -= took; sfx.tax(); say("30% TAX", `The Banana Phone took ${took} bananas`); setTimeout(() => { if (state === "play") say(""); }, 1300); }
  }
}

const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtRun = (ms) => `${fmt(ms)}.${Math.floor((ms % 1000) / 100)}`;

// ── Automap: the walls you've seen, badge doors in colour, you as a yellow arrow ──
let showMap = false;
function drawMap(now) {
  const cs = Math.max(2, Math.floor(Math.min(W * 0.94 / MW, H * 0.86 / MH))), ox = (W - MW * cs) >> 1, oy = (H - MH * cs) >> 1;
  for (let i = 0; i < buf.length; i++) { const c = buf[i]; buf[i] = ((255 << 24) | (((c >>> 16) & 255) >> 2) << 16 | (((c >>> 8) & 255) >> 2) << 8 | ((c & 255) >> 2)) >>> 0; }
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (!seen[y * MW + x]) continue;
    const c = map[y][x]; if (c === ".") continue;
    const b = DOOR_BADGE[c] ? BADGES[DOOR_BADGE[c]].c : c === "D" ? [233, 22, 113] : c === "C" ? [120, 70, 90] : [110, 100, 130];
    const col = rgb(...b);
    for (let j = 0; j < cs; j++) for (let i = 0; i < cs; i++) buf[(oy + y * cs + j) * W + ox + x * cs + i] = col;
  }
  const px = ox + player.x * cs, py = oy + player.y * cs, blink = Math.floor(now / 250) % 2 ? rgb(255, 210, 63) : rgb(255, 255, 255);
  for (let k = 0; k < cs * 2.5; k += 0.5) { const x = Math.round(px + player.dx * k), y = Math.round(py + player.dy * k); if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = blink; }
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) buf[(Math.round(py) + j) * W + Math.round(px) + i] = blink;
}

// ── Render ──
function addLight(c, r, g, b) {
  return ((255 << 24) | Math.min(255, ((c >>> 16) & 255) + (b | 0)) << 16 | Math.min(255, ((c >>> 8) & 255) + (g | 0)) << 8 | Math.min(255, (c & 255) + (r | 0))) >>> 0;
}
// A shot: a soft glow in its colour, then the 8×8 shape over it.
function drawShot(s, x0, y0, size, tY) {
  const [r, g, b] = s.c, cx = x0 + size / 2, cy = y0 + size / 2, R = size * 1.7;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x++) {
    if (tY >= zbuf[x]) continue;
    const k = 0.55 * (1 - Math.hypot(x - cx, y - cy) / R); if (k > 0) buf[y * W + x] = addLight(buf[y * W + x], r * k, g * k, b * k);
  }
  const main = rgb(r, g, b), core = rgb(255, 255, 255), dark = rgb(r * 0.4, g * 0.4, b * 0.4);
  for (let x = Math.max(0, x0); x < Math.min(W, x0 + size); x++) {
    if (tY >= zbuf[x]) continue;
    const mx = Math.floor((x - x0) * 8 / size);
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + size); y++) {
      const m = s.mask[Math.floor((y - y0) * 8 / size)][mx];
      if (m === "1") buf[y * W + x] = main; else if (m === "2") buf[y * W + x] = core; else if (m === "3") buf[y * W + x] = dark;
    }
  }
}
function render() {
  // Whole pixels: on an odd-height canvas H / 2 lands between rows, and the floor rows
  // were then written half a row (= half the screen) to the side.
  const p = player, half = H >> 1, now = performance.now(), flowY = Math.floor(now / 90) & (TEX - 1);
  // floor + ceiling, row by row
  const r0x = p.dx - p.px, r0y = p.dy - p.py, r1x = p.dx + p.px, r1y = p.dy + p.py;
  for (let y = half + 1; y < H; y++) {
    const dist = half / (y - half);
    const sx = dist * (r1x - r0x) / W, sy = dist * (r1y - r0y) / W;
    let fx = p.x + dist * r0x, fy = p.y + dist * r0y;
    const f = fog(dist), yc = H - y - 1;
    for (let x = 0; x < W; x++) {
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = (TEX * (fx - ix)) & (TEX - 1), ty = (TEX * (fy - iy)) & (TEX - 1);
      const ci = iy * MW + ix, ok = ix >= 0 && iy >= 0 && ix < MW && iy < MH, l = ok ? Math.min(1, f * light[ci]) : f;
      const ft = ok ? floorAt[ci] : baseFloor;
      buf[y * W + x] = shade(ft[(ft === FLOORS.w ? (ty + flowY) & (TEX - 1) : ty) * TEX + tx], l);
      buf[yc * W + x] = shade((ok ? ceilAt[ci] : baseCeil)[ty * TEX + tx], l);
      fx += sx; fy += sy;
    }
  }
  for (const s of shots) s.c = shotColour(WEAPON.shot.color, now);
  // walls
  for (let x = 0; x < W; x++) {
    const cam = 2 * x / W - 1, rx = p.dx + p.px * cam, ry = p.dy + p.py * cam;
    let mx = Math.floor(p.x), my = Math.floor(p.y);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
    const stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1;
    let sdx = (rx < 0 ? p.x - mx : mx + 1 - p.x) * ddx, sdy = (ry < 0 ? p.y - my : my + 1 - p.y) * ddy;
    let side = 0, cell = null, doorHit = null;
    for (let i = 0; i < 160; i++) {
      if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; } else { sdy += ddy; my += sty; side = 1; }
      cell = map[my]?.[mx]; if (cell === ".") continue;
      if (DOOR_CHARS.has(cell)) {
        // Hit the door slab in the middle of the cell, unless the ray passes the open part.
        const d = doors.get(my * MW + mx);
        if (d) {
          const t = d.alongX ? (my + 0.5 - p.y) / ry : (mx + 0.5 - p.x) / rx;
          const hx = p.x + t * rx, hy = p.y + t * ry;
          if (t > 0 && Math.floor(hx) === mx && Math.floor(hy) === my) {
            const u = (d.alongX ? hx : hy) - (d.alongX ? mx : my);
            if (u >= d.open) { doorHit = { t, u: u - d.open }; break; }
          }
          continue;
        }
      }
      break;
    }
    if (mx >= 0 && my >= 0 && mx < MW && my < MH) seen[my * MW + mx] = 1;
    const perp = doorHit ? doorHit.t : side === 0 ? sdx - ddx : sdy - ddy;
    zbuf[x] = perp;
    const lh = Math.floor(H / perp);
    const top = Math.max(0, Math.floor(half - lh / 2)), bot = Math.min(H - 1, Math.floor(half + lh / 2));
    let wx = side === 0 ? p.y + perp * ry : p.x + perp * rx; wx -= Math.floor(wx);
    let tx = Math.floor(wx * TEX); if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = TEX - tx - 1;
    if (doorHit) tx = Math.min(TEX - 1, Math.floor(doorHit.u * TEX));
    const tex = TEXTURES[cell] || TEXTURES["#"];
    const hx = p.x + perp * rx, hy = p.y + perp * ry;
    const li = Math.floor(hy - ry * 0.02) * MW + Math.floor(hx - rx * 0.02);
    const f = Math.min(1, fog(perp) * (side ? 0.78 : 1) * (light[li] || 1)), step = TEX / lh;
    // Shots light up the wall they fly past, in their own colour.
    let lr = 0, lg = 0, lb = 0;
    for (const s of shots) { const k = 0.85 / (1 + ((s.x - hx) ** 2 + (s.y - hy) ** 2) * 2.2); if (k > 0.04) { lr += s.c[0] * k; lg += s.c[1] * k; lb += s.c[2] * k; } }
    let tpos = (top - half + lh / 2) * step;
    if (cell === "W") tpos -= (now / 30) % TEX;
    if (lr + lg + lb < 8) for (let y = top; y <= bot; y++) { buf[y * W + x] = shade(tex[((tpos & (TEX - 1)) * TEX) + tx], f); tpos += step; }
    else for (let y = top; y <= bot; y++) { buf[y * W + x] = addLight(shade(tex[((tpos & (TEX - 1)) * TEX) + tx], f), lr, lg, lb); tpos += step; }
  }
  // sprites, far to near
  const sprites = [];
  for (const t of things) {
    let spr, scale = 0.62, lift = 0;
    if (isFoe(t)) {
      // The Gatekeeper shows its back (no shield) once you're behind it.
      const behind = t.kind === "keeper" && Math.cos(t.face) * (p.x - t.x) + Math.sin(t.face) * (p.y - t.y) < 0;
      const set = t.kind === "phone" && t.armour > 0 ? SPR.phoneCase : behind ? SPR.keeperBack : SPR[t.kind];
      const fr = t.kind === "ad" ? Math.floor(now / 250) : t.kind === "eye" ? (Math.sin(t.phase * 0.2) > 0.9 ? 1 : 0) : Math.floor(t.phase || 0);
      spr = set[fr % 2]; if (t.kind === "bear") scale = 1.1; if (t.kind === "phone") scale = 0.7;
      if (FOES[t.kind]) { scale = FOES[t.kind].scale; lift = FOES[t.kind].lift || 0; if (t.kind === "bat") lift += Math.sin(t.phase * 0.4) * 0.05; }
    }
    else if (t.kind === "badge") { spr = SPR.badge[t.b]; scale = 0.42; lift = 0.12 + Math.sin(now / 300) * 0.04; }
    else if (t.kind === "ammo") { spr = t.big ? SPR.ammoBig : SPR.ammo; scale = 0.4; }
    else if (t.kind === "decor") { spr = SPR[t.d]; scale = t.d === "tree" ? 1.05 : t.d === "torch" ? 0.7 : 0.38; }
    else if (t.kind === "idol") { spr = SPR.idol; scale = 0.42; lift = 0.06 + Math.sin(now / 350) * 0.03; }
    else if (t.kind === "health" && t.big) { spr = SPR.healthBig; scale = 0.42; }
    else { spr = SPR[t.kind]; scale = 0.4; }
    sprites.push({ x: t.x, y: t.y, spr, scale, lift, flash: t.flash > 0, dying: !!t.dieAt });
  }
  for (const s of shots) sprites.push({ x: s.x, y: s.y, mask: SHOT, c: s.c, scale: 0.14, lift: 0.24 });
  for (const s of spits) sprites.push({ x: s.x, y: s.y, spr: s.spr ? SPR[s.spr] : SLIME, scale: s.spr ? 0.32 : 0.4, lift: s.spr ? 0.22 : 0.1 });
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
    if (s.mask) { drawShot(s, x0, y0, size, tY); continue; }
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
  if (player.flash > 0) { const c = shotColour(WEAPON.shot.color, now); for (let y = H - 70; y < H; y++) for (let x = (W >> 1) - 40; x < (W >> 1) + 50; x++) { const k = 0.5 * (1 - Math.hypot(x - W / 2 - 6, y - H + 40) / 60); if (k > 0) buf[y * W + x] = addLight(buf[y * W + x], c[0] * k, c[1] * k, c[2] * k); } }
  const G = 3, gx = Math.round(W / 2 - GUN.w * G / 2 + 8), gy = H - GUN.h * G + 8 + Math.round(player.kick * 10 + bob);
  for (let y = 0; y < GUN.h; y++) for (let x = 0; x < GUN.w; x++) {
    const c = GUN.data[y * GUN.w + x]; if (!c) continue;
    for (let yy = 0; yy < G; yy++) for (let xx = 0; xx < G; xx++) {
      const px = gx + x * G + xx, py = gy + y * G + yy;
      if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = c;
    }
  }
  if (player.slime > 0) {
    const k = Math.min(1, player.slime) * 0.55;
    for (let i = 0; i < buf.length; i++) { const c = buf[i], x = i % W, y = (i / W) | 0; const drip = ((x * 7 + (y >> 2) * 13) % 23 === 0) || ((x >> 3) % 5 === 2 && y < (40 + ((x * 37) % 50)) * Math.min(1, player.slime)); const kk = drip ? Math.min(0.9, k * 1.8) : k;
      buf[i] = ((255 << 24) | Math.round(((c >>> 16) & 255) * (1 - kk) + 40 * kk) << 16 | Math.round(((c >>> 8) & 255) * (1 - kk) + 220 * kk) << 8 | Math.round((c & 255) * (1 - kk) + 50 * kk)) >>> 0; }
  }
  if (player.hurt > 0) for (let i = 0; i < buf.length; i += 1) { const c = buf[i]; buf[i] = ((255 << 24) | ((c >>> 16) & 255) * 0.6 << 16 | ((c >>> 8) & 255) * 0.6 << 8 | Math.min(255, (c & 255) + 70)) >>> 0; }
  if (boss && boss.hp > 0 && boss.seen) {
    const bw = Math.floor(W * 0.6), bx = (W - bw) >> 1, fill = Math.floor(bw * boss.hp / boss.max);
    for (let y = 6; y < 11; y++) for (let x = bx - 1; x <= bx + bw; x++) buf[y * W + x] = x - bx < fill && x >= bx && y > 6 && y < 10 ? rgb(235, 60, 80) : rgb(20, 16, 28);
  }
  // A Pop-up Ad up close covers part of the screen for a moment.
  if (player.popup > 0) {
    const bw = Math.floor(W * 0.55), bh = Math.floor(H * 0.42), bx = Math.floor((W - bw) * player.popupX), by = Math.floor(H * 0.18);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      const edge = x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1, bar = y < by + 10, close = bar && x > bx + bw - 11;
      const stripe = y > by + bh * 0.35 && y < by + bh * 0.6 && ((x - bx) >> 3) % 2;
      buf[y * W + x] = edge ? rgb(16, 14, 20) : close ? rgb(225, 50, 60) : bar ? rgb(44, 96, 210) : stripe ? rgb(255, 210, 63) : rgb(245, 245, 250);
    }
  }
  if (showMap) drawMap(now);
  // Crosshair in the shot colour, dimmed.
  if (state === "play") { const c = shotColour(WEAPON.shot.color, now), cx = W >> 1, cy = H >> 1; for (const [x, y] of [[-3, 0], [-2, 0], [2, 0], [3, 0], [0, -3], [0, -2], [0, 2], [0, 3]]) buf[(cy + y) * W + cx + x] = addLight(buf[(cy + y) * W + cx + x], c[0] * 0.7, c[1] * 0.7, c[2] * 0.7); }
  // Low health: a red pulse at the edges.
  if (state === "play" && player.hp > 0 && player.hp < 30) {
    const k = 0.35 + 0.25 * Math.sin(now / 180);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const e = Math.min(x, W - 1 - x, y, H - 1 - y); if (e < 14) { const kk = k * (1 - e / 14); buf[y * W + x] = addLight(buf[y * W + x], 255 * kk, 0, 0); } }
  }
  ctx.putImageData(frame, 0, 0);

  $("hp").textContent = Math.max(0, Math.round(player.hp));
  $("ammo").textContent = player.ammo;
  $("bananas").textContent = player.bananas;
  $("clock").textContent = fmtRun(state === "play" ? runTime() : clearTime);
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
loadImage(imageFor(n)).then(readGrid).then(setFace).catch(() => { /* face stays blank */ });
equip(n);
loadLevel();
const swatch = (c) => c === "rainbow" ? "linear-gradient(90deg,#f44,#fd4,#4f6,#4cf,#a4f)" : c;
card("MONKECAVES", [
  `<div class="dim">MONKE #${n}</div>`,
  `<div class="weapon"><i style="background:${swatch(WEAPON.shot.color)}"></i>${WEAPON.name}</div>`,
  `<div class="dim">${LEVELS.length} caves · hunt the jeets · find the pink exit<br>The Banana Phone waits at the end.</div>`,
  `<div class="cta">${isTouch ? "Tap FIRE" : "Space"} to start</div>`,
]);
document.getElementById("fire").style.background = WEAPON.shot.color === "rainbow" ? swatch("rainbow") : WEAPON.shot.color;
setTimeout(() => document.getElementById("help").classList.add("gone"), 6000);

function startCave(keepLoadout) {
  loadLevel(keepLoadout); state = "play"; t0 = 0;
  say(LEVELS[levelIx].name, `Cave ${levelIx + 1} of ${LEVELS.length} · the clock starts when you move`);
  setTimeout(() => { if (state === "play") say(""); }, 2200);
}

// ── Pause: button, P / Esc, or leaving the app. The clock stops while paused. ──
const menu = document.getElementById("menu");
function setPaused(on) {
  if (on === !!paused || (on && state !== "play")) return;
  if (on) { paused = performance.now(); touch.fire = false; keys.clear(); document.exitPointerLock?.(); }
  else { if (t0) t0 += performance.now() - paused; paused = 0; }
  menu.hidden = !on;
}
document.getElementById("pause").addEventListener("pointerdown", (e) => { e.stopPropagation(); setPaused(true); });
addEventListener("keydown", (e) => { if (e.code === "KeyP" || e.code === "Escape") setPaused(!paused); if (e.code === "KeyM" || e.code === "Tab") { e.preventDefault(); showMap = !showMap; } });
document.getElementById("mapbtn").addEventListener("pointerdown", (e) => { e.stopPropagation(); showMap = !showMap; });
document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
const sensEl = document.getElementById("m-sens"), sensVal = document.getElementById("m-sensv");
sensEl.value = String(settings.sens); sensVal.textContent = `${settings.sens.toFixed(1)}×`;
sensEl.addEventListener("input", () => { settings.sens = parseFloat(sensEl.value); sensVal.textContent = `${settings.sens.toFixed(1)}×`; store.set("sens", String(settings.sens)); });
const toggle = (id, key, label, storeKey = key, onHint = "") => {
  const el = document.getElementById(id), show = () => { el.textContent = `${label}: ${settings[key] ? "on" : "off"}`; };
  show(); el.addEventListener("click", () => {
    settings[key] = !settings[key]; store.set(storeKey, settings[key] ? "1" : "0"); show();
    if (settings[key] && onHint) { el.textContent = onHint; setTimeout(show, 2600); }
  });
};
toggle("m-assist", "assist", "Aim assist");
toggle("m-tilt", "tilt", "Tilt to aim", "tilt2", "Tilts while your right thumb is down");
if (!isTouch) for (const id of ["m-assist", "m-tilt", "m-sensrow"]) document.getElementById(id).hidden = true;
const soundBtn = document.getElementById("m-sound");
const showSound = () => { soundBtn.textContent = muted ? "Sound: off" : "Sound: on"; };
showSound();
soundBtn.addEventListener("click", () => { muted = !muted; store.set("muted", muted ? "1" : "0"); showSound(); });
document.getElementById("m-resume").addEventListener("click", () => setPaused(false));
document.getElementById("m-restart").addEventListener("click", () => { setPaused(false); startCave(levelIx > 0); });

let last = performance.now();
// Test hooks only with ?debug=1 (headless playtests); never on a normal page.
if (params.has("debug")) window.__caves = { player, things, shots, spits, keys, touch, turn, step: (dt) => update(dt), map, get door() { return door; }, get level() { return levelIx; }, get weapon() { return WEAPON; }, get state() { return state; }, get totals() { return totals; }, get secrets() { return [secretsFound, secrets]; }, blocked: (x, y) => blockers.has(y * MW + x), wallAt, settings, assistTarget, frames: 0, goto(i) { levelIx = i; loadLevel(); state = "play"; t0 = performance.now(); say(""); } };
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); if (window.__caves) window.__caves.frames++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
