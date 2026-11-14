// MonkeCaves Big Tech HQ world (cave 5): the tower itself. Black glass, marble lobby,
// cubicle farms, ad screens that never stop, and the Banana Phone waiting on the roof.
// Same shape as caves-world.js / caves-tech.js / caves-garden.js: painters return [r, g, b]
// for a 32×32 texture, rnd is caves.js's seeded random. A level with theme "hq" uses these.
//
// Walls: # black glass curtain wall (window grid, city lights)  S secret (a glass panel
//        with a banana sticker)  T giant ad screen (animated: the engagement chart climbs)
//        V walnut executive panelling  Z grey cubicle partition  W brushed-steel elevator doors
//        d glass security turnstile door
// Floors (level `floor` rows): u white marble  t grey office carpet  y boardroom walnut
//        z rooftop concrete (yellow safety line)
// Ceiling (level `ceil` rows): o night sky over the roof (stars, a moon-ish glow),
//        anything else office ceiling tiles with strip lights

const n = (rnd, a = 0.75) => a + rnd() * (1 - a);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// Every pattern repeats in 32 (see caves-world.js): periods of 2, 4, 8, 16 or 32 only.
const TAU = Math.PI * 2 / 32;

const glass = (x, y, rnd) => {
  const u = x % 16, v = y % 32;
  if (u === 0 || v === 0) return [70, 74, 86];             // mullions
  const k = n(rnd, 0.9), sheen = (x + y) % 32 < 3 ? 1.8 : 1;
  const city = rnd() < 0.035 ? [255, 214, 120] : null;      // a lit window across the street
  if (city) return city;
  return [18 * k * sheen, 22 * k * sheen, 34 * k * sheen];
};

// The engagement chart: bars climb, an arrow points up, the colours shout. `f` moves it.
const screen = (f) => (x, y, rnd) => {
  if (x < 1 || x > 30 || y < 1 || y > 30) return [12, 12, 16];
  const k = n(rnd, 0.93);
  if (y < 7) return (x + f * 4) % 16 < 8 ? [233, 22, 113] : [255, 210, 63];      // ticker strip
  const bar = x >> 2, h = 6 + ((bar * 5 + f * 3) % 18);
  if (x % 4 !== 0 && 30 - y < h) return mix([60, 200, 255], [120, 255, 160], (30 - y) / 24).map((q) => q * k);
  return [20 * k, 24 * k, 44 * k];
};

export const HQ_WALL_PAINT = {
  "#": glass,
  S: (x, y, rnd) => {
    const p = glass(x, y, rnd);
    const bx = x - 22, by = y - 10, mark = Math.abs(Math.hypot(bx, by + 4) - 4) < 0.9 && by > -2 && Math.abs(bx) < 4;
    return mark ? mix(p, [255, 200, 40], 0.85) : p;
  },
  T: screen(0),
  V: (x, y, rnd) => {
    const k = n(rnd, 0.85), grain = Math.sin(y * TAU * 4 + Math.sin(x * TAU) * 2) * 0.12;
    if (x % 16 === 0) return [50, 30, 18];
    return [118 * k * (1 + grain), 70 * k * (1 + grain), 40 * k * (1 + grain)];
  },
  Z: (x, y, rnd) => {
    if (y < 3) return [190, 192, 198];                      // aluminium cap
    const k = n(rnd, 0.7), weave = (x + y) % 2 === 0 ? 1.06 : 0.96;
    return [120 * k * weave, 124 * k * weave, 132 * k * weave];
  },
  W: (x, y, rnd) => {
    if (x === 15 || x === 16) return [40, 42, 48];          // the seam between the doors
    if (y < 3) return x > 12 && x < 19 ? [255, 210, 63] : [60, 62, 70]; // floor indicator
    const k = n(rnd, 0.9), brush = (y * 7 + x) % 4 === 0 ? 1.08 : 1;
    return [176 * k * brush, 180 * k * brush, 188 * k * brush];
  },
  d: (x, y, rnd) => {
    if (x < 2 || x > 29 || y < 2) return [60, 64, 74];
    if (y > 14 && y < 18) return [233, 22, 113];            // badge-reader stripe
    const k = n(rnd, 0.95);
    return [110 * k, 140 * k, 160 * k];
  },
};

