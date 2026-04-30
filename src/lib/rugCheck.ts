/**
 * rugCheck.ts — Pull a token's risk summary from RugCheck.xyz.
 *
 * Free, public API, no auth. Cached in-memory for 1 hour per mint to
 * avoid hammering on repeated ChartModal opens.
 */

const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1";
const CACHE_TTL_MS = 60 * 60_000; // 1 hour

interface RugCheckRisk {
  name: string;
  description?: string;
  level?: string;   // "warn" | "danger" | etc.
  score?: number;
}

export interface RugCheckSummary {
  mint: string;
  /** 0-100. Lower = safer. RugCheck's own normalised scale. */
  scoreNormalised: number;
  /** % of LP locked. > 80 generally safe; under 50 is suspect. */
  lpLockedPct: number;
  /** Top three risks ordered by severity. */
  topRisks: RugCheckRisk[];
  /** Coarse verdict for badge color. */
  verdict: "safe" | "caution" | "danger";
  fetchedAt: number;
}

const _cache = new Map<string, RugCheckSummary>();

function deriveVerdict(scoreNormalised: number, lpLockedPct: number): RugCheckSummary["verdict"] {
  if (scoreNormalised >= 60 || lpLockedPct < 30) return "danger";
  if (scoreNormalised >= 25 || lpLockedPct < 70) return "caution";
  return "safe";
}

export async function fetchRugCheckSummary(mint: string): Promise<RugCheckSummary | null> {
  const cached = _cache.get(mint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const res = await fetch(
      `${RUGCHECK_BASE}/tokens/${mint}/report/summary`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const json = await res.json() as {
      score_normalised?: number;
      lpLockedPct?: number;
      risks?: RugCheckRisk[];
    };

    const scoreNormalised = typeof json.score_normalised === "number" ? json.score_normalised : 0;
    const lpLockedPct = typeof json.lpLockedPct === "number" ? json.lpLockedPct : 0;
    const allRisks = Array.isArray(json.risks) ? json.risks : [];
    // Sort by score desc; show top 3
    const topRisks = [...allRisks]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3);

    const summary: RugCheckSummary = {
      mint,
      scoreNormalised,
      lpLockedPct,
      topRisks,
      verdict: deriveVerdict(scoreNormalised, lpLockedPct),
      fetchedAt: Date.now(),
    };
    _cache.set(mint, summary);
    return summary;
  } catch {
    return null;
  }
}
