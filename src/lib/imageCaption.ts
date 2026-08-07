/**
 * imageCaption.ts — client helpers for bot-generated photo captions used by
 * PhotoReviewModal (live fill while the modal is open) and Share-to-X.
 *
 * Fire-and-forget request pattern: the app posts IMAGE_CAPTION_REQUEST to the
 * bot DM as soon as a photo is taken. The bot describes the image (Groq vision)
 * and replies IMAGE_CAPTION_RESPONSE:<id>:<caption>. Delivery used to rely
 * solely on streamAllMessages, which silently dropped object-wrapped text
 * payloads — so the bot could succeed while PhotoReviewModal sat on
 * "Monke is thinking…" until its give-up timer. We now:
 *   1) parse responses robustly (substring match, not only startsWith after MSG strip)
 *   2) actively poll/sync the bot DM for the matching response while waiting
 *   3) send a smaller vision-only JPEG so the XMTP request itself isn't huge
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "image_captions_v1";
const MAX_CACHED = 50;
/** Client wait budget for the review modal — must cover XMTP round-trip + vision. */
export const CAPTION_WAIT_MS = 45_000;
const POLL_INTERVAL_MS = 1_200;

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

/**
 * Pull plain text out of an XMTP DecodedMessage regardless of codec shape.
 * RN SDK TextCodec returns a string; some bridge paths surface `{ text }` or
 * only put the body on `nativeContent.text` / `fallback`.
 */
export function extractXmtpText(raw: any): string | null {
  try {
    let content: unknown =
      typeof raw?.content === "function" ? raw.content() : raw?.content;
    if (content && typeof content === "object" && typeof (content as any).text === "string") {
      content = (content as any).text;
    }
    if (typeof content === "string" && content.length > 0) return content;
  } catch { /* fall through */ }
  if (typeof raw?.nativeContent?.text === "string" && raw.nativeContent.text.length > 0) {
    return raw.nativeContent.text as string;
  }
  if (typeof raw?.fallback === "string" && raw.fallback.length > 0) {
    return raw.fallback as string;
  }
  return null;
}

/**
 * Parse IMAGE_CAPTION_RESPONSE from a wire string. Accepts bare payloads and
 * bot `MSG:<name>:…` envelopes — matches the token anywhere so a slightly
 * different envelope never silently fails startsWith checks.
 */
export function parseImageCaptionResponse(
  text: string,
): { messageId: string; caption: string } | null {
  const marker = "IMAGE_CAPTION_RESPONSE:";
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const rest = text.slice(idx + marker.length);
  const sepIdx = rest.indexOf(":");
  if (sepIdx <= 0) return null;
  const messageId = rest.slice(0, sepIdx).trim();
  const caption = rest.slice(sepIdx + 1).trim();
  if (!messageId || !caption) return null;
  return { messageId, caption };
}

/** Apply a parsed response to cache + live PhotoReviewModal store. */
export async function deliverCaptionResponse(messageId: string, caption: string): Promise<void> {
  await storeCaptionResponse(messageId, caption);
  try {
    const { usePhotoReviewStore } = await import("@/store/photoReviewStore");
    usePhotoReviewStore.getState().setCaption(messageId, caption);
  } catch { /* store optional in headless contexts */ }
}

/**
 * Actively sync the bot DM and scan recent messages for a matching
 * IMAGE_CAPTION_RESPONSE. Covers the case where streamAllMessages drops the
 * reply (content-shape race, stream not yet attached, etc.) while the bot
 * has already generated and sent it.
 */
async function pollBotDmForCaption(messageId: string): Promise<string | null> {
  try {
    const { getXmtpClient } = await import("@/hooks/useXmtp");
    const { openOrCreateDm } = await import("@/lib/xmtp");
    const { BOT_INBOX_IDS } = await import("@/lib/constants");
    const client = getXmtpClient();
    if (!client) return null;
    const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
    try {
      await dm.sync?.();
    } catch { /* best-effort */ }
    const msgs: any[] = await dm.messages({ limit: 40, direction: "DESCENDING" }).catch(() => []);
    for (const raw of msgs) {
      const text = extractXmtpText(raw);
      if (!text) continue;
      const parsed = parseImageCaptionResponse(text);
      if (!parsed || parsed.messageId !== messageId) continue;
      await deliverCaptionResponse(parsed.messageId, parsed.caption);
      return parsed.caption;
    }
  } catch (err) {
    if (__DEV__) {
      console.warn(`[diag] caption poll threw: ${(err as Error)?.message?.slice(0, 100)}`);
    }
  }
  return null;
}

