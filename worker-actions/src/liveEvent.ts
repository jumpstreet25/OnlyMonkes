/**
 * Monke Live (owner 2026-11-13): the next live Avatar Room hangout. Change LIVE_EVENT for the next one.
 * The time vote is the bot's Main Chat poll — only holders are in Main Chat, so only holders vote.
 * The bot posts the tally here (POST /api/live/poll, BOT_HTTP_SECRET) on every vote; GET /api/live
 * serves the event + tally to the /live page and the app (counts only, never who voted).
 */
import type { Env } from "./index";
import { bearerOk } from "./botAuth";

export const LIVE_EVENT = {
  start: Date.UTC(2026, 10, 14, 22, 0), // Sat Nov 14 2026, 5:00 PM EST
  hours: 3,
  title: "Monke Live: Avatar Room hangout",
};

export function liveZoneTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** Shown from now until the hangout ends. */
export const liveUpcoming = (now = Date.now()) => now < LIVE_EVENT.start + LIVE_EVENT.hours * 3_600_000;

export interface LivePoll { id: string; question: string; options: { id: string; label: string; votes: number }[]; resolvesAt: number; status: string }

const KEY = "live:poll";
const ID = /^poll-\d{10,16}-[a-z0-9]{2,10}$/;
const OPT = /^opt-\d$/;

export function cleanLivePoll(b: unknown): LivePoll | null {
  const p = b as Partial<LivePoll> | null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n) : "");
  if (!p || typeof p.id !== "string" || !ID.test(p.id) || !Array.isArray(p.options) || p.options.length < 2 || p.options.length > 5) return null;
  const options = p.options.map((o) => ({ id: String(o?.id ?? ""), label: str(o?.label, 90), votes: Math.max(0, Math.min(100_000, Math.floor(Number(o?.votes) || 0))) }));
  if (options.some((o) => !OPT.test(o.id) || !o.label)) return null;
  const resolvesAt = Number(p.resolvesAt);
  if (!Number.isFinite(resolvesAt)) return null;
  return { id: p.id, question: str(p.question, 200), options, resolvesAt, status: p.status === "resolved" ? "resolved" : "open" };
}

export async function handleLive(request: Request, env: Env, path: string): Promise<Response> {
  const json = (b: unknown, status = 200, cache = "no-store") =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache, "Access-Control-Allow-Origin": "*" } });
  if (path === "/api/live/poll" && request.method === "POST") {
    if (!bearerOk(request.headers.get("authorization"), env.BOT_HTTP_SECRET)) return json({ error: "unauthorized" }, 401);
    const poll = cleanLivePoll(await request.json().catch(() => null));
    if (!poll) return json({ error: "bad poll" }, 400);
    await env.COMMUNITY_DATA.put(KEY, JSON.stringify(poll), { expirationTtl: 14 * 86_400 });
    return json({ ok: true });
  }
  if (path === "/api/live" && (request.method === "GET" || request.method === "HEAD")) {
    const raw = await env.COMMUNITY_DATA.get(KEY).catch(() => null);
    const poll = raw ? cleanLivePoll(JSON.parse(raw)) : null;
    return json({ event: { ...LIVE_EVENT, upcoming: liveUpcoming() }, poll }, 200, "public, max-age=15");
  }
  return json({ error: "not found" }, 404);
}

export const isLivePath = (path: string) => path === "/api/live" || path === "/api/live/poll";
