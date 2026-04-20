/**
 * debouncedStorage.ts — Batched, debounced AsyncStorage writes.
 *
 * Problem: High-frequency setItem calls (on every message, every state change)
 * cause excessive I/O and GC pressure on the JS thread.
 *
 * Solution: Buffer writes per key and flush after a debounce window.
 * If multiple writes happen to the same key within the window, only the
 * last value is persisted. Callers get the same API as AsyncStorage.setItem.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const _pendingWrites = new Map<string, string>();
const _timers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Debounced setItem — coalesces rapid writes to the same key.
 * The value is written after `debounceMs` of silence on that key.
 * Returns immediately (fire-and-forget).
 */
export function debouncedSetItem(
  key: string,
  value: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): void {
  _pendingWrites.set(key, value);

  const existing = _timers.get(key);
  if (existing) clearTimeout(existing);

  _timers.set(
    key,
    setTimeout(() => {
      _timers.delete(key);
      const val = _pendingWrites.get(key);
      _pendingWrites.delete(key);
      if (val !== undefined) {
        AsyncStorage.setItem(key, val).catch(() => {});
      }
    }, debounceMs),
  );
}

/**
 * Flush all pending writes immediately.
 * Call this on app backgrounding (AppState → background) to prevent data loss.
 */
export async function flushPendingWrites(): Promise<void> {
  // Clear all pending timers
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();

  // Write all pending values
  const entries = Array.from(_pendingWrites.entries());
  _pendingWrites.clear();

  if (entries.length === 0) return;

  try {
    await AsyncStorage.multiSet(entries);
  } catch {
    // Fall back to individual writes
    for (const [k, v] of entries) {
      await AsyncStorage.setItem(k, v).catch(() => {});
    }
  }
}
