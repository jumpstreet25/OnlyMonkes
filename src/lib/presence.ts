/**
 * Presence / Online Indicators
 *
 * Message format: PRESENCE:<inboxId>:<timestamp>
 * Sent as a heartbeat every 3 min while app is foregrounded.
 * (Was 60s — each send is an MLS commit; N users × 60s flooded Main Chat
 * history and Tokio on the bot.)
 *
 * "Online" = last heartbeat < 7 minutes ago (2 beats + 1 min slack).
 * "Last seen Xm ago" = last heartbeat > 7 min but tracked.
 */
import { AppState as RNAppState } from 'react-native';

export interface PresenceEntry {
  inboxId: string;
  lastSeen: number; // unix ms
}

const HEARTBEAT_INTERVAL = 3 * 60_000; // 3 min
const ONLINE_THRESHOLD = 7 * 60_000;   // 7 min — two missed beats + slack

/** In-memory presence map: inboxId → lastSeen timestamp */
const _presenceMap = new Map<string, number>();

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _sendFn: (() => void) | null = null;

/** Parse a PRESENCE: message */
export function parsePresenceMessage(raw: string): { inboxId: string; timestamp: number } | null {
  if (!raw.startsWith('PRESENCE:')) return null;
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  return { inboxId: parts[1], timestamp: parseInt(parts[2], 10) };
}

/** Build a PRESENCE: message string */
export function buildPresenceMessage(inboxId: string): string {
  return `PRESENCE:${inboxId}:${Date.now()}`;
}

/** Update presence for a user (called when we receive their heartbeat) */
export function updatePresence(inboxId: string, timestamp?: number): void {
  _presenceMap.set(inboxId, timestamp ?? Date.now());
}

/** Check if a user is currently online */
export function isUserOnline(inboxId: string): boolean {
  const last = _presenceMap.get(inboxId);
  if (!last) return false;
  return Date.now() - last < ONLINE_THRESHOLD;
}

/** Get raw lastSeen timestamp for a user (0 if never seen) */
export function getLastSeenTimestamp(inboxId: string): number {
  return _presenceMap.get(inboxId) ?? 0;
}

/** Get "last seen" text for a user */
export function getLastSeenText(inboxId: string): string | null {
  const last = _presenceMap.get(inboxId);
  if (!last) return null;
  const diff = Date.now() - last;
  if (diff < ONLINE_THRESHOLD) return 'Online';
  if (diff < 60_000 * 60) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 60_000 * 60 * 24) return `${Math.floor(diff / (60_000 * 60))}h ago`;
  return null; // too old to show
}

/** Start sending heartbeats (call once after XMTP init) */
export function startHeartbeat(sendPresence: () => void): void {
  stopHeartbeat();
  _sendFn = sendPresence;

  // Send immediately
  sendPresence();

  // Then every 3 min while app is active
  _heartbeatTimer = setInterval(() => {
    if (RNAppState.currentState === 'active') {
      sendPresence();
    }
  }, HEARTBEAT_INTERVAL);
}

/** Stop heartbeats (call on disconnect/logout) */
export function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  _sendFn = null;
}
