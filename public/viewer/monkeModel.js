/**
 * Saga Monke pixel art → a 3D monke (three.js), shared by the viewer
 * (monke3d.html) and the Avatar Room stage (room.html). Every Saga Monke is
 * 16×16 pixel art, so the model is built from the monke's own Arweave image.
 * Default is the block monke (32×32 blocks, blockShape.js); the older
 * smooth "inflated" monke is kept behind ?style=smooth.
 */
import * as THREE from "three";
import { solidFromPx, blockFaces, DIRS, FRONT, BLOCK_SHAPE, BLOCK_LIMITS, neckPivot, clampTilt, toWorld } from "/viewer/blockShape.js";

const STYLE = typeof location !== "undefined" && new URLSearchParams(location.search).get("style") === "smooth" ? "smooth" : "block";

const DEG = Math.PI / 180;
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// ── Monke number → Arweave image (same table as src/lib/monkeMeme/monkeNumbers.ts) ──
const BASE_A = "https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE";
const BASE_B = "https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY";
const GIFS = new Set([8986, 8987, 8988]);
const BURNED = new Set([411, 2976, 3109, 3140, 3850, 3970, 4747, 4979, 5203, 5363, 5462, 5952, 6692, 6797, 7894]);
export function imageFor(n) {
  if (!Number.isInteger(n) || n < 1 || n > 10014 || BURNED.has(n)) return null;
  return `${n >= 8989 ? BASE_B : BASE_A}/${n}.${GIFS.has(n) ? "gif" : "png"}`;
}

// ── Pixel art → smooth 3D ──
// Standard monkes share one template: eyes at (7,9) and (10,9), mouth on
// row 11 at x 7–10, neck below row 11.
const EYES = [[7, 9], [10, 9]];
const MOUTH_ROW = 11, MOUTH_X = [7, 8, 9, 10];
const NECK_ROW = 12;
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

export function readGrid(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const cell = c.width / 16;
  const px = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      const d = ctx.getImageData(Math.floor((x + 0.5) * cell), Math.floor((y + 0.5) * cell), 1, 1).data;
      row.push([d[0], d[1], d[2], d[3]]);
    }
    px.push(row);
  }
  const solid = solidFromPx(px);
  return { px, solid };
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const css = (p) => `rgb(${p[0]},${p[1]},${p[2]})`;

// The monke is one rounded, "inflated" shape per part (head, body): a mesh with
// S cells per art pixel whose outline follows the art without stair steps and
// whose thickness rises smoothly from the outline. The on-chain pixel art is
// painted on the front, crisp (nearest-neighbour), so it stays the real monke.
// It is built to be seen from the front, up to 45° either side.
const S = 8, N = 16 * S, W = N + 1;
const CAVITY = [58, 13, 22];
// front: gentle curve carrying the art (steep walls would stretch the pixels);
// back: a deeper round bulge in the part's own colour.
const HEAD = { front: 2.2, back: 3.0, R: 3.4, dome: 0.5 };
const BODY = { front: 1.3, back: 2.2, R: 2.6, dome: 0 };
const NECK_Y = 8 - NECK_ROW; // head pivot, in the centred art coordinates (y up)

// Vertex (gx, gy) is inside when the bilinear blend of the pixel-centre
// solid mask is over the threshold: that rounds the stair steps off.
function silhouette(solid) {
  const s = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? 0 : solid[y][x] ? 1 : 0);
  const inside = new Uint8Array(W * W);
  for (let gy = 0; gy <= N; gy++) for (let gx = 0; gx <= N; gx++) {
    const u = gx / S - 0.5, v = gy / S - 0.5;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const f = s(x0, y0) * (1 - fx) * (1 - fy) + s(x0 + 1, y0) * fx * (1 - fy) + s(x0, y0 + 1) * (1 - fx) * fy + s(x0 + 1, y0 + 1) * fx * fy;
    inside[gy * W + gx] = f > 0.45 ? 1 : 0;
  }
  return inside;
}

