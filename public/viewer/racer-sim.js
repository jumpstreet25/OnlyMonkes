// Monke RC — the rules, with no DOM or three.js so they run in Node checks and (later)
// on the worker. One track per UTC day built from the date; a fixed 120 Hz step so a run
// and its ghost replay the same everywhere. World: x/z ground plane, y up, heading a
// (forward = (cos a, sin a) in x/z).
export const RV = 1;
export const DT = 1 / 120;
export const LAPS = 3;
export const ROAD_W = 26;          // road width
export const SHOULDER = 7;         // grass strip between road edge and barrier
export const V_MAX = 78;           // top speed on road
export const V_GRASS = 34;         // top speed on grass
export const V_BOOST = 108;
const ACCEL = 46, BRAKE = 95, DRAG = 0.35, GRASS_DRAG = 2.4;
const GRIP = 9, DRIFT_GRIP = 2.2, TURN = 2.25, DRIFT_TURN = 3.05;
const BOOST_PAD_S = 1.1, DRIFT_BOOST_MAX = 1.2;
export const GHOST_EVERY = 3;      // record a ghost frame every 3 steps (40 Hz)

export function hashSeed(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const todayId = (d = new Date()) => d.toISOString().slice(0, 10);

// ── Track ──
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

function sampleLoop(ctrl, step) {
  const dense = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < 40; k++) dense.push(catmull(p0, p1, p2, p3, k / 40));
  }
  // resample evenly by arc length
  const pts = [dense[0]]; let acc = 0;
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]), from = a;
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      const p = [from[0] + (b[0] - from[0]) * t, from[1] + (b[1] - from[1]) * t];
      pts.push(p); seg -= step - acc; acc = 0; from = p;
    }
    acc += seg;
  }
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < step * 0.5) pts.pop();
  return pts;
}

function selfOverlap(pts, clear) {
  const n = pts.length, gap = Math.ceil((clear * 2.2) / 4);
  for (let i = 0; i < n; i += 2) for (let j = i + gap; j < n; j += 2) {
    if (n - (j - i) < gap) continue;
    if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < clear) return true;
  }
  return false;
}

/**
 * Builds the track for a course id: a closed loop through 9–12 jittered control points
 * (some pulled in for hairpins), sampled every 4 units. Rejects loops that come near
 * themselves (the road plus both barriers must never touch another part of the track).
 */
