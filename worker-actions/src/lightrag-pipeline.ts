/**
 * lightrag-pipeline.ts
 *
 * LightRAG knowledge graph ingestion + query pipeline.
 * All ingest calls are fire-and-forget (void) — never block the bot.
 * queryLightRAG has a hard 3s timeout — falls back to empty string silently.
 */

const LIGHTRAG_URL = process.env.LIGHTRAG_URL || "http://localhost:9621";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface AlertFiredPayload {
  id: string;
  token: string;
  timeframe: string;
  score: number;
  entry: number;
  stopLoss: number;
  targets: [number, number];
  confluence: string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  timestamp: number;
}

export interface AlertResolvedPayload extends AlertFiredPayload {
  exitPrice: number;
  result: "T1_HIT" | "T2_HIT" | "STOP_HIT" | "EXPIRED";
  pnlPct: number;
  durationHours: number;
  chatSentimentAtFire: "bullish" | "neutral" | "bearish";
  whaleActivityAtFire: boolean;
}

export interface WeeklyDigestPayload {
  weekOf: string;
  totalAlerts: number;
  wins: number;
  losses: number;
  bestToken: string;
  worstToken: string;
  bestConfluence: string[];
  avgWinDuration: number;
  avgLossDuration: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function ingest(text: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    await fetch(`${LIGHTRAG_URL}/documents/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (err) {
    console.error("[LightRAG] ingest failed:", (err as Error).message);
  }
}

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

// ─── Exported functions ──────────────────────────────────────────────────────

/**
 * 1. Ingest a chat message into the knowledge graph.
 *    Filters out system/protocol messages — only real content gets ingested.
 */
export function ingestChatMessage(msg: {
  sender: string;
  content: string;
  timestamp: number;
  channel: "main" | "trades" | "bets" | "predictions" | "sales";
}): void {
  try {
    const SKIP_PREFIXES = [
      "PRESENCE:", "TYPING:", "PROFILE_UPDATE:", "LIVE_ROOM:", "VIDEO_ROOM:",
      "PIN:", "UNPIN:", "THREAD:", "NFT_LIST:", "NFT_BID:", "NFT_OFFER:",
      "NFT_ACCEPT:", "NFT_DELIST:", "NFT_SWAP:", "NFT_COMPLETE:",
      "EDIT:", "REACT:", "STICKER_REACT:", "AUTOMONKE_STATUS:",
    ];
    if (SKIP_PREFIXES.some((p) => msg.content.startsWith(p))) return;

    // Only ingest MSG: prefixed messages and bot alert text
    const content = msg.content.startsWith("MSG:")
      ? msg.content.replace(/^MSG:[^:]+:/, "").trim()
      : msg.content;

    if (!content) return;

    const text = `[${iso(msg.timestamp)}] ${msg.channel} | ${msg.sender}: ${content}`;
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] ingestChatMessage failed:", (err as Error).message);
  }
}

/**
 * 2. Record a new TA alert firing.
 */
export function onAlertFired(alert: AlertFiredPayload): void {
  try {
    const text = [
      `TA ALERT FIRED: $${alert.token} on ${alert.timeframe}`,
      `Score: ${alert.score} | Risk: ${alert.risk}`,
      `Entry: $${alert.entry} | Stop: $${alert.stopLoss}`,
      `Targets: T1=$${alert.targets[0]}, T2=$${alert.targets[1]}`,
      `Confluence: ${alert.confluence.join(", ")}`,
      `Timestamp: ${iso(alert.timestamp)}`,
      `Pattern summary: ${alert.confluence.join("+")}+${alert.timeframe} for $${alert.token} = OPEN (score ${alert.score}, risk ${alert.risk})`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onAlertFired failed:", (err as Error).message);
  }
}

/**
 * 3. Record a resolved alert outcome — most important function.
 */
export function onAlertResolved(alert: AlertResolvedPayload): void {
  try {
    const win = alert.result === "T1_HIT" || alert.result === "T2_HIT";
    const text = [
      `ALERT RESOLVED: $${alert.token} on ${alert.timeframe} — ${win ? "WIN" : "LOSS"}`,
      `Result: ${alert.result} | PnL: ${alert.pnlPct > 0 ? "+" : ""}${alert.pnlPct.toFixed(2)}%`,
      `Duration: ${alert.durationHours.toFixed(1)}h`,
      `Entry: $${alert.entry} → Exit: $${alert.exitPrice}`,
      `Stop: $${alert.stopLoss} | Targets: T1=$${alert.targets[0]}, T2=$${alert.targets[1]}`,
      `Score: ${alert.score} | Risk: ${alert.risk}`,
      `Confluence: ${alert.confluence.join(", ")}`,
      `Chat sentiment at fire: ${alert.chatSentimentAtFire}`,
      `Whale activity at fire: ${alert.whaleActivityAtFire ? "YES" : "NO"}`,
      `Timestamp: ${iso(alert.timestamp)} → Resolved: ${iso(alert.timestamp + alert.durationHours * 3600000)}`,
      `Pattern summary: ${alert.confluence.join("+")}+${alert.timeframe} for $${alert.token} = ${alert.result} (${alert.pnlPct > 0 ? "+" : ""}${alert.pnlPct.toFixed(2)}% in ${alert.durationHours.toFixed(1)}h)`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onAlertResolved failed:", (err as Error).message);
  }
}

/**
 * 4. Record an NFT sale.
 */
export function onNFTSale(sale: {
  tokenId: string;
  price: number;
  seller: string;
  buyer: string;
  timestamp: number;
}): void {
  try {
    const text = [
      `NFT SALE: Saga Monke #${sale.tokenId}`,
      `Price: ${sale.price} SOL | Seller: ${sale.seller} → Buyer: ${sale.buyer}`,
      `Timestamp: ${iso(sale.timestamp)}`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onNFTSale failed:", (err as Error).message);
  }
}

/**
 * 5. Record a resolved sports bet.
 */
export function onBetResolved(bet: {
  market: string;
  sport: string;
  edge: number;
  result: string;
  pnlUsdt: number;
  timestamp: number;
}): void {
  try {
    const text = [
      `BET RESOLVED: ${bet.sport} — ${bet.market}`,
      `Edge: ${bet.edge.toFixed(1)}% | Result: ${bet.result} | PnL: $${bet.pnlUsdt.toFixed(2)}`,
      `Timestamp: ${iso(bet.timestamp)}`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onBetResolved failed:", (err as Error).message);
  }
}

/**
 * 6. Record a resolved prediction market position.
 */
export function onPredictionResolved(pred: {
  market: string;
  score: number;
  result: string;
  pnlUsdt: number;
  timestamp: number;
}): void {
  try {
    const text = [
      `PREDICTION RESOLVED: ${pred.market}`,
      `Score: ${pred.score} | Result: ${pred.result} | PnL: $${pred.pnlUsdt.toFixed(2)}`,
      `Timestamp: ${iso(pred.timestamp)}`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onPredictionResolved failed:", (err as Error).message);
  }
}

/**
 * 7. Record weekly digest stats.
 */
export function onWeeklyDigest(stats: WeeklyDigestPayload): void {
  try {
    const winRate = ((stats.wins / stats.totalAlerts) * 100).toFixed(1);
    const text = [
      `WEEKLY DIGEST: Week of ${stats.weekOf}`,
      `Total alerts: ${stats.totalAlerts} | Wins: ${stats.wins} | Losses: ${stats.losses} | Win rate: ${winRate}%`,
      `Best token: $${stats.bestToken} | Worst token: $${stats.worstToken}`,
      `Best confluence: ${stats.bestConfluence.join(", ")}`,
      `Avg win duration: ${stats.avgWinDuration.toFixed(1)}h | Avg loss duration: ${stats.avgLossDuration.toFixed(1)}h`,
    ].join("\n");
    void ingest(text);
  } catch (err) {
    console.error("[LightRAG] onWeeklyDigest failed:", (err as Error).message);
  }
}

/**
 * 8. Query the knowledge graph. Hard 3s timeout — returns "" on any failure.
 */
export async function queryLightRAG(
  question: string,
  mode: "hybrid" | "local" | "global" | "naive" = "hybrid",
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${LIGHTRAG_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, mode }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return "";
    const data = (await res.json()) as { response?: string };
    return data.response ?? "";
  } catch {
    return "";
  }
}

/**
 * 9. Backfill historical outcomes sequentially with 200ms delay.
 */
export async function backfillHistoricalData(
  outcomes: AlertResolvedPayload[],
): Promise<void> {
  for (let i = 0; i < outcomes.length; i++) {
    onAlertResolved(outcomes[i]);
    if ((i + 1) % 10 === 0) {
      console.log(`[LightRAG] Backfilled ${i + 1}/${outcomes.length}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`[LightRAG] Backfill complete: ${outcomes.length} outcomes`);
}
