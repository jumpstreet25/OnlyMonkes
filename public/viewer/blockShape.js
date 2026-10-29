/**
 * Block monke geometry from the 16×16 art, with no three.js so it can be tested
 * in node (src/__tests__/blockShape.test.ts). Built at 32×32: every art pixel is
 * 2×2 blocks, so eyelids, the mouth and (later) traits move in half-pixel steps.
 * The front is the NFT exactly; every block goes back the same depth (head and
 * body each their own), so the sides are flat walls that follow the art's
 * outline. Head (rows 0–11) and body (rows 12–15) are separate rigid parts with
 * a gap between them so the head can turn without touching the body.
 * monkeModel.js turns these faces into meshes. Shape tuned by the owner in the
 * Monke 3D tuner (2026-10-29).
 */
export const NECK_ROW = 12;
export const RES = 32;
export const V = 16 / RES; // block size, in art pixels
// Depths and gap in art pixels; width stretches x; wrap = how far the face's
// colours run back onto the cheeks; ear = the ear patch's size front to back.
export const BLOCK_SHAPE = { headD: 7, bodyD: 5, width: 1.1, wrap: 1, ear: 2, gap: 0.5 };
// Head turn limits (degrees). Yaw is the owner's ±45°. Pitch and roll share an
// oval budget (clampTilt) that every fur clears the body with at any yaw
// (alone the head clears 11°/9°, together only 5°; searched 2026-10-29,
// checked by blockShape.test.ts).
export const BLOCK_LIMITS = { yaw: 45, pitch: 8, roll: 7 };

/**
 * Pitch and roll share one budget (an oval): full pitch or full roll alone is
 * safe, but both at once would tip a chin corner into the neck. Degrees in, out.
 */
export function clampTilt(pitch, roll, L = BLOCK_LIMITS) {
  const e = Math.hypot(pitch / L.pitch, roll / L.roll);
  return e > 1 ? [pitch / e, roll / e] : [pitch, roll];
}

// The backdrop is slightly tinted noise around #22–#2c. Dark clothing is flat
// neutral black under #22 (e.g. #1234's hoodie #1c1e1e), so it stays solid.
export const isBg = (r, g, b, a) => {
  if (a < 128) return true;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  return hi >= 0x21 && hi <= 0x30 && lo >= 0x1b && hi - lo >= 3;
};

/** Background is whatever bg-coloured pixels touch the border. */
export function solidFromPx(px) {
  const solid = px.map((r) => r.map(() => true));
  const q = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    if ((x === 0 || y === 0 || x === 15 || y === 15) && isBg(...px[y][x])) { solid[y][x] = false; q.push([x, y]); }
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 15 || ny > 15 || !solid[ny][nx]) continue;
      if (isBg(...px[ny][nx])) { solid[ny][nx] = false; q.push([nx, ny]); }
    }
  }
  return solid;
}

/** Block lattice corner (i, j, k) → scene units (art centred, y up, x stretched by width). */
export const toWorld = (i, j, k, shape = BLOCK_SHAPE) => [(i * V - 8) * shape.width, 8 - j * V, k * V];

/**
 * Where the head turns, in scene units: over the middle of the neck, half a
 * pixel below the bottom of the head. The art's neck is off-centre, so turning
 * about the picture's middle swung the chin into it.
 */
export function neckPivot(solid, shape = BLOCK_SHAPE) {
  const xs = [];
  for (let x = 0; x < 16; x++) if (solid[NECK_ROW]?.[x]) xs.push(x);
  const cx = xs.length ? (xs[0] + xs[xs.length - 1] + 1) / 2 - 8 : 0;
  return [cx * shape.width, 8 - NECK_ROW + shape.gap - 0.5, 0];
}

const key = (p) => (p[0] << 16) | (p[1] << 8) | p[2];
const diff = (a, b) => Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
function mostCommon(keys, skip) {
  const n = new Map();
  for (const k of keys) if (!skip?.has(k)) n.set(k, (n.get(k) || 0) + 1);
  let best = null, bn = 0;
  for (const [k, c] of n) if (c > bn) { best = k; bn = c; }
  return best;
}

// Face directions in the lattice: +i, -i, up (j-1), down (j+1), front (+k, toward the viewer), back.
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
export const FRONT = 4, BACK = 5;

/**
 * Every block and exposed block face of each part, in lattice cells
 * (i, j: 0–31, k: depth), with its colour (0xRRGGBB). The art is on the front.
 * Fur keeps its colour all round; the face's colours wrap `wrap` pixels onto
 * the cheeks and stop (eyes and dark details stay on the front); behind that
 * the head is fur. The ear (a skin pixel on the head's left edge, seen side-on
 * in the art) is a patch in the middle of the side, not a stripe.
 */
export function blockFaces(px, solid, shape = BLOCK_SHAPE) {
  const bodyKeys = [], headKeys = [];
  for (let r = 0; r < 16; r++) for (let x = 0; x < 16; x++) if (solid[r][x]) (r < NECK_ROW ? headKeys : bodyKeys).push(key(px[r][x]));
  const furSet = new Set(bodyKeys);
  const fur = mostCommon(bodyKeys) ?? mostCommon(headKeys) ?? 0x808080;
  const skin = mostCommon(headKeys, furSet) ?? fur;
  const leftX = (r) => solid[r].findIndex(Boolean);
  const isEar = (x, r) => r < NECK_ROW && x === leftX(r) && !furSet.has(key(px[r][x])) && diff(key(px[r][x]), skin) <= 30;

  const cubes = { head: [], body: [] }, faces = { head: [], body: [] }, zFront = {};
  for (const [part, r0, r1, depth] of [["head", 0, NECK_ROW, shape.headD], ["body", NECK_ROW, 16, shape.bodyD]]) {
    const n = Math.round(depth / V), k0 = -Math.floor(n / 2), k1 = k0 + n - 1;
    zFront[part] = (k1 + 1) * V;
    const has = (i, j, k) => {
      const x = i >> 1, r = j >> 1;
      return i >= 0 && j >= 0 && i < RES && j < RES && r >= r0 && r < r1 && solid[r][x] && k >= k0 && k <= k1;
    };
    const colour = (i, j, k, dir) => {
      const x = i >> 1, r = j >> 1, c = key(px[r][x]);
      if (dir === FRONT) return c;
      const z = (k + 0.5) * V;
      if (isEar(x, r)) return dir === 1 && Math.abs(z) <= shape.ear / 2 ? c : fur;
      if (furSet.has(c)) return c;
      if (dir === BACK || zFront[part] - z > shape.wrap) return fur;
      return diff(c, skin) > 30 ? skin : c;
    };
    for (let j = r0 * 2; j < r1 * 2; j++) for (let i = 0; i < RES; i++) {
      if (!solid[j >> 1][i >> 1]) continue;
      for (let k = k0; k <= k1; k++) {
        cubes[part].push([i, j, k]);
        DIRS.forEach(([di, dj, dk], dir) => { if (!has(i + di, j + dj, k + dk)) faces[part].push({ i, j, k, dir, c: colour(i, j, k, dir) }); });
      }
    }
  }
  return { cubes, faces, zFront, skin, fur };
}
