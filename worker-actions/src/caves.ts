/**
 * MonkeCaves weekly speed-run board (2026-11-07). The game (onlymonkes.app/viewer/caves)
 * posts each cleared cave to its host; the app (phone: Device Integrity key, web: holder
 * token, same proofs as referrals.ts) sends it here. Best time per holder per cave per
 * ISO week.
 *
 * Release switch, env CAVES_BOARD: "off" (default) | "testers" | "on".
 * "testers" accepts runs only from CAVES_TESTERS (comma-separated sha256 hex of wallets);
 * each accepted run's reply carries that cave's top 10, and GET /board stays hidden.
 * "on" is the public launch: anyone can read the board.
 *
 * The game runs on the player's device, so a run can be faked. These checks only stop
 * impossible ones: a known level version, a time over the fastest walkable route (+ boss),
 * one submit per 10 s per holder. Wallets are stored only as hashes.
 *   POST /api/caves/run   { proof, v, cave, timeMs, kills?, secrets?, n?, name? } → { ok, week, best, improved, rank, top }
 *   GET  /api/caves/board ?week=2026-W45                                     → { week, caves: { 1: [...], …, 4: [...] } }
 *   POST /api/caves/progress { proof }                                       → { max, today, cap }
 *   POST /api/caves/collect  { proof }                                       → { bananas }   (phone only, everything owed, once)
 *
 * Campaign (owner 2026-11-13): progress is saved per holder (phone and web share it); a cave
 * unlocks when the one before it is beaten. A clear pays CLEAR_BANANAS(cave) once per cave per
 * UTC day, at most DAILY_BANANAS a day, its own cap (Jungle Royale has a separate 100). Before
 * progress was saved the only way into cave N was clearing 1..N-1 in one sitting, so a valid
 * cave N run marks every cave up to N as beaten. Bananas are earned here and collected by the
 * phone (bananas live on the phone; the web only mirrors the balance).
 * KV (COMMUNITY_DATA): caves:wk:<week>:c<cave>:<id> { t, n, name, at } (each holder's best)
 *                      caves:top:<week>:c<cave> [{ id, t, n, name, at }] (top 10, kept on write
 *                      so reading the board never lists keys)
 *                      caves:prog:<id> { max }            highest cave beaten
 *                      caves:day:<id>:<YYYY-MM-DD> { caves, total }   paid clears that day
 *                      caves:earned:<id> / caves:paid:<id>  running totals; only submit writes
 *                      earned and only collect writes paid, so the two never overwrite each other
 */
import type { Env } from "./index";
import { holderClaimsFromToken } from "./webAuth";
import { walletFromDeviceProof } from "./livekitAuth";
import { sha256Hex } from "./cryptoVerify";
import { cleanName } from "./referrals";
import { monkeImageForNumber } from "./shareCard";

/** Level set the floors below were measured on (caves.js LEVELS). Bump both together. */
export const CAVES_VERSION = 4;
/** Older game versions still accepted for the caves they didn't change (v2 → v3 rebuilt cave 2 only;
 *  v3 → v4 added Data Center as cave 3 and moved Big Tech HQ to cave 4), so a page cached through
 *  the deploy doesn't lose a run. A v3 "cave 3" run was Big Tech HQ, so it isn't accepted as cave 3. */
const STILL_VALID: Record<number, number[]> = { 2: [1], 3: [1, 2] };
/**
 * Fastest possible clear per cave (ms), a little under the shortest walkable route at full
 * speed (3.2 cells/s, secret walls and doors counted open) plus the boss kill. v2 (Lost Temple
 * cave 1): 140 cells ≈ 44 s. v3 (Paper Hands Alley cave 2, 2026-11-13): 222 cells ≈ 70 s + the
 * bear (18 hits × 0.32 s); 62 s since the bear can be shot from range. v4 (Data Center cave 3,
 * 2026-11-14): ~170 cells through three badge rooms ≈ 53 s → 48 s. Cave 4 = the old Big Tech HQ
 * prototype (≈ 11.5 s + the Banana Phone).
 */
export const MIN_MS: Record<number, number> = { 1: 40_000, 2: 62_000, 3: 48_000, 4: 12_000 };
const MAX_MS = 60 * 60_000;
const TOP = 10;

export function cavesProofMessage(action: string, nonce: string): string {
  return `OnlyMonkes Caves\naction:${action}\nnonce:${nonce}`;
}

export const isCavesPath = (path: string) => path === "/api/caves/run" || path === "/api/caves/board" || path === "/api/caves/progress" || path === "/api/caves/collect";

/** Bananas for a clear: deeper caves pay more. Once per cave per UTC day, DAILY_BANANAS a day. */
export const CLEAR_BANANAS = (cave: number) => 15 + 10 * cave;
export const DAILY_BANANAS = 100;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = async (kv: KVNamespace, key: string) => parseInt((await kv.get(key)) ?? "0", 10) || 0;

