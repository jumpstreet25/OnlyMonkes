/**
 * storageRescue.ts — Self-healing AsyncStorage wrapper.
 *
 * Android's AsyncStorage uses SQLite under the hood with a default 6MB DB
 * cap. The profile cache (avatars-as-base64-data-URIs ≈ 50KB each), message
 * cache, and assorted other stores can push past that and start failing
 * with SQLITE_FULL (code 13). Native APK can raise the cap via
 * `AsyncStorage_db_size_in_MB=20` in gradle.properties (queued separately),
 * but until users on the current build install a new APK we need an
 * OTA-safe escape hatch.
 *
 * `safeStorageSet` catches SQLITE_FULL, runs an emergency cleanup (strips
 * base64 avatar URIs from the profile cache + truncates to 50 most-recent),
 * then retries the original write. Successful retry → user never sees the
 * error. Hard failure → re-throw so callers can surface a clear message.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_CACHE_KEY = "profile_cache_v2";
// Aggressive truncation target during emergency cleanup. Going-forward growth
// is capped at MAX_PROFILE_CACHE in userProfile.ts; this is just the floor.
const EMERGENCY_KEEP = 50;

function isSqliteFullError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("sqlite_full") ||
    msg.includes("database or disk is full") ||
    msg.includes("code 13")
  );
}

/** Shrinks the profile cache by stripping base64 nftImage data URIs and
 * keeping only the EMERGENCY_KEEP most-recent entries. Returns approximate
 * bytes freed (positive number). HTTP/IPFS image URLs are preserved since
 * they're tiny. */
async function shrinkProfileCache(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return 0;
    const before = raw.length;
    const obj = JSON.parse(raw) as Record<string, any>;

    const entries = Object.entries(obj).map(([k, v]) => {
      const profile = { ...v };
      // Strip base64 data URIs (the heavy ones — typically 30-80KB each).
      // Keep http(s) URLs so users can re-fetch lightly.
      if (
        typeof profile.nftImage === "string" &&
        profile.nftImage.startsWith("data:")
      ) {
        delete profile.nftImage;
      }
      const recency =
        (profile.accessedAt ?? profile.cachedAt ?? 0) as number;
      return { k, profile, recency };
    });

    entries.sort((a, b) => b.recency - a.recency);
    const kept = entries.slice(0, EMERGENCY_KEEP);

    const compact: Record<string, any> = {};
    for (const e of kept) compact[e.k] = e.profile;
    const after = JSON.stringify(compact);

    await AsyncStorage.setItem(PROFILE_CACHE_KEY, after);
    return Math.max(0, before - after.length);
  } catch {
    return 0;
  }
}

export async function safeStorageSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (err) {
    if (!isSqliteFullError(err)) throw err;
    if (__DEV__) {
      console.warn(`[storageRescue] SQLITE_FULL on key=${key}; running emergency cleanup`);
    }
    const freed = await shrinkProfileCache();
    if (__DEV__) console.warn(`[storageRescue] Freed ~${freed} bytes; retrying write`);
    // Retry once. If still full, the write fails and the caller's catch
    // surfaces the original error context — better UX than infinite loops.
    await AsyncStorage.setItem(key, value);
  }
}

/** Public — callable from a startup hook to proactively free space if the
 * cache is bloated, before any write blows up. Cheap to call; no-ops if the
 * cache is small. */
export async function maybeProactiveShrink(thresholdBytes = 4 * 1024 * 1024): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (raw && raw.length > thresholdBytes) {
      if (__DEV__) console.warn(`[storageRescue] Profile cache ${raw.length}B > ${thresholdBytes}B threshold — proactive shrink`);
      await shrinkProfileCache();
    }
  } catch {
    /* ignore */
  }
}
