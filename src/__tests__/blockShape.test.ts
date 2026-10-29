import bare from "./fixtures/bareMonkes.json";
import { solidFromPx, blockFaces, BLOCK_LIMITS, BLOCK_SHAPE, FRONT, BACK, RES, V, NECK_ROW, neckPivot, clampTilt, toWorld } from "../../public/viewer/blockShape.js";
import type { Px } from "../../public/viewer/blockShape.js";

type V3 = [number, number, number];
const DEG = Math.PI / 180;
// three.js Euler order XYZ: v' = Rx · Ry · Rz · v
function rotate([x, y, z]: V3, rx: number, ry: number, rz: number): V3 {
  let a = x * Math.cos(rz) - y * Math.sin(rz), b = x * Math.sin(rz) + y * Math.cos(rz); x = a; y = b;
  a = x * Math.cos(ry) + z * Math.sin(ry); b = -x * Math.sin(ry) + z * Math.cos(ry); x = a; z = b;
  a = y * Math.cos(rx) - z * Math.sin(rx); b = y * Math.sin(rx) + z * Math.cos(rx); y = a; z = b;
  return [x, y, z];
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// One block's half-size in scene units (x is stretched by the width).
const HE: V3 = [(V / 2) * BLOCK_SHAPE.width, V / 2, V / 2];

/** Block rotated (axes u) at c1 vs axis-aligned block at c2: overlapping by more than 0.001? */
function overlaps(c1: V3, u: V3[], c2: V3): boolean {
  const e: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const axes: V3[] = [...e, ...u];
  for (const a of e) for (const b of u) { const c = cross(a, b); if (dot(c, c) > 1e-9) axes.push(c); }
  const d: V3 = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
  for (const L of axes) {
    const len = Math.sqrt(dot(L, L));
    const r1 = u.reduce((s, ui, i) => s + HE[i] * Math.abs(dot(ui, L)), 0) / len;
    const r2 = (HE[0] * Math.abs(L[0]) + HE[1] * Math.abs(L[1]) + HE[2] * Math.abs(L[2])) / len;
    if (Math.abs(dot(d, L)) / len >= r1 + r2 - 0.001) return false;
  }
  return true;
}

const centre = ([i, j, k]: number[], yOff: number): V3 => { const w = toWorld(i + 0.5, j + 0.5, k + 0.5); return [w[0], w[1] + yOff, w[2]]; };

// Per monke: the head's bottom blocks (relative to the pivot) and the body's top blocks.
const parts = new WeakMap<Px, { head: V3[]; body: Map<string, V3[]>; pivot: V3 }>();
const cellOf = (p: V3) => p.map((v) => Math.floor(v * 2)) as V3;
function partsOf(px: Px) {
  let p = parts.get(px);
  if (!p) {
    const solid = solidFromPx(px);
    const { cubes } = blockFaces(px, solid);
    const pivot = neckPivot(solid);
    // Only the bottom of the head can reach the top of the body.
    const head = cubes.head.filter(([, j]) => j >= (NECK_ROW - 4) * 2).map((c) => { const q = centre(c, BLOCK_SHAPE.gap); return [q[0] - pivot[0], q[1] - pivot[1], q[2] - pivot[2]] as V3; });
    const body = new Map<string, V3[]>();
    for (const c of cubes.body) {
      if (c[1] >= (NECK_ROW + 3) * 2) continue;
      const b = centre(c, 0), k = cellOf(b).join(",");
      body.set(k, [...(body.get(k) || []), b]);
    }
    p = { head, body, pivot };
    parts.set(px, p);
  }
  return p;
}

/** Does the head, turned to (pitch, yaw, roll) about its neck pivot, touch the body? */
function headHitsBody(px: Px, pitch: number, yaw: number, roll: number): boolean {
  const { head, body, pivot } = partsOf(px);
  const u = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).map((v) => rotate(v, pitch * DEG, yaw * DEG, roll * DEG));
  for (const h of head) {
    const w = rotate(h, pitch * DEG, yaw * DEG, roll * DEG);
    const c: V3 = [w[0] + pivot[0], w[1] + pivot[1], w[2] + pivot[2]];
    const [x, y, z] = cellOf(c);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++)
      for (const b of body.get(`${x + dx},${y + dy},${z + dz}`) || []) if (overlaps(c, u, b)) return true;
  }
  return false;
}

const fixtures = bare as { fur: string; n: number; px: Px }[];

describe.each(fixtures)("$fur (#$n) block monke", ({ px }) => {
  const solid = solidFromPx(px);
  const { cubes, faces, zFront, fur } = blockFaces(px, solid);
  const key = (p: number[]) => (p[0] << 16) | (p[1] << 8) | p[2];

  test("32×32: every art pixel is 2×2 blocks, each the full part depth", () => {
    for (const part of ["head", "body"] as const) {
      const depth = Math.round((part === "head" ? BLOCK_SHAPE.headD : BLOCK_SHAPE.bodyD) / V);
      const cols = new Map<string, number>();
      for (const [i, j] of cubes[part]) cols.set(i + "," + j, (cols.get(i + "," + j) || 0) + 1);
      for (const n of cols.values()) expect(n).toBe(depth);
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const inPart = (j >> 1 < NECK_ROW) === (part === "head");
        if (inPart) expect(cols.has(i + "," + j)).toBe(solid[j >> 1][i >> 1]);
      }
    }
  });

  test("the front is the NFT, pixel for pixel", () => {
    const front = [...faces.head, ...faces.body].filter((f) => f.dir === FRONT);
    for (const f of front) expect(f.c).toBe(key(px[f.j >> 1][f.i >> 1]));
    expect(zFront.head).toBeCloseTo(BLOCK_SHAPE.headD / 2, 5);
  });

  test("eyes only on the front; the back of the head is fur", () => {
    const eye = key(px[9][7]);
    if (eye === key(px[9][8])) return;
    expect(faces.head.filter((f) => f.dir !== FRONT && f.c === eye)).toEqual([]);
    for (const f of faces.head.filter((g) => g.dir === BACK)) if (f.c !== key(px[f.j >> 1][f.i >> 1])) expect(f.c).toBe(fur);
  });

  test("head turns ±45° and tilts inside the limits without touching the body", () => {
    const { yaw, pitch, roll } = BLOCK_LIMITS;
    const tilts: [number, number][] = [[0, 0]];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      tilts.push(clampTilt(Math.cos(a) * pitch * 1.5, Math.sin(a) * roll * 1.5));
    }
    for (const y of [-yaw, -yaw / 2, 0, yaw / 2, yaw])
      for (const [p, ro] of tilts)
        expect([y, p, ro, headHitsBody(px, p, y, ro)]).toEqual([y, p, ro, false]);
  });
});