/** Records a clear: progress up to this cave, and today's bananas if this cave hasn't paid today. */
async function recordClear(kv: KVNamespace, holder: string, cave: number, now: number): Promise<{ max: number; bananas: number; today: number }> {
  const progKey = `caves:prog:${holder}`;
  const prog = JSON.parse((await kv.get(progKey)) ?? "null") as { max: number } | null;
  const max = Math.max(prog?.max ?? 0, cave);
  if (max !== prog?.max) await kv.put(progKey, JSON.stringify({ max }));
  const dayKey = `caves:day:${holder}:${utcDay(now)}`;
  const day = (JSON.parse((await kv.get(dayKey)) ?? "null") as { caves: number[]; total: number } | null) ?? { caves: [], total: 0 };
  if (day.caves.includes(cave)) return { max, bananas: 0, today: day.total };
  const bananas = Math.max(0, Math.min(CLEAR_BANANAS(cave), DAILY_BANANAS - day.total));
  day.caves.push(cave); day.total += bananas;
  await kv.put(dayKey, JSON.stringify(day), { expirationTtl: 3 * 86_400 });
  if (bananas) await kv.put(`caves:earned:${holder}`, String((await num(kv, `caves:earned:${holder}`)) + bananas));
  return { max, bananas, today: day.total };
}

async function progress(env: Env, body: any, now = Date.now()): Promise<Response> {
  const id = await who(env, body?.proof, "progress");
  if ("error" in id) return json({ error: id.error }, id.status);
  const holder = await idFor(id.wallet), kv = env.COMMUNITY_DATA;
  const prog = JSON.parse((await kv.get(`caves:prog:${holder}`)) ?? "null") as { max: number } | null;
  const day = JSON.parse((await kv.get(`caves:day:${holder}:${utcDay(now)}`)) ?? "null") as { total: number } | null;
  return json({ max: prog?.max ?? 0, today: day?.total ?? 0, cap: DAILY_BANANAS });
}

