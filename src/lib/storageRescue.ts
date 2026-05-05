/**
 * storageRescue.ts — Self-healing AsyncStorage wrapper.
 *
 * Android's AsyncStorage uses SQLite under the hood with a default 6MB DB
 * cap. The profile cache (avatars-as-base64-data-URIs ≈ 50KB each), per-
 * channel message caches (150-200 messages each), and assorted other stores
 * can push past that and start failing with SQLITE_FULL (code 13). Native
 * APK can raise the cap via `AsyncStorage_db_size_in_MB=20` in
 * gradle.properties (queued separately), but until users on the current
 * build install a new APK we need an OTA-safe escape hatch.
 *
 * `safeStorageSet` catches SQLITE_FULL and runs progressively more
 * aggressive cleanup, retrying after each level:
 *   L1: strip base64 avatar data URIs from profile_cache_v2, keep top 30
 *   L2: trim every msg_cache_v1_* channel to 30 messages
 *   L3: nuke profile_cache_v2 + every msg_cache_v1_* entirely (caches
 *       repopulate on next chat scroll / profile broadcast)
 * If all three fail, re-throw so the caller can surface a clear UI message.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_CACHE_KEY = "profile_cache_v2";
const MSG_CACHE_PREFIX = "msg_cache_v1_";
const L1_PROFILE_KEEP = 30;
const L2_MSG_KEEP = 30;

function isSqliteFullError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("sqlite_full") ||
    msg.includes("database or disk is full") ||
    msg.includes("code 13")
  );
}

/** L1 — Strip base64 nftImage URIs from profile cache + keep top N most-
 * recent. HTTP/IPFS image URLs are preserved (tiny). */
async function l1ShrinkProfileCache(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return 0;
    const before = raw.length;
    const obj = JSON.parse(raw) as Record<string, any>;

    const entries = Object.entries(obj).map(([k, v]) => {
      const profile = { ...v };
      if (
        typeof profile.nftImage === "string" &&
        profile.nftImage.startsWith("data:")
      ) {
        delete profile.nftImage;
      }
      const recency = (profile.accessedAt ?? profile.cachedAt ?? 0) as number;
      return { k, profile, recency };
    });

    entries.sort((a, b) => b.recency - a.recency);
    const compact: Record<string, any> = {};
    for (const e of entries.slice(0, L1_PROFILE_KEEP)) compact[e.k] = e.profile;

    await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(compact));
    return Math.max(0, before - JSON.stringify(compact).length);
  } catch {
    return 0;
  }
}

/** L2 — Trim every per-channel message cache to N most-recent entries. */
async function l2TrimMessageCaches(): Promise<number> {
  let bytesFreed = 0;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const msgKeys = allKeys.filter((k) => k.startsWith(MSG_CACHE_PREFIX));
    if (msgKeys.length === 0) return 0;

    for (const key of msgKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const before = raw.length;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        const trimmed = arr.slice(-L2_MSG_KEEP);
        const next = JSON.stringify(trimmed);
        await AsyncStorage.setItem(key, next);
        bytesFreed += Math.max(0, before - next.length);
      } catch {
        /* per-key failure — continue */
      }
    }
  } catch {
    /* ignore */
  }
  return bytesFreed;
}

/** L3 — Nuke profile cache and every message cache entirely. Last resort. */
async function l3NukeCaches(): Promise<number> {
  let bytesFreed = 0;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const targets = [
      PROFILE_CACHE_KEY,
      ...allKeys.filter((k) => k.startsWith(MSG_CACHE_PREFIX)),
    ];
    // Sum bytes before deletion so we can log effectiveness.
    for (const key of targets) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) bytesFreed += raw.length;
      } catch {
        /* ignore */
      }
    }
    await AsyncStorage.multiRemove(targets);
  } catch {
    /* ignore */
  }
  return bytesFreed;
}

export async function safeStorageSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
    return;
  } catch (err) {
    if (!isSqliteFullError(err)) throw err;
  }

  // L1
  if (__DEV__) console.warn(`[storageRescue] L1 cleanup for key=${key}`);
  const l1 = await l1ShrinkProfileCache();
  try {
    await AsyncStorage.setItem(key, value);
    if (__DEV__) console.warn(`[storageRescue] L1 succeeded (~${l1}B freed)`);
    return;
  } catch (err) {
    if (!isSqliteFullError(err)) throw err;
  }

  // L2
  if (__DEV__) console.warn(`[storageRescue] L2 cleanup for key=${key}`);
  const l2 = await l2TrimMessageCaches();
  try {
    await AsyncStorage.setItem(key, value);
    if (__DEV__) console.warn(`[storageRescue] L2 succeeded (~${l2}B freed)`);
    return;
  } catch (err) {
    if (!isSqliteFullError(err)) throw err;
  }

  // L3 — nuclear
  if (__DEV__) console.warn(`[storageRescue] L3 nuke for key=${key}`);
  const l3 = await l3NukeCaches();
  // Final retry — if this fails, caller's catch surfaces it.
  await AsyncStorage.setItem(key, value);
  if (__DEV__) console.warn(`[storageRescue] L3 succeeded (~${l3}B freed)`);
}

/** Public — callable from a startup hook to proactively free space if any
 * single store is bloated. Cheap to call; no-ops when caches are small. */
export async function maybeProactiveShrink(thresholdBytes = 3 * 1024 * 1024): Promise<void> {
  try {
    // Profile cache is the most common bloat source.
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (raw && raw.length > thresholdBytes) {
      if (__DEV__) console.warn(`[storageRescue] Profile cache ${raw.length}B > ${thresholdBytes}B — proactive L1`);
      await l1ShrinkProfileCache();
    }
    // If aggregate message caches are huge, trim them too.
    const allKeys = await AsyncStorage.getAllKeys();
    const msgKeys = allKeys.filter((k) => k.startsWith(MSG_CACHE_PREFIX));
    let msgTotal = 0;
    for (const k of msgKeys) {
      try {
        const r = await AsyncStorage.getItem(k);
        if (r) msgTotal += r.length;
      } catch {
        /* ignore */
      }
      if (msgTotal > thresholdBytes) break;
    }
    if (msgTotal > thresholdBytes) {
      if (__DEV__) console.warn(`[storageRescue] Message caches aggregate ${msgTotal}B > ${thresholdBytes}B — proactive L2`);
      await l2TrimMessageCaches();
    }
  } catch {
    /* ignore */
  }
}
