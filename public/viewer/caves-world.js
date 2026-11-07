// MonkeCaves jungle world: wall, floor and sky textures, and decorations.
// The story: a lost Monke temple deep in the jungle that Big Tech is digging
// into. Painters return [r, g, b] for a 32×32 texture; caves.js turns them into
// textures. rnd is caves.js's seeded random, so every load looks the same.
//
// Walls: # mossy temple stone  V vines  T carved monke-head block  Z bamboo
//        W waterfall (animated)  d temple door  S secret wall (looks like
//        temple stone with a small banana carving — the only hint)
// Floors (level `floor` rows): g grass  m mud  w shallow water  s stone
// Ceiling (level `ceil` rows): o open sky with canopy, anything else rock

const n = (rnd, a = 0.75) => a + rnd() * (1 - a);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// Textures are 32×32 and repeat every tile, so every pattern below repeats in 32
// (periods of 4, 8, 16 or 32, sines of 2π/32 multiples); anything else leaves a seam.
const TAU = Math.PI * 2 / 32;

export const WALL_PAINT = {
  "#": (x, y, rnd) => {
    const row = Math.floor(y / 8), off = row % 2 ? 8 : 0;
    const mortar = y % 8 === 0 || (x + off) % 16 === 0;
    if (mortar) return [22, 26, 20];
    const k = n(rnd);
    // Moss creeps down from the top of each block.
    const moss = (y % 8) < 2 + ((x * 7 + row * 3) % 3) && rnd() < 0.7;
    return moss ? [52 * k, 104 * k, 46 * k] : [96 * k, 98 * k, 84 * k];
  },
  V: (x, y, rnd) => {
    const stone = WALL_PAINT["#"](x, y, rnd);
    const vine = Math.abs((((x + Math.round(Math.sin(y * TAU * 2) * 2)) % 8) + 8) % 8 - 4) < 1.2;
    const leaf = vine && rnd() < 0.45;
    return leaf ? [70, 170, 60] : vine ? [36, 110, 40] : stone;
  },
  T: (x, y, rnd) => {
    const k = n(rnd, 0.85), edge = x < 2 || x > 29 || y < 2 || y > 29;
    if (edge) return [60, 58, 48];
    const cx = x - 15.5, cy = y - 16;
    const head = cx * cx / 110 + cy * cy / 130 < 1, ear = (Math.abs(cx) > 9 && Math.abs(cx) < 13 && Math.abs(cy + 2) < 4);
    const eye = Math.abs(cy + 3) < 2 && (Math.abs(cx - 4.5) < 2 || Math.abs(cx + 4.5) < 2);
    const mouth = cy > 5 && cy < 8 && Math.abs(cx) < 5;
    if (eye || mouth) return [30, 28, 22];
    if (head || ear) return [150 * k, 140 * k, 104 * k];
    return [104 * k, 100 * k, 80 * k];
  },
  Z: (x, y, rnd) => {
    const stalk = x % 8, node = y % 11 === 0;
    const k = n(rnd, 0.85);
    if (stalk === 0) return [30, 50, 20];
    if (node) return [120 * k, 140 * k, 50 * k];
    return stalk < 3 ? [150 * k, 180 * k, 70 * k] : [110 * k, 150 * k, 56 * k];
  },
  W: (x, y, rnd) => {
    const k = n(rnd, 0.7), streak = (x * 5) % 8 < 2 || ((x * 3 + y) % 16 === 0);
    return streak ? [215 * k, 240 * k, 255] : [70 * k, 150 * k, 210 * k];
  },
  d: (x, y, rnd) => {
    const k = n(rnd, 0.85), plank = x % 8 === 0, band = y === 6 || y === 25;
    const bx = x - 16, by = y - 16, banana = Math.abs(Math.hypot(bx, by + 8) - 9) < 1.6 && by > -3 && Math.abs(bx) < 8;
    if (band) return [70, 66, 60];
    if (banana) return [220, 180, 60];
    return plank ? [60, 34, 16] : [130 * k, 82 * k, 40 * k];
  },
  S: (x, y, rnd) => {
    const stone = WALL_PAINT["#"](x, y, rnd);
    // A tiny banana scratched into one block: look closely.
    const bx = x - 23, by = y - 13, mark = Math.abs(Math.hypot(bx, by + 4) - 4) < 0.8 && by > -2 && Math.abs(bx) < 4;
    return mark ? mix(stone, [200, 170, 90], 0.45) : stone;
  },
};

