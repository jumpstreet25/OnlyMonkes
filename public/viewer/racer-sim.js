// MonkeKart (was Monke RC) — the rules, with no DOM or three.js so they run in Node checks and (later)
// on the worker. One track per local calendar day (3am→3am) built from the date; a fixed 120 Hz step so a run
// and its ghost replay the same everywhere. World: x/z ground plane, y up, heading a
// (forward = (cos a, sin a) in x/z). Each track point also has a height T.y[i].
export const RV = 3;
export const DT = 1 / 120;
export const LAPS = 3;
// RV 2 (2026-11-12, owner: "without boost the car travels slow"): RV 1's drag cancelled
// ~28% of V_MAX (real cruise ~56, boost 108 = +93%). Now throttle reaches V_MAX exactly
// (drag only when coasting), cruise is +60% (~90), boost is a +40% bonus, roads and
// tracks are wider/larger to match, grass and shallow wall scrapes keep most speed.
// RV 3 (2026-11-20, owner: "Bridges, tunnels, over-passes, hills, mountains, and make the tracks
// very different every 24hrs"): every point has a height (hills, grades capped) and gravity pulls
// along slopes; each day picks a layout — classic circuit, figure-8 whose crossing is an overpass,
// or a long stretched course — and features: a tunnel through a mountain, a river the road bridges.
export const ROAD_W = 32;          // road width
export const SHOULDER = 8;         // grass strip between road edge and barrier
export const V_MAX = 90;           // top speed on road
export const V_GRASS = 50;         // speed cap on grass (grass drag settles it near 44)
export const V_BOOST = 126;
const ACCEL = 82, BRAKE = 120, DRAG = 0.35, GRASS_DRAG = 0.4;
const GRIP = 9, DRIFT_GRIP = 2.2, TURN = 2.6, DRIFT_TURN = 3.4;
const BOOST_PAD_S = 1.0, PADS = 6; // 4–6 pads by track length
/** Drift boost levels: hold a drift past `charge` for a boost of `s` seconds (blue → yellow → pink). */
export const DRIFT_TIERS = [{ charge: 0.5, s: 0.5 }, { charge: 1.1, s: 0.9 }, { charge: 1.8, s: 1.4 }];
export const driftTier = (charge) => DRIFT_TIERS.reduce((t, d, i) => (charge >= d.charge ? i + 1 : t), 0);
/** Start boost for pressing right before GO (racer.js times it; quality 0..1). */
export const LAUNCH_MAX_S = 1.0;
export const GHOST_EVERY = 3;      // record a ghost frame every 3 steps (40 Hz)
export const CLEARANCE = 13;       // overpass: height between the two roads where they cross
export const TUNNEL_H = 15;        // tunnel ceiling over the road
const GRAV = 30;                   // pull along the slope (units/s² per unit of grade)
const RAMP = 52;                   // overpass ramp half-length in points (4 units each)
export const LAYOUTS = ["circuit", "eight", "long"];

