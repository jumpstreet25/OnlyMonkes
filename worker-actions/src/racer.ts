/**
 * Monke RC daily board, leader ghost and daily bananas (2026-11-11). The game
 * (onlymonkes.app/viewer/racer, racer-sim.js) builds one track per UTC day; a holder's
 * app posts each finished daily race here with a holder proof (phone: Device Integrity
 * key, web: holder token — same as caves.ts). Best time per holder per day, top 10
 * kept on write, and the #1 race's ghost (positions only) so everyone can race the leader.
 *
 * Daily bananas: the first finished daily race of a UTC day pays DAILY_BANANAS, only
 * when the app asks (`pay: true` — the phone, where bananas live; the web never
 * collects). Marked paid before the reply.
 *
 * Release switch, env RACER_BOARD: "off" (default) | "testers" | "on"; testers =
 * RACER_TESTERS (comma-separated sha256 hex of wallets). The game runs on the player's
 * device, so these checks only stop impossible races (a known version, today's or the
 * just-ended track, laps that add up, a time over the floor, one submit per 10 s).
 *   POST /api/racer/run   { proof, v, course, ms, laps: [ms×3], ghost?, n?, name?, pay? }
 *                         → { ok, day, best, improved, rank, top, paid }
 *   GET  /api/racer/board ?day=  → { day, top }               (only when "on")
 *   GET  /api/racer/ghost ?day=  → { day, name, n, t, ghost }  (when not "off")
 * KV (COMMUNITY_DATA): racer:day:<day>:<id> { t, n, name, at }, racer:top:<day> [...],
 *                      racer:ghost:<day> { id, name, n, t, ghost }, racer:paid:<day>:<id>
 */
import type { Env } from "./index";
import { holderClaimsFromToken } from "./webAuth";
import { walletFromDeviceProof } from "./livekitAuth";
import { sha256Hex } from "./cryptoVerify";
import { cleanName } from "./referrals";
import { monkeImageForNumber } from "./shareCard";

/** racer-sim.js RV. Bump both together when the physics or track builder changes. */
export const RACER_VERSION = 1;
export const LAPS = 3;
/** Shortest track is ~1,350 units; boosting the whole way (108 u/s) can't lap under ~12 s. */
export const MIN_LAP_MS = 11_000;
const MAX_MS = 20 * 60_000;
const TOP = 10;
const GRACE_MS = 2 * 3_600_000;
export const DAILY_BANANAS = 20;
/** Ghost frames are recorded every 3 sim steps at 120 Hz (40 per second). */
const GHOST_HZ = 40;
const GHOST_MAX = 48_000;

export function racerProofMessage(action: string, nonce: string): string {
  return `OnlyMonkes Racer\naction:${action}\nnonce:${nonce}`;
}

export const isRacerPath = (path: string) => path === "/api/racer/run" || path === "/api/racer/board" || path === "/api/racer/ghost";

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

export const dayId = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Why a race is refused, or null. */
export function runProblem(r: Record<string, unknown>, now = Date.now()): string | null {
  if (r.v !== RACER_VERSION) return "old game version";
  const course = r.course;
  if (typeof course !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(course)) return "only the daily track counts";
  if (course !== dayId(now) && course !== dayId(now - GRACE_MS)) return "not today's track";
  const t = r.ms as number;
  if (!Number.isFinite(t)) return "bad time";
  if (t > MAX_MS) return "too slow to count";
  const laps = r.laps as number[];
  if (!Array.isArray(laps) || laps.length !== LAPS || !laps.every((l) => Number.isFinite(l))) return "bad laps";
  if (laps.some((l) => l < MIN_LAP_MS)) return "faster than possible";
  if (Math.abs(laps.reduce((a, b) => a + b, 0) - t) > 50) return "laps don't add up";
  return null;
}

/** A ghost is a list of [x, z, heading] frames covering the race. */
export function ghostOk(g: unknown, ms: number): g is number[][] {
  if (!Array.isArray(g) || g.length > GHOST_MAX) return false;
  const want = (ms / 1000) * GHOST_HZ;
  if (Math.abs(g.length - want) > want * 0.03 + 10) return false;
  return g.every((f) => Array.isArray(f) && f.length === 3 && f.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 5000));
}

async function who(env: Env, proof: any, action: string): Promise<{ wallet: string } | { error: string; status: number }> {
  if (proof?.kind === "holder") {
    const c = await holderClaimsFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    return c ? { wallet: c.wallet } : { error: "sign in again", status: 401 };
  }
  if (proof?.kind === "device") {
    const r = await walletFromDeviceProof(env, proof, (nonce) => racerProofMessage(action, nonce));
    return "error" in r ? r : { wallet: r.wallet };
  }
  return { error: "proof required", status: 401 };
}

