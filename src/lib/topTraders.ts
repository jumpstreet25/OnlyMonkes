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

/** Hardcoded bot identity — always available even if CDN/worker omits fields. */
export const BOT_LEADERBOARD_PFP = "https://i.imgur.com/Igyhf3p.jpeg";
export const BOT_LEADERBOARD_NAME = "AI Agent #9385";

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

/** Infer bot book when older caches / partial payloads omit `kind`. */
export function normalizeTopTrader(raw: TopTrader): TopTrader {
  let kind = raw.kind;
  const name = (raw.monkeName ?? "").toLowerCase();

  if (!isBotKind(kind)) {
    if (name.includes("entered") || name.includes("· entered") || name.includes("actual")) {
      kind = "bot_entered";
    } else if (name.includes("monitored") || name.includes("· monitored") || name.includes("watch")) {
      kind = "bot_monitored";
    } else if (name.includes("ai agent") || name.includes("#9385")) {
      // Ambiguous bot row — leave kind unset unless rank is 0 (pinned bots)
      if (raw.rank === 0) kind = "bot_entered";
    } else if (raw.rank === 0 && (raw.nftImage?.includes("imgur.com/Igyhf3p") || !raw.monkeName)) {
      // rank-0 without community monke name → treat as bot book placeholders
      kind = undefined;
    }
  }

  if (isBotKind(kind)) {
    return {
      ...raw,
      kind,
      monkeName:
        kind === "bot_entered"
          ? `${BOT_LEADERBOARD_NAME} · Entered`
          : `${BOT_LEADERBOARD_NAME} · Monitored`,
      nftImage: raw.nftImage && /^https:\/\//i.test(raw.nftImage)
        ? raw.nftImage
        : BOT_LEADERBOARD_PFP,
    };
  }

  return { ...raw, kind: kind === "holder" ? "holder" : raw.kind ?? "holder" };
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
    const active = entries
      .filter(
        (t) =>
          typeof t.rank === "number" &&
          typeof t.winRatePct === "number" &&
          typeof t.weeklyGainPct === "number",
      )
      .map(normalizeTopTrader);

    // If API returned two rank-0 rows without kind/name, assign by order
    const rankZero = active.filter((t) => t.rank === 0 && !isBotKind(t.kind));
    if (rankZero.length >= 1) {
      let assigned = 0;
      for (let i = 0; i < active.length; i++) {
        if (active[i].rank !== 0 || isBotKind(active[i].kind)) continue;
        const k: TopTraderKind = assigned === 0 ? "bot_entered" : "bot_monitored";
        active[i] = normalizeTopTrader({ ...active[i], kind: k, monkeName: k === "bot_entered" ? "Entered" : "Monitored" });
        assigned++;
        if (assigned >= 2) break;
      }
    }

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
  return isBotKind(t.kind) || t.rank === 0 && (t.monkeName?.includes("AI Agent") ?? false);
}
