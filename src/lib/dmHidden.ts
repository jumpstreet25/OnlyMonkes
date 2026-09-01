/**
 * dmHidden.ts — per-device "delete conversation" for 1:1 DM threads.
 *
 * XMTP DMs can't actually be deleted from the network (no server, no
 * central log to purge from) — this hides a thread from THIS device's
 * inbox list only, same pattern as any messaging app's local "delete
 * conversation." If the peer messages again after being hidden, the
 * thread automatically reappears (compares lastMessageAt against the
 * hidden timestamp) rather than staying gone forever.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_HIDDEN_DMS = "hidden_dm_threads_v1"; // Record<peerInboxId, hiddenAtMs>

async function loadHiddenMap(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(AK_HIDDEN_DMS);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function saveHiddenMap(map: Record<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(AK_HIDDEN_DMS, JSON.stringify(map));
  } catch { /* non-fatal — worst case the thread just doesn't stay hidden */ }
}

export async function getHiddenDmMap(): Promise<Record<string, number>> {
  return loadHiddenMap();
}

export async function hideDmThread(peerInboxId: string): Promise<void> {
  const map = await loadHiddenMap();
  map[peerInboxId] = Date.now();
  await saveHiddenMap(map);
}

export async function unhideDmThread(peerInboxId: string): Promise<void> {
  const map = await loadHiddenMap();
  if (peerInboxId in map) {
    delete map[peerInboxId];
    await saveHiddenMap(map);
  }
}

/** True if this thread should stay hidden — i.e. hidden, and no newer message has arrived since. */
export function isDmStillHidden(hiddenMap: Record<string, number>, peerInboxId: string, lastMessageAt: Date | null): boolean {
  const hiddenAt = hiddenMap[peerInboxId];
  if (hiddenAt === undefined) return false;
  if (!lastMessageAt) return true;
  return lastMessageAt.getTime() <= hiddenAt;
}