const enc = new TextEncoder();
const idFor = async (wallet: string) => (await sha256Hex(enc.encode(`om-racer:${wallet}`))).slice(0, 40);

type Entry = { t: number; n: number | null; name: string; at: number };
type TopRow = Entry & { id: string };
const topKey = (day: string) => `racer:top:${day}`;
const nameOf = (r: { name: string; n: number | null }) => r.name || (r.n ? `Monke #${r.n}` : "A Saga Monke holder");
const shown = (r: Entry) => ({ name: nameOf(r), n: r.n, t: r.t });

async function readTop(env: Env, day: string): Promise<TopRow[]> {
  try { return JSON.parse((await env.COMMUNITY_DATA.get(topKey(day))) ?? "[]") as TopRow[]; } catch { return []; }
}

async function submit(env: Env, body: any, now = Date.now()): Promise<Response> {
  const mode = env.RACER_BOARD ?? "off";
  const bad = runProblem(body ?? {}, now);
  if (bad) return json({ error: bad }, 400);
  const day = body.course as string;
  const t = Math.round(body.ms);
  const id = await who(env, body?.proof, `run:${day}:${t}`);
  if ("error" in id) return json({ error: id.error }, id.status);
  if (mode !== "on") {
    const testers = (env.RACER_TESTERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (mode !== "testers" || !testers.includes(await sha256Hex(enc.encode(id.wallet)))) return json({ error: "not released" }, 404);
  }
  const holder = await idFor(id.wallet);
  const kv = env.COMMUNITY_DATA;
  const lastKey = `racer:last:${holder}`;
  const last = parseInt((await kv.get(lastKey)) ?? "0", 10) || 0;
  if (now - last < 10_000) return json({ error: "slow down" }, 429);
  await kv.put(lastKey, String(now), { expirationTtl: 60 });

  let paid = 0;
  if (body.pay === true) {
    const paidKey = `racer:paid:${day}:${holder}`;
    if (!(await kv.get(paidKey))) {
      paid = DAILY_BANANAS;
      await kv.put(paidKey, String(paid), { expirationTtl: 3 * 86_400 });
    }
  }

  const key = `racer:day:${day}:${holder}`;
  const prev = JSON.parse((await kv.get(key)) ?? "null") as Entry | null;
  let top = await readTop(env, day);
  const reply = (best: number, improved: boolean) => {
    const at = top.findIndex((r) => r.id === holder);
    return json({ ok: true, day, best, improved, rank: at < 0 ? null : at + 1, top: top.map(shown), paid });
  };
  if (prev && prev.t <= t) return reply(prev.t, false);
  const n = monkeImageForNumber(Number(body.n)) ? Number(body.n) : null;
  const entry: Entry = { t, n, name: cleanName(body.name), at: now };
  await kv.put(key, JSON.stringify(entry), { expirationTtl: 8 * 86_400 });
  top = [...top.filter((r) => r.id !== holder), { ...entry, id: holder }].sort((a, b) => a.t - b.t || a.at - b.at).slice(0, TOP);
  await kv.put(topKey(day), JSON.stringify(top), { expirationTtl: 35 * 86_400 });
  // New #1 with a usable ghost: it becomes the day's leader ghost.
  if (top[0]?.id === holder && ghostOk(body.ghost, t)) {
    await kv.put(`racer:ghost:${day}`, JSON.stringify({ id: holder, name: nameOf(entry), n, t, ghost: body.ghost }), { expirationTtl: 8 * 86_400 });
  }
  return reply(t, true);
}

export async function handleRacer(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/racer/run" && request.method === "POST") {
    if (Number(request.headers.get("Content-Length") ?? 0) > 1_500_000) return json({ error: "too big" }, 413);
    let body: any = null;
    try { body = await request.json(); } catch { /* bad body */ }
    return submit(env, body);
  }
  const q = new URL(request.url).searchParams.get("day") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dayId(Date.now());
  if (path === "/api/racer/board" && request.method === "GET") {
    if (env.RACER_BOARD !== "on") return json({ error: "not released" }, 404);
    return json({ day, top: (await readTop(env, day)).map(shown) }, 200, "public, max-age=60");
  }
  if (path === "/api/racer/ghost" && request.method === "GET") {
    if ((env.RACER_BOARD ?? "off") === "off") return json({ error: "not released" }, 404);
    const g = await env.COMMUNITY_DATA.get(`racer:ghost:${day}`);
    if (!g) return json({ error: "no ghost yet" }, 404, "public, max-age=60");
    const { id: _id, ...rest } = JSON.parse(g);
    return json({ day, ...rest }, 200, "public, max-age=60");
  }
  return json({ error: "not found" }, 404);
}

export const __test = { submit };
