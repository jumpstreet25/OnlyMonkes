/**
 * Deleted Messages
 *
 * Message format: DELETE:<messageId>
 *   Broadcast so the removal propagates to every device, not just the
 *   deleter's own — and so a re-synced history (background reconnect,
 *   loadOlderMessages, cold start) doesn't resurrect the message.
 *
 * Authorization is NOT enforced by this module — it only tracks which IDs
 * are deleted. Callers (useXmtp stream handler) must verify the requester
 * is either the target message's original sender or the app's admin
 * inboxId before calling markMessageDeleted() for an incoming request.
 *
 * Deleted state is persisted to AsyncStorage so it survives restarts,
 * capped to bound storage growth.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_DELETED = 'om_deleted_messages';
const MAX_DELETED_IDS = 1000;

let _deletedIds: Set<string> = new Set();
let _loaded = false;

/** Parse a DELETE: system message. Returns the target messageId, or null. */
export function parseDeleteMessage(raw: string): string | null {
  if (!raw.startsWith('DELETE:')) return null;
  const messageId = raw.slice('DELETE:'.length);
  return messageId || null;
}

/** Build a DELETE: system message string. */
export function buildDeleteMessage(messageId: string): string {
  return `DELETE:${messageId}`;
}

/** Load deleted IDs from disk (call once at startup). */
export async function loadDeletedMessageIds(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(AK_DELETED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _deletedIds = new Set(parsed);
    }
  } catch { /* non-critical */ }
}

/** Mark a message deleted (add to cache + persist). Idempotent. */
export async function markMessageDeleted(messageId: string): Promise<void> {
  if (_deletedIds.has(messageId)) return;
  _deletedIds.add(messageId);
  // Keep bounded — drop oldest (insertion-order) entries past the cap.
  if (_deletedIds.size > MAX_DELETED_IDS) {
    const arr = [..._deletedIds];
    _deletedIds = new Set(arr.slice(arr.length - MAX_DELETED_IDS));
  }
  await AsyncStorage.setItem(AK_DELETED, JSON.stringify([..._deletedIds])).catch(() => {});
}

/** Check whether a message has been deleted. */
export function isMessageDeleted(messageId: string): boolean {
  return _deletedIds.has(messageId);
}

/** Filter a batch of decoded messages, dropping any already-deleted IDs. */
export function filterDeleted<T extends { id: string }>(messages: T[]): T[] {
  if (_deletedIds.size === 0) return messages;
  return messages.filter(m => !_deletedIds.has(m.id));
}
