/**
 * backgroundSync.ts
 *
 * Network-aware sync manager using @react-native-community/netinfo.
 * Replaces the old no-op stub with:
 *  - NetInfo listener for online/offline transitions
 *  - Exponential backoff on consecutive sync failures
 *  - Immediate sync when returning online or foregrounding
 *  - Offline queue flush trigger
 */

import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";

let _isOnline = true;
let _syncFailCount = 0;
let _reconnectCooldown = 2000;
let _lastSyncAttempt = 0;
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _netInfoUnsub: (() => void) | null = null;
let _appStateSub: { remove: () => void } | null = null;
let _syncFn: (() => Promise<void>) | null = null;
let _reconnectFn: (() => Promise<void>) | null = null;
let _flushQueueFn: (() => Promise<void>) | null = null;

const HEARTBEAT_MS = 15_000;
const MAX_COOLDOWN = 60_000;
const RECONNECT_THRESHOLD = 3; // consecutive failures before full reconnect

export function isOnline(): boolean {
  return _isOnline;
}

export function setOfflineQueueFlusher(fn: () => Promise<void>): void {
  _flushQueueFn = fn;
}

export function registerNetworkSync(
  syncFn: () => Promise<void>,
  reconnectFn: () => Promise<void>,
): void {
  // Clean up any previous registration
  unregisterNetworkSync();

  _syncFn = syncFn;
  _reconnectFn = reconnectFn;
  _syncFailCount = 0;
  _reconnectCooldown = 2000;

  // ── NetInfo listener ──────────────────────────────────────────────────────
  let wasOnline = _isOnline;
  _netInfoUnsub = NetInfo.addEventListener((state: NetInfoState) => {
    const nowOnline = !!(state.isConnected && state.isInternetReachable !== false);
    _isOnline = nowOnline;

    // Transition: offline → online
    if (!wasOnline && nowOnline) {
      console.log("[NetworkSync] Back online — syncing immediately");
      _syncFailCount = 0;
      _reconnectCooldown = 2000;
      _syncFn?.().catch(() => {});
      _flushQueueFn?.().catch(() => {});
    }
    wasOnline = nowOnline;
  });

  // ── AppState listener (foreground return) ─────────────────────────────────
  let lastAppState: AppStateStatus = AppState.currentState;
  _appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (lastAppState !== "active" && next === "active" && _isOnline) {
      _syncFn?.().catch(() => {});
      _flushQueueFn?.().catch(() => {});
    }
    lastAppState = next;
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  _heartbeatInterval = setInterval(async () => {
    if (!_isOnline || !_syncFn) return;

    const now = Date.now();
    if (now - _lastSyncAttempt < _reconnectCooldown) return; // cooldown active
    _lastSyncAttempt = now;

    try {
      if (_syncFailCount >= RECONNECT_THRESHOLD && _reconnectFn) {
        await _reconnectFn();
        _syncFailCount = 0;
        _reconnectCooldown = 2000;
      } else {
        await _syncFn();
        _syncFailCount = 0;
        _reconnectCooldown = 2000;
      }
    } catch {
      _syncFailCount++;
      _reconnectCooldown = Math.min(MAX_COOLDOWN, 2000 * Math.pow(2, _syncFailCount));
      console.log(`[NetworkSync] Sync failed (${_syncFailCount}x), cooldown ${_reconnectCooldown}ms`);
    }
  }, HEARTBEAT_MS);
}

export function unregisterNetworkSync(): void {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  if (_netInfoUnsub) { _netInfoUnsub(); _netInfoUnsub = null; }
  if (_appStateSub) { _appStateSub.remove(); _appStateSub = null; }
  _syncFn = null;
  _reconnectFn = null;
}

