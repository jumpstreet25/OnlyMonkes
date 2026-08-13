/**
 * messageCache.ts
 *
 * AsyncStorage-backed persistence for chat messages across app restarts.
 * - Main chat: caches last 50 messages (7-day TTL)
 * - Bot channels (bets/trades/sales/predictions): 24-hour TTL, max 200
 * - Media (IMAGE/GIF/VIDEO) and URL messages are kept indefinitely for Shared tabs
 *
 * 2026-07-22: IMAGE: messages' embedded base64 payloads are rewritten to
 * real cache files (mediaCache.ts) before being persisted here — see
 * serialize(). GIF:/VIDEO: content is already just a remote URL string
 * (Giphy CDN / Cloudinary upload respectively), not an embedded blob, so
 * they were never part of this problem and don't need the same treatment.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { debouncedSetItem } from "@/lib/debouncedStorage";
import { cacheImageContent, deleteCachedImage } from "@/lib/mediaCache";
import type { ChatMessage } from "@/types";

const AK_PREFIX = "msg_cache_v1_";
const AK_LAST_READ = "msg_last_read_v1_";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Bot channels keep only 24h of messages; main chat keeps 50 */
const BOT_CHANNELS = new Set(["trades"]);
const MAX_CACHED_MAIN = 150;
const MAX_CACHED_BOT = 200;
// isPreservable messages (IMAGE/GIF/VIDEO/URL) were exempt from maxCached
// entirely — every PnL card ever shared to Main Chat embeds a full base64
// JPEG directly in `content` (100-400KB as a string) and none of them ever
// aged out. That's unbounded AsyncStorage growth: the cached JSON blob only
// gets bigger with every image/GIF/video/link shared, for the life of the
// install, and JSON.parse-ing an ever-growing multi-MB blob on every cold
// start is the direct cause of load times climbing over time.
// 2026-07-12: the original cap (40) bounded item COUNT but not byte size —
// 40 embedded images at up to ~400KB each is still a multi-MB blob to parse
// on every load. Tightened further since "old messages loading slowly" was
// still being reported after the count-only cap shipped.
const MAX_PRESERVABLE = 15;

const URL_REGEX = /https?:\/\/[^\s"'<>)]+/;

/** Serializable form of ChatMessage (Date → ISO string) */
interface SerializedMessage {
  id: string;
  senderAddress: string;
  senderUsername?: string;
  senderNft?: { mint: string; name: string; image: string | null };
  content: string;
  sentAt: string; // ISO
  reactions: ChatMessage["reactions"];
  stickerReactions?: ChatMessage["stickerReactions"];
  replyTo?: ChatMessage["replyTo"];
  status?: ChatMessage["status"];
}

function serialize(msg: ChatMessage): SerializedMessage {
  // Rewrite embedded base64 IMAGE: payloads to a real cache file reference
  // before persisting — keeps the AsyncStorage JSON blob small. Only
  // touches the copy being written to disk, never the live in-memory
  // message (this returns a new object; msg.content itself is untouched).
  const content = cacheImageContent(msg.id, msg.content);
  return { ...msg, content, sentAt: msg.sentAt.toISOString() };
}

function deserialize(s: SerializedMessage): ChatMessage {
  return { ...s, sentAt: new Date(s.sentAt) } as ChatMessage;
}

/**
 * Returns true if this message should be preserved past the 7-day window
 * (media for Shared Images, URLs for Shared Links).
 */
function isPreservable(content: string): boolean {
  return (
    content.startsWith("IMAGE:") ||
    content.startsWith("GIF:") ||
    content.startsWith("VIDEO:") ||
    URL_REGEX.test(content)
  );
}

/**
 * Load cached messages for a channel, pruning expired ones.
 */
export async function loadCachedMessages(channelKey: string): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(AK_PREFIX + channelKey);
    if (!raw) return [];
    const items: SerializedMessage[] = JSON.parse(raw);
    const now = Date.now();
    const ttl = BOT_CHANNELS.has(channelKey) ? ONE_DAY_MS : SEVEN_DAYS_MS;
    const kept = items.filter((s) => {
      const age = now - new Date(s.sentAt).getTime();
      // Keep if within TTL OR if it's a preservable message (media/link)
      return age < ttl || isPreservable(s.content);
    });
    // Save back the pruned list (debounced — not critical path)
    if (kept.length !== items.length) {
      debouncedSetItem(AK_PREFIX + channelKey, JSON.stringify(kept), 1000);
    }
    return kept.map(deserialize);
  } catch {
    return [];
  }
}

