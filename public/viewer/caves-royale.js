// Jungle Royale: MonkeCaves versus. The match itself (fighters, shots, kills,
// respawns, pickups, bots) with no DOM, so the page runs it offline today and the
// match server can run the same code later. Every weapon plays the same (damage,
// fire rate, shot speed); only the looks differ, as in the caves.

export const VS = {
  HP: 100, DMG: 12, COOL: 0.32, SHOT_SPEED: 9, SHOT_LIFE: 1.4, HIT_R: 0.42,
  MOVE: 3.2, R: 0.22, AMMO_START: 50, AMMO_MAX: 150,
  RESPAWN: 2.5, SHIELD: 1.5, PICKUP_BACK: 20, KILLS_TO_WIN: 10, TIME: 300, SEATS: 4,
};

// OnlyTreasury's Saga Monkes, playing as bots when there aren't enough holders.
// Skill 0..1 sets reaction time, aim wobble and how well they keep moving.
export const ROSTER = [
  { n: 1308, skill: 0.55 },
  { n: 2737, skill: 0.8 },
  { n: 4151, skill: 0.45 },
  { n: 4457, skill: 0.7 },
  { n: 6986, skill: 0.6 },
  { n: 8340, skill: 0.9 },
];

const FLOOR = new Set([".", "R", "h", "H", "q", "Q", "M", "b", "I"]);

// Deterministic random per match (the server and a replay see the same bots).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

