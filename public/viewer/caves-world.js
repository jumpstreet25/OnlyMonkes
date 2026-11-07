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
    const vine = Math.abs(((x + Math.round(Math.sin(y / 4 + x) * 2)) % 9) - 4) < 1.2;
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
    const k = n(rnd, 0.7), streak = (x * 13) % 7 < 2;
    return streak ? [200 * k, 235 * k, 255] : [60 * k, 140 * k, 200 * k];
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
  m: (x, y, rnd) => { const k = n(rnd, 0.7); return ((x >> 2) + (y >> 3)) % 5 === 0 ? [70 * k, 50 * k, 30 * k] : [92 * k, 66 * k, 40 * k]; },
  w: (x, y, rnd) => { const k = n(rnd, 0.8); const glint = (x + y * 3) % 17 === 0; return glint ? [170, 220, 240] : [40 * k, 96 * k, 120 * k]; },
  s: (x, y, rnd) => { const k = n(rnd, 0.7); return x % 16 === 0 || y % 16 === 0 ? [40, 40, 36] : [86 * k, 84 * k, 74 * k]; },
};

// Open sky in clearings: canopy leaves with light coming through the gaps.
export const SKY_PAINT = (x, y, rnd) => {
  // Big soft leaf clumps; light shows through a few round gaps between them.
  const g = Math.sin(x * 0.39) * Math.cos(y * 0.33) + Math.sin((x + y) * 0.21) * 0.6;
  const k = 0.85 + rnd() * 0.15;
  if (g > 1.05) return [170 * k, 205 * k, 120 * k];
  if (g > 0.8) return [90 * k, 140 * k, 64 * k];
  return g > 0 ? [40 * k, 96 * k, 40 * k] : [28 * k, 74 * k, 32 * k];
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
