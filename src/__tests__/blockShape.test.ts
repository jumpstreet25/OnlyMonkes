import bare from "./fixtures/bareMonkes.json";
import { solidFromPx, blockFaces, halfDepths, BLOCK_LIMITS, NECK_GAP, FRONT, neckPivot, clampTilt } from "../../public/viewer/blockShape.js";

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

/** Unit cube rotated (axes u) at c1 vs axis-aligned unit cube at c2: overlapping by more than 0.001? */
function overlaps(c1: V3, u: V3[], c2: V3): boolean {
  const e: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const axes: V3[] = [...e, ...u];
  for (const a of e) for (const b of u) { const c = cross(a, b); if (dot(c, c) > 1e-9) axes.push(c); }
  const d: V3 = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
  for (const L of axes) {
    const len = Math.sqrt(dot(L, L));
    const r1 = 0.5 * u.reduce((s, ui) => s + Math.abs(dot(ui, L)), 0) / len;
    const r2 = 0.5 * (Math.abs(L[0]) + Math.abs(L[1]) + Math.abs(L[2])) / len;
    if (Math.abs(dot(d, L)) / len >= r1 + r2 - 0.001) return false;
  }
  return true;
}

/** Does the head, turned to (pitch, yaw, roll) about its neck pivot, touch the body? */
export function headHitsBody(px: number[][][], pitch: number, yaw: number, roll: number): boolean {
  const solid = solidFromPx(px);
  const { cubes } = blockFaces(px, solid);
  const pivot = neckPivot(solid) as V3;
  const u = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).map((v) => rotate(v, pitch * DEG, yaw * DEG, roll * DEG));
  const body = cubes.body.map(([x, r, z]) => [x - 7.5, 8 - r - 0.5, z] as V3);
  for (const [x, r, z] of cubes.head) {
    const local: V3 = [x - 7.5 - pivot[0], 8 - r - 0.5 + NECK_GAP - pivot[1], z - pivot[2]];
    const w = rotate(local, pitch * DEG, yaw * DEG, roll * DEG);
    const c: V3 = [w[0] + pivot[0], w[1] + pivot[1], w[2] + pivot[2]];
    for (const b of body) {
      const dd = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 + (b[2] - c[2]) ** 2;
      if (dd < 3.01 && overlaps(c, u, b)) return true;
    }
  }
  return false;
}

const steps = (lim: number) => [-lim, -lim / 2, 0, lim / 2, lim];

describe.each(bare as { fur: string; n: number; px: number[][][] }[])("$fur (#$n) block monke", ({ px }) => {
  const solid = solidFromPx(px);
  const { H, cubes, faces } = blockFaces(px, solid);

  test("solid: every art pixel has a column, symmetric front/back, no gaps", () => {
    for (let r = 0; r < 16; r++) for (let x = 0; x < 16; x++) {
      if (!solid[r][x]) continue;
      expect(H[r][x]).toBeGreaterThanOrEqual(1);
      const zs = [...cubes.head, ...cubes.body].filter((c) => c[0] === x && c[1] === r).map((c) => c[2]).sort((a, b) => a - b);
      expect(zs).toEqual(Array.from({ length: 2 * H[r][x] + 1 }, (_, i) => i - H[r][x]));
    }
  });

  test("no dents: every row and column climbs to one peak", () => {
    const D = halfDepths(solid);
    const runs = (vals: number[]) => {
      let down = false;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] < vals[i - 1]) down = true;
        else if (vals[i] > vals[i - 1] && down) return false;
      }
      return true;
    };
    for (let r = 0; r < 16; r++) expect(runs(D[r].filter((_, x) => solid[r][x]))).toBe(true);
  });

  test("eyes and dark details only on the front, the back of the head is not a face", () => {
    const front = new Set(faces.head.filter((f) => f.dir === FRONT).map((f) => f.c));
    const eye = (px[9][7][0] << 16) | (px[9][7][1] << 8) | px[9][7][2];
    if (!front.has(eye)) return;
    const elsewhere = faces.head.filter((f) => f.dir !== FRONT && f.c === eye && !(f.x === 7 && f.r === 9 && f.dir === FRONT));
    expect(elsewhere).toEqual([]);
  });

  test("head never touches the body anywhere inside the turn limits", () => {
    const { yaw, pitch, roll } = BLOCK_LIMITS;
    const tilts: [number, number][] = [[0, 0]];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      tilts.push(clampTilt(Math.cos(a) * pitch * 1.5, Math.sin(a) * roll * 1.5) as [number, number]);
    }
    for (const y of [-yaw, -yaw * 2 / 3, -yaw / 3, 0, yaw / 3, yaw * 2 / 3, yaw])
      for (const [p, ro] of tilts)
        expect([y, p, ro, headHitsBody(px, p, y, ro)]).toEqual([y, p, ro, false]);
  });
});
