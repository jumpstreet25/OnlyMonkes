// MonkeCaves weapon looks: the held weapon (first person, 32×24, drawn at 2×)
// and its shot. Every weapon plays the same (caves.js); this file only draws
// them. Looks come from caves-loadout.js, built from each monke's traits.
import { WEAPONS, DEFAULT_WEAPON, LOADOUT } from "/viewer/caves-loadout.js";

const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mul = ([r, g, b], f) => [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)].map(Math.round);
const OUTLINE = rgb(16, 14, 20);

export function weaponFor(n) {
  const i = n >= 1 ? n - 1 : -1;
  const code = i >= 0 ? LOADOUT.slice(i * 2, i * 2 + 2) : "--";
  return WEAPONS[code === "--" || code.length < 2 ? DEFAULT_WEAPON : parseInt(code, 36)] || WEAPONS[DEFAULT_WEAPON];
}

// ── Held weapon ──
export function heldSprite(w) {
  const W = 32, H = 24, px = new Array(W * H).fill(null);
  const body = hex(w.held.body), accent = hex(w.held.accent), hand = hex(w.held.hand || "#7a5034");
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  // Light from the upper left: left edge brighter, right edge darker.
  const rect = (x, y, w2, h2, c) => { for (let j = 0; j < h2; j++) for (let i = 0; i < w2; i++) set(x + i, y + j, i === 0 ? mul(c, 1.25) : i === w2 - 1 ? mul(c, 0.7) : c); };
  const disc = (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) set(cx + x, cy + y, x < 0 && y < 0 ? mul(c, 1.25) : c); };
  const t = w.held.t;
  if (t === "pistol") { rect(13, 1, 6, 9, mul(body, 0.85)); rect(12, 8, 8, 9, body); rect(13, 1, 6, 1, accent); rect(12, 11, 8, 1, accent); }
  else if (t === "rifle") { rect(14, 0, 4, 13, mul(body, 0.8)); rect(15, 2, 1, 9, accent); rect(11, 11, 10, 7, body); rect(12, 13, 8, 1, accent); }
  else if (t === "cannon") { rect(10, 2, 12, 13, body); rect(10, 5, 12, 2, accent); for (let x = 12; x < 20; x++) set(x, 2, [20, 18, 26]); for (let x = 13; x < 19; x++) set(x, 3, [36, 32, 44]); rect(12, 14, 8, 4, mul(body, 0.8)); }
  else if (t === "staff") { rect(15, 6, 3, 18, body); rect(15, 10, 3, 1, mul(body, 0.6)); disc(16, 4, 4, accent); set(15, 2, [255, 255, 255]); }
  else if (t === "tube") { rect(11, 4, 10, 13, body); rect(13, 7, 6, 4, accent); rect(14, 8, 2, 1, [255, 255, 255]); rect(13, 1, 6, 3, mul(body, 0.7)); rect(14, 1, 4, 1, accent); }
  else if (t === "blade") { rect(13, 0, 6, 13, [210, 218, 228]); rect(13, 0, 1, 13, [255, 255, 255]); rect(17, 3, 1, 1, OUTLINE_RGB); rect(14, 13, 4, 4, accent); }
  // The monke's hand, its fur colour, gripping from below.
  for (let y = 15; y < H; y++) for (let x = 8; x < 25; x++) {
    const edge = (y === 15 && (x < 10 || x > 22)) || (y === 16 && (x === 8 || x === 24));
    if (!edge) set(x, y, (y < 19 && (x - 9) % 4 === 3) ? mul(hand, 0.72) : y === 15 ? mul(hand, 1.18) : hand);
  }
  return toSprite(px, W, H);
}
const OUTLINE_RGB = [16, 14, 20];
function toSprite(px, W, H) {
  const data = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = px[y * W + x];
    if (c) { data[y * W + x] = rgb(...c); continue; }
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < W && Y < H && px[Y * W + X]; });
    if (near) data[y * W + x] = OUTLINE;
  }
  return { w: W, h: H, data };
}

// ── Shots: 8×8 masks, 1 = shot colour, 2 = white core, 3 = dark ──
const SHOT_MASKS = {
  bolt: ["........", "........", "..1111..", ".122221.", ".122221.", "..1111..", "........", "........"],
  ball: ["........", "..1111..", ".112211.", ".122211.", ".111111.", ".111111.", "..1111..", "........"],
  peel: ["........", ".1....1.", "..1..1..", "...22...", "...22...", "..1111..", "........", "........"],
  petal: ["...11...", "..1221..", ".112211.", "11222211", ".112211.", "..1221..", "...11...", "........"],
  goo: ["........", "...11...", "..1111..", ".112111.", ".111111.", "..1111..", "...1.1..", "....1..."],
  orb: ["..1111..", ".122221.", "12222221", "12222221", "12222221", ".122221.", "..1111..", "........"],
  rail: ["........", "........", "........", "11111111", "22222222", "11111111", "........", "........"],
  fire: ["...1....", "..121...", ".12221..", ".122221.", "1222221.", ".12221..", "..111...", "........"],
  blade: ["........", ".111111.", ".122221.", ".111111.", "......3.", "......3.", "........", "........"],
  bone: ["........", ".11..11.", "..1221..", "...22...", "..1221..", ".11..11.", "........", "........"],
  pie: ["........", "..1111..", ".122221.", "12222221", "33333333", ".333333.", "........", "........"],
  star: ["...1....", "...1....", "11121111", "..121...", "..1.1...", ".1...1..", "........", "........"],
  shard: ["....1...", "...121..", "...121..", "..1221..", "..1221..", ".12221..", ".1111...", "........"],
  glitch: ["1.1..1..", ".11.1.1.", "1.2211..", ".12221.1", "1.1221..", "..1.11.1", ".1..1...", "........"],
  doodle: ["........", ".1...1..", "..1.1.1.", "...1...1", "..1.1...", ".1...1..", "........", "........"],
  shuriken: ["...1....", "...11...", "1..21...", "11222211", "...12..1", "...11...", "....1...", "........"],
};
export function shotMask(shape) { return SHOT_MASKS[shape] || SHOT_MASKS.bolt; }

// Rainbow shots cycle hue over time.
export function shotColour(colour, t) {
  if (colour !== "rainbow") return hex(colour);
  const h = (t / 6) % 360, f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}
