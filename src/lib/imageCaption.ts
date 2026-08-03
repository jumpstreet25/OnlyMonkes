/**
 * imageCaption.ts — client helpers for bot-generated (Ollama vision) photo
 * captions, used by ChatScreen's Share-to-X flow.
 *
 * Fire-and-forget request pattern, NOT a blocking round trip: the bot's
 * vision inference (llava via Ollama) can realistically take 60s+ on its
 * actual hardware, so the request fires the moment a photo is SENT to chat
 * (see ChatScreen.tsx handleCamera), giving the caption time to be ready
 * well before the user later taps Share to X. If it isn't ready yet when
 * they do, the caller falls back to a generic caption — never blocks the
 * share action waiting on this.
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
