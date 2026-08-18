/**
 * sentimentUploadTask.ts — Headless JS Task "OnlyMonkesSentimentUpload".
 *
 * Triggered by SentimentSyncWorker (WorkManager, ~every 30 min while opted in) via
 * SentimentHeadlessTaskService — same pattern as headlessReaction.ts. Reads the locally-
 * queued engagement events (sentimentSignal.ts), signs one batch with the device's
 * Keystore key (deviceAttest.ts), and POSTs it to the worker. Runs with no UI — must not
 * depend on any React state, only AsyncStorage + native modules, same constraint
 * headlessReaction.ts already documents for its own headless task.
 */

import { AppRegistry } from "react-native";
import { Buffer } from "buffer";
import { peekQueue, removeSentEvents, type SentimentEvent } from "./sentimentSignal";
import { signWithDeviceKey, getDevicePublicKeyBase64 } from "./deviceAttest";
import { getActiveThreats } from "./security";

export const HEADLESS_SENTIMENT_UPLOAD_TASK_NAME = "OnlyMonkesSentimentUpload";

const WORKER_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";
// Matches sentimentOracle.ts's MAX_EVENTS_PER_BATCH.
const MAX_EVENTS_PER_BATCH = 200;

async function uploadOneBatch(events: SentimentEvent[]): Promise<boolean> {
  const devicePubKeyBase64 = await getDevicePublicKeyBase64();
  const payload = {
    events,
    clientTs: Date.now(),
    raspThreats: getActiveThreats(),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
  const signatureBase64 = await signWithDeviceKey(payloadBase64);

  const res = await fetch(`${WORKER_BASE}/api/sentiment/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devicePubKeyBase64, payloadBase64, signatureBase64 }),
  });
  return res.ok;
}

async function sentimentUploadTask(): Promise<void> {
  try {
    // Lazy import — a headless JS context can be created purely to run this task, and
    // pulling the whole store module in eagerly at the top of the file isn't needed for
    // anything else here.
    const { useAppStore } = await import("@/store/appStore");
    if (!useAppStore.getState().sentimentOracleOptIn) return; // opted out since this run was scheduled

    const queue = await peekQueue();
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_EVENTS_PER_BATCH);
    const ok = await uploadOneBatch(batch);
    if (!ok) {
      console.warn("[sentimentUpload] batch rejected — leaving queue intact for next run");
      return;
    }

    // Only remove what was actually sent — anything beyond MAX_EVENTS_PER_BATCH stays
    // queued for the next periodic run rather than being dropped.
    await removeSentEvents(batch.length);
  } catch (err) {
    console.warn("[sentimentUpload] failed:", (err as Error)?.message ?? err);
  }
}

AppRegistry.registerHeadlessTask(HEADLESS_SENTIMENT_UPLOAD_TASK_NAME, () => sentimentUploadTask);
