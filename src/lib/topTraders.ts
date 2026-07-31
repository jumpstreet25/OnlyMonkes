/**
 * topTraders.ts — fetches the Saga-Monkes-holder "Top Traders" scorecard
 * from the onlymonkes-actions worker (/api/top-traders).
 *
 * Privacy: the worker only ever serves {rank, winRatePct, weeklyGainPct}
 * per entry (bot-side validation rejects anything else before it's even
 * stored) — never a wallet address, never a $/SOL amount. No wallet
 * identity is attached here on the client either; entries render as
 * anonymous ranks only.
 */

const TOP_TRADERS_URL = "https://onlymonkes-actions.jumpstreet25.workers.dev/api/top-traders";
const CACHE_MS = 10 * 60 * 1000; // 10 min — this data only changes at most daily server-side

export interface TopTrader {
  rank: number;
  winRatePct: number;
  weeklyGainPct: number;
}

let _cache: { entries: TopTrader[]; ts: number } | null = null;

export async function fetchTopTraders(forceRefresh = false): Promise<TopTrader[]> {
  if (!forceRefresh && _cache && Date.now() - _cache.ts < CACHE_MS) {
    return _cache.entries;
  }
  try {
    const res = await fetch(TOP_TRADERS_URL);
    if (!res.ok) return _cache?.entries ?? [];
    const data = await res.json() as { traders?: TopTrader[] };
    const entries = Array.isArray(data.traders) ? data.traders : [];
    _cache = { entries, ts: Date.now() };
    return entries;
  } catch {
    return _cache?.entries ?? [];
  }
}