/**
 * Wait until the caption for `messageId` is in the live store / cache, or
 * until timeout. Polls the bot DM on an interval so a missed stream event
 * still fills PhotoReviewModal.
 */
export async function waitForImageCaption(
  messageId: string,
  timeoutMs: number = CAPTION_WAIT_MS,
): Promise<string | null> {
  const { usePhotoReviewStore } = await import("@/store/photoReviewStore");
  const deadline = Date.now() + timeoutMs;

  const fromStore = usePhotoReviewStore.getState().captions[messageId];
  if (fromStore) return fromStore;
  const cached = await getCachedCaption(messageId);
  if (cached) {
    usePhotoReviewStore.getState().setCaption(messageId, cached);
    return cached;
  }

  while (Date.now() < deadline) {
    const live = usePhotoReviewStore.getState().captions[messageId];
    if (live) return live;

    const polled = await pollBotDmForCaption(messageId);
    if (polled) return polled;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)));
  }

  return usePhotoReviewStore.getState().captions[messageId] ?? (await getCachedCaption(messageId));
}

/**
 * Shrink a local image URI to a vision-friendly JPEG (small base64 for XMTP).
 * Chat still uses the full compressImage path for the IMAGE: payload.
 */
async function visionBase64FromUri(localUri: string): Promise<string | null> {
  try {
    const ImageManipulator = await import("expo-image-manipulator");
    const result = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: 512 } }],
      {
        compress: 0.55,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    return result.base64 ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire caption request + background wait that delivers into photoReviewStore.
 * Prefer passing `localUri` so we can send a small vision JPEG over XMTP
 * (full chat-quality base64 is often multi-MB and slow to upload).
 */
export async function requestImageCaption(
  messageId: string,
  base64: string,
  localUri?: string | null,
): Promise<void> {
  try {
    const { getXmtpClient } = await import("@/hooks/useXmtp");
    const { openOrCreateDm } = await import("@/lib/xmtp");
    const { BOT_INBOX_IDS } = await import("@/lib/constants");
    const client = getXmtpClient();
    if (!client) {
      if (__DEV__) console.warn("[diag] caption request: no xmtp client");
      return;
    }

    let payloadB64 = base64;
    if (localUri) {
      const small = await visionBase64FromUri(localUri);
      if (small && small.length > 0) payloadB64 = small;
    }
    // Strip accidental data-URI prefix if a caller passed one
    const dataIdx = payloadB64.indexOf("base64,");
    if (dataIdx >= 0) payloadB64 = payloadB64.slice(dataIdx + "base64,".length);

    const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
    await dm.send(`IMAGE_CAPTION_REQUEST:${messageId}:${payloadB64}`);

    // Don't await — PhotoReviewModal watches the store; this just guarantees
    // delivery even if streamAllMessages drops the reply.
    void waitForImageCaption(messageId, CAPTION_WAIT_MS);
  } catch (err) {
    if (__DEV__) {
      console.warn(`[diag] caption request threw: ${(err as Error)?.message?.slice(0, 100)}`);
    }
  }
}

/**
 * Banana Streak (Day-7 bonus) AI caption — same bot-generated pattern as
 * photo captions, single cached value (one pending celebration at a time).
 */
const STREAK_CACHE_KEY = "streak_caption_v1";

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

export async function storeStreakCaptionResponse(caption: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STREAK_CACHE_KEY, caption);
  } catch { /* non-critical */ }
}

export async function getAndClearStreakCaption(): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(STREAK_CACHE_KEY);
    if (cached) await AsyncStorage.removeItem(STREAK_CACHE_KEY);
    return cached;
  } catch {
    return null;
  }
}
