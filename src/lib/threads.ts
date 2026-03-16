/**
 * Chat Threads
 *
 * Message format: THREAD:<parentMessageId>:<username>:<content>
 * Thread messages are stored alongside main messages but filtered
 * by parentId for thread views.
 *
 * Threads are tracked in-memory and persisted to AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from '../types';

const AK_THREADS = 'om_thread_metadata';

export interface ThreadMeta {
  parentMessageId: string;
  parentContent: string;
  parentSender?: string;
  replyCount: number;
  lastReplyAt: Date;
  participants: string[]; // unique inboxIds
}

/** In-memory thread metadata */
const _threadMap = new Map<string, ThreadMeta>();

/** Parse a THREAD: message */
export function parseThreadMessage(
  raw: string,
): { parentMessageId: string; username: string; content: string } | null {
  if (!raw.startsWith('THREAD:')) return null;
  const idx1 = raw.indexOf(':', 7); // after "THREAD:"
  if (idx1 === -1) return null;
  const idx2 = raw.indexOf(':', idx1 + 1);
  if (idx2 === -1) return null;
  return {
    parentMessageId: raw.slice(7, idx1),
    username: raw.slice(idx1 + 1, idx2),
    content: raw.slice(idx2 + 1),
  };
}

/** Build a THREAD: message string */
export function buildThreadMessage(
  parentMessageId: string,
  username: string,
  content: string,
): string {
  return `THREAD:${parentMessageId}:${username}:${content}`;
}

/** Record a thread reply in metadata */
export function trackThreadReply(
  parentMessageId: string,
  senderInboxId: string,
  parentContent?: string,
  parentSender?: string,
): void {
  const existing = _threadMap.get(parentMessageId);
  if (existing) {
    existing.replyCount += 1;
    existing.lastReplyAt = new Date();
    if (!existing.participants.includes(senderInboxId)) {
      existing.participants.push(senderInboxId);
    }
  } else {
    _threadMap.set(parentMessageId, {
      parentMessageId,
      parentContent: parentContent ?? '',
      parentSender,
      replyCount: 1,
      lastReplyAt: new Date(),
      participants: [senderInboxId],
    });
  }
  _persist();
}

/** Get thread metadata for a message (null if no thread) */
export function getThreadMeta(parentMessageId: string): ThreadMeta | null {
  return _threadMap.get(parentMessageId) ?? null;
}

/** Get all active threads sorted by last reply */
export function getAllThreads(): ThreadMeta[] {
  return Array.from(_threadMap.values()).sort(
    (a, b) => b.lastReplyAt.getTime() - a.lastReplyAt.getTime(),
  );
}

/** Check if a message has a thread */
export function hasThread(messageId: string): boolean {
  return _threadMap.has(messageId);
}

/** Load thread metadata from disk */
export async function loadThreadMetadata(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_THREADS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          _threadMap.set(t.parentMessageId, {
            ...t,
            lastReplyAt: new Date(t.lastReplyAt),
          });
        }
      }
    }
  } catch { /* non-critical */ }
}

function _persist(): void {
  const arr = Array.from(_threadMap.values());
  AsyncStorage.setItem(AK_THREADS, JSON.stringify(arr)).catch(() => {});
}
