// MonkeCaves status face: the player's own PFP, worn down as health drops.
// Five stages by health (100-80 fine, 79-60 tired, 59-40 sweaty, 39-20 bloodied,
// 19-0 beaten), plus short reactions: glance toward whatever hit you, "ouch"
// on a big hit, a grin when you pick up a badge. Only the monke's own pixels
// (solid mask from monkeModel.js) are marked, never the background.

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// Stable per-pixel noise so blood and sweat don't flicker frame to frame.
const hash = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export const faceStage = (hp) => Math.min(4, Math.max(0, Math.floor(((100 - Math.min(100, Math.max(0, hp))) * 5) / 101)));

/**
 * px: 16×16 [r,g,b,a] grid, solid: 16×16 booleans, crop {x,y,n}.
 * state: { hp, look (-1 left, 0, 1 right), ouch (s left), grin (s left), hurt (s left), t (ms) }.
 * Returns an n×n array of [r,g,b] or null (transparent).
 */
export function paintFace(px, solid, crop, state) {
  const { x: cx, y: cy, n } = crop, stage = faceStage(state.hp);
  // Find the face's rows once: top of the solid area, its height, its middle column.
  let top = 16, bot = -1, left = 16, right = -1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (solid[y][x]) { top = Math.min(top, y); bot = Math.max(bot, y); left = Math.min(left, x); right = Math.max(right, x); }
  const h = Math.max(1, bot - top + 1), eyeRow = top + Math.round(h * 0.42);
  const shift = state.look || 0;
  // Blood: a fixed set of drip columns (2 when bloodied, 4 when beaten), each running
  // down from the top of the head; the beaten face also gets a cut under one eye.
  const cols = [];
  for (let x = left; x <= right; x++) cols.push(x);
  cols.sort((a, b) => hash(a, 0, 2) - hash(b, 0, 2));
  const drips = new Map(cols.slice(0, stage === 3 ? 2 : stage === 4 ? 4 : 0).map((x) => [x, Math.max(2, Math.round(h * (stage === 3 ? 0.3 : 0.5) + hash(x, 0, 3) * h * 0.25))]));
  // Sweat: two drops beside the eyes.
  const sweat = stage >= 2 ? new Set([`${left},${eyeRow + 1}`, `${right},${eyeRow}`, ...(stage >= 3 ? [`${left},${eyeRow + 3}`, `${right},${eyeRow + 2}`] : [])]) : new Set();
  const out = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const sx = Math.max(0, Math.min(15, cx + x - shift)), sy = cy + y;
      const p = px[sy]?.[sx];
      if (!p) { row.push(null); continue; }
      let [r, g, b] = p;
      const isMonke = solid[sy]?.[sx];
      if (isMonke) {
        // Tired: duller and darker, heavier shadow across the eyes.
        if (stage >= 1) { const k = 1 - 0.07 * stage; const grey = (r + g + b) / 3; r = (r * 0.8 + grey * 0.2) * k; g = (g * 0.8 + grey * 0.2) * k; b = (b * 0.8 + grey * 0.2) * k; }
        if (stage >= 1 && (sy === eyeRow - 1 || (stage >= 3 && sy === eyeRow))) { r *= 0.72; g *= 0.68; b *= 0.72; }
        if (sweat.has(`${sx},${sy}`)) { r = 170; g = 215; b = 255; }
        const drip = drips.get(sx);
        if (drip && sy - top < drip && hash(sx, sy, 6) > 0.2) { const k = sy - top < 2 ? 0.85 : 0.65; r = r * (1 - k) + 200 * k; g = g * (1 - k) + 18 * k; b = b * (1 - k) + 28 * k; }
        if (stage === 4 && sy === eyeRow + 1 && (sx === left + 2 || sx === left + 3)) { r = 150; g = 16; b = 30; }
        if (stage === 4 && sy === eyeRow - 1 && sx === left + 2) { r = 95; g = 45; b = 110; }
      }
      // Reactions on top of the stage.
      if (state.ouch > 0) { r = r * 0.6 + 255 * 0.4; g *= 0.55; b *= 0.55; }
      else if (state.hurt > 0) { r = r + (255 - r) * 0.45; g *= 0.6; b *= 0.6; }
      if (state.grin > 0 && isMonke && hash(sx, sy, Math.floor(state.t / 120)) < 0.08) { r = 255; g = 230; b = 120; }
      row.push([clamp(r), clamp(g), clamp(b)]);
    }
    out.push(row);
  }
  return out;
}
