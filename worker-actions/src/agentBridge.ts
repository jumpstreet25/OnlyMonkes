/**
 * Outbound event relay to the owner's Grok agents (2026-10-28). The agents only read
 * and draft for the owner's approval — this module only pushes facts out; nothing in
 * the worker lets an agent act, post, trade or spend.
 *
 * POST <GROK_RELAY_URL>, `Authorization: Bearer <GROK_RELAY_KEY>`, body
 * `{ source, type, priority, ts, data }`. `priority` is false unless the event is urgent
 * (bot down, fatal crash). Events: Sentry error alerts, daily sales stats, holder-count
 * changes, bot health failures. No DMs and no wallet-private data: payloads are built from
 * allowlisted fields and scrubbed again before sending (no addresses, inbox IDs, wallets).
 *
 * Never throws and never blocks a response: unset secrets → no-op; per-type rate limit;
 * one retry with a short timeout on network errors / 429 / 5xx.
 */

export type AgentEventType = "sentry_error" | "sales_daily" | "holders_change" | "bot_health";

export interface AgentEvent {
  type: AgentEventType;
  priority?: boolean;
  data: Record<string, unknown>;
}

interface RateLimiter { limit(opts: { key: string }): Promise<{ success: boolean }> }

export interface AgentBridgeEnv {
  GROK_RELAY_URL?: string;
  GROK_RELAY_KEY?: string;
  AGENT_RELAY_LIMITER?: RateLimiter;
}

export const RELAY_TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 400;
/** Per-isolate fallback when the rate-limit binding is missing: events per type per minute. */
const LOCAL_LIMIT_PER_MIN = 10;

const _local = new Map<string, { windowStart: number; count: number }>();

function localAllow(type: string, now: number): boolean {
  const w = _local.get(type);
  if (!w || now - w.windowStart >= 60_000) {
    _local.set(type, { windowStart: now, count: 1 });
    return true;
  }
  if (w.count >= LOCAL_LIMIT_PER_MIN) return false;
  w.count++;
  return true;
}

/** Keys that can carry a person or wallet — dropped wherever they appear. */
const PRIVATE_KEY = /wallet|address|owner|buyer|seller|inbox|email|^ip$|^user(id|name)?$|token$|secret|key$|signature|sender|recipient|message|content/i;
/** Values that look like an XMTP inbox ID (64 hex) or a Solana address (base58, 32–44). */
const PRIVATE_VALUE = /\b[0-9a-f]{64}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/** Pure: a copy with private-looking keys removed and private-looking strings redacted. */
export function scrubPrivate(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === "string") return PRIVATE_VALUE.test(value) ? value.replace(new RegExp(PRIVATE_VALUE, "g"), "[redacted]") : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubPrivate(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!PRIVATE_KEY.test(k)) out[k] = scrubPrivate(v, depth + 1);
    return out;
  }
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends one event. Resolves true when the relay accepted it; never throws. */
export async function relayEvent(env: AgentBridgeEnv, event: AgentEvent, now = Date.now()): Promise<boolean> {
  try {
    const url = env.GROK_RELAY_URL;
    const key = env.GROK_RELAY_KEY;
    if (!url || !key || !/^https:\/\//.test(url)) return false;
    const allowed = env.AGENT_RELAY_LIMITER
      ? (await env.AGENT_RELAY_LIMITER.limit({ key: `agent:${event.type}` })).success
      : localAllow(event.type, now);
    if (!allowed) return false;
    const body = JSON.stringify({
      source: "onlymonkes-actions",
      type: event.type,
      priority: event.priority === true,
      ts: new Date(now).toISOString(),
      data: scrubPrivate(event.data),
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body,
          signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        });
        if (res.ok) return true;
        if (res.status !== 429 && res.status < 500) return false;
      } catch { /* network error or timeout — retry once */ }
      if (attempt === 0) await sleep(RETRY_DELAY_MS);
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Event builders (allowlisted fields only) ────────────────────────────────

/** Sentry issue-alert / issue webhook → public-safe summary. */
export function sentryEvent(payload: unknown): AgentEvent | null {
  const p = payload as { data?: { issue?: Record<string, unknown>; event?: Record<string, unknown> }; action?: string } | null;
  const issue = p?.data?.issue ?? p?.data?.event;
  if (!issue || typeof issue !== "object") return null;
  const level = String(issue.level ?? "error");
  const s = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : null);
  return {
    type: "sentry_error",
    priority: level === "fatal",
    data: {
      action: s(p?.action, 40),
      title: s(issue.title),
      culprit: s(issue.culprit),
      level,
      shortId: s(issue.shortId, 40),
      count: Number(issue.count) || null,
      userCount: Number(issue.userCount) || null,
      firstSeen: s(issue.firstSeen, 40),
      lastSeen: s(issue.lastSeen, 40),
      project: s((issue.project as { slug?: unknown } | undefined)?.slug, 60),
      link: s(issue.web_url ?? issue.permalink, 300),
    },
  };
}

interface StatsLike {
  holders: number;
  holdersDelta: number | null;
  floorSol: number | null;
  floorChg24h: number | null;
  volume24hSol: number | null;
  recentSales: Array<{ priceSol: number; ts: number }>;
}

/** Once a day from the stats snapshot: floor, volume, sales in the last 24h (no buyers/sellers). */
export function salesDailyEvent(s: StatsLike, now = Date.now()): AgentEvent {
  const day = s.recentSales.filter((x) => now - x.ts < 86_400_000);
  return {
    type: "sales_daily",
    data: {
      floorSol: s.floorSol,
      floorChg24hPct: s.floorChg24h,
      volume24hSol: s.volume24hSol,
      sales24h: day.length,
      avgSaleSol: day.length ? Math.round((day.reduce((a, x) => a + x.priceSol, 0) / day.length) * 1000) / 1000 : null,
      holders: s.holders,
    },
  };
}

/** When the holder count moved since the last snapshot; null when unchanged or unknown. */
export function holdersChangeEvent(s: StatsLike): AgentEvent | null {
  if (!s.holdersDelta || !(s.holders > 0)) return null;
  return { type: "holders_change", data: { holders: s.holders, delta: s.holdersDelta } };
}

/** Bot health transition (only on change, see probeBot). Down is urgent. */
export function botHealthEvent(up: boolean, detail: string, downSinceIso: string | null): AgentEvent {
  return { type: "bot_health", priority: !up, data: { state: up ? "recovered" : "down", detail: detail.slice(0, 200), downSince: downSinceIso } };
}

/**
 * Liveness through the public tunnel: an unauthenticated POST /command must answer 401
 * (the bot is up and refusing, as it should). Anything else — 5xx, Cloudflare 530, timeout —
 * counts as down. Never sends the bot secret.
 */
export async function probeBot(baseUrl: string): Promise<{ up: boolean; detail: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/command`, { method: "POST", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS * 2) });
    return res.status === 401 ? { up: true, detail: "401 as expected" } : { up: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { up: false, detail: (err as Error)?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
