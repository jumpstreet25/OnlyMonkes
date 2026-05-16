/**
 * healthBeacon.ts
 *
 * Periodic stream-health beacon DM'd to the bot so Hermes can monitor
 * chat-stream reliability across the install base. Emits a structured
 * `HEALTH:<json>` DM every ~10 minutes (only when the app is active),
 * carrying the counters from `useXmtp._streamHealth` plus light context.
 *
 * The bot is the only party that should ever read these — they're filtered
 * out of the chat decode path in `decodeMessage` (STRUCTURED_PREFIXES).
 *
 * The payload is intentionally minimal: no message content, no wallet
 * addresses, no inbox IDs. Just counters + version + ms ages.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { _streamHealth, _getLastStreamEvent, _getStreamAliveFlag } from '@/hooks/useXmtp';
import { openOrCreateDm } from '@/lib/xmtp';

const AK_LAST_BEACON = 'health_beacon_last_v1';
const BEACON_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface BeaconPayload {
  v: 1;                       // schema version
  ts: number;                 // unix ms
  ver: string;                // app version (2.37.0)
  rt: string;                 // runtime version (3.2)
  plat: 'android' | 'ios' | string;
  uptime_ms: number;          // ms since session start
  last_event_ms: number;      // ms since last stream event (-1 if never)
  stream_alive: 0 | 1;        // SDK-level alive flag (still useful even when unreliable)
  stale_reconnects: number;   // # of 90s-watchdog reconnects
  fg_reconnects: number;      // # of foreground reconnects (AppState + heartbeat)
  last_stale_ago_ms: number;  // ms since last stale trigger (-1 if never)
  msg_count: number;          // # messages currently in store
}

let _beaconTimer: ReturnType<typeof setInterval> | null = null;
let _emitInFlight = false;

async function emitOnce(
  getClient: () => any | null,
  botInboxId: string,
  msgCount: number,
): Promise<void> {
  if (_emitInFlight) return;
  _emitInFlight = true;
  try {
    const client = getClient();
    if (!client || !botInboxId) return;
    const now = Date.now();
    const lastEvent = _getLastStreamEvent();
    const lastStaleAt = _streamHealth.lastStaleAt;
    const payload: BeaconPayload = {
      v: 1,
      ts: now,
      ver: (Constants.expoConfig?.version as string) ?? 'unknown',
      rt: (Constants.expoConfig?.runtimeVersion as string) ?? 'unknown',
      plat: Platform.OS,
      uptime_ms: now - _streamHealth.sessionStartedAt,
      last_event_ms: lastEvent > 0 ? now - lastEvent : -1,
      stream_alive: _getStreamAliveFlag() ? 1 : 0,
      stale_reconnects: _streamHealth.staleReconnects,
      fg_reconnects: _streamHealth.foregroundReconnects,
      last_stale_ago_ms: lastStaleAt > 0 ? now - lastStaleAt : -1,
      msg_count: msgCount,
    };
    const dm = await openOrCreateDm(client, botInboxId);
    await (dm as any).send(`HEALTH:${JSON.stringify(payload)}`);
    await AsyncStorage.setItem(AK_LAST_BEACON, String(now));
    if (__DEV__) console.log('[HealthBeacon] sent', payload);
  } catch (err) {
    if (__DEV__) console.warn('[HealthBeacon] emit failed:', err);
  } finally {
    _emitInFlight = false;
  }
}

/**
 * Start the periodic beacon. Safe to call multiple times — subsequent calls
 * are no-ops while a timer is already armed. Caller passes a getter for the
 * XMTP client (so we don't capture a stale reference across reconnects),
 * the bot inbox ID, and a getter for the current message count.
 */
export function startHealthBeacon(opts: {
  getClient: () => any | null;
  botInboxId: string;
  getMessageCount: () => number;
}) {
  if (_beaconTimer) return;
  const { getClient, botInboxId, getMessageCount } = opts;
  // First emission: 60s after start (lets initial reconnect storms settle).
  setTimeout(() => emitOnce(getClient, botInboxId, getMessageCount()), 60_000);
  _beaconTimer = setInterval(
    () => emitOnce(getClient, botInboxId, getMessageCount()),
    BEACON_INTERVAL_MS,
  );
}

export function stopHealthBeacon() {
  if (_beaconTimer) {
    clearInterval(_beaconTimer);
    _beaconTimer = null;
  }
}