async function collect(env: Env, body: any, now = Date.now()): Promise<Response> {
  const id = await who(env, body?.proof, "collect");
  if ("error" in id) return json({ error: id.error }, id.status);
  const holder = await idFor(id.wallet), kv = env.COMMUNITY_DATA;
  const lastKey = `caves:collect:${holder}`;
  if (now - ((await num(kv, lastKey)) || 0) < 10_000) return json({ bananas: 0 });
  await kv.put(lastKey, String(now), { expirationTtl: 60 });
  const earned = await num(kv, `caves:earned:${holder}`), paid = await num(kv, `caves:paid:${holder}`);
  const bananas = Math.max(0, Math.min(10_000, earned - paid));
  // Mark first, pay after: a lost reply costs bananas, a retry never doubles them.
  if (bananas) await kv.put(`caves:paid:${holder}`, String(earned));
  return json({ bananas });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** ISO 8601 week, e.g. "2026-W45" (weeks start Monday, UTC). */
export function isoWeek(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const enc = new TextEncoder();
const idFor = async (wallet: string) => (await sha256Hex(enc.encode(`om-caves:${wallet}`))).slice(0, 40);
const walletHash = async (wallet: string) => sha256Hex(enc.encode(wallet));

/** Server-side checks on a submitted run. Returns the reason it's refused, or null. */
export function runProblem(r: { v?: unknown; cave?: unknown; timeMs?: unknown; kills?: unknown }): string | null {
  const cave = r.cave as number;
  if (r.v !== CAVES_VERSION && !STILL_VALID[r.v as number]?.includes(cave)) return "old game version";
  if (!Number.isInteger(cave) || !MIN_MS[cave]) return "unknown cave";
  const t = r.timeMs as number;
  if (!Number.isFinite(t)) return "bad time";
  if (t < MIN_MS[cave]) return "faster than possible";
  if (t > MAX_MS) return "too slow to count";
  if (r.kills !== undefined && (!Number.isInteger(r.kills) || (r.kills as number) < 0 || (r.kills as number) > 120)) return "bad kills";
  return null;
}

async function who(env: Env, proof: any, action: string): Promise<{ wallet: string } | { error: string; status: number }> {
  if (proof?.kind === "holder") {
    const c = await holderClaimsFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    return c ? { wallet: c.wallet } : { error: "sign in again", status: 401 };
  }
  if (proof?.kind === "device") {
    const r = await walletFromDeviceProof(env, proof, (nonce) => cavesProofMessage(action, nonce));
    return "error" in r ? r : { wallet: r.wallet };
  }
  return { error: "proof required", status: 401 };
}

type Entry = { t: number; n: number | null; name: string; at: number };
type TopRow = Entry & { id: string };
/** A rebuilt cave gets fresh board slots so times on the old map don't outrank it (cave 2 rebuilt in v3,
 *  cave 3 became Data Center in v4; cave 4's slot is new). */
const EDITION: Record<number, string> = { 2: "v3", 3: "v4" };
const caveSlot = (cave: number) => `c${cave}${EDITION[cave] ?? ""}`;
const topKey = (week: string, cave: number) => `caves:top:${week}:${caveSlot(cave)}`;
const shown = (r: Entry) => ({ name: r.name || (r.n ? `Monke #${r.n}` : "A Saga Monke holder"), n: r.n, t: r.t });

async function readTop(env: Env, week: string, cave: number): Promise<TopRow[]> {
  try { return JSON.parse((await env.COMMUNITY_DATA.get(topKey(week, cave))) ?? "[]") as TopRow[]; } catch { return []; }
}

async function submit(env: Env, body: any, now = Date.now()): Promise<Response> {
  const mode = env.CAVES_BOARD ?? "off";
  const bad = runProblem(body ?? {});
  if (bad) return json({ error: bad }, 400);
  const id = await who(env, body?.proof, `run:${body.cave}:${body.timeMs}`);
  if ("error" in id) return json({ error: id.error }, id.status);
  if (mode !== "on") {
    const testers = (env.CAVES_TESTERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (mode !== "testers" || !testers.includes(await walletHash(id.wallet))) return json({ error: "not released" }, 404);
  }
  const holder = await idFor(id.wallet);
  const kv = env.COMMUNITY_DATA;
  const lastKey = `caves:last:${holder}`;
  const last = parseInt((await kv.get(lastKey)) ?? "0", 10) || 0;
  if (now - last < 10_000) return json({ error: "slow down" }, 429);
  await kv.put(lastKey, String(now), { expirationTtl: 60 });

  const cleared = await recordClear(kv, holder, body.cave as number, now);
  const week = isoWeek(now);
  const key = `caves:wk:${week}:${caveSlot(body.cave)}:${holder}`;
  const prev = JSON.parse((await kv.get(key)) ?? "null") as Entry | null;
  const n = monkeImageForNumber(Number(body.n)) ? Number(body.n) : null;
  const t = Math.round(body.timeMs);
  const cave = body.cave as number;
  let top = await readTop(env, week, cave);
  const reply = (best: number, improved: boolean) => {
    const at = top.findIndex((r) => r.id === holder);
    return json({ ok: true, week, best, improved, rank: at < 0 ? null : at + 1, top: top.map(shown), max: cleared.max, bananas: cleared.bananas, today: cleared.today, cap: DAILY_BANANAS });
  };
  if (prev && prev.t <= t) return reply(prev.t, false);
  const entry: Entry = { t, n, name: cleanName(body.name), at: now };
  // Weeks expire on their own after ~5 weeks.
  await kv.put(key, JSON.stringify(entry), { expirationTtl: 35 * 86_400 });
  // Two holders improving in the same instant can drop one from the top list until their next run.
  top = [...top.filter((r) => r.id !== holder), { ...entry, id: holder }].sort((a, b) => a.t - b.t || a.at - b.at).slice(0, TOP);
  await kv.put(topKey(week, cave), JSON.stringify(top), { expirationTtl: 35 * 86_400 });
  return reply(t, true);
}

export async function board(env: Env, week: string): Promise<Record<number, { name: string; n: number | null; t: number }[]>> {
  const out: Record<number, { name: string; n: number | null; t: number }[]> = {};
  for (const cave of Object.keys(MIN_MS).map(Number)) out[cave] = (await readTop(env, week, cave)).map(shown);
  return out;
}

export async function handleCaves(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/caves/run" && request.method === "POST") {
    let body: any = null;
    try { body = await request.json(); } catch { /* bad body */ }
    return submit(env, body);
  }
  if ((path === "/api/caves/progress" || path === "/api/caves/collect") && request.method === "POST") {
    let body: any = null;
    try { body = await request.json(); } catch { /* bad body */ }
    return path === "/api/caves/progress" ? progress(env, body) : collect(env, body);
  }
  if (path === "/api/caves/board" && request.method === "GET") {
    // Testers see the board in their run replies; the public board waits for "on".
    if (env.CAVES_BOARD !== "on") return json({ error: "not released" }, 404);
    const q = new URL(request.url).searchParams.get("week") ?? "";
    const week = /^\d{4}-W\d{2}$/.test(q) ? q : isoWeek(Date.now());
    return new Response(JSON.stringify({ week, caves: await board(env, week) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
  }
  return json({ error: "not found" }, 404);
}

export const __test = { submit, progress, collect };
