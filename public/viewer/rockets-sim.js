// Banana Rockets — the game itself, with no DOM: course generation, physics,
// landing and scoring. rockets.js draws it and handles input; Node can run this
// file directly (scripts/rockets/check-courses.mjs proves every course can be
// finished).
//
// World units, y points UP (the Moon is above the start). A rocket sits on a
// spinning planet, the player drags back and lets go, and it flies under the
// gravity of nearby planets until it lands, crashes or drifts off. The daily
// course is built from the UTC date, so every phone gets the same course with
// no server call.

export const RV = 1; // bump when physics or generation change (scores stop comparing)
export const DT = 1 / 120;
export const G = 430; // surface pull of a radius-40 planet, units/s²
export const ZONE = 3.4; // gravity reaches ZONE × radius, fading out over the last quarter
export const MIN_V = 150, MAX_V = 540;
export const LAND_V = 300; // touch a planet slower than this and you land; faster and you crash
export const MAX_TILT = 80 * Math.PI / 180; // launch at most this far from straight up off the surface
export const ROCKET_R = 7;
export const BANANA_R = 20;
export const FLIGHT_MAX = 10; // seconds in the air before "lost in space"
export const PENALTY_MS = 3000; // crash or lost: back to the last planet, +3 s

// ── Seeded random ──
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const todayId = (d = new Date()) => d.toISOString().slice(0, 10);

const LOOKS = ["jungle", "banana", "rock", "ice", "lava", "candy"];
const mass = (r) => r * r * (r / 40);

// ── Physics ──
// Pull on (x, y) from every planet whose zone it is inside (and the Moon).
function gravity(world, x, y) {
  let ax = 0, ay = 0;
  for (const b of world.pullers) {
    const dx = b.x - x, dy = b.y - y, d2 = dx * dx + dy * dy, zone = b.r * ZONE;
    if (d2 >= zone * zone) continue;
    const d = Math.sqrt(d2), fade = d > zone * 0.75 ? (zone - d) / (zone * 0.25) : 1;
    const a = (G * mass(b.r) / 40) / Math.max(d2, b.r * b.r) * fade;
    ax += (dx / d) * a; ay += (dy / d) * a;
  }
  return [ax, ay];
}

/**
 * One fixed step of a flying rocket. Mutates f = { x, y, vx, vy, t }.
 * Returns null or { hit: "planet"|"moon"|"rock"|"lost", body, speed }.
 */
export function stepFlight(world, f, dt = DT) {
  const [ax, ay] = gravity(world, f.x, f.y);
  f.vx += ax * dt; f.vy += ay * dt;
  f.x += f.vx * dt; f.y += f.vy * dt;
  f.t += dt;
  const speed = Math.hypot(f.vx, f.vy);
  for (const p of world.planets) {
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (d < p.r + ROCKET_R) return { hit: "planet", body: p, speed };
  }
  const m = world.moon;
  if (m && Math.hypot(f.x - m.x, f.y - m.y) < m.r + ROCKET_R) return { hit: "moon", body: m, speed };
  for (const a of world.rocks) {
    if (Math.hypot(f.x - a.x, f.y - a.y) < a.r + ROCKET_R - 2) return { hit: "rock", body: a, speed };
  }
  const b = world.bounds;
  if (f.t > FLIGHT_MAX || f.x < b.x0 || f.x > b.x1 || f.y < b.y0 || f.y > b.y1) return { hit: "lost", speed };
  return null;
}

/** Launch velocity from a surface angle and a drag: direction (dx, dy), power 0..1. */
export function launchVelocity(surfAng, dx, dy, power) {
  const nx = Math.cos(surfAng), ny = Math.sin(surfAng);
  let ang = Math.atan2(dy, dx), rel = ang - surfAng;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  if (Math.abs(rel) > MAX_TILT) ang = surfAng + Math.sign(rel) * MAX_TILT;
  if (!(dx || dy)) ang = Math.atan2(ny, nx);
  const v = MIN_V + Math.max(0, Math.min(1, power)) * (MAX_V - MIN_V);
  return [Math.cos(ang) * v, Math.sin(ang) * v];
}

export const surfacePoint = (p, ang) => [p.x + Math.cos(ang) * (p.r + ROCKET_R), p.y + Math.sin(ang) * (p.r + ROCKET_R)];