export function buildTrack(id) {
  const seed = hashSeed(`monke-rc:${RV}:${id}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = rng(seed + attempt * 7919);
    const n = 9 + Math.floor(r() * 4), base = 230 + r() * 70, ctrl = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.35;
      let rad = base * (0.62 + r() * 0.6);
      if (r() < 0.22) rad *= 0.55; // pinch → hairpin
      ctrl.push([Math.cos(ang) * rad * 1.15, Math.sin(ang) * rad]);
    }
    const pts = sampleLoop(ctrl, 4);
    if (pts.length < 220 || pts.length > 700) continue;
    if (selfOverlap(pts, ROAD_W + 2 * SHOULDER + 22)) continue;
    const N = pts.length, tan = [], nor = [], curv = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      tan.push([dx / l, dz / l]); nor.push([-dz / l, dx / l]);
    }
    let maxCurv = 0;
    for (let i = 0; i < N; i++) {
      const t0 = tan[(i - 3 + N) % N], t1 = tan[(i + 3) % N];
      const c = Math.atan2(t0[0] * t1[1] - t0[1] * t1[0], t0[0] * t1[0] + t0[1] * t1[1]) / 24;
      curv.push(c); maxCurv = Math.max(maxCurv, Math.abs(c));
    }
    if (maxCurv > 0.07) continue; // tighter than a ~14-unit radius: undriveable
    // Start on the straightest stretch.
    let start = 0, bestSum = Infinity;
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -12; k <= 12; k++) s += Math.abs(curv[(i + k + N) % N]); if (s < bestSum) { bestSum = s; start = i; } }
    const rot = (arr) => arr.slice(start).concat(arr.slice(0, start));
    const T = { id, seed, pts: rot(pts), tan: rot(tan), nor: rot(nor), curv: rot(curv), N, length: N * 4 };
    // Boost pads on the straighter parts, away from the start.
    T.pads = [];
    const pr = rng(seed ^ 0xb005);
    for (let tries = 0; tries < 200 && T.pads.length < 3; tries++) {
      const i = 40 + Math.floor(pr() * (N - 80));
      let s = 0; for (let k = -6; k <= 6; k++) s += Math.abs(T.curv[(i + k) % N]);
      if (s > 0.12 || T.pads.some((p) => Math.abs(p.i - i) < N / 6)) continue;
      T.pads.push({ i, off: (pr() - 0.5) * (ROAD_W * 0.45) });
    }
    T.checkpoints = [0.25, 0.5, 0.75].map((f) => Math.floor(N * f));
    return T;
  }
  throw new Error(`no track for ${id}`);
}

/** Closest centreline index to (x, z), searching ±w around a hint. */
export function nearest(T, x, z, hint, w = 30) {
  let best = hint, bd = Infinity;
  for (let k = -w; k <= w; k++) {
    const i = (hint + k + T.N) % T.N, p = T.pts[i], d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Signed sideways distance from the centreline at index i (+ = right of travel). */
export function sideOf(T, i, x, z) { const p = T.pts[i], n = T.nor[i]; return (x - p[0]) * n[0] + (z - p[1]) * n[1]; }

// ── Run ──
export function createRun(T) {
  const p = T.pts[0], t = T.tan[0];
  return {
    T, x: p[0] - t[0] * 10, z: p[1] - t[1] * 10, a: Math.atan2(t[1], t[0]),
    vf: 0, vl: 0, steer: 0, idx: T.N - 3, lap: 0, cp: 0, t: 0, started: false, done: false,
    lapStart: 0, laps: [], boost: 0, driftCharge: 0, drifting: false, grass: false, hitWall: 0,
    ghost: [], step: 0, cpTimes: [],
  };
}

export const speedOf = (r) => Math.hypot(r.vf, r.vl);

/**
 * One fixed step. input: { steer: -1..1 (+ = right), gas: 0..1, brake: 0..1, drift: bool, reverse?: bool }.
 * Returns events: { type: "lap", n, ms } | { type: "finish", ms } | { type: "wall", speed } |
 * { type: "pad" } | { type: "driftBoost", s } | { type: "checkpoint", n, ms }.
 */
export function step(r, input) {
  const ev = [];
  if (r.done) return ev;
  if (r.started) r.t += DT;
  const T = r.T;
  // steering eases toward the input; faster cars turn a little less
  r.steer += (Math.max(-1, Math.min(1, input.steer)) - r.steer) * Math.min(1, DT * 10);
  const spd = speedOf(r);
  const drift = !!input.drift && spd > 34 && Math.abs(r.steer) > 0.35;
  if (r.drifting && !drift && r.driftCharge > 0.35) { const s = Math.min(DRIFT_BOOST_MAX, r.driftCharge); r.boost = Math.max(r.boost, s); ev.push({ type: "driftBoost", s }); }
  if (!drift) r.driftCharge = 0;
  r.drifting = drift;
  if (drift) r.driftCharge += DT * (0.6 + Math.abs(r.steer) * 0.6);
  const turnK = (drift ? DRIFT_TURN : TURN) * Math.min(1, spd / 18) * (1 - Math.min(0.35, spd / 300));
  r.a += r.steer * turnK * DT * Math.sign(r.vf || 1);
  // forward/lateral velocity in the car's frame
  const vmax = r.boost > 0 ? V_BOOST : r.grass ? V_GRASS : V_MAX;
  if (r.boost > 0) { r.vf += ACCEL * 2.2 * DT; r.boost = Math.max(0, r.boost - DT); }
  else if (input.brake > 0) r.vf = r.vf > 0 ? Math.max(0, r.vf - BRAKE * input.brake * DT) : r.vf - BRAKE * input.brake * DT * 0.35 * (input.gas === 0 && input.reverse ? 1 : 0);
  else r.vf += ACCEL * (input.gas ?? 0) * (1 - Math.max(0, r.vf) / vmax) * DT * 1.6;
  r.vf -= r.vf * (r.grass ? GRASS_DRAG : DRAG) * DT;
  if (r.vf > vmax) r.vf += (vmax - r.vf) * Math.min(1, DT * 3);
  if (r.vf < -18) r.vf = -18;
  // turning pushes velocity sideways; grip pulls it back in line
  const turnRate = r.steer * turnK * Math.sign(r.vf || 1);
  r.vl += -turnRate * r.vf * DT * (drift ? 0.55 : 0.18);
  r.vl *= Math.exp(-(drift ? DRIFT_GRIP : GRIP) * DT);
  const ca = Math.cos(r.a), sa = Math.sin(r.a);
  r.x += (ca * r.vf - sa * r.vl) * DT;
  r.z += (sa * r.vf + ca * r.vl) * DT;
  // where on the track
  const prev = r.idx;
  r.idx = nearest(T, r.x, r.z, r.idx);
  const side = sideOf(T, r.idx, r.x, r.z), lim = ROAD_W / 2 + SHOULDER;
  r.grass = Math.abs(side) > ROAD_W / 2;
  if (Math.abs(side) > lim) {
    // barrier: put the car back inside, lose speed, bounce off the wall's angle
    const n = T.nor[r.idx], push = Math.abs(side) - lim, sg = Math.sign(side);
    r.x -= n[0] * sg * (push + 0.3); r.z -= n[1] * sg * (push + 0.3);
    const t = T.tan[r.idx], along = Math.atan2(t[1], t[0]);
    let da = Math.atan2(Math.sin(r.a - along), Math.cos(r.a - along));
    const hit = Math.abs(Math.sin(da)) * Math.abs(r.vf);
    r.a -= da * 0.35;
    r.vf *= 0.82 - Math.min(0.4, Math.abs(Math.sin(da)) * 0.5);
    r.vl = -r.vl * 0.3 - sg * 4;
    if (r.hitWall <= 0 && hit > 8) ev.push({ type: "wall", speed: hit });
    r.hitWall = 0.25;
  }
  r.hitWall -= DT;
  // boost pads
  for (const p of T.pads) {
    const di = (r.idx - p.i + T.N) % T.N;
    if (di <= 2 && Math.abs(side - p.off) < 6 && r.boost < BOOST_PAD_S - 0.1) { r.boost = BOOST_PAD_S; ev.push({ type: "pad" }); }
  }
  // checkpoints and laps (moving forward past each in order; the line is index 0)
  const fwd = (a, b) => { const d = (b - a + T.N) % T.N; return d > 0 && d < T.N / 2; };
  if (r.cp < 3 && fwd(prev, r.idx) && passed(prev, r.idx, T.checkpoints[r.cp], T.N)) {
    r.cp++;
    ev.push({ type: "checkpoint", n: r.lap * 3 + r.cp, ms: Math.round(r.t * 1000) });
    r.cpTimes.push(r.t);
  }
  if (fwd(prev, r.idx) && prev > r.idx) {
    if (!r.started) { r.started = true; }
    else if (r.cp === 3) {
      const ms = Math.round((r.t - r.lapStart) * 1000);
      r.laps.push(ms); r.lap++; r.cp = 0; r.lapStart = r.t;
      ev.push({ type: "lap", n: r.lap, ms });
      if (r.lap >= LAPS) { r.done = true; ev.push({ type: "finish", ms: Math.round(r.t * 1000) }); }
    }
  }
  if (r.started && r.step++ % GHOST_EVERY === 0) r.ghost.push([+r.x.toFixed(2), +r.z.toFixed(2), +r.a.toFixed(3)]);
  return ev;
}

function passed(a, b, c, N) { return ((c - a + N) % N) <= ((b - a + N) % N) && ((c - a + N) % N) > 0; }

/** Ghost pose at run time t (seconds since the line), interpolated. */
export function ghostAt(g, t) {
  if (!g?.length) return null;
  const f = t / (DT * GHOST_EVERY), i = Math.floor(f);
  if (i >= g.length - 1) return { x: g[g.length - 1][0], z: g[g.length - 1][1], a: g[g.length - 1][2], done: true };
  const k = f - i, A = g[Math.max(0, i)], B = g[i + 1];
  let da = B[2] - A[2]; da = Math.atan2(Math.sin(da), Math.cos(da));
  return { x: A[0] + (B[0] - A[0]) * k, z: A[1] + (B[1] - A[1]) * k, a: A[2] + da * k };
}

/** A simple driver used by the checks and the debug autopilot: aims a few points ahead. */
export function autopilot(r, look = 9, skill = 1) {
  const T = r.T, i = (r.idx + look) % T.N, p = T.pts[i];
  const want = Math.atan2(p[1] - r.z, p[0] - r.x);
  const da = Math.atan2(Math.sin(want - r.a), Math.cos(want - r.a));
  let curveAhead = 0; for (let k = 4; k < 30; k += 2) curveAhead = Math.max(curveAhead, Math.abs(T.curv[(r.idx + k) % T.N]));
  const target = V_MAX * (1 - Math.min(0.62, curveAhead * 9 / skill));
  const spd = speedOf(r);
  return { steer: Math.max(-1, Math.min(1, da * 2.4)), gas: spd < target ? 1 : 0, brake: spd > target + 8 ? 0.6 : 0, drift: Math.abs(da) > 0.5 && spd > 40 };
}
