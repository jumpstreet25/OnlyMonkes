/**
 * bananaBet.ts — client helpers for the BananaBetting pop-up/pill flow.
 *
 * Placement reuses the bot's existing `/bet <id> yes|no <amount>` DM path
 * (already live and tested) — a tap here just sends the equivalent
 * structured DM automatically instead of the user typing it.
 *
 * 2026-07-16: real balance deduction wired up (was trust-based test-phase
 * only) — placeBananaBet() now spends from the SAME banana balance used by
 * the Banana Store (bananaRewards.ts), same spend/sync pattern as
 * BananaShopModal's purchases. Users can never bet more than they've
 * actually earned.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface BananaBetOpenData {
  id: string;
  category: "crypto" | "nft" | "sports" | "news";
  question: string;
  resolvesAt: number;
  /** Bot-generated (Ollama-first, see fallbackChain.ts) cheeky X caption,
   *  computed once at broadcast time. Absent on older/replayed messages or
   *  if generation failed — callers fall back to a local static pool. */
  shareCaption?: string;
}

export interface BananaBetSettledData {
  betId: string;
  question: string;
  outcome: "yes" | "no";
  totalBets: number;
  totalBananasWon: number;
  /** Only present via the push-notification path (per-user win/lose caption
   *  needs to know the recipient, which the anonymous group broadcast this
   *  type is also parsed from doesn't carry) — see notifications.ts. */
  shareCaption?: string;
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

export function parseBananaBetSettled(content: string): BananaBetSettledData | null {
  if (!content.startsWith("BANANA_BET_SETTLED:")) return null;
  try {
    const data = JSON.parse(content.slice("BANANA_BET_SETTLED:".length));
    if (!data.betId || !data.question || !data.outcome) return null;
    return data as BananaBetSettledData;
  } catch {
    return null;
  }
}

export async function placeBananaBet(betId: string, side: "yes" | "no", amount: number): Promise<void> {
  if (!amount || amount <= 0) throw new Error("Invalid amount");
  const { getBananaBalance, spendBananas, addBananas } = await import("@/lib/bananaRewards");
  const { useAppStore } = await import("@/store/appStore");

  const balance = await getBananaBalance();
  if (amount > balance) throw new Error(`Not enough bananas — you have ${balance} 🍌`);

  const spent = await spendBananas(amount);
  if (!spent) throw new Error(`Not enough bananas — you have ${balance} 🍌`);
  useAppStore.getState().setBananaBalance(useAppStore.getState().bananaBalance - amount);

  try {
    const { getXmtpClient } = await import("@/hooks/useXmtp");
    const { openOrCreateDm } = await import("@/lib/xmtp");
    const { BOT_INBOX_IDS } = await import("@/lib/constants");
    const client = getXmtpClient();
    if (!client) throw new Error("Not connected");
    const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
    await dm.send(`/bet ${betId} ${side} ${amount}`);
    await recordMyBet(betId, side, amount);
  } catch (err) {
    // Refund — the stake was never recorded bot-side if the DM send failed.
    await addBananas(amount);
    useAppStore.getState().setBananaBalance(useAppStore.getState().bananaBalance + amount);
    throw err;
  }
}

// ─── My-bet tracking — lets the settlement popup know if THIS device's
// user personally won or lost, for a personalized display + share caption.
// The group BANANA_BET_SETTLED: broadcast is intentionally aggregate/
// anonymous (goes to everyone regardless of participation), so per-user
// outcome has to be derived client-side by cross-referencing this local
// record against the broadcast's outcome — never sent over the wire. ────
const MY_BETS_KEY = "banana_my_bets_v1";
const MAX_MY_BETS = 200;
export interface MyBetRecord { side: "yes" | "no"; amount: number }
let _myBetsCache: Record<string, MyBetRecord> | null = null;

async function loadMyBets(): Promise<Record<string, MyBetRecord>> {
  if (_myBetsCache) return _myBetsCache;
  try {
    const raw = await AsyncStorage.getItem(MY_BETS_KEY);
    _myBetsCache = raw ? JSON.parse(raw) : {};
  } catch {
    _myBetsCache = {};
  }
  return _myBetsCache!;
}

async function recordMyBet(betId: string, side: "yes" | "no", amount: number): Promise<void> {
  const bets = await loadMyBets();
  bets[betId] = { side, amount };
  const entries = Object.entries(bets);
  const trimmed = entries.length > MAX_MY_BETS ? Object.fromEntries(entries.slice(-MAX_MY_BETS)) : bets;
  _myBetsCache = trimmed;
  try {
    await AsyncStorage.setItem(MY_BETS_KEY, JSON.stringify(trimmed));
  } catch { /* non-critical */ }
}

/** Returns this device's own bet on betId, if any — null if never placed one. */
export async function getMyBet(betId: string): Promise<MyBetRecord | null> {
  const bets = await loadMyBets();
  return bets[betId] ?? null;
}

// ─── Seen-bet tracking — pop-up shows once per bet, ever ──────────────────
// A BANANA_BET_OPEN: broadcast can be reprocessed (XMTP stream reconnect
// replaying recent messages is the most likely cause, per the 2026-07-16
// report of the pop-up "returning a few times") — track which bet ids have
// already triggered a pop-up so a replay is a safe no-op regardless of
// mechanism. Persisted so it survives app restarts too.
const SEEN_KEY = "banana_bet_seen_ids_v1";
const MAX_SEEN = 200;
let _seenCache: Set<string> | null = null;

async function loadSeen(): Promise<Set<string>> {
  if (_seenCache) return _seenCache;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    _seenCache = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    _seenCache = new Set();
  }
  return _seenCache;
}

async function saveSeen(seen: Set<string>): Promise<void> {
  try {
    const trimmed = Array.from(seen).slice(-MAX_SEEN);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch { /* non-critical */ }
}

/** Returns true and marks the bet as seen if this is the FIRST time — false if already seen. */
export async function markBetSeenIfFirstTime(betId: string): Promise<boolean> {
  const seen = await loadSeen();
  if (seen.has(betId)) return false;
  seen.add(betId);
  await saveSeen(seen);
  return true;
}