// Distance (in art pixels) from each inside vertex to the outline; 0 on it.
function outlineDistance(inside) {
  const isIn = (gx, gy) => gx >= 0 && gy >= 0 && gx <= N && gy <= N && inside[gy * W + gx] === 1;
  const edge = [];
  for (let gy = 0; gy <= N; gy++) for (let gx = 0; gx <= N; gx++)
    if (isIn(gx, gy) && !(isIn(gx + 1, gy) && isIn(gx - 1, gy) && isIn(gx, gy + 1) && isIn(gx, gy - 1))) edge.push(gx, gy);
  const D = new Float32Array(W * W);
  for (let gy = 0; gy <= N; gy++) for (let gx = 0; gx <= N; gx++) {
    if (!isIn(gx, gy)) continue;
    let m = Infinity;
    for (let i = 0; i < edge.length; i += 2) {
      const dx = edge[i] - gx, dy = edge[i + 1] - gy, q = dx * dx + dy * dy;
      if (q < m) m = q;
    }
    D[gy * W + gx] = Math.sqrt(m) / S;
  }
  return D;
}

// Heights from the outline distance: flat across the middle so the face stays
// readable, plus an optional gentle dome around the part's centre.
function heights(d, p, gx, gy, centre) {
  const t = Math.min(d / p.R, 1);
  let front = p.front * (1 - (1 - t) * (1 - t));
  if (p.dome && centre) {
    const dx = (gx / S - centre.x) / centre.rx, dy = (gy / S - centre.y) / centre.ry;
    front += p.dome * t * Math.max(0, 1 - dx * dx - dy * dy);
  }
  return [front, p.back * Math.sqrt(1 - (1 - t) * (1 - t))];
}

// Fill background pixels with the nearest solid colour, so the softened
// outline never samples the dark backdrop.
function filledColors(px, solid) {
  const c = px.map((r, y) => r.map((p, x) => (solid[y][x] ? p : null)));
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    const next = c.map((r) => r.slice());
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (c[y][x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = c[y + dy]?.[x + dx];
        if (p) { next[y][x] = p; changed = true; break; }
      }
    }
    for (let y = 0; y < 16; y++) c[y] = next[y];
    if (!changed) break;
  }
  return c.map((r) => r.map((p) => p || [40, 40, 48, 255]));
}

