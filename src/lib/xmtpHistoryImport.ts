/**
 * One-time import of the old network's chat history into the SDK 8 database (3.1 cutover).
 *
 * 3.0 kept a v5 database in <files>/xmtp_db/ (RN SDK 5 default: xmtp-<env host>-<inboxId>.db3)
 * encrypted with the key in SecureStore `xmtp_v5_enc_key_<wallet[0..16]>` (legacy
 * `xmtp_v5_enc_key`). 3.1 uses the xmtp_v8_ names, so an in-place update from the store keeps
 * both. SDK 8 can't open that file; `prepareMigrationArchive` converts a copy of it offline
 * into an encrypted archive and `client.archives.importFromFile` loads it. Imported
 * conversations are read-only ("inactive") — `Conversations.listDms/listGroups` hide them and
 * `listImported()` returns them for the "before the move" history views.
 *
 * Runs once per wallet in the background after the client opens; never blocks chat. The old
 * database is left in place (a later release can delete it). Nothing is sent anywhere — the
 * archive key is random, lives only in memory, and the archive file is deleted afterwards.
 */
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as Sentry from "@sentry/react-native";
import { AppState } from "react-native";
import { prepareOldHistoryArchive, type OmClient } from "@/lib/xmtpSdk";

const V5_KEY_PREFIX = "xmtp_v5_enc_key_";
const V5_KEY_LEGACY = "xmtp_v5_enc_key";
const DONE_PREFIX = "xmtp_v8_history_import_";
const MAX_ATTEMPTS = 3;

export type HistoryImportResult =
  | { status: "imported"; groups: number; messages: number }
  | { status: "skipped"; reason: "done" | "no-old-key" | "no-old-database" | "gave-up" }
  | { status: "failed"; error: string };

let _running: Promise<HistoryImportResult> | null = null;

const plain = (uri: string) => uri.replace(/^file:\/\//, "");

async function oldDatabaseFor(inboxId: string): Promise<string | null> {
  const dir = `${FileSystem.documentDirectory}xmtp_db/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return null;
  const names = await FileSystem.readDirectoryAsync(dir);
  const db = names.find((n) => n.endsWith(".db3") && n.includes(inboxId));
  return db ? plain(dir + db) : null;
}

async function oldKey(wallet: string): Promise<Uint8Array | null> {
  const b64 = (await SecureStore.getItemAsync(V5_KEY_PREFIX + wallet.slice(0, 16)))
    ?? (await SecureStore.getItemAsync(V5_KEY_LEGACY));
  return b64 ? Uint8Array.from(Buffer.from(b64, "base64")) : null;
}

async function run(client: OmClient, wallet: string): Promise<HistoryImportResult> {
  const doneKey = DONE_PREFIX + wallet.slice(0, 16);
  const state = await SecureStore.getItemAsync(doneKey);
  if (state === "done" || state === "none") return { status: "skipped", reason: "done" };
  const attempts = state?.startsWith("failed:") ? Number(state.slice(7)) || 0 : 0;
  if (attempts >= MAX_ATTEMPTS) return { status: "skipped", reason: "gave-up" };

  const key = await oldKey(wallet);
  if (!key) { await SecureStore.setItemAsync(doneKey, "none"); return { status: "skipped", reason: "no-old-key" }; }
  const databasePath = await oldDatabaseFor(client.inboxId);
  if (!databasePath) { await SecureStore.setItemAsync(doneKey, "none"); return { status: "skipped", reason: "no-old-database" }; }

  const outputPath = plain(`${FileSystem.cacheDirectory}xmtp-history-${Date.now()}.archive`);
  const archiveKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    const report = await prepareOldHistoryArchive(client, { databasePath, databaseKey: key, archiveKey, outputPath });
    await SecureStore.setItemAsync(doneKey, "done");
    const result = { status: "imported" as const, groups: Number(report.groupCount), messages: Number(report.messageCount) };
    Sentry.addBreadcrumb({ category: "xmtp", message: "history import", data: { groups: result.groups, messages: result.messages } });
    return result;
  } catch (e) {
    await SecureStore.setItemAsync(doneKey, `failed:${attempts + 1}`);
    const error = String((e as Error)?.message ?? e).slice(0, 200);
    Sentry.captureMessage(`XMTP history import failed (attempt ${attempts + 1}): ${error}`, "warning");
    return { status: "failed", error };
  } finally {
    archiveKey.fill(0);
    await FileSystem.deleteAsync(`file://${outputPath}`, { idempotent: true }).catch(() => {});
  }
}

/** Starts (or joins) the one-time import for this wallet. Safe to call on every client open. */
export function importOldHistoryOnce(client: OmClient, wallet: string | null | undefined): Promise<HistoryImportResult> {
  if (!wallet) return Promise.resolve({ status: "skipped", reason: "no-old-key" });
  // Not from push / background-task runtimes (short-lived, and the app may own the database);
  // the next foreground open does it.
  if (AppState.currentState !== "active") return Promise.resolve({ status: "skipped", reason: "done" });
  _running ??= run(client, wallet).finally(() => { _running = null; });
  return _running;
}