export const FLOOR_PAINT = {
  g: (x, y, rnd) => { const k = n(rnd, 0.6); const blade = rnd() < 0.12; return blade ? [90 * k, 170 * k, 60 * k] : [46 * k, 98 * k, 38 * k]; },
  m: (x, y, rnd) => { const k = n(rnd, 0.7); return ((x >> 2) + (y >> 3)) % 4 === 0 ? [70 * k, 50 * k, 30 * k] : [92 * k, 66 * k, 40 * k]; },
  w: (x, y, rnd) => {
    // Clear shallow water: ripple bands, light glints; caves.js scrolls it so it flows.
    const k = n(rnd, 0.85), wave = Math.sin((x + y) * TAU * 2) + Math.sin((x - y) * TAU * 3) * 0.6;
    if (wave > 1.3) return [190, 235, 250];
    return wave > 0.6 ? [70 * k, 165 * k, 200 * k] : [40 * k, 120 * k, 165 * k];
  },
  s: (x, y, rnd) => { const k = n(rnd, 0.7); return x % 16 === 0 || y % 16 === 0 ? [40, 40, 36] : [86 * k, 84 * k, 74 * k]; },
};

// Open sky in clearings: canopy leaves with light coming through the gaps.
// Smooth random noise that wraps at the tile edge and has no mirror line (a sine
// pattern mirrors around the tile's middle, which reads as a split screen when you
// stand in the middle of a tile).
function wrapNoise(rnd, cells) {
  const g = Array.from({ length: cells * cells }, () => rnd()), step = 32 / cells;
  const at = (i, j) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
  const ease = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / step, fy = y / step, i = Math.floor(fx), j = Math.floor(fy), u = ease(fx - i), v = ease(fy - j);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}
let canopy = null;
export const SKY_PAINT = (x, y, rnd) => {
  // Big soft leaf clumps; light shows through a few gaps between them.
  if (!canopy) { const a = wrapNoise(rnd, 4), b = wrapNoise(rnd, 8); canopy = (x, y) => a(x, y) * 0.65 + b(x, y) * 0.35; }
  const g = canopy(x, y), k = 0.85 + rnd() * 0.15;
  if (g > 0.68) return [170 * k, 205 * k, 120 * k];
  if (g > 0.6) return [90 * k, 140 * k, 64 * k];
  return g > 0.4 ? [40 * k, 96 * k, 40 * k] : [28 * k, 74 * k, 32 * k];
};

// Light: sunlit clearings are brighter than the torch-lit tunnels.
export const LIGHT = { sky: 1.15, rock: 0.82 };

// Decorations (16×16). Y banana tree and F torch block your way; M mushroom and I idol don't.
export const DECOR_PAL = {
  k: [16, 14, 20], g: [60, 160, 60], G: [34, 100, 40], t: [110, 74, 40], T: [80, 52, 28], y: [255, 210, 63], Y: [200, 150, 30],
  r: [255, 90, 40], o: [255, 170, 50], w: [255, 240, 200], c: [120, 230, 255], C: [60, 160, 200], s: [150, 140, 104], S: [104, 100, 80],
};
export const DECOR_ROWS = {
  tree: [
    "..gg....gg......", ".gGgg..ggGgg....", "gGGggggGGggg.gg.", ".ggGgGGgggGGggGg", "...ggGkkGgg.gGg.", ".....yyk.yy.....",
    "....yYyk.yYy....", "....yy.ktyy.....", ".......kt.......", ".......kt.......", ".......Tt.......", ".......Tt.......",
    ".......Tt.......", "......TTtt......", ".....TTTttt.....", "................",
  ],
  torch: [
    "................", ".......y........", "......yoy.......", "......yooy......", ".....yoroy......", ".....yorry......",
    "......oro.......", ".....kkkkk......", ".....kSSSk......", "......kTk.......", "......kTk.......", "......kTk.......",
    "......kTk.......", "......kTk.......", ".....kTTTk......", "................",
  ],
  mushroom: [
    "................", "................", "................", "................", "................", "................",
    "................", ".....kkkkk......", "....kcCcCck.....", "...kcCcwcCck....", "...kkkkkkkkk....", "......kwk.......",
    "......kwk.......", ".....kwwwk......", "................", "................",
  ],
  idol: [
    "................", "................", "....kk....kk....", "...kyyk..kyyk...", "...kyykkkkyyk...", "....kyyyyyyk....",
    "....kyrkkrYk....", "....kyyyyyyk....", ".....kyYYyk.....", "....kkyyyykk....", "...kYyyyyyyYk...", "...kYYyyyyYYk...",
    "....kkkkkkkk....", "....kSSSSSSk....", "...kkkkkkkkkk...", "................",
  ],
};
export const DECOR_LETTERS = { Y: "tree", F: "torch", M: "mushroom", I: "idol" };
export const DECOR_BLOCKS = new Set(["tree", "torch"]);
