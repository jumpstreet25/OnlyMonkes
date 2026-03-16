/**
 * Pinned Messages
 *
 * Message format: PIN:<messageId>:<action>
 *   action = "pin" | "unpin"
 *   Only admins can pin/unpin.
 *
 * Pinned state is persisted to AsyncStorage so it survives restarts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from '../types';

const AK_PINNED = 'om_pinned_messages';

export interface PinnedMessage {
  messageId: string;
  content: string;
  senderUsername?: string;
  pinnedBy: string;       // inboxId of admin who pinned
  pinnedAt: Date;
}

let _pinnedCache: PinnedMessage[] = [];

/** Parse a PIN: system message */
export function parsePinMessage(raw: string): { messageId: string; action: 'pin' | 'unpin' } | null {
  if (!raw.startsWith('PIN:')) return null;
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  const action = parts[2] as 'pin' | 'unpin';
  if (action !== 'pin' && action !== 'unpin') return null;
  return { messageId: parts[1], action };
}

/** Build a PIN: message string */
export function buildPinMessage(messageId: string, action: 'pin' | 'unpin'): string {
  return `PIN:${messageId}:${action}`;
}

/** Pin a message (add to cache + persist) */
export async function pinMessage(
  msg: ChatMessage,
  pinnedBy: string,
): Promise<void> {
  // Don't duplicate
  if (_pinnedCache.some(p => p.messageId === msg.id)) return;
  const pinned: PinnedMessage = {
    messageId: msg.id,
    content: msg.editedContent ?? msg.content,
    senderUsername: msg.senderUsername,
    pinnedBy,
    pinnedAt: new Date(),
  };
  _pinnedCache.push(pinned);
  await _persist();
}

/** Unpin a message */
export async function unpinMessage(messageId: string): Promise<void> {
  _pinnedCache = _pinnedCache.filter(p => p.messageId !== messageId);
  await _persist();
}

/** Get all pinned messages */
export function getPinnedMessages(): PinnedMessage[] {
  return _pinnedCache;
}

/** Load pinned messages from disk (call once at startup) */
export async function loadPinnedMessages(): Promise<PinnedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(AK_PINNED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        _pinnedCache = parsed.map((p: any) => ({
          ...p,
          pinnedAt: new Date(p.pinnedAt),
        }));
      }
    }
  } catch { /* non-critical */ }
  return _pinnedCache;
}

async function _persist(): Promise<void> {
  await AsyncStorage.setItem(AK_PINNED, JSON.stringify(_pinnedCache)).catch(() => {});
}
