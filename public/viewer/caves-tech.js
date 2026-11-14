// MonkeCaves Data Center world (cave 3): Big Tech's server farm, dug in under the jungle,
// where everything they track about you is stored. Same shape as caves-world.js:
// painters return [r, g, b] for a 32×32 texture, rnd is caves.js's seeded random.
// A level with theme "tech" uses these instead of the jungle set.
//
// Walls: # steel wall panels  S secret (a panel with a tiny banana sticker, the only hint)
//        T server racks (LEDs blink)  Z cable bundles  V cooling fan (spins)
//        W coolant falls (flows, like the waterfall)  d hazard-striped blast door
// Floors (level `floor` rows): r raised floor tiles  x steel grate  k cold-aisle tiles
//        c coolant (flows)
// Ceiling (level `ceil` rows): o light panels (bright), anything else dark ceiling tiles

const n = (rnd, a = 0.75) => a + rnd() * (1 - a);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// Every pattern repeats in 32 (see caves-world.js): periods of 2, 4, 8, 16 or 32 only.
const TAU = Math.PI * 2 / 32;

const panel = (x, y, rnd) => {
  const u = x % 16, v = y % 16;
  if (u === 0 || v === 0) return [26, 30, 38];
  if (u === 15 || v === 15) return [44, 50, 62];
  if ((u === 3 || u === 12) && (v === 3 || v === 12)) return [150, 160, 176];
  if (y === 24 && u > 1 && u < 15) return [70, 210, 235]; // a thin LED strip
  const k = n(rnd, 0.86), brush = (x * 5) % 8 < 1 ? 0.92 : 1;
  return [74 * k * brush, 80 * k * brush, 94 * k * brush];
};

// A server rack: 1U units, vent holes, drive bays, status LEDs. `f` is the blink frame.
const rack = (f) => (x, y, rnd) => {
  if (x < 2 || x > 29) return x === 0 || x === 31 ? [10, 10, 14] : [34, 36, 42];
  const unit = y >> 2, row = y & 3;
  if (row === 0) return [10, 11, 14];
  const k = n(rnd, 0.88);
  if (row === 2 && (x === 4 || x === 6 || x === 8)) {
    const led = (x - 4) >> 1, on = (unit * 7 + led * 3 + f * 5 + (unit * led) % 3) % 4 !== 0;
    if (!on) return [26, 34, 28];
    return (unit + led) % 5 === 0 ? [255, 176, 40] : [70, 255, 130];
  }
  if (x >= 18 && x <= 27 && row !== 0) return (x - 18) % 3 === 2 ? [16, 18, 22] : [58 * k, 62 * k, 72 * k];
  if (row === 2 && x > 10 && x < 16 && x % 2 === 0) return [18, 20, 24];
  return [42 * k, 46 * k, 54 * k];
};

const CABLES = [[40, 110, 230], [240, 200, 50], [220, 60, 60], [60, 190, 90], [140, 144, 150], [36, 36, 42], [240, 120, 40], [150, 80, 220]];

// A cooling fan in a grille; `f` turns the blades.
const fan = (f) => (x, y, rnd) => {
  if (x < 2 || x > 29 || y < 2 || y > 29) return [30, 34, 40];
  const cx = x - 15.5, cy = y - 15.5, r = Math.hypot(cx, cy);
  if (r > 13.5) return y % 4 === 0 ? [20, 22, 26] : [58, 62, 70];
  if (r > 12.3) return [90, 96, 108];
  if (r < 3) return r < 1.6 ? [200, 210, 220] : [70, 74, 84];
  const a = Math.atan2(cy, cx) + f * Math.PI / 6 + r * 0.09;
  const blade = Math.cos(a * 4) > 0.35;
  const k = n(rnd, 0.9);
  return blade ? [120 * k, 128 * k, 140 * k] : [14, 16, 20];
};

export const TECH_WALL_PAINT = {
  "#": panel,
  S: (x, y, rnd) => {
    const p = panel(x, y, rnd);
    // A tiny banana sticker on one panel: look closely.
    const bx = x - 22, by = y - 9, mark = Math.abs(Math.hypot(bx, by + 4) - 4) < 0.9 && by > -2 && Math.abs(bx) < 4;
    return mark ? mix(p, [255, 210, 63], 0.6) : p;
  },
  T: rack(0),
  Z: (x, y, rnd) => {
    const i = x >> 2, c = CABLES[i % 8], w = x & 3, k = n(rnd, 0.9);
    if (y % 16 === 8) return [210, 210, 214]; // zip ties
    if (w === 0) return [10, 10, 12];
    const shine = w === 1 ? 1.25 : w === 3 ? 0.7 : 1;
    return c.map((v) => Math.min(255, v * shine * k * (0.92 + 0.08 * Math.sin(y * TAU * 4))));
  },
  V: fan(0),
  W: (x, y, rnd) => {
    const k = n(rnd, 0.7), streak = (x * 5) % 8 < 2 || ((x * 3 + y) % 16 === 0);
    return streak ? [190 * k, 255, 245] : [30 * k, 160 * k, 180 * k];
  },
  d: (x, y, rnd) => {
    const k = n(rnd, 0.88);
    if (y < 4 || y > 27) return (x + y) % 8 < 4 ? [250, 200, 40] : [20, 20, 22];
    if (y > 9 && y < 14 && x > 8 && x < 23) return y === 10 ? [120, 200, 240] : [30, 70, 100];
    if (x % 16 === 0) return [36, 40, 48];
    return [96 * k, 100 * k, 110 * k];
  },
};