export function createMatch(arena, { seed = 1 } = {}) {
  const rows = arena.rows, MW = Math.max(...rows.map((r) => r.length)), MH = rows.length;
  const rnd = rng(seed);
  const solidCell = new Uint8Array(MW * MH);
  const spawns = [], pickups = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = rows[y][x] || "#";
    solidCell[y * MW + x] = FLOOR.has(c) ? 0 : 1;
    if (c === "R") spawns.push({ x: x + 0.5, y: y + 0.5 });
    if (c === "h" || c === "H" || c === "q" || c === "Q") pickups.push({ kind: c === "h" || c === "H" ? "health" : "ammo", big: c === "H" || c === "Q", x: x + 0.5, y: y + 0.5, back: 0 });
  }
  const solid = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || solidCell[Math.floor(y) * MW + Math.floor(x)] === 1;
  const sight = (ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
    for (let i = 1; i < n; i++) if (solid(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)) return false;
    return true;
  };

  // Walking distance to a cell, for bots finding their way (cached per goal).
  const flows = new Map();
  function flowTo(gx, gy) {
    const key = gy * MW + gx;
    let f = flows.get(key);
    if (f) return f;
    f = new Int16Array(MW * MH).fill(-1);
    f[key] = 0;
    const q = [key];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of [i + 1, i - 1, i + MW, i - MW]) if (j >= 0 && j < MW * MH && f[j] < 0 && !solidCell[j]) { f[j] = f[i] + 1; q.push(j); }
    }
    if (flows.size > 64) flows.clear();
    flows.set(key, f);
    return f;
  }
  // Which way to walk from (x, y) towards a goal cell: the neighbouring cell closest to it.
  function stepToward(x, y, gx, gy) {
    const f = flowTo(gx, gy), cx = Math.floor(x), cy = Math.floor(y), here = f[cy * MW + cx];
    if (here <= 0) return here === 0 ? [gx + 0.5 - x, gy + 0.5 - y] : null;
    let best = null, bd = here;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy, v = f[ny * MW + nx];
      if (v < 0 || v >= bd) continue;
      if (dx && dy && (solidCell[cy * MW + nx] || solidCell[ny * MW + cx])) continue; // no corner cutting
      bd = v; best = [nx + 0.5 - x, ny + 0.5 - y];
    }
    return best;
  }

  const m = {
    MW, MH, rows, solid, sight, spawns, pickups,
    fighters: [], shots: [], events: [], time: 0, over: false, winner: null,
  };

  function spawnPoint() {
    const live = m.fighters.filter((f) => !f.dead);
    let best = spawns[0], bd = -1;
    for (const s of spawns) {
      const d = live.length ? Math.min(...live.map((f) => Math.hypot(f.x - s.x, f.y - s.y))) : rnd() * 10;
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  }
  function place(f) {
    const s = spawnPoint();
    // Face the middle of the arena.
    Object.assign(f, { x: s.x, y: s.y, a: Math.atan2(MH / 2 - s.y, MW / 2 - s.x), hp: VS.HP, ammo: VS.AMMO_START, dead: 0, shield: VS.SHIELD, cool: 0.5 });
  }

  m.addFighter = (opts) => {
    const f = { id: opts.id, n: opts.n, name: opts.name ?? `#${opts.n}`, bot: !!opts.bot, skill: opts.skill ?? 0.6, kills: 0, deaths: 0, joinedAt: m.time, brain: opts.bot ? { goal: null, seenFor: 0, strafe: 1, strafeT: 0, target: null, lastSeen: null, stuckT: 0, lastX: 0, lastY: 0, think: 0, wantA: 0 } : null };
    place(f);
    m.fighters.push(f);
    return f;
  };
  // Fill empty seats with roster bots nobody is already playing as.
  m.fillBots = (seats = VS.SEATS) => {
    const taken = new Set(m.fighters.map((f) => f.n));
    const pool = [...ROSTER];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const r of pool) {
      if (m.fighters.length >= seats) break;
      if (taken.has(r.n)) continue;
      m.addFighter({ id: `bot-${r.n}`, n: r.n, name: `#${r.n}`, bot: true, skill: r.skill });
    }
  };

  function fire(f, ax, ay) {
    if (f.dead || f.cool > 0 || f.ammo <= 0) return false;
    f.cool = VS.COOL; f.ammo--;
    const d = Math.hypot(ax, ay) || 1;
    m.shots.push({ by: f.id, x: f.x + ax / d * 0.3, y: f.y + ay / d * 0.3, vx: ax / d * VS.SHOT_SPEED, vy: ay / d * VS.SHOT_SPEED, life: VS.SHOT_LIFE });
    m.events.push({ t: "shot", by: f.id });
    return true;
  }

  function move(f, mx, my) {
    const R = VS.R;
    if (!solid(f.x + mx + Math.sign(mx) * R, f.y)) f.x += mx;
    if (!solid(f.x, f.y + my + Math.sign(my) * R)) f.y += my;
  }

  // ── Bots ──
  function botThink(f, dt) {
    const b = f.brain, s = f.skill;
    const reaction = 0.55 - 0.3 * s, wobble = (1 - s) * 0.14, turnRate = 2.2 + 1.6 * s;
    b.think -= dt;
    // Who can I see? Nearest live enemy in view (≈150° cone, or anyone within 3 tiles).
    if (b.think <= 0) {
      b.think = 0.15;
      let best = null, bd = 1e9;
      for (const o of m.fighters) {
        if (o === f || o.dead) continue;
        const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
        if (d > 16) continue;
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - f.a), Math.cos(Math.atan2(dy, dx) - f.a)));
        if ((off < 1.3 || d < 3 || o.id === b.attacker) && d < bd && sight(f.x, f.y, o.x, o.y)) { best = o; bd = d; }
      }
      if (best !== b.target) b.seenFor = 0;
      b.target = best;
      if (best) b.lastSeen = { x: best.x, y: best.y };
    }
    const t = b.target && !b.target.dead ? b.target : null;
    let fwd = 0, side = 0;
    if (t) {
      b.seenFor += dt;
      const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy);
      // Lead the target a little (better bots lead better).
      const lead = (d / VS.SHOT_SPEED) * s * 0.8;
      b.wantA = Math.atan2(dy + (t.vy || 0) * lead, dx + (t.vx || 0) * lead);
      // Keep a fighting distance and strafe, switching sides now and then.
      if ((b.strafeT -= dt) <= 0) { b.strafe = rnd() < 0.5 ? -1 : 1; b.strafeT = 0.6 + rnd() * 1.2; }
      fwd = d > 7 ? 1 : d < 3 ? -0.7 : 0;
      side = b.strafe * (0.4 + 0.6 * s);
      const err = Math.abs(Math.atan2(Math.sin(b.wantA - f.a), Math.cos(b.wantA - f.a)));
      if (b.seenFor > reaction && err < 0.18 && d < 14) {
        const a = f.a + (rnd() - 0.5) * 2 * wobble;
        fire(f, Math.cos(a), Math.sin(a));
      }
    } else {
      // No one in sight: patch up, restock, chase the last sighting, or roam.
      const want = (kind) => {
        let best = null, bd = 1e9;
        for (const p of pickups) if (p.kind === kind && p.back <= 0) { const d = Math.hypot(p.x - f.x, p.y - f.y); if (d < bd) { bd = d; best = p; } }
        return best;
      };
      let goal = f.hp < 50 ? want("health") : null;
      if (!goal && f.ammo < 15) goal = want("ammo");
      if (!goal && b.lastSeen) goal = b.lastSeen;
      if (!goal) {
        if (!b.goal || Math.hypot(b.goal.x - f.x, b.goal.y - f.y) < 1) {
          const opts = [...spawns, ...pickups];
          b.goal = opts[Math.floor(rnd() * opts.length)];
        }
        goal = b.goal;
      }
      if (b.lastSeen && Math.hypot(b.lastSeen.x - f.x, b.lastSeen.y - f.y) < 1) b.lastSeen = null;
      const st = stepToward(f.x, f.y, Math.floor(goal.x), Math.floor(goal.y));
      if (st) { b.wantA = Math.atan2(st[1], st[0]); fwd = 1; }
      // Stuck (pinned on a corner or another monke): pick somewhere else.
      if ((b.stuckT += dt) > 1) {
        if (Math.hypot(f.x - b.lastX, f.y - b.lastY) < 0.3) { b.goal = null; b.lastSeen = null; side = rnd() < 0.5 ? -1 : 1; }
        b.stuckT = 0; b.lastX = f.x; b.lastY = f.y;
      }
    }
    // Turn at a human-ish rate, then walk relative to where it faces.
    const da = Math.atan2(Math.sin(b.wantA - f.a), Math.cos(b.wantA - f.a));
    f.a += Math.max(-turnRate * dt, Math.min(turnRate * dt, da));
    // Walking forward only once roughly facing the way (no moonwalking round corners).
    if (!t && Math.abs(da) > 0.9) fwd *= 0.2;
    const len = Math.hypot(fwd, side) || 1, sp = VS.MOVE * dt * (0.85 + 0.15 * s) / Math.max(1, len);
    const cx = Math.cos(f.a), cy = Math.sin(f.a);
    move(f, (cx * fwd - cy * side) * sp, (cy * fwd + cx * side) * sp);
  }

  // ── One tick. human: { [id]: { x, y, a, fire } } — offline the page moves its own
  // player; the server version will move humans from their inputs instead. ──
  m.step = (dt, human = {}) => {
    m.events.length = 0;
    if (m.over) return m.events;
    m.time += dt;
    for (const f of m.fighters) {
      const px = f.x, py = f.y;
      f.cool -= dt; f.shield = Math.max(0, f.shield - dt);
      if (f.dead) {
        if ((f.dead -= dt) <= 0) { place(f); m.events.push({ t: "spawn", id: f.id }); }
        continue;
      }
      if (f.bot) botThink(f, dt);
      else if (human[f.id]) {
        const h = human[f.id];
        f.x = h.x; f.y = h.y; f.a = h.a;
        if (h.fire) fire(f, Math.cos(h.aim ?? h.a), Math.sin(h.aim ?? h.a));
      }
      f.vx = (f.x - px) / dt; f.vy = (f.y - py) / dt;
      for (const p of pickups) {
        if (p.back > 0 || Math.hypot(p.x - f.x, p.y - f.y) > 0.5) continue;
        if (p.kind === "health") { if (f.hp >= VS.HP) continue; f.hp = Math.min(VS.HP, f.hp + (p.big ? 50 : 25)); }
        else { if (f.ammo >= VS.AMMO_MAX) continue; f.ammo = Math.min(VS.AMMO_MAX, f.ammo + (p.big ? 40 : 15)); }
        p.back = VS.PICKUP_BACK;
        m.events.push({ t: "pickup", id: f.id, kind: p.kind });
      }
    }
    for (const p of pickups) if (p.back > 0) p.back -= dt;
    for (let i = m.shots.length - 1; i >= 0; i--) {
      const s = m.shots[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      let gone = s.life <= 0 || solid(s.x, s.y);
      for (const f of m.fighters) {
        if (gone || f.dead || f.id === s.by || Math.hypot(f.x - s.x, f.y - s.y) > VS.HIT_R) continue;
        gone = true;
        if (f.shield > 0) continue; // just respawned
        f.hp -= VS.DMG;
        if (f.brain) f.brain.attacker = s.by;
        m.events.push({ t: "hit", id: f.id, by: s.by, fx: s.x - s.vx * 0.1, fy: s.y - s.vy * 0.1 });
        if (f.hp <= 0) {
          f.hp = 0; f.dead = VS.RESPAWN; f.deaths++;
          const k = m.fighters.find((o) => o.id === s.by);
          if (k) k.kills++;
          m.events.push({ t: "kill", id: f.id, by: s.by });
          if (k && k.kills >= VS.KILLS_TO_WIN) end();
        }
      }
      if (gone) m.shots.splice(i, 1);
    }
    if (!m.over && m.time >= VS.TIME) end();
    return m.events;
  };

  m.standings = () => [...m.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.joinedAt - b.joinedAt);
  function end() {
    m.over = true;
    m.winner = m.standings()[0]?.id ?? null;
    m.events.push({ t: "over", winner: m.winner });
  }
  return m;
}

// Bananas for a finished match (paid by the server to phones only, once online):
// 25 for a win, 2 a kill, half when everyone else was a bot, 100 a day at most.
export const BANANAS = { WIN: 25, KILL: 2, BOTS_ONLY: 0.5, DAILY_MAX: 100 };
export function matchBananas(m, id) {
  const f = m.fighters.find((x) => x.id === id);
  if (!f) return 0;
  const raw = (m.winner === id ? BANANAS.WIN : 0) + f.kills * BANANAS.KILL;
  const humans = m.fighters.filter((x) => !x.bot).length;
  return Math.round(raw * (humans > 1 ? 1 : BANANAS.BOTS_ONLY));
}