export function hashSeed(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// The race day is the player's own calendar date, turning over at 3am local time (owner 2026-11-14:
// "I want the track to match the day … based on time zone"), like the daily word games: everyone
// on Sunday plays the Sunday track, one board per date. HOLDS launch a track early: a date inside
// [from, until) plays the `until` track — First Snow (2026-11-15) from its 5pm Nov 14 launch, and the
// first hilly figure-8 (2026-11-21) from its Nov 20 evening launch (owner: "ship the new level now").
// Keep in step with worker racer.ts HOLDS. The worker accepts every date that is "today" somewhere
// (UTC−12 … UTC+14).
export const DAY_START_H = 3;
export const HOLDS = [["2026-11-14", "2026-11-15"], ["2026-11-20", "2026-11-21"]];
export const holdDay = (id) => { for (const [from, until] of HOLDS) if (id >= from && id < until) return until; return id; };
const pad = (v) => String(v).padStart(2, "0");
export function todayId(d = new Date()) {
  const t = new Date(d.getTime() - DAY_START_H * 3600_000);
  return holdDay(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`);
}
/** When the track after `id` arrives, in the player's local time (ms). */
export function nextTrackAt(id) {
  const [y, m, d] = id.split("-").map(Number);
  return new Date(y, m - 1, d + 1, DAY_START_H, 0).getTime();
}

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

/** Pairs of points far apart along the loop but closer than `clear` on the ground (i < j). */
function overlaps(pts, clear) {
  const n = pts.length, gap = Math.ceil((clear * 2.2) / 4), out = [];
  for (let i = 0; i < n; i += 2) for (let j = i + gap; j < n; j += 2) {
    if (n - (j - i) < gap) continue;
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d < clear) out.push([i, j, d]);
  }
  return out;
}

export const cyc = (a, b, N) => { const d = Math.abs(a - b) % N; return Math.min(d, N - d); };
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function ctrlCircuit(r) {
  const n = 9 + Math.floor(r() * 4), base = (230 + r() * 70) * 1.2, ctrl = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.35;
    let rad = base * (0.62 + r() * 0.6);
    if (r() < 0.22) rad *= 0.55; // pinch → hairpin
    ctrl.push([Math.cos(ang) * rad * 1.15, Math.sin(ang) * rad]);
  }
  return ctrl;
}
/** A long course: a stretched loop (2–2.6 : 1) with a few pinches. */
function ctrlLong(r) {
  const n = 12 + Math.floor(r() * 4), base = (210 + r() * 50) * 1.2, ax = 2 + r() * 0.6, ctrl = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.25;
    let rad = base * (0.75 + r() * 0.4);
    if (r() < 0.18) rad *= 0.62;
    ctrl.push([Math.cos(ang) * rad * ax, Math.sin(ang) * rad * 0.8]);
  }
  return ctrl;
}
/** Figure-8: points on a lemniscate (crossing at the origin), lobes fattened and jittered away from the crossing. */
function ctrlEight(r) {
  const n = 20, a = (300 + r() * 80) * 1.2, fat = 1.3 + r() * 0.5, tilt = (r() - 0.5) * 0.5, ctrl = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, nearX = Math.min(cyc(i, n / 4, n), cyc(i, (3 * n) / 4, n)) <= 1;
    const den = 1 + Math.sin(t) ** 2, j = nearX ? 1 : 0.88 + r() * 0.24;
    const x = ((a * Math.cos(t)) / den) * j, z = ((a * Math.sin(t) * Math.cos(t)) / den) * fat * j;
    ctrl.push([x * Math.cos(tilt) - z * Math.sin(tilt), x * Math.sin(tilt) + z * Math.cos(tilt)]);
  }
  return ctrl;
}

/**
 * Builds the track for a course id. The day's seed picks a layout (circuit 40%, figure-8 35%, long
 * 25%), a hill profile and features. Loops are sampled every 4 units; any place where the road comes
 * near itself is rejected unless it is the figure-8 crossing, where one road climbs over the other
 * with at least CLEARANCE between them.
 */
export function buildTrack(id) {
  const seed = hashSeed(`monke-rc:${RV}:${id}`);
  const roll = rng(seed ^ 0x1a40)();
  const layout = id === "demo" ? "circuit" : roll < 0.4 ? "circuit" : roll < 0.75 ? "eight" : "long";
  for (let attempt = 0; attempt < 80; attempt++) {
    const r = rng(seed + attempt * 7919);
    const ctrl = layout === "eight" ? ctrlEight(r) : layout === "long" ? ctrlLong(r) : ctrlCircuit(r);
    const pts = sampleLoop(ctrl, 4);
    if (pts.length < 260 || pts.length > 900) continue;
    const N = pts.length, clear = ROAD_W + 2 * SHOULDER + 22;
    const ov = overlaps(pts, clear);
    let cross = null;
    if (layout === "eight") {
      if (!ov.length) continue;
      const m = ov.reduce((b, p) => (p[2] < b[2] ? p : b));
      // one crossing only
      if (ov.some(([i, j]) => cyc(i, m[0], N) > 22 || cyc(j, m[1], N) > 22)) continue;
      // flat top of the overpass: covers every point of the upper road that is near the lower one
      const plateau = 3 + Math.max(...ov.map(([i]) => cyc(i, m[0], N)));
      cross = [m[0], m[1], plateau];
    } else if (ov.length) continue;
    const tan = [], nor = [], curv = [];
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
    if (maxCurv > 0.06) continue; // tighter than a ~17-unit radius: undriveable at RV 2 speeds
    if (cross) {
      const [ci, cj] = cross, d = tan[ci][0] * tan[cj][0] + tan[ci][1] * tan[cj][1];
      if (Math.abs(d) > 0.6) continue; // the roads must cross at a wide angle
    }
    // Start on the straightest stretch, never on an overpass ramp.
    let start = -1, bestSum = Infinity;
    for (let i = 0; i < N; i++) {
      if (cross && (cyc(i, cross[0], N) < cross[2] + RAMP + 30 || cyc(i, cross[1], N) < cross[2] + RAMP + 30)) continue;
      let s = 0; for (let k = -12; k <= 12; k++) s += Math.abs(curv[(i + k + N) % N]);
      if (s < bestSum) { bestSum = s; start = i; }
    }
    if (start < 0) continue;
    const rot = (arr) => arr.slice(start).concat(arr.slice(0, start));
    const T = { id, seed, layout, pts: rot(pts), tan: rot(tan), nor: rot(nor), curv: rot(curv), N, length: N * 4 };
    if (cross) T.cross = { up: (cross[0] - start + N) % N, down: (cross[1] - start + N) % N, plateau: cross[2] };
    // Heights: a few periodic waves, flat at the start line and calm around the crossing, plus the overpass ramp.
    const hr = rng(seed ^ 0x4111), hk = hr();
    const amp = id === "demo" ? 3 : hk < 0.1 ? 4 : hk < 0.4 ? 9 : hk < 0.75 ? 14 : 19;
    const waves = [1, 2, 3, 5].map((k) => ({ k, a: hr(), ph: hr() * Math.PI * 2 }));
    const wsum = waves.reduce((s, w) => s + w.a, 0);
    const raw = (i) => waves.reduce((s, w) => s + w.a * Math.sin((2 * Math.PI * w.k * i) / N + w.ph), 0) / wsum;
    const calm = (i) => {
      let w = smooth(10, 34, cyc(i, 0, N));
      if (T.cross) w *= smooth(T.cross.plateau + RAMP * 0.6, T.cross.plateau + RAMP * 1.4, Math.min(cyc(i, T.cross.up, N), cyc(i, T.cross.down, N)));
      return w;
    };
    const hills = []; for (let i = 0; i < N; i++) hills.push((raw(i) - raw(0)) * calm(i));
    let grade = 0; for (let i = 0; i < N; i++) grade = Math.max(grade, Math.abs(hills[(i + 1) % N] - hills[i]) / 4);
    const scale = Math.min(amp, 0.11 / Math.max(1e-6, grade));
    T.y = hills.map((h) => h * scale);
    if (T.cross) {
      const H = CLEARANCE + 3, P = T.cross.plateau;
      for (let i = 0; i < N; i++) {
        const d = cyc(i, T.cross.up, N);
        if (d <= P) T.y[i] += H;
        else if (d < P + RAMP) T.y[i] += (H * (1 + Math.cos((Math.PI * (d - P)) / RAMP))) / 2;
      }
      if (overlaps(T.pts, clear).some(([i, j]) => Math.abs(T.y[i] - T.y[j]) < CLEARANCE)) continue;
    }
    // Features: a tunnel on a gentle stretch, a river line the road bridges (renderer carves the valley).
    const fr = rng(seed ^ 0x7a11);
    const busy = (i, pad) => cyc(i, 0, N) < 40 + pad || (T.cross && (cyc(i, T.cross.up, N) < T.cross.plateau + RAMP + pad || cyc(i, T.cross.down, N) < T.cross.plateau + RAMP + pad));
    const wantTunnel = id !== "demo" && (layout !== "eight" ? fr() < 0.7 : fr() < 0.45);
    if (wantTunnel) {
      const len = 30 + Math.floor(fr() * 16);
      for (let tries = 0; tries < 60; tries++) {
        const a = Math.floor(fr() * N), b = a + len;
        let ok = true;
        for (let i = a - 6; i <= b + 6 && ok; i++) { const k = ((i % N) + N) % N; if (busy(k, 10) || Math.abs(T.curv[k]) > 0.022) ok = false; }
        if (ok) { T.tunnel = { a: a % N, len }; break; }
      }
    }
    const wantRiver = id !== "demo" && (!T.tunnel || fr() < 0.5);
    if (wantRiver) {
      for (let tries = 0; tries < 60; tries++) {
        const i = Math.floor(fr() * N);
        if (busy(i, 14) || (T.tunnel && cyc(i, (T.tunnel.a + T.tunnel.len / 2) % N, N) < T.tunnel.len / 2 + 40)) continue;
        let s = 0; for (let k = -8; k <= 8; k++) s += Math.abs(T.curv[(i + k + N) % N]);
        if (s > 0.25) continue;
        const t = T.tan[i], skew = (fr() - 0.5) * 0.7, ang = Math.atan2(t[1], t[0]) + Math.PI / 2 + skew;
        T.river = { i, x: T.pts[i][0], z: T.pts[i][1], dx: Math.cos(ang), dz: Math.sin(ang) };
        break;
      }
    }
    // Boost pads on the straighter parts, away from the start and out of the tunnel.
    T.pads = [];
    const pr = rng(seed ^ 0xb005);
    const nPads = Math.min(PADS, Math.max(4, Math.round(N / 100)));
    for (let tries = 0; tries < 400 && T.pads.length < nPads; tries++) {
      const i = 40 + Math.floor(pr() * (N - 80));
      let s = 0; for (let k = -6; k <= 6; k++) s += Math.abs(T.curv[(i + k) % N]);
      if (s > 0.2 || inTunnel(T, i) || T.pads.some((p) => Math.abs(p.i - i) < N / 10)) continue;
      T.pads.push({ i, off: (pr() - 0.5) * (ROAD_W * 0.45) });
    }
    T.checkpoints = [0.25, 0.5, 0.75].map((f) => Math.floor(N * f));
    return T;
  }
  throw new Error(`no track for ${id}`);
}

/** Is centreline index i inside the tunnel (with `pad` extra points at each end)? */
export function inTunnel(T, i, pad = 0) { return !!T.tunnel && ((i - T.tunnel.a + pad + T.N) % T.N) <= T.tunnel.len + 2 * pad; }
/** Grade at index i (rise per unit forward). */
export function slopeAt(T, i) { const N = T.N; return (T.y[(i + 1) % N] - T.y[(i - 1 + N) % N]) / 8; }
/** Road height under (x, z) near centreline index i (slope-interpolated along the road). */
export function heightAt(T, i, x, z) {
  const p = T.pts[i], t = T.tan[i];
  return T.y[i] + ((x - p[0]) * t[0] + (z - p[1]) * t[1]) * slopeAt(T, i);
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
    lapStart: 0, laps: [], boost: 0, driftCharge: 0, drifting: false, grass: false, hitWall: 0, lastPad: -1,
    ghost: [], step: 0, cpTimes: [],
  };
}

export const speedOf = (r) => Math.hypot(r.vf, r.vl);

/** Start boost: called once at GO with how well the press was timed (0..1). */
export function launch(r, quality) {
  const s = Math.max(0, Math.min(1, quality)) * LAUNCH_MAX_S;
  if (s > 0.15) r.boost = Math.max(r.boost, s);
  return s;
}

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
  const drift = !!input.drift && spd > 40 && Math.abs(r.steer) > 0.35;
  const tier = driftTier(r.driftCharge);
  if (r.drifting && !drift && tier > 0) { const s = DRIFT_TIERS[tier - 1].s; r.boost = Math.max(r.boost, s); ev.push({ type: "driftBoost", s, tier }); }
  if (!drift) r.driftCharge = 0;
  r.drifting = drift;
  if (drift) r.driftCharge += DT * (0.6 + Math.abs(r.steer) * 0.6);
  const turnK = (drift ? DRIFT_TURN : TURN) * Math.min(1, spd / 18) * (1 - Math.min(0.3, spd / 400));
  r.a += r.steer * turnK * DT * Math.sign(r.vf || 1);
  // forward/lateral velocity in the car's frame
  const vmax = r.boost > 0 ? V_BOOST : r.grass ? V_GRASS : V_MAX;
  const gas = input.gas ?? 0;
  if (r.boost > 0) { r.vf += ACCEL * 1.6 * DT; r.boost = Math.max(0, r.boost - DT); }
  else if (input.brake > 0) r.vf = r.vf > 0 ? Math.max(0, r.vf - BRAKE * input.brake * DT) : r.vf - BRAKE * input.brake * DT * 0.35 * (input.gas === 0 && input.reverse ? 1 : 0);
  else r.vf += ACCEL * gas * (1 - Math.max(0, r.vf) / vmax) * DT * 1.6;
  // Coasting drag only on the road (throttle settles exactly at vmax); grass always drags.
  if (r.grass) r.vf -= r.vf * GRASS_DRAG * DT;
  else if (r.boost <= 0 && !(gas > 0)) r.vf -= r.vf * DRAG * DT;
  if (r.vf > vmax) r.vf += (vmax - r.vf) * Math.min(1, DT * 3);
  r.vf -= GRAV * slopeAt(T, r.idx) * DT; // uphill slows, downhill speeds up
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
    // a shallow scrape keeps ~90% of the speed, a head-on hit keeps ~42%
    r.vf *= 0.97 - Math.min(0.55, Math.abs(Math.sin(da)) * 0.8);
    r.vl = -r.vl * 0.3 - sg * 4;
    if (r.hitWall <= 0 && hit > 8) ev.push({ type: "wall", speed: hit });
    r.hitWall = 0.25;
  }
  r.hitWall -= DT;
  // boost pads
  for (const p of T.pads) {
    const di = (r.idx - p.i + T.N) % T.N;
    if (di <= 3 && Math.abs(side - p.off) < 6.5 && r.lastPad !== p.i) { r.lastPad = p.i; r.boost = Math.max(r.boost, BOOST_PAD_S); ev.push({ type: "pad" }); }
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
      r.laps.push(ms); r.lap++; r.cp = 0; r.lapStart = r.t; r.lastPad = -1;
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
  const target = V_MAX * (1 - Math.min(0.62, curveAhead * 11 / skill));
  const spd = speedOf(r);
  return { steer: Math.max(-1, Math.min(1, da * 2.4)), gas: spd < target ? 1 : 0, brake: spd > target + 8 ? 0.6 : 0, drift: Math.abs(da) > 0.5 && spd > 40 };
}