// Walls that animate: caves.js picks a frame from the clock and the cell, so racks
// don't all blink together.
export const TECH_WALL_FRAMES = {
  T: [rack(0), rack(1), rack(2)],
  V: [fan(0), fan(1), fan(2)],
};

export const TECH_FLOOR_PAINT = {
  r: (x, y, rnd) => {
    const u = x % 16, v = y % 16, k = n(rnd, 0.82);
    if (u === 0 || v === 0) return [30, 32, 38];
    const vented = ((x >> 4) + (y >> 4)) % 2 === 0;
    if (vented && u % 4 === 2 && v % 4 === 2) return [36, 40, 46];
    return [84 * k, 88 * k, 96 * k];
  },
  x: (x, y, rnd) => {
    const k = n(rnd, 0.85);
    if (x % 4 === 0 || y % 4 === 0) return [70 * k, 74 * k, 82 * k];
    return [14, 15, 18];
  },
  k: (x, y, rnd) => {
    const u = x % 16, v = y % 16, k = n(rnd, 0.85);
    if (u === 0 || v === 0) return [24, 34, 52];
    if (u % 4 === 2 && v % 4 === 2) return [20, 40, 70];
    return [60 * k, 96 * k, 140 * k];
  },
  c: (x, y, rnd) => {
    // Glowing coolant; caves.js scrolls it so it flows.
    const k = n(rnd, 0.85), wave = Math.sin((x + y) * TAU * 2) + Math.sin((x - y) * TAU * 3) * 0.6;
    if (wave > 1.3) return [200, 255, 250];
    return wave > 0.6 ? [40 * k, 200 * k, 200 * k] : [20 * k, 130 * k, 150 * k];
  },
};

// Ceiling: light panels where the room is lit, dark tiles with a cable tray elsewhere.
export const TECH_LIGHT_PANEL = (x, y, rnd) => {
  const u = x % 16, v = y % 16;
  if (u === 0 || v === 0) return [58, 62, 72];
  const k = 0.95 + rnd() * 0.05, line = v % 4 === 0 ? 0.88 : 1;
  return [196 * k * line, 206 * k * line, 224 * k * line];
};
export const TECH_CEIL_PAINT = (x, y, rnd) => {
  const u = x % 16, v = y % 16, k = n(rnd, 0.75);
  if (u === 0 || v === 0) return [12, 13, 16];
  if (x >= 12 && x <= 19) return x === 12 || x === 19 ? [50, 52, 58] : y % 4 === 0 ? [36, 38, 44] : [20, 22, 26];
  return [32 * k, 34 * k, 40 * k];
};

// Lit rooms are brighter than the dark halls; lamps warm everything near them.
export const TECH_LIGHT = { sky: 1.15, rock: 0.72 };

// Decorations (16×16). Y server cabinet and F light pylon block your way; M terminal doesn't.
export const TECH_DECOR_PAL = {
  k: [12, 12, 16], S: [60, 64, 74], s: [96, 102, 116], g: [70, 255, 130], o: [255, 176, 40], w: [235, 240, 250],
  c: [90, 230, 255], C: [40, 150, 200], b: [24, 60, 110], B: [50, 120, 200], r: [255, 60, 70],
};
export const TECH_DECOR_ROWS = {
  cabinet: [
    "..kkkkkkkkkkkk..", ".ksssssssssssssk", ".kSkkkkkkkkkkkSk", ".kSkgkokkSSSkkSk", ".kSkkkkkkkkkkkSk", ".kSkokgkkSSSkkSk",
    ".kSkkkkkkkkkkkSk", ".kSkgkgkkSSSkkSk", ".kSkkkkkkkkkkkSk", ".kSkgkokkSSSkkSk", ".kSkkkkkkkkkkkSk", ".kSkkgkkkSSSkkSk",
    ".kSkkkkkkkkkkkSk", ".kSSSSSSSSSSSSSk", ".kkkkkkkkkkkkkkk", "..kk........kk..",
  ],
  pylon: [
    "................", "......kkkk......", ".....kcwwck.....", ".....kcwwck.....", ".....kCccCk.....", ".....kCccCk.....",
    ".....kCccCk.....", ".....kCccCk.....", ".....kCccCk.....", ".....kCccCk.....", ".....kCccCk.....", "......kSSk......",
    "......kSSk......", ".....kSSSSk.....", "....kkkkkkkk....", "................",
  ],
  terminal: [
    "................", "................", "................", "................", "...kkkkkkkkkk...", "...kbBBBBBBbk...",
    "...kBwwBrBBBk...", "...kBBBBBBBBk...", "...kBwBwwBBBk...", "...kbBBBBBBbk...", "...kkkkkkkkkk...", "......kSSk......",
    "......kSSk......", ".....kSSSSk.....", "....kkkkkkkk....", "................",
  ],
};
export const TECH_DECOR_LETTERS = { Y: "cabinet", F: "pylon", M: "terminal", I: "idol" };
