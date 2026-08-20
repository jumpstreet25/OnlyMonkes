/**
 * Inboxes this device has itself created for a wallet.
 *
 * Safe to treat as "mine" without a bot round-trip: we persisted them after
 * Client.build/create/addAccount on this phone. Used when identity migrates
 * from a leftover createRandom() inbox onto the wallet-bound one so old
 * bubbles still render as own.
 *
 * Do NOT populate this from PROFILE_UPDATE `w` — that field is spoofable.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "xmtp_local_inboxes_";

const _remembered = new Set<string>();

function storageKey(walletAddress: string): string {
  return KEY_PREFIX + walletAddress.slice(0, 16);
}

export function getRememberedInboxIds(): ReadonlySet<string> {
  return _remembered;
}

export async function loadLocalInboxIds(walletAddress: string): Promise<string[]> {
  if (!walletAddress) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(walletAddress));
    if (!raw) return [..._remembered];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [..._remembered];
    for (const id of parsed) {
      if (typeof id === "string" && id) _remembered.add(id);
    }
  } catch { /* best-effort */ }
  return [..._remembered];
}

export async function rememberLocalInboxId(
  walletAddress: string,
  inboxId: string,
): Promise<void> {
  if (!walletAddress || !inboxId) return;
  _remembered.add(inboxId);
  try {
    const key = storageKey(walletAddress);
    let ids: string[] = [];
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) ids = parsed.filter((x: unknown) => typeof x === "string");
      }
    } catch { /* start fresh */ }
    if (!ids.includes(inboxId)) ids.push(inboxId);
    await AsyncStorage.setItem(key, JSON.stringify(ids));
  } catch { /* best-effort */ }
}
