/**
 * topTraders.ts — fetches the "Top Traders" scorecard from the
 * onlymonkes-actions worker (/api/top-traders).
 *
 * Privacy: worker serves rank + winRatePct + weeklyGainPct + optional public
 * NFT image/name only — never a wallet address, never a $/SOL amount.
 *
 * Rows may include pinned bot books:
 *   kind=bot_entered   — AutonoMonke trades the bot opened
 *   kind=bot_monitored — smart-money wallets the bot tracks
 */

const TOP_TRADERS_URL = "https://onlymonkes-actions.jumpstreet25.workers.dev/api/top-traders";
const CACHE_MS = 10 * 60 * 1000; // 10 min

export type TopTraderKind = "bot_entered" | "bot_monitored" | "holder";

export interface TopTrader {
  rank: number;
  winRatePct: number;
  weeklyGainPct: number;
  /** Public Saga Monke / bot image URL when available */
  nftImage?: string;
  /** e.g. "MONKE #622" or "AI Agent #9385 · Entered" */
  monkeName?: string;
  /** Pinned bot books vs community holders */
  kind?: TopTraderKind;
}

let _cache: { entries: TopTrader[]; ts: number } | null = null;

function isBotKind(k: string | undefined): k is "bot_entered" | "bot_monitored" {
  return k === "bot_entered" || k === "bot_monitored";
}

export async function fetchTopTraders(forceRefresh = false): Promise<TopTrader[]> {
  if (!forceRefresh && _cache && Date.now() - _cache.ts < CACHE_MS) {
    return _cache.entries;
  }
  try {
    const res = await fetch(TOP_TRADERS_URL);
    if (!res.ok) return _cache?.entries ?? [];
    const data = await res.json() as { traders?: TopTrader[] };
    const entries = Array.isArray(data.traders) ? data.traders : [];
    // Client-side guard: require core numeric fields. Bot rows may have
    // rank 0 and weeklyGainPct 0 (all-time WR still shown).
    const active = entries.filter(
      (t) =>
        typeof t.rank === "number" &&
        typeof t.winRatePct === "number" &&
        typeof t.weeklyGainPct === "number" &&
        (isBotKind(t.kind) || t.kind === "holder" || t.kind === undefined),
    );
    // Stable order: bot books first (entered, then monitored), then holders by rank
    const bots = active.filter((t) => isBotKind(t.kind));
    const holders = active
      .filter((t) => !isBotKind(t.kind))
      .sort((a, b) => a.rank - b.rank);
    const ordered = [
      ...bots.filter((t) => t.kind === "bot_entered"),
      ...bots.filter((t) => t.kind === "bot_monitored"),
      ...holders,
    ];
    _cache = { entries: ordered, ts: Date.now() };
    return ordered;
  } catch {
    return _cache?.entries ?? [];
  }
}

export function isBotTrader(t: TopTrader): boolean {
  return isBotKind(t.kind);
}