function pixelTexture(colors, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { ctx.fillStyle = css(colors[y][x]); ctx.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Colour for the back of a part. Monkes face right, so the back of the head
// (or body) is the leftmost pixels of each row: take the most common of the
// first two solid pixels per row.
function partColor(px, solid, fromRow, toRow) {
  const count = new Map();
  for (let y = fromRow; y < toRow; y++) {
    let seen = 0;
    for (let x = 0; x < 16 && seen < 2; x++) {
      if (!solid[y][x]) continue;
      seen++;
      const k = css(px[y][x]);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  let best = "rgb(90,70,60)", n = 0;
  for (const [k, c] of count) if (c > n) { best = k; n = c; }
  return best;
}

// One part as a closed mesh: front (art) + back (flat colour), meeting at the
// outline, plus a flat cap where the part is cut at the neck.
// `inside` is the part's own outline (the head must not borrow the body's
// shape under the chin); D comes from the whole figure, for thickness.
function partMesh(inside, D, p, rows, centre, frontMat, backMat, offsetY, capFacesUp) {
  const pos = new Float32Array(W * W * 2 * 3), uv = new Float32Array(W * W * 2 * 2);
  const hgt = new Float32Array(W * W);
  for (let gy = 0; gy <= N; gy++) for (let gx = 0; gx <= N; gx++) {
    const i = gy * W + gx;
    const [hf, hb] = inside[i] ? heights(D[i], p, gx, gy, centre) : [0, 0];
    hgt[i] = hf;
    const x = gx / S - 8, y = 8 - gy / S - offsetY;
    pos.set([x, y, hf], i * 3);
    pos.set([x, y, -hb], (W * W + i) * 3);
    uv.set([gx / N, 1 - gy / N], i * 2);
    uv.set([gx / N, 1 - gy / N], (W * W + i) * 2);
  }
  const front = [], back = [];
  const inRows = (gy) => gy >= rows[0] * S && gy + 1 <= rows[1] * S;
  for (let gy = 0; gy < N; gy++) {
    if (!inRows(gy)) continue;
    for (let gx = 0; gx < N; gx++) {
      const a = gy * W + gx, b = a + 1, c = a + W, d = c + 1;
      // Cells touching the shape slope down to zero thickness at the outside
      // vertices: front and back meet there, so the rim is closed and smooth.
      if (inside[a] || inside[b] || inside[c]) { front.push(a, c, b); back.push(W * W + a, W * W + b, W * W + c); }
      if (inside[b] || inside[c] || inside[d]) { front.push(b, c, d); back.push(W * W + b, W * W + d, W * W + c); }
    }
  }
  // Cap along the cut row.
  const cut = (capFacesUp ? rows[0] : rows[1]) * S;
  if (cut > 0 && cut < N) for (let gx = 0; gx < N; gx++) {
    const f0 = cut * W + gx, f1 = f0 + 1;
    if (!inside[f0] && !inside[f1]) continue;
    const b0 = W * W + f0, b1 = W * W + f1;
    if (capFacesUp) back.push(f0, f1, b0, f1, b1, b0);
    else back.push(f0, b0, f1, f1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex([...front, ...back]);
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, back.length, 1);
  g.computeVertexNormals();
  return { mesh: new THREE.Mesh(g, [frontMat, backMat]), hgt, inside };
}

// A piece of the head's front surface over art pixels [x0, x0+w) × [y0, y0+h),
// lifted a hair, so moving parts (jaw, eyelids) hug the curve at any angle.
// Local y is measured from the patch's top edge. It borrows the surface's own
// normals, so it is lit exactly like the face under it (no visible seam).
function surfacePatch(part, x0, y0, w, h, mat, lift) {
  const cols = w * S, rows = h * S;
  const nrm = part.mesh.geometry.getAttribute("normal").array;
  const pos = [], uv = [], nor = [], idx = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const gx = x0 * S + i, gy = y0 * S + j, k = gy * W + gx;
    pos.push(gx / S - 8, -j / S, part.hgt[k] + lift);
    nor.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
    uv.push(i / cols, 1 - j / rows);
  }
  // Only cells fully inside the outline: the rim slope would poke past the face.
  const ins = (i, j) => part.inside[(y0 * S + j) * W + x0 * S + i] === 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (!(ins(i, j) && ins(i + 1, j) && ins(i, j + 1) && ins(i + 1, j + 1))) continue;
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, mat);
}

export function disposeMonke(monke) {
  monke.root.removeFromParent();
  monke.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
  });
}

/** A monke as a THREE.Group (`root`) plus its moving parts; add `root` to a scene. */
export function buildMonke(grid) {
  return STYLE === "smooth" ? buildSmoothMonke(grid) : buildBlockMonke(grid);
}

// ── Block monke ──
// Faces of one plane and colour are merged into one rectangle, so a run of the
// same colour reads as one seamless surface; a change of colour or shade is a
// new block. Nothing scales: blink and mouth are flat frames shown or hidden.
function faceRects(faces) {
  const groups = new Map();
  for (const f of faces) {
    const ax = f.dir < 2 ? 0 : f.dir < 4 ? 1 : 2, u = (ax + 1) % 3, v = (ax + 2) % 3, p = [f.i, f.j, f.k];
    const plane = p[ax] + (DIRS[f.dir][ax] > 0 ? 1 : 0);
    const k = f.dir + "|" + plane;
    if (!groups.has(k)) groups.set(k, { dir: f.dir, ax, u, v, plane, cells: new Map() });
    groups.get(k).cells.set(p[u] + "," + p[v], f.c);
  }
  const rects = [];
  for (const { dir, ax, u, v, plane, cells } of groups.values()) {
    const done = new Set();
    const keys = [...cells.keys()].map((k) => k.split(",").map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (const [a0, b0] of keys) {
      if (done.has(a0 + "," + b0)) continue;
      const c = cells.get(a0 + "," + b0);
      const free = (a, b) => cells.get(a + "," + b) === c && !done.has(a + "," + b);
      let b1 = b0 + 1; while (free(a0, b1)) b1++;
      let a1 = a0 + 1;
      for (;;) { let ok = true; for (let b = b0; b < b1; b++) if (!free(a1, b)) { ok = false; break; } if (!ok) break; a1++; }
      for (let a = a0; a < a1; a++) for (let b = b0; b < b1; b++) done.add(a + "," + b);
      rects.push({ dir, ax, u, v, plane, a0, a1, b0, b1, c });
    }
  }
  return rects;
}

// Lattice rectangle → its four corners in scene units, grown a hair so the
// joins between neighbouring rectangles never show as cracks.
const SEAL = 0.004;
function rectCorners({ ax, u, v, plane, a0, a1, b0, b1 }) {
  const corner = (a, b) => { const q = [0, 0, 0]; q[ax] = plane; q[u] = a; q[v] = b; return toWorld(q[0], q[1], q[2]); };
  return [corner(a0 - SEAL, b0 - SEAL), corner(a1 + SEAL, b0 - SEAL), corner(a1 + SEAL, b1 + SEAL), corner(a0 - SEAL, b1 + SEAL)];
}

function quadsGeometry(quads) {
  const pos = [], nor = [], col = [];
  const tmp = new THREE.Color();
  for (const { corners, normal, c } of quads) {
    let q = corners;
    const e1 = q[1].map((v, i) => v - q[0][i]), e2 = q[3].map((v, i) => v - q[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0) q = [q[0], q[3], q[2], q[1]];
    tmp.setRGB((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, THREE.SRGBColorSpace);
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...q[i]); nor.push(...normal); col.push(tmp.r, tmp.g, tmp.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const worldNormal = (dir) => [DIRS[dir][0], -DIRS[dir][1], DIRS[dir][2]];
const partGeometry = (faces) => quadsGeometry(faceRects(faces).map((r) => ({ corners: rectCorners(r), normal: worldNormal(r.dir), c: r.c })));

/** Flat squares on the face front, one per 32-grid cell [i, j] — eyelids, open mouth. */
function frontSquares(cells, zFront, c) {
  return quadsGeometry(cells.map(([i, j]) => {
    const a = toWorld(i, j, 0), b = toWorld(i + 1, j + 1, 0), z = zFront + 0.01;
    return { corners: [[a[0], b[1], z], [b[0], b[1], z], [b[0], a[1], z], [a[0], a[1], z]], normal: [0, 0, 1], c };
  }));
}

// Each eye pixel is 2×2 cells: a half blink covers its top row, a full blink all four.
const eyeCells = ([x, y], rows) => rows.flatMap((j) => [[2 * x, j], [2 * x + 1, j]]);
// The open mouth: half = the middle of the lower mouth row; open = a wider hole over both rows.
const MOUTH_HALF = [16, 17, 18, 19].map((i) => [i, 2 * MOUTH_ROW + 1]);
const MOUTH_OPEN = [...[15, 16, 17, 18, 19, 20].map((i) => [i, 2 * MOUTH_ROW]), ...[14, 15, 16, 17, 18, 19, 20, 21].map((i) => [i, 2 * MOUTH_ROW + 1])];

function buildBlockMonke({ px, solid }) {
  const { faces, zFront, skin } = blockFaces(px, solid);
  const eyesOk = EYES.every(([x, y]) => solid[y][x]) && same(px[9][7], px[9][10]) && !same(px[9][7], px[9][8]) && same(px[9][8], px[9][9]);
  const jawOk = MOUTH_X.every((x) => solid[MOUTH_ROW][x]) && same(px[10][8], px[10][9]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const over = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  const pivot = neckPivot(solid);
  const root = new THREE.Group();
  const headGroup = new THREE.Group();
  headGroup.position.set(pivot[0], pivot[1], pivot[2]);
  const inHead = (m) => { m.position.set(-pivot[0], BLOCK_SHAPE.gap - pivot[1], -pivot[2]); headGroup.add(m); return m; };
  const hidden = (cells, c) => { const m = inHead(new THREE.Mesh(frontSquares(cells, zFront.head, c), over)); m.visible = false; return m; };
  inHead(new THREE.Mesh(partGeometry(faces.head), mat));
  root.add(new THREE.Mesh(partGeometry(faces.body), mat), headGroup);

  const lids = eyesOk ? EYES.map((e) => ({ side: e[0] + 0.5 - 8, half: hidden(eyeCells(e, [2 * e[1]]), skin), full: hidden(eyeCells(e, [2 * e[1], 2 * e[1] + 1]), skin) })) : [];
  const cav = (CAVITY[0] << 16) | (CAVITY[1] << 8) | CAVITY[2];
  const mouth = jawOk ? [hidden(MOUTH_HALF, cav), hidden(MOUTH_OPEN, cav)] : null;
  return { root, headGroup, block: true, lids, mouth, mouthFrame: 0, limits: BLOCK_LIMITS, jaw: 0, blinkL: 0, blinkR: 0 };
}

function buildSmoothMonke({ px, solid }) {
  const skin = css(px[8][8]);
  // Template check: the moving parts only switch on where they'll look right
  // (sunglasses, masks and odd 1/1s keep their faces still).
  const eyesOk = EYES.every(([x, y]) => solid[y][x]) && same(px[9][7], px[9][10]) && !same(px[9][7], px[9][8]) && same(px[9][8], px[9][9]);
  const jawOk = MOUTH_X.every((x) => solid[MOUTH_ROW][x]) && same(px[10][8], px[10][9]);

  const colors = filledColors(px, solid);
  const art = colors.map((r) => r.slice());
  if (jawOk) for (const x of MOUTH_X) art[MOUTH_ROW][x] = CAVITY; // the jaw piece covers it until the mouth opens
  const map = pixelTexture(art, 16, 16);
  const frontMat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });

  const D = outlineDistance(silhouette(solid));
  // Each part's own outline, carried straight across the neck cut so the cut isn't pinched.
  const headInside = silhouette(solid.map((r, y) => (y < NECK_ROW ? r : solid[NECK_ROW - 1])));
  const bodyInside = silhouette(solid.map((r, y) => (y >= NECK_ROW ? r : solid[NECK_ROW])));
  // Head centre for the dome: middle of the head's solid pixels.
  let sx = 0, sy = 0, n = 0, minX = 16, maxX = 0, minY = 16;
  for (let y = 0; y < NECK_ROW; y++) for (let x = 0; x < 16; x++) if (solid[y][x]) { sx += x + 0.5; sy += y + 0.5; n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); minY = Math.min(minY, y); }
  const centre = n ? { x: sx / n, y: sy / n, rx: Math.max(2, (maxX - minX) / 2), ry: Math.max(2, (NECK_ROW - minY) / 2) } : null;

  const headBack = new THREE.MeshStandardMaterial({ color: partColor(px, solid, 0, NECK_ROW), roughness: 0.9, metalness: 0 });
  const bodyBack = new THREE.MeshStandardMaterial({ color: partColor(px, solid, NECK_ROW, 16), roughness: 0.9, metalness: 0 });
  const head = partMesh(headInside, D, HEAD, [0, NECK_ROW], centre, frontMat, headBack, NECK_Y, false);
  const body = partMesh(bodyInside, D, BODY, [NECK_ROW, 16], null, frontMat, bodyBack, 0, true);

  const root = new THREE.Group();
  const headGroup = new THREE.Group();
  headGroup.position.y = NECK_Y;
  headGroup.add(head.mesh);

  let jawMesh = null, jawY = 0;
  if (jawOk) {
    const mouthTex = pixelTexture([MOUTH_X.map((x) => colors[MOUTH_ROW][x])], MOUTH_X.length, 1);
    const mouthMat = new THREE.MeshStandardMaterial({ map: mouthTex, roughness: 0.85, metalness: 0 });
    // The mouth opens in place: this chin strip shrinks toward its bottom edge
    // and uncovers the dark mouth painted under it (no part slides off the face).
    jawMesh = surfacePatch(head, MOUTH_X[0], MOUTH_ROW, MOUTH_X.length, 1, mouthMat, 0.02);
    jawMesh.geometry.translate(0, 1, 0);
    jawY = 8 - MOUTH_ROW - NECK_Y - 1;
    jawMesh.position.y = jawY;
    headGroup.add(jawMesh);
  }
  const lidMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85, metalness: 0 });
  const lids = eyesOk ? EYES.map(([x, y]) => {
    const lid = surfacePatch(head, x, y, 1, 1, lidMat, 0.03);
    lid.userData.top = 8 - y - NECK_Y;
    lid.position.y = lid.userData.top;
    lid.scale.y = 0.001;
    lid.userData.side = x + 0.5 - 8;
    headGroup.add(lid);
    return lid;
  }) : [];

  root.add(body.mesh, headGroup);
  return { root, headGroup, jawMesh, jawY, lids, jaw: 0, blinkL: 0, blinkR: 0 };
}

/**
 * Eases the monke toward a face ({ values, headRotation }, blendshape names as
 * src/lib/faceTracking.ts). face null + idle: slow blink and a little sway;
 * face null, not idle: back to rest and still. Returns true while still moving.
 * rate: how fast it eases toward the target (higher = snappier).
 */
export function driveMonke(monke, face, dt, idle, rate = 14) {
  const t = performance.now() / 1000;
  const live = !!face;
  const k = 1 - Math.exp(-dt * rate);
  let jaw = 0, bl = 0, br = 0, rx = 0, ry = 0, rz = 0;
  if (live) {
    const v = face.values, r = face.headRotation || {};
    jaw = clamp01(v.jawOpen * 1.6);
    bl = clamp01(v.eyeBlinkLeft * 1.3);
    br = clamp01(v.eyeBlinkRight * 1.3);
    // Mirror yaw/roll so the monke moves like a mirror image of you.
    // Built to be seen from the front: at most 45° left or right.
    const L = monke.limits || { pitch: 20, yaw: 45, roll: 20 };
    let p = Math.max(-L.pitch, Math.min(L.pitch, Number(r.x) || 0));
    let ro = Math.max(-L.roll, Math.min(L.roll, Number(r.z) || 0));
    if (monke.block) [p, ro] = clampTilt(p, ro, L);
    rx = p * DEG;
    ry = -Math.max(-L.yaw, Math.min(L.yaw, Number(r.y) || 0)) * DEG;
    rz = -ro * DEG;
  } else if (idle) {
    // Idle: slow blink and a little sway when nothing is driving it.
    bl = br = (t % 4) < 0.14 ? 1 : 0;
    rx = Math.sin(t * 0.8) * 0.04;
    ry = Math.sin(t * 0.45) * 0.12;
  }
  monke.jaw += (jaw - monke.jaw) * k;
  monke.blinkL += (bl - monke.blinkL) * Math.min(1, k * 2);
  monke.blinkR += (br - monke.blinkR) * Math.min(1, k * 2);
  if (monke.block) {
    // Frames, not scaling: lids half / closed; mouth closed / half / open,
    // with a little hysteresis so a jittery jawOpen doesn't flicker.
    monke.lids.forEach((lid) => {
      const b = lid.side > 0 ? monke.blinkL : monke.blinkR;
      lid.full.visible = b > 0.7;
      lid.half.visible = b > 0.3 && b <= 0.7;
    });
    if (monke.mouth) {
      const j = monke.jaw, f = monke.mouthFrame;
      monke.mouthFrame = j > (f === 2 ? 0.4 : 0.5) ? 2 : j > (f >= 1 ? 0.12 : 0.18) ? 1 : 0;
      monke.mouth[0].visible = monke.mouthFrame === 1;
      monke.mouth[1].visible = monke.mouthFrame === 2;
    }
  } else if (monke.jawMesh) monke.jawMesh.scale.y = Math.max(0.08, 1 - monke.jaw * 0.85);
  // The monke faces you, so its left eye is on screen right (higher x).
  if (!monke.block) monke.lids.forEach((lid) => {
    const b = lid.userData.side > 0 ? monke.blinkL : monke.blinkR;
    lid.scale.y = Math.max(0.001, b); // patches hang from their top edge
  });
  const h = monke.headGroup.rotation;
  h.x += (rx - h.x) * k;
  h.y += (ry - h.y) * k;
  h.z += (rz - h.z) * k;
  const off = Math.abs(jaw - monke.jaw) + Math.abs(bl - monke.blinkL) + Math.abs(br - monke.blinkR)
    + Math.abs(rx - h.x) + Math.abs(ry - h.y) + Math.abs(rz - h.z);
  return live || idle || off > 0.002;
}
