/**
 * imageCaption.ts — client helpers for bot-generated (Ollama) captions used
 * by various Share-to-X flows: photo captions (vision model) from
 * ChatScreen, and Banana Streak Day-7 captions (text model) from
 * BananaClaimModal.
 *
 * Fire-and-forget request pattern, NOT a blocking round trip: local Ollama
 * inference can realistically take real time on this bot's actual hardware,
 * so requests fire as early as possible (photo send / streak-modal open)
 * rather than when the user later taps Share to X, giving the caption time
 * to be ready by then. If it isn't ready yet when they do, the caller falls
 * back to a generic/static caption — never blocks the share action.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "image_captions_v1";
const MAX_CACHED = 50;
let _cache: Record<string, string> | null = null;

async function loadCache(): Promise<Record<string, string>> {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
  return _cache!;
}

/** Called from useXmtp.ts / useDm.ts when an IMAGE_CAPTION_RESPONSE: DM arrives. */
export async function storeCaptionResponse(messageId: string, caption: string): Promise<void> {
  const cache = await loadCache();
  cache[messageId] = caption;
  const entries = Object.entries(cache);
  const trimmed = entries.length > MAX_CACHED ? Object.fromEntries(entries.slice(-MAX_CACHED)) : cache;
  _cache = trimmed;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* non-critical */ }
}

/** Returns the bot-generated caption for a photo, if it's arrived yet. */
export async function getCachedCaption(messageId: string): Promise<string | null> {
  const cache = await loadCache();
  return cache[messageId] ?? null;
}

/** Fire-and-forget: ask the bot to caption a photo just sent to chat. */
export async function requestImageCaption(messageId: string, base64: string): Promise<void> {
  try {
    const { getXmtpClient } = await import("@/hooks/useXmtp");
    const { openOrCreateDm } = await import("@/lib/xmtp");
    const { BOT_INBOX_IDS } = await import("@/lib/constants");
    const client = getXmtpClient();
    if (!client) {
      // 2026-08-03: was toast.error — visible to real users for a
      // best-effort background feature (Share to X caption). Dev-only
      // console log keeps the diagnostic value without the user-facing
      // noise; falls back to the generic caption same as before.
      if (__DEV__) console.warn("[diag] caption request: no xmtp client");
      return;
    }
    const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
    await dm.send(`IMAGE_CAPTION_REQUEST:${messageId}:${base64}`);
  } catch (err) {
    if (__DEV__) console.warn(`[diag] caption request threw: ${(err as Error)?.message?.slice(0, 100)}`);
  }
}

/**
 * Banana Streak (Day-7 bonus) AI caption — same bot-generated-via-Ollama
 * pattern as photo captions, but there's only ever one pending streak
 * celebration at a time, so this is a single cached value rather than a
 * per-messageId map. Cleared once consumed so a stale caption from a
 * previous cycle can't leak into a later one.
 */
const STREAK_CACHE_KEY = "streak_caption_v1";

/** Fire-and-forget: ask the bot to write a Day-7 streak tweet caption.
 *  Called as soon as the claim modal shows the bonus (see BananaClaimModal),
 *  not when the user later taps Share to X — same "fire early, ready by the
 *  time it's needed" pattern as requestImageCaption. */
export async function requestStreakCaption(totalBananas: number, cyclesCompleted: number): Promise<void> {
  try {
    const { getXmtpClient } = await import("@/hooks/useXmtp");
    const { openOrCreateDm } = await import("@/lib/xmtp");
    const { BOT_INBOX_IDS } = await import("@/lib/constants");
    const client = getXmtpClient();
    if (!client) return;
    const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
    await dm.send(`STREAK_CAPTION_REQUEST:${totalBananas}:${cyclesCompleted}`);
  } catch {
    // non-fatal — Share to X just falls back to the static template
  }
}

/** Called from useXmtp.ts / useDm.ts when a STREAK_CAPTION_RESPONSE: DM arrives. */
export async function storeStreakCaptionResponse(caption: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STREAK_CACHE_KEY, caption);
  } catch { /* non-critical */ }
}

/** Returns the bot-generated streak caption, if it arrived in time, and
 *  clears it — one-shot, consumed at share time. */
export async function getAndClearStreakCaption(): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(STREAK_CACHE_KEY);
    if (cached) await AsyncStorage.removeItem(STREAK_CACHE_KEY);
    return cached;
  } catch {
    return null;
  }
}
