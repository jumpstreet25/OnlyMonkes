// MonkeCaves Walled Garden world (cave 4): Big Tech's spotless fenced-in paradise.
// Everything is free, except leaving. Same shape as caves-world.js / caves-tech.js:
// painters return [r, g, b] for a 32×32 texture, rnd is caves.js's seeded random.
// A level with theme "garden" uses these.
//
// Walls: # glossy white wall panels  S secret (a panel with a tiny banana sticker)
//        V trimmed hedge  T app-icon wall (notification dots blink)  Z iron fence bars
//        W fountain cascade (flows)  d frosted glass sliding door
// Floors (level `floor` rows): l striped lawn  p white paving  f fountain water (flows)
//        e red rubber running track
// Ceiling (level `ceil` rows): o the fake sky (a screen: blue, clouds, pixel grid),
//        anything else white ceiling with recessed lights

const n = (rnd, a = 0.75) => a + rnd() * (1 - a);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// Every pattern repeats in 32 (see caves-world.js): periods of 2, 4, 8, 16 or 32 only.
const TAU = Math.PI * 2 / 32;

const white = (x, y, rnd) => {
  const u = x % 16, v = y % 32;
  if (u === 0 || v === 0) return [150, 156, 166];
  if (u === 1 || v === 1) return [250, 252, 255];
  const k = n(rnd, 0.96), sheen = 1 - Math.abs(u - 8) / 40;
  return [222 * k * sheen, 226 * k * sheen, 232 * k * sheen];
};

const hedge = (x, y, rnd) => {
  const k = n(rnd, 0.55), leaf = rnd() < 0.25;
  if (y >= 29) return [70, 56, 40]; // soil line at the foot
  const clip = y < 2 ? 1.25 : 1;    // freshly trimmed top
  return leaf ? [80 * k * clip, 170 * k * clip, 70 * k * clip] : [36 * k * clip, 112 * k * clip, 44 * k * clip];
};

const ICON = [[60, 140, 255], [255, 80, 110], [255, 196, 50], [70, 210, 120], [170, 90, 255], [40, 200, 220], [255, 130, 40], [120, 130, 150]];
// App icons in a grid, rounded corners, some with a red notification dot (`f` blinks them).
const apps = (f) => (x, y, rnd) => {
  const u = x % 16, v = y % 16, i = (x >> 4) + (y >> 4) * 2, c = ICON[(i * 3 + 1) % 8];
  const inIcon = u >= 2 && u <= 13 && v >= 2 && v <= 13 && !((u === 2 || u === 13) && (v === 2 || v === 13));
  if (!inIcon) return [235, 238, 244];
  const dot = (i + f) % 3 === 0 && Math.hypot(u - 12.5, v - 3.5) < 2.2;
  if (dot) return [255, 40, 50];
  const k = n(rnd, 0.92), glyph = Math.hypot(u - 7.5, v - 7.5) < 3.2 && Math.hypot(u - 7.5, v - 7.5) > 1.8;
  return glyph ? [250, 250, 255] : mix(c, [255, 255, 255], v < 6 ? 0.15 : 0).map((q) => q * k);
};

export const GARDEN_WALL_PAINT = {
  "#": white,
  S: (x, y, rnd) => {
    const p = white(x, y, rnd);
    const bx = x - 22, by = y - 10, mark = Math.abs(Math.hypot(bx, by + 4) - 4) < 0.9 && by > -2 && Math.abs(bx) < 4;
    return mark ? mix(p, [255, 200, 40], 0.7) : p;
  },
  V: hedge,
  T: apps(0),
  Z: (x, y, rnd) => {
    // Black iron bars with spear tips, lawn green behind (you can't get through).
    const bar = x % 8 === 3 || x % 8 === 4, rail = y === 6 || y === 26, tip = y < 4 && Math.abs((x % 8) - 3.5) < 2 - y * 0.4;
    if (bar || rail || tip) return x % 8 === 3 ? [70, 72, 80] : [24, 24, 28];
    const k = n(rnd, 0.7);
    return y > 20 ? [50 * k, 130 * k, 60 * k] : [120 * k, 190 * k, 230 * k];
  },
  W: (x, y, rnd) => {
    const k = n(rnd, 0.75), streak = (x * 5) % 8 < 2 || ((x * 3 + y) % 16 === 0);
    return streak ? [235, 250, 255] : [90 * k, 190 * k, 240 * k];
  },
  d: (x, y, rnd) => {
    if (x < 2 || x > 29 || y < 2) return [200, 204, 212];
    if (y === 16) return [170, 176, 186];
    const k = n(rnd, 0.95), frost = (x + y * 3) % 8 === 0 ? 1.06 : 1;
    return [190 * k * frost, 214 * k * frost, 228 * k * frost];
  },
};