export const HQ_WALL_FRAMES = { T: [screen(0), screen(1), screen(2), screen(3)] };

export const HQ_FLOOR_PAINT = {
  u: (x, y, rnd) => {
    const k = n(rnd, 0.94), vein = Math.abs(Math.sin((x * 2 + y) * TAU) + Math.sin(y * TAU * 2) * 0.5) < 0.08;
    if (x % 16 === 0 || y % 16 === 0) return [200, 200, 204];
    return vein ? [170, 170, 178] : [236 * k, 236 * k, 238 * k];
  },
  t: (x, y, rnd) => {
    const k = n(rnd, 0.82), tile = ((x >> 3) + (y >> 3)) % 2 === 0 ? 1 : 0.92;
    return [92 * k * tile, 96 * k * tile, 108 * k * tile];
  },
  y: (x, y, rnd) => {
    const k = n(rnd, 0.85), grain = Math.sin(x * TAU * 8 + Math.sin(y * TAU) * 3) * 0.1;
    if (y % 8 === 0) return [60, 36, 20];
    return [132 * k * (1 + grain), 82 * k * (1 + grain), 46 * k * (1 + grain)];
  },
  z: (x, y, rnd) => {
    // Rooftop concrete slabs, a worn yellow safety line along one edge of each.
    const k = n(rnd, 0.85);
    if (x % 32 === 0 || y % 32 === 0) return [44, 46, 50];
    if (y % 32 >= 2 && y % 32 <= 3 && (x >> 2) % 2 === 0) return [220 * k, 180 * k, 50 * k];
    return [72 * k, 74 * k, 78 * k];
  },
};

export const HQ_SKY_PAINT = (x, y, rnd) => {
  const glow = Math.max(0, 1 - Math.hypot((x % 32) - 16, (y % 32) - 16) / 22);
  if (rnd() < 0.02) return [240, 240, 255];
  return mix([10, 12, 30], [60, 40, 90], glow * 0.5);
};
export const HQ_CEIL_PAINT = (x, y, rnd) => {
  const u = x % 16, v = y % 32;
  if (u >= 6 && u <= 9 && v > 2 && v < 29) return [250, 252, 255];   // strip light
  if (u === 0 || v === 0) return [150, 150, 156];
  const k = n(rnd, 0.94);
  return [196 * k, 198 * k, 202 * k];
};

// Offices are lit for 24/7 productivity; the roof is night.
export const HQ_LIGHT = { sky: 0.8, rock: 0.95 };

// Decorations (16×16). Y potted plant and F logo pylon block your way; M water cooler doesn't.
export const HQ_DECOR_PAL = {
  k: [14, 14, 18], g: [70, 170, 80], G: [36, 110, 48], w: [245, 246, 250], W: [180, 184, 196], b: [120, 200, 255],
  B: [60, 140, 220], y: [255, 210, 63], p: [233, 22, 113], t: [150, 96, 60],
};
export const HQ_DECOR_ROWS = {
  plant: [
    "................", "......gG.g......", "....g.GgGg.g....", "...gGgGgGgGg....", "....GgGgGgGg....", "...gGgGg.gGgg...",
    ".....gGgGg......", ".......kk.......", ".......kk.......", ".....kkkkkk.....", ".....kWWWWk.....", ".....kwwwwk.....",
    ".....kwwwwk.....", ".....kwwwwk.....", "......kkkk......", "................",
  ],
  pylon_hq: [
    "................", ".....kkkkkk.....", ".....kpppyk.....", ".....kpyypk.....", ".....kpppyk.....", ".....kkkkkk.....",
    ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......", ".......Wk.......",
    ".......Wk.......", "......kWWk......", ".....kkkkkk.....", "................",
  ],
  cooler: [
    "................", "................", "................", "................", "......kkkk......", ".....kbbBBk.....",
    ".....kbBBbk.....", ".....kbbBBk.....", "......kkkk......", ".....kwwwwk.....", ".....kwkkwk.....", ".....kwwwwk.....",
    ".....kwwwwk.....", ".....kwwwwk.....", ".....kkkkkk.....", "................",
  ],
};
export const HQ_DECOR_LETTERS = { Y: "plant", F: "pylon_hq", M: "cooler", I: "idol" };