/**
 * Save messages for a channel, merging with existing cache.
 * Deduplicates by message ID, caps at MAX_CACHED_MESSAGES.
 */
export async function saveCachedMessages(
  channelKey: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const existing = await loadCachedMessages(channelKey);
    const existingIds = new Set(existing.map((m) => m.id));
    // Merge: existing + new (deduped)
    const merged = [
      ...existing,
      ...messages.filter((m) => !existingIds.has(m.id)),
    ];
    // Sort by sentAt ascending
    merged.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    // Trim: keep last MAX_CACHED_MESSAGES, but never drop preservable messages
    const maxCached = BOT_CHANNELS.has(channelKey) ? MAX_CACHED_BOT : MAX_CACHED_MAIN;
    let trimmed = merged;
    if (trimmed.length > maxCached || merged.some((m) => isPreservable(m.content))) {
      const preservableAll = trimmed.filter((m) => isPreservable(m.content));
      // Newest MAX_PRESERVABLE win — older ones age out of the cache (they're
      // still recoverable from XMTP network history, just not kept locally).
      const preservable = preservableAll.slice(-MAX_PRESERVABLE);
      // Delete the cache file (if any) for images that just aged out —
      // otherwise the on-disk cache grows unbounded in parallel with the
      // exact problem this rework was meant to fix, just moved from
      // AsyncStorage to disk instead of eliminated.
      if (preservableAll.length > preservable.length) {
        const survivingIds = new Set(preservable.map((m) => m.id));
        for (const m of preservableAll) {
          if (!survivingIds.has(m.id) && m.content.startsWith("IMAGE:")) {
            deleteCachedImage(m.id);
          }
        }
      }
      const regular = trimmed.filter((m) => !isPreservable(m.content));
      const regularKeep = regular.slice(-Math.max(0, maxCached - preservable.length));
      trimmed = [...preservable, ...regularKeep].sort(
        (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
      );
    }
    debouncedSetItem(
      AK_PREFIX + channelKey,
      JSON.stringify(trimmed.map(serialize)),
      800,
    );
  } catch {
    // non-critical
  }
}

/**
 * Append a single message to the cache (used for streaming).
 */
export async function appendCachedMessage(
  channelKey: string,
  msg: ChatMessage,
): Promise<void> {
  await saveCachedMessages(channelKey, [msg]);
}

// ── Last-read tracking for accurate badge counts ─────────────────────────────

/**
 * Get the timestamp of the last time the user viewed a channel.
 */
export async function getLastReadTimestamp(channelKey: string): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(AK_LAST_READ + channelKey);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Mark a channel as read (current time). Writes synchronously to AsyncStorage —
 * not debounced — so the timestamp survives an immediate back-out or app kill.
 * If the write is debounced and the screen unmounts before it fires, the next
 * cold-launch unread-count loop reads the old timestamp and resurrects the badge.
 */
export async function markChannelRead(channelKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(AK_LAST_READ + channelKey, String(Date.now()));
  } catch { /* best-effort */ }
}

/**
 * Count messages newer than the last-read timestamp.
 */
export async function getUnreadCount(channelKey: string): Promise<number> {
  const lastRead = await getLastReadTimestamp(channelKey);
  const messages = await loadCachedMessages(channelKey);
  return messages.filter((m) => m.sentAt.getTime() > lastRead).length;
}
