/**
 * Saga Monkes live floor for the app ticker, the website and /api/stats (2026-11-13).
 * The bot reads Tensor's on-chain cNFT listings every 10 min (Monke_Eliza
 * lib/nft/tensorFloor.ts) and serves the buy-now floor (list + 5% royalty + 2% Tensor fee,
 * what Tensor shows) in /api/sales-stats. This keeps one copy at the edge for 5 min so a
 * page view never reaches the bot. CoinGecko (lags Tensor) only when the bot has no
 * Tensor floor, and labelled so.
 *   GET /api/floor → { floorSol, source: "tensor" | "coingecko", listSol?, listed?, at }
 */

const fetchWithTimeout = (url: string, init: RequestInit, ms: number) => fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

export type LiveFloor = { floorSol: number; source: "tensor" | "coingecko"; listSol?: number; listed?: number; at: number };
type FloorEnv = { BOT_PROFILE_URL?: string };

const CACHE_KEY = "https://floor.onlymonkes.internal/v1";
const TTL_S = 300;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Shape a bot /api/sales-stats reply into a floor, or null when it has no Tensor floor. */
export function floorFromBot(d: any, now = Date.now()): LiveFloor | null {
  const f = num(d?.floorSol);
  if (!f || d?.floorSource !== "tensor") return null;
  const l = d?.listing;
  return { floorSol: f, source: "tensor", listSol: num(l?.listSol) ?? undefined, listed: num(l?.listed) ?? undefined, at: num(l?.at) ?? now };
}

async function compute(env: FloorEnv): Promise<LiveFloor | null> {
  const base = (env.BOT_PROFILE_URL ?? "").replace(/\/$/, "");
  if (base) {
    try {
      const res = await fetchWithTimeout(`${base}/api/sales-stats`, {}, 8_000);
      if (res.ok) { const f = floorFromBot(await res.json()); if (f) return f; }
    } catch { /* fall through */ }
  }
  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/nfts/saga-monkes", { headers: { "User-Agent": "OnlyMonkes-Web/1.0" } }, 8_000);
    if (res.ok) {
      const f = num(((await res.json()) as any)?.floor_price?.native_currency);
      if (f) return { floorSol: f, source: "coingecko", at: Date.now() };
    }
  } catch { /* none */ }
  return null;
}

export async function liveFloor(env: FloorEnv): Promise<LiveFloor | null> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => undefined);
    if (hit) { try { return (await hit.json()) as LiveFloor; } catch { /* recompute */ } }
  }
  const f = await compute(env);
  if (f && cache) {
    await cache.put(CACHE_KEY, new Response(JSON.stringify(f), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL_S}` } })).catch(() => {});
  }
  return f;
}
