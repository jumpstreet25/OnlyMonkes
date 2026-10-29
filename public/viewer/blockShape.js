/**
 * Block monke geometry from the 16×16 art, with no three.js so it can be tested
 * in node (src/__tests__/blockShape.test.ts). One cube per art pixel column,
 * solid front to back; the head (rows 0–11) and body (rows 12–15) are separate
 * rigid parts with a gap between them so the head can turn without touching
 * the body. monkeModel.js turns these faces into meshes.
 */
export const NECK_ROW = 12;
export const NECK_GAP = 0.4;
// Head turn limits (degrees). Yaw is the owner's ±45°. Pitch and roll share an
// oval budget (clampTilt) that every fur clears the body with at any yaw, with
// this gap and pivot: 15°/10° alone is safe but not both together, so 10°/7°
// (searched 2026-10-29; checked by blockShape.test.ts).
export const BLOCK_LIMITS = { yaw: 45, pitch: 10, roll: 7 };

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

const isHead = (r) => r < NECK_ROW;

/**
 * Where the head turns, in scene units (art centred, y up): over the middle of
 * the neck, half a block below the bottom of the head (inside the neck top). The art's neck is off-centre, so turning
 * about the picture's middle swung the chin into it.
 */
export function neckPivot(solid) {
  const xs = [];
  for (let x = 0; x < 16; x++) if (solid[NECK_ROW]?.[x]) xs.push(x);
  const cx = xs.length ? (xs[0] + xs[xs.length - 1] + 1) / 2 - 8 : 0;
  return [cx, 8 - NECK_ROW + NECK_GAP - 0.5, 0];
}

/**
 * Half-depth per pixel (the column runs z = -h … +h): thicker toward the middle
 * of each part (head up to 4, body up to 3), then raised so every row and
 * column climbs to one peak and back down — no dents, holes or pits.
 */
export function halfDepths(solid) {
  const d = solid.map((row) => row.map((s) => (s ? 99 : 0)));
  for (let it = 0; it < 16; it++)
    for (let r = 0; r < 16; r++) for (let x = 0; x < 16; x++) {
      if (!d[r][x]) continue;
      let m = 99;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = r + dy;
        const v = nx < 0 || ny < 0 || nx > 15 || ny > 15 || isHead(ny) !== isHead(r) ? 0 : d[ny][nx];
        m = Math.min(m, v);
      }
      d[r][x] = Math.min(d[r][x], m + 1);
    }
  const H = d.map((row, r) => row.map((v) => (!v ? 0 : isHead(r) ? Math.min(1 + Math.floor(v * 0.9), 4) : Math.min(1 + Math.floor(v * 0.6), 3))));
  const unimodal = (get, set, len, splitAt) => {
    let changed = false;
    let j = 0;
    while (j < len) {
      if (!get(j)) { j++; continue; }
      let e = j;
      while (e < len && get(e) && (splitAt == null || isHead(e) === isHead(j))) e++;
      const seg = []; for (let i = j; i < e; i++) seg.push(get(i));
      const pre = [], suf = [];
      seg.forEach((v, i) => (pre[i] = Math.max(v, i ? pre[i - 1] : 0)));
      for (let i = seg.length - 1; i >= 0; i--) suf[i] = Math.max(seg[i], i < seg.length - 1 ? suf[i + 1] : 0);
      seg.forEach((v, i) => { const t = Math.min(pre[i], suf[i]); if (t > v) { set(j + i, t); changed = true; } });
      j = e;
    }
    return changed;
  };
  for (let pass = 0; pass < 20; pass++) {
    let ch = false;
    for (let r = 0; r < 16; r++) ch = unimodal((i) => H[r][i], (i, v) => (H[r][i] = v), 16, null) || ch;
    for (let x = 0; x < 16; x++) ch = unimodal((i) => H[i][x], (i, v) => (H[i][x] = v), 16, true) || ch;
    if (!ch) break;
  }
  return H;
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

// Face directions: +x, -x, up, down, front (+z, toward the viewer), back.
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
export const FRONT = 4, BACK = 5;

/**
 * Every exposed cube face of each part, with its colour (0xRRGGBB). The art is
 * on the front faces. Sides take the pixel's own colour, except that eyes and
 * other dark face details stay on the front only (side walls show skin), and
 * the face's colours stop at the middle: behind it the head is fur, so the
 * back of the head is never a second face.
 */
export function blockFaces(px, solid) {
  const H = halfDepths(solid);
  const bodyKeys = [], headKeys = [];
  for (let r = 0; r < 16; r++) for (let x = 0; x < 16; x++) if (solid[r][x]) (isHead(r) ? headKeys : bodyKeys).push(key(px[r][x]));
  const furSet = new Set(bodyKeys);
  const fur = mostCommon(bodyKeys) ?? mostCommon(headKeys) ?? 0x808080;
  const skin = mostCommon(headKeys, furSet) ?? fur;
  const colour = (x, r, z, dir) => {
    const k = key(px[r][x]);
    if (dir === FRONT || furSet.has(k)) return k;
    if (dir === BACK || z < 0) return fur;
    return diff(k, skin) > 30 ? skin : k;
  };
  const cubes = { head: [], body: [] };
  const has = (x, r, z) => x >= 0 && r >= 0 && x < 16 && r < 16 && solid[r][x] && Math.abs(z) <= H[r][x];
  const faces = { head: [], body: [] };
  for (let r = 0; r < 16; r++) for (let x = 0; x < 16; x++) {
    if (!solid[r][x]) continue;
    const part = isHead(r) ? "head" : "body";
    for (let z = -H[r][x]; z <= H[r][x]; z++) {
      cubes[part].push([x, r, z]);
      DIRS.forEach(([dx, dy, dz], dir) => {
        const nr = r + dy;
        if (has(x + dx, nr, z + dz) && isHead(nr) === isHead(r)) return;
        faces[part].push({ x, r, z, dir, c: colour(x, r, z, dir) });
      });
    }
  }
  return { H, cubes, faces, skin, fur };
}
