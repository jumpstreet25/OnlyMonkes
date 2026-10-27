/**
 * Push + background sync on the self-hosted XMTP backend (3.1, SDK 8).
 *
 * The backend's [push.fcm] channel sends data-only hints — `{ topic, sequence_id }`, never
 * content. A hint (or the periodic background task) wakes this module, which reuses the open
 * client or reopens the stored installation, runs a bounded catch-up, decrypts locally and
 * shows the notification itself.
 *
 * Scope: DMs from people. Groups and the bot's own DMs already push through the bot's relay
 * (fcmRelay.ts), and Main Chat's PRESENCE heartbeats every 3 min would wake every phone, so
 * group pushes are switched off per conversation and bot senders are skipped here. While the
 * app is in the foreground the live stream notifies (useXmtp), so this stays silent.
 *
 * Tasks are defined at module load (imported from app/_layout.tsx) so a headless runtime has
 * them before anything mounts.
 */

import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { currentClient, type Client } from "@/lib/xmtpSdk";
import { decodeMessage, openStoredXmtpClient } from "@/lib/xmtp";
import { lastXmtpWallet } from "@/lib/xmtpCredential";
import { BOT_INBOX_IDS } from "@/lib/constants";
import { CH_ALL, notificationPreviewText, showLocalNotification } from "@/lib/notifications";
import { isXmtpHint } from "@/lib/xmtpPushHint";

export const XMTP_PUSH_TASK = "om-xmtp-push";
export const XMTP_SYNC_TASK = "om-xmtp-sync";

const SK_SEEN = "om_xmtp_push_seen_v1";
const CATCH_UP_MS = 5_000;
const MAX_DMS = 50;
const MAX_ALERTS = 5;
const SYNC_EVERY_MIN = 15;

type Seen = { afterNs: number; ids: string[] };

async function loadSeen(): Promise<Seen> {
  try {
    const raw = await AsyncStorage.getItem(SK_SEEN);
    if (raw) return JSON.parse(raw) as Seen;
  } catch { /* first run */ }
  // First run: only messages from now on, not the whole DM history.
  return { afterNs: Date.now() * 1_000_000, ids: [] };
}

async function saveSeen(s: Seen): Promise<void> {
  try { await AsyncStorage.setItem(SK_SEEN, JSON.stringify({ afterNs: s.afterNs, ids: s.ids.slice(-200) })); } catch { /* next run re-checks */ }
}

// ─── Registration (foreground, after the client is up) ───────────────────────

let _tokenSub: { remove(): void } | null = null;

export async function registerXmtpPush(client: Client): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== "string" || !token) return;
    const state = await client.enableNotifications(token);
    if (state.kind === "failed" && __DEV__) console.warn("[xmtpPush] backend refused push:", state.error);
    const groups = await client.conversations.listGroups(undefined, undefined, ["allowed", "unknown"]);
    await Promise.all(groups.map((g) => g.setNotifications("disabled").catch(() => {})));
    if (!_tokenSub) {
      _tokenSub = Notifications.addPushTokenListener(({ data }) => {
        if (typeof data === "string") currentClient()?.enableNotifications(data).catch(() => {});
      });
    }
  } catch (e) {
    if (__DEV__) console.warn("[xmtpPush] register failed:", (e as Error)?.message);
  }
}

export async function registerXmtpBackgroundTasks(): Promise<void> {
  try { await Notifications.registerTaskAsync(XMTP_PUSH_TASK); } catch { /* already registered */ }
  try {
    if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available
      && !(await TaskManager.isTaskRegisteredAsync(XMTP_SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(XMTP_SYNC_TASK, { minimumInterval: SYNC_EVERY_MIN });
    }
  } catch { /* background work restricted — push hints still work */ }
}

// ─── Catch-up + notify (push hint, periodic task) ────────────────────────────

let _running: Promise<void> | null = null;

export function catchUpAndNotify(): Promise<void> {
  if (!_running) _running = runCatchUp().finally(() => { _running = null; });
  return _running;
}

async function runCatchUp(): Promise<void> {
  const client = currentClient() ?? await openStoredXmtpClient(await lastXmtpWallet()).catch(() => null);
  if (!client) return;
  await client.catchUpToLive(CATCH_UP_MS).catch(() => undefined);
  if (AppState.currentState === "active") return;

  const seen = await loadSeen();
  const known = new Set(seen.ids);
  let newest = seen.afterNs;
  let shown = 0;
  const dms = await client.conversations.listDms(undefined, MAX_DMS, ["allowed", "unknown"]).catch(() => []);
  for (const dm of dms) {
    const last = await dm.lastMessage().catch(() => undefined);
    if (!last || last.sentNs <= seen.afterNs) continue;
    const recent = (await dm.messages({ limit: 5 }).catch(() => [])).reverse();
    for (const raw of recent) {
      if (raw.sentNs <= seen.afterNs || known.has(raw.id)) continue;
      known.add(raw.id);
      newest = Math.max(newest, raw.sentNs);
      if (raw.senderInboxId === client.inboxId || BOT_INBOX_IDS.includes(raw.senderInboxId)) continue;
      const msg = decodeMessage(raw, client.inboxId);
      if (!msg || shown >= MAX_ALERTS) continue;
      await showLocalNotification(`💬 ${msg.senderUsername ?? "New message"}`, notificationPreviewText(msg.content), CH_ALL);
      shown++;
    }
  }
  await saveSeen({ afterNs: newest, ids: [...known] });
}

// ─── Task definitions (module scope) ─────────────────────────────────────────

TaskManager.defineTask(XMTP_PUSH_TASK, async ({ data, error }) => {
  if (error || !isXmtpHint(data)) return;
  await catchUpAndNotify().catch(() => {});
});

TaskManager.defineTask(XMTP_SYNC_TASK, async () => {
  try {
    await catchUpAndNotify();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
