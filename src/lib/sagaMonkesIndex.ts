/**
 * sagaMonkesIndex
 *
 * Static mint/assetId → {name, image} lookup for the entire Saga Monkes
 * collection (~10,014 assets, one fixed tree, no new mints — see
 * onchainCnftVerify.ts's tree-completeness note). Built offline by
 * scripts/build-saga-monkes-index.ts and hosted at
 * config/saga-monkes-index.json via raw.githubusercontent.com — same
 * zero-cost hosting pattern as remoteConfig.ts's app-config.json.
 *
 * Why this exists: the on-chain-only NFT-ownership fallback
 * (onchainCnftVerify.ts) can prove a wallet holds a compressed NFT with
 * zero dependency on Helius/QuickNode/Alchemy, but has no way to resolve
 * that NFT's image/name on its own. Cross-referencing its derived asset
 * IDs against this static index (see nftVerification.ts's on-chain branch)
 * lets a verified holder pick their real Monke as PFP even when every DAS
 * provider is down simultaneously — confirmed to happen for real on
 * 2026-08-13 (Helius account-wide maxed, QuickNode trial expired, Alchemy
 * erroring on every method).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const REPO = "jumpstreet25/OnlyMonkes";
const BRANCH = "master";
const FILE = "config/saga-monkes-index.json";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;

const AK_INDEX_CACHE = "saga_monkes_index_cache_v1";
const AK_INDEX_CACHE_TS = "saga_monkes_index_cache_ts_v1";
// Generous TTL — the collection is static, so "freshness" only matters for
// picking up assets that were minted/re-indexed after the last build run,
// not for correctness of existing entries. Avoids a ~2MB re-fetch on every
// cold launch.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SagaMonkeIndexEntry {
  name: string;
  image: string | null;
}

type IndexMap = Record<string, SagaMonkeIndexEntry>;

let _memCache: IndexMap | null = null;
let _memCacheAt = 0;

async function loadDiskCache(): Promise<{ index: IndexMap; ts: number } | null> {
  try {
    const [raw, tsRaw] = await Promise.all([
      AsyncStorage.getItem(AK_INDEX_CACHE),
      AsyncStorage.getItem(AK_INDEX_CACHE_TS),
    ]);
    if (!raw) return null;
    const index = JSON.parse(raw);
    if (!index || typeof index !== "object") return null;
    return { index, ts: tsRaw ? Number(tsRaw) : 0 };
  } catch {
    return null;
  }
}

async function saveDiskCache(index: IndexMap): Promise<void> {
  try {
    await AsyncStorage.setItem(AK_INDEX_CACHE, JSON.stringify(index));
    await AsyncStorage.setItem(AK_INDEX_CACHE_TS, String(Date.now()));
  } catch {
    // non-fatal — worst case we just re-fetch next time
  }
}

async function fetchFresh(): Promise<IndexMap | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    return json as IndexMap;
  } catch {
    return null;
  }
}

/**
 * Load the collection index. Order: fresh in-memory cache → fresh-enough
 * disk cache (no network call) → live fetch → stale disk cache as a last
 * resort → empty object. Never throws — callers can always safely index
 * into the result.
 */
async function getIndex(): Promise<IndexMap> {
  const now = Date.now();
  if (_memCache && now - _memCacheAt < CACHE_TTL_MS) return _memCache;

  const disk = await loadDiskCache();
  if (disk && now - disk.ts < CACHE_TTL_MS) {
    _memCache = disk.index;
    _memCacheAt = now;
    return disk.index;
  }

  const fresh = await fetchFresh();
  if (fresh && Object.keys(fresh).length > 0) {
    _memCache = fresh;
    _memCacheAt = now;
    saveDiskCache(fresh).catch(() => {});
    return fresh;
  }

  // Fetch failed/empty — fall back to whatever's on disk even if stale,
  // rather than nothing. A static collection barely goes stale.
  if (disk) {
    _memCache = disk.index;
    _memCacheAt = now;
    return disk.index;
  }

  return {};
}

/** Look up a single asset's {name, image} by its Bubblegum asset ID. */
export async function getSagaMonkeMeta(assetId: string): Promise<SagaMonkeIndexEntry | null> {
  const index = await getIndex();
  return index[assetId] ?? null;
}

/** Batch lookup — returns only the assetIds that resolved, in input order. */
export async function getSagaMonkesMetaBatch(
  assetIds: string[],
): Promise<Array<{ assetId: string; meta: SagaMonkeIndexEntry }>> {
  const index = await getIndex();
  const out: Array<{ assetId: string; meta: SagaMonkeIndexEntry }> = [];
  for (const id of assetIds) {
    const meta = index[id];
    if (meta) out.push({ assetId: id, meta });
  }
  return out;
}