// ── Solver: can a rocket on `from` reach `to`? (used by the generator) ──
// Planets spin, so the player can launch from any point on the surface; the
// solver tries a fan of launch points (centred on the one facing the target),
// directions and powers, all with the game's own step.
function solve(world, from, to, wantPath) {
  const face = Math.atan2(to.y - from.y, to.x - from.x);
  for (let k = 0; k < 7; k++) {
    const surf = face + [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05][k];
    for (let ai = -10; ai <= 10; ai++) {
      const rel = ai * 8 * Math.PI / 180;
      for (let pi = 0; pi <= 10; pi++) {
        const [vx, vy] = launchVelocity(surf, Math.cos(surf + rel), Math.sin(surf + rel), pi / 10);
        const [x, y] = surfacePoint(from, surf);
        const f = { x, y, vx, vy, t: 0 }, path = wantPath ? [] : null;
        for (let s = 0; s < FLIGHT_MAX / DT; s++) {
          const ev = stepFlight(world, f);
          if (path && s % 6 === 0) path.push([f.x, f.y]);
          if (!ev) continue;
          const ok = (ev.hit === "moon" && to === world.moon) || (ev.hit === "planet" && ev.body === to && ev.speed <= LAND_V);
          if (ok) return { surf, rel, power: pi / 10, path, time: f.t };
          break;
        }
      }
    }
  }
  return null;
}

// ── Course generation ──
/** A course from a seed string, e.g. a UTC date "2026-11-11" or "practice-1". */
export function buildCourse(seedStr, opts = {}) {
  const rand = rng(hashSeed(`rockets:${RV}:${seedStr}`));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const hops = opts.hops ?? (6 + (rand() < 0.4 ? 1 : 0));
  const world = { id: seedStr, planets: [], rocks: [], bananas: [], moon: null, pullers: [], bounds: null };
  const setBounds = () => {
    const ys = [...world.planets, ...(world.moon ? [world.moon] : [])].map((p) => p.y);
    world.bounds = { x0: -460, x1: 460, y0: Math.min(...ys) - 520, y1: Math.max(...ys) + 620 };
    world.pullers = [...world.planets, ...(world.moon ? [world.moon] : [])];
  };
  const planet = (x, y, r) => ({ x, y, r, spin: (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.45) * (40 / r) ** 0.5, look: pick(LOOKS), seed: Math.floor(rand() * 1e9) });
  world.planets.push(planet(0, 0, 44));
  world.planets[0].look = "jungle";
  const paths = [];
  const clear = (x, y, r) => world.planets.every((p) => Math.hypot(p.x - x, p.y - y) >= (p.r + r) * 1.7 + 110);

  for (let k = 1; k <= hops; k++) {
    const prev = world.planets[world.planets.length - 1];
    let placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const r = 24 + rand() * 34;
      const dist = 290 + rand() * 150 + r;
      const ang = (rand() * 2 - 1) * 0.95;
      const x = Math.max(-200, Math.min(200, prev.x + Math.sin(ang) * dist)), y = prev.y + Math.cos(ang) * dist;
      if (!clear(x, y, r)) continue;
      const p = planet(x, y, r);
      world.planets.push(p); setBounds();
      // Rocks from the third hop on, beside the straight line so there's always a way round.
      const keepRocks = [];
      if (k >= 2 && rand() < 0.65) {
        for (let rt = 0; rt < 6; rt++) {
          const mx = (prev.x + x) / 2, my = (prev.y + y) / 2, len = Math.hypot(x - prev.x, y - prev.y);
          const ox = -(y - prev.y) / len, oy = (x - prev.x) / len, side = rand() < 0.5 ? -1 : 1, off = 30 + rand() * 70;
          const cluster = [];
          const n = 3 + Math.floor(rand() * 3);
          for (let i = 0; i < n; i++) cluster.push({ x: mx + ox * off * side + (rand() - 0.5) * 70, y: my + oy * off * side + (rand() - 0.5) * 70, r: 8 + rand() * 8, spin: rand() * 6.28 });
          const fits = cluster.every((c) => world.planets.every((q) => Math.hypot(q.x - c.x, q.y - c.y) > q.r + c.r + 40));
          if (!fits) continue;
          world.rocks.push(...cluster);
          if (solve(world, prev, p, false)) { keepRocks.push(...cluster); break; }
          world.rocks.splice(world.rocks.length - cluster.length, cluster.length);
        }
      }
      const sol = solve(world, prev, p, true);
      if (sol) { paths.push(sol.path); placed = true; }
      else { world.planets.pop(); world.rocks = world.rocks.filter((c) => !keepRocks.includes(c)); setBounds(); }
    }
    if (!placed) break;
  }

  const last = world.planets[world.planets.length - 1];
  for (let tries = 0; tries < 80; tries++) {
    const ang = (rand() * 2 - 1) * 0.6, dist = 380 + rand() * 80;
    world.moon = { x: Math.max(-160, Math.min(160, last.x + Math.sin(ang) * dist)), y: last.y + Math.cos(ang) * dist, r: 52 };
    if (!clear(world.moon.x, world.moon.y, world.moon.r)) continue;
    setBounds();
    const sol = solve(world, last, world.moon, true);
    if (sol) { paths.push(sol.path); break; }
    world.moon = null;
  }
  if (!world.moon) { // fallback: straight above, close (always reachable)
    world.moon = { x: last.x, y: last.y + last.r + 260, r: 52 };
    setBounds();
    paths.push(null);
  }

  // Three bananas, each on a route the solver actually flew.
  const usable = paths.map((p, i) => [p, i]).filter(([p]) => p && p.length > 8);
  const chosen = [];
  for (let i = 0; i < 3 && usable.length; i++) {
    const at = Math.floor(((i + 0.5) / 3) * usable.length);
    chosen.push(usable.splice(Math.min(at, usable.length - 1), 1)[0][0]);
  }
  for (const path of chosen) {
    const pt = path[Math.floor(path.length * (0.45 + rand() * 0.15))];
    world.bananas.push({ x: pt[0], y: pt[1] });
  }
  world.par = Math.round(paths.reduce((s, p) => s + (p ? p.length * 6 * DT : 2), 0) + world.planets.length * 2.2);
  return world;
}