export const GARDEN_WALL_FRAMES = { T: [apps(0), apps(1), apps(2)] };

export const GARDEN_FLOOR_PAINT = {
  l: (x, y, rnd) => {
    // Mowed in perfect stripes.
    const k = n(rnd, 0.82), stripe = (x >> 3) % 2 === 0;
    return stripe ? [86 * k, 180 * k, 76 * k] : [64 * k, 150 * k, 58 * k];
  },
  p: (x, y, rnd) => {
    const u = x % 16, v = y % 16, k = n(rnd, 0.92);
    if (u === 0 || v === 0) return [170, 172, 176];
    return [226 * k, 226 * k, 222 * k];
  },
  f: (x, y, rnd) => {
    const k = n(rnd, 0.85), wave = Math.sin((x + y) * TAU * 2) + Math.sin((x - y) * TAU * 3) * 0.6;
    if (wave > 1.3) return [235, 250, 255];
    return wave > 0.6 ? [90 * k, 200 * k, 235 * k] : [50 * k, 150 * k, 210 * k];
  },
  e: (x, y, rnd) => {
    const k = n(rnd, 0.85);
    if (x % 16 === 0) return [240, 240, 240];
    return [176 * k, 64 * k, 52 * k];
  },
};

// The fake sky is a screen: blue, soft clouds, and the pixel grid if you look closely.
export const GARDEN_SKY_PAINT = (x, y, rnd) => {
  if (x % 8 === 0 || y % 8 === 0) return [96, 150, 220];
  const cloud = Math.sin(x * TAU) + Math.sin(y * TAU * 2 + 1) * 0.7 + Math.sin((x + y) * TAU) * 0.5;
  const k = 0.96 + rnd() * 0.04;
  return cloud > 1.2 ? [235 * k, 242 * k, 250 * k] : [110 * k, 176 * k, 245 * k];
};
export const GARDEN_CEIL_PAINT = (x, y, rnd) => {
  const u = x % 16, v = y % 16;
  if (Math.hypot(u - 8, v - 8) < 3) return [255, 250, 230];
  if (u === 0 || v === 0) return [180, 184, 192];
  const k = n(rnd, 0.95);
  return [214 * k, 216 * k, 222 * k];
};

// Bright and clinical: even the halls are lit.
export const GARDEN_LIGHT = { sky: 1.18, rock: 0.92 };

// Decorations (16×16). Y topiary and F lamp post block your way; M flower bed doesn't.
export const GARDEN_DECOR_PAL = {
  k: [16, 16, 20], g: [80, 170, 70], G: [40, 110, 44], w: [245, 246, 250], W: [190, 194, 204], y: [255, 236, 150],
  r: [255, 80, 110], o: [255, 196, 50], p: [170, 90, 255], t: [150, 96, 60],
};
export const GARDEN_DECOR_ROWS = {
  topiary: [
    "................", ".....kkkkkk.....", "....kggGgggk....", "...kgGggggGgk...", "...kggggGgggk...", "...kgGgggggGk...",
    "....kgggGggk....", ".....kkkkkk.....", ".......kk.......", ".......kt.......", ".......kt.......", ".....kkkkkk.....",
    ".....kWWWWk.....", ".....kwwwwk.....", ".....kwwwwk.....", "......kkkk......",
  ],
  lamppost: [
    "................", ".....kkkkkk.....", ".....kyyyyk.....", ".....kyyyyk.....", "......kkkk......", ".......Wk.......",
    ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......",
    ".......Wk.......", "......kWWk......", ".....kkWWkk.....", "................",
  ],
  flowers: [
    "................", "................", "................", "................", "................", "................",
    "................", "................", "..r..o...p..r...", ".rgr.ogo.pgp.rgr", "..g...g...g..g..", ".ggG.gGg.gGg.gGg",
    "kkkkkkkkkkkkkkkk", "kttttttttttttttk", "kkkkkkkkkkkkkkkk", "................",
  ],
};
export const GARDEN_DECOR_LETTERS = { Y: "topiary", F: "lamppost", M: "flowers", I: "idol" };
