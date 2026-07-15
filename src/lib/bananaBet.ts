/**
 * bananaBet.ts — client helpers for the BananaBetting pop-up/pill flow.
 *
 * Placement reuses the bot's existing `/bet <id> yes|no <amount>` DM path
 * (already live and tested) — a tap here just sends the equivalent
 * structured DM automatically instead of the user typing it. No local
 * banana-balance deduction yet (test-phase design, matches the bot's
 * trust-based placement — see bananaBetting.ts on the bot side).
 */

export interface BananaBetOpenData {
  id: string;
  category: "crypto" | "nft" | "sports" | "news";
  question: string;
  resolvesAt: number;
}

export function parseBananaBetOpen(content: string): BananaBetOpenData | null {
  if (!content.startsWith("BANANA_BET_OPEN:")) return null;
  try {
    const data = JSON.parse(content.slice("BANANA_BET_OPEN:".length));
    if (!data.id || !data.question || !data.resolvesAt) return null;
    return data as BananaBetOpenData;
  } catch {
    return null;
  }
}

export async function placeBananaBet(betId: string, side: "yes" | "no", amount: number): Promise<void> {
  const { getXmtpClient } = await import("@/hooks/useXmtp");
  const { openOrCreateDm } = await import("@/lib/xmtp");
  const { BOT_INBOX_IDS } = await import("@/lib/constants");
  const client = getXmtpClient();
  if (!client) throw new Error("Not connected");
  const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
  await dm.send(`/bet ${betId} ${side} ${amount}`);
}