// ── A run ──
export function createRun(world) {
  const start = world.planets[0];
  return {
    world, mode: "landed", planet: start, ang: Math.PI / 2, last: { planet: start, ang: Math.PI / 2 },
    f: null, launches: 0, crashes: 0, penaltyMs: 0, clockMs: 0, started: false,
    got: new Set(), landed: new Set([start]), done: false,
  };
}

/** Where the rocket is now (landed: on the surface, angle out). */
export function rocketPose(run) {
  if (run.mode === "landed" || run.mode === "respawn") {
    const [x, y] = surfacePoint(run.planet, run.ang);
    return { x, y, heading: run.ang, vx: 0, vy: 0 };
  }
  const { x, y, vx, vy } = run.f;
  return { x, y, heading: Math.atan2(vy, vx), vx, vy };
}

export function launch(run, dx, dy, power) {
  if (run.mode !== "landed" || run.done) return false;
  const [vx, vy] = launchVelocity(run.ang, dx, dy, power);
  const [x, y] = surfacePoint(run.planet, run.ang);
  run.last = { planet: run.planet, ang: run.ang };
  run.f = { x, y, vx, vy, t: 0 };
  run.mode = "flying"; run.launches++; run.started = true;
  return true;
}

/** Dotted aim line: the first `secs` of the flight this drag would make. */
export function preview(run, dx, dy, power, secs = 0.55) {
  if (run.mode !== "landed") return [];
  const [vx, vy] = launchVelocity(run.ang, dx, dy, power);
  const [x, y] = surfacePoint(run.planet, run.ang);
  const f = { x, y, vx, vy, t: 0 }, out = [];
  for (let s = 0; s < secs / DT; s++) {
    if (stepFlight(run.world, f)) break;
    if (s % 5 === 0) out.push([f.x, f.y]);
  }
  return out;
}

/** Advance by dt seconds; returns a list of events for sounds and effects. */
export function update(run, dt) {
  const events = [];
  if (run.done) return events;
  if (run.started) run.clockMs += dt * 1000;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(DT, left); left -= h;
    for (const p of run.world.planets) p.turn = ((p.turn || 0) + p.spin * h) % (Math.PI * 2);
    if (run.mode === "landed") { run.ang += run.planet.spin * h; continue; }
    if (run.mode !== "flying") continue;
    const ev = stepFlight(run.world, run.f, h);
    for (const b of run.world.bananas) {
      if (!run.got.has(b) && Math.hypot(run.f.x - b.x, run.f.y - b.y) < BANANA_R) { run.got.add(b); events.push({ type: "banana", x: b.x, y: b.y }); }
    }
    if (!ev) continue;
    if (ev.hit === "moon") {
      run.mode = "won"; run.done = true;
      events.push({ type: "finish", x: run.f.x, y: run.f.y, ms: run.clockMs + run.penaltyMs });
      break;
    }
    if (ev.hit === "planet" && ev.speed <= LAND_V) {
      run.mode = "landed"; run.planet = ev.body;
      run.ang = Math.atan2(run.f.y - ev.body.y, run.f.x - ev.body.x);
      const first = !run.landed.has(ev.body); run.landed.add(ev.body);
      events.push({ type: "land", x: run.f.x, y: run.f.y, first, soft: ev.speed < LAND_V * 0.5 });
      break;
    }
    // Crash or lost: back to the last planet with a time penalty.
    run.crashes++; run.penaltyMs += PENALTY_MS;
    events.push({ type: ev.hit === "lost" ? "lost" : "crash", x: run.f.x, y: run.f.y, speed: ev.speed });
    run.mode = "landed"; run.planet = run.last.planet; run.ang = run.last.ang;
    break;
  }
  return events;
}

export const runTimeMs = (run) => Math.round(run.clockMs + run.penaltyMs);
