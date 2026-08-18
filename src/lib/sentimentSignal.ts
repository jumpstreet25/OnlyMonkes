/**
 * sentimentSignal.ts — Data Oracle Phase 1's entire collection surface.
 *
 * What's collected, in full: which token symbol was viewed inside the app, and how long
 * (dwell time). Nothing else — no location, no contacts, no messages, no wallet address or
 * user id in the event payload itself. That link only exists transiently server-side via
 * the signed batch's device→wallet binding (see deviceRegistration.ts), and the worker
 * (sentimentOracle.ts) never persists raw event content past folding it into the epoch
 * aggregate.
 *
 * Collection only records while `sentimentOracleOptIn` is true (appStore) — see
 * useSentimentOptIn.ts for the opt-in/opt-out wiring, which also wipes this queue
 * immediately on opt-out.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppStore } from "@/store/appStore";

const AK_QUEUE = "sentiment_signal_queue_v1";
// Local queue cap — oldest events dropped first if collection outpaces upload (e.g. device
// offline for a long stretch). Bounded so a stuck queue can't grow unbounded on-device.
const MAX_QUEUE_LENGTH = 500;
// Matches the worker's own MAX_DWELL_MS sanity bound (sentimentOracle.ts).
const MAX_DWELL_MS = 10 * 60 * 1000;

export interface SentimentEvent {
  token: string;
  hourBucket: string; // "YYYY-MM-DDTHH" (UTC) — matches the worker's epoch bucketing
  dwellMs: number;
}

function hourBucketNow(): string {
  return new Date().toISOString().slice(0, 13);
}

// In-memory only — which tokens are currently being viewed and when that view started.
const _activeViews = new Map<string, number>();

/** Call when a token becomes visible (e.g. ChartModal opens for a $TOKEN mention). */
export function recordTokenView(token: string): void {
  if (!useAppStore.getState().sentimentOracleOptIn) return;
  _activeViews.set(token, Date.now());
}

/**
 * Call when the token stops being visible (e.g. ChartModal closes). Computes dwell time
 * from the matching recordTokenView() call and appends one event to the local queue.
 * No-ops if recordTokenView was never called for this token, or if opted out in the
 * meantime (matches recordTokenView's own gate).
 */
export async function recordEngagementEnd(token: string): Promise<void> {
  const start = _activeViews.get(token);
  _activeViews.delete(token);
  if (!start) return;
  if (!useAppStore.getState().sentimentOracleOptIn) return;

  const dwellMs = Math.min(Date.now() - start, MAX_DWELL_MS);
  if (dwellMs < 250) return; // filters out accidental taps, not a meaningful "view"

  const event: SentimentEvent = { token, hourBucket: hourBucketNow(), dwellMs };
  try {
    const raw = await AsyncStorage.getItem(AK_QUEUE);
    const queue: SentimentEvent[] = raw ? JSON.parse(raw) : [];
    queue.push(event);
    while (queue.length > MAX_QUEUE_LENGTH) queue.shift();
    await AsyncStorage.setItem(AK_QUEUE, JSON.stringify(queue));
  } catch {
    // best-effort — dropping one local event silently isn't worth surfacing an error for
  }
}

/** Read the queue without clearing it — used by sentimentUploadTask.ts. */
export async function peekQueue(): Promise<SentimentEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(AK_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Removes the first `count` events (already successfully uploaded), keeping the rest
 *  queued for the next periodic run. Only called after a confirmed-successful POST — see
 *  sentimentUploadTask.ts — so a failed upload never loses data. */
export async function removeSentEvents(count: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_QUEUE);
    const queue: SentimentEvent[] = raw ? JSON.parse(raw) : [];
    const remaining = queue.slice(count);
    if (remaining.length === 0) {
      await AsyncStorage.removeItem(AK_QUEUE);
    } else {
      await AsyncStorage.setItem(AK_QUEUE, JSON.stringify(remaining));
    }
  } catch {
    // non-critical — worst case a few already-uploaded events get resent and are folded
    // into the aggregate a second time; the epoch rate-limit (one batch/device/epoch on
    // the worker) bounds how much that can skew a single epoch.
  }
}

/** Immediate wipe on opt-out — see useSentimentOptIn.ts. */
export async function clearAllLocalSignalState(): Promise<void> {
  _activeViews.clear();
  try {
    await AsyncStorage.removeItem(AK_QUEUE);
  } catch {
    /* non-critical */
  }
}
