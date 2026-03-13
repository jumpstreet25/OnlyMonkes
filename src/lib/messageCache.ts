/**
 * messageCache.ts
 *
 * AsyncStorage-backed persistence for chat messages across app restarts.
 * - Bot channel messages persist so badges/counts are accurate
 * - Main chat messages persist for Shared Images/Links derivation
 * - Messages auto-expire after 7 days EXCEPT media (IMAGE/GIF/VIDEO) and URLs
 * - Media and link messages are kept indefinitely for Shared tabs
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "@/types";

const AK_PREFIX = "msg_cache_v1_";
const AK_LAST_READ = "msg_last_read_v1_";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHED_MESSAGES = 500;

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
  return { ...msg, sentAt: msg.sentAt.toISOString() };
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
    const kept = items.filter((s) => {
      const age = now - new Date(s.sentAt).getTime();
      // Keep if under 7 days OR if it's a preservable message (media/link)
      return age < SEVEN_DAYS_MS || isPreservable(s.content);
    });
    // Save back the pruned list
    if (kept.length !== items.length) {
      await AsyncStorage.setItem(AK_PREFIX + channelKey, JSON.stringify(kept));
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
    let trimmed = merged;
    if (trimmed.length > MAX_CACHED_MESSAGES) {
      const preservable = trimmed.filter((m) => isPreservable(m.content));
      const regular = trimmed.filter((m) => !isPreservable(m.content));
      const regularKeep = regular.slice(-(MAX_CACHED_MESSAGES - preservable.length));
      trimmed = [...preservable, ...regularKeep].sort(
        (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
      );
    }
    await AsyncStorage.setItem(
      AK_PREFIX + channelKey,
      JSON.stringify(trimmed.map(serialize)),
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
 * Mark a channel as read (current time).
 */
export async function markChannelRead(channelKey: string): Promise<void> {
  await AsyncStorage.setItem(AK_LAST_READ + channelKey, String(Date.now()));
}

/**
 * Count messages newer than the last-read timestamp.
 */
export async function getUnreadCount(channelKey: string): Promise<number> {
  const lastRead = await getLastReadTimestamp(channelKey);
  const messages = await loadCachedMessages(channelKey);
  return messages.filter((m) => m.sentAt.getTime() > lastRead).length;
}
