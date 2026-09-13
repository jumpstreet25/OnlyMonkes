/**
 * NFT Verification Service
 *
 * Provider chain: Helius DAS (primary) → QuickNode DAS (2026-07-13, 30-day
 * trial — see constants.ts) → direct on-chain check (no third-party
 * indexer). Each indexed provider gets 2 attempts with exponential backoff
 * before falling through.
 *
 * Helius and QuickNode are both DAS-capable (see compressed NFTs via
 * getAssetsByOwner) — either one giving a clean "0 found" is authoritative.
 * Shyft used to sit in this chain as a fallback — removed 2026-07-15,
 * confirmed unusable (403, wrong plan tier) and even when it worked it
 * couldn't verify this collection anyway (confirmed 2026-07-11/13: blanket
 * "DAS RPC method not supported" on all DAS methods regardless of
 * key/tier). The on-chain check (onchainCnftVerify.ts) is the final
 * fallback — added 2026-07-11 after the shared Helius account hit its usage
 * cap, and is what will keep working after the QuickNode trial ends.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  HELIUS_API_KEY,
  HELIUS_NFT_API_KEY,
  HELIUS_NFT_RPC_URL,
  NFT_COLLECTION_ADDRESS,
  QUICKNODE_DAS_URL,
  ALCHEMY_DAS_URL,
  MONKE_LEDGER_URL,
} from "./constants";
import { verifySagaMonkeOnChain } from "./onchainCnftVerify";
import { getSagaMonkeMeta } from "./sagaMonkesIndex";
import type { NFTVerificationResult, OwnedNFT, NftTrait } from "@/types";

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 2; // per provider

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Verified-NFT image cache ──────────────────────────────────────────────────
// Persists the last known-good NFT (with real image/metadata from an indexed
// provider) per wallet, so the on-chain fallback — which can confirm
// ownership but has no way to fetch compressed-NFT metadata — can still show
// the user's real PFP instead of a blank one. Also means a returning user
// doesn't need a live Helius/Shyft call just to redraw their own PFP.
const AK_NFT_IMAGE_CACHE = "nft_verified_nft_cache_v1";
let _imageCache: Record<string, OwnedNFT> | null = null;

async function loadImageCache(): Promise<Record<string, OwnedNFT>> {
  if (_imageCache) return _imageCache;
  try {
    const raw = await AsyncStorage.getItem(AK_NFT_IMAGE_CACHE);
    _imageCache = raw ? JSON.parse(raw) : {};
  } catch {
    _imageCache = {};
  }
  return _imageCache!;
}

async function cacheVerifiedNft(walletAddress: string, nft: OwnedNFT): Promise<void> {
  if (!nft.image) return; // only cache entries that actually have an image to offer later
  const cache = await loadImageCache();
  cache[walletAddress] = nft;
  try {
    await AsyncStorage.setItem(AK_NFT_IMAGE_CACHE, JSON.stringify(cache));
  } catch {
    // non-fatal — worst case we just re-fetch from an indexed provider next time one's available
  }
}

async function getCachedVerifiedNft(walletAddress: string): Promise<OwnedNFT | null> {
  const cache = await loadImageCache();
  return cache[walletAddress] ?? null;
}

async function fetchWithAbort(
  url: string,
  opts: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry a provider function up to MAX_RETRIES times with exponential backoff.
 * Returns the result on first success, or throws the last error.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[NFTVerify] ${label} attempt ${attempt}/${MAX_RETRIES} failed: ${lastErr.message}`,
      );
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt); // 2s, 4s
      }
    }
  }
  throw lastErr!;
}

// ─── Helius DAS Provider (fallback) ───────────────────────────────────────────

interface DASAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      symbol: string;
      attributes?: Array<{ trait_type: string; value: string }>;
    };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string; mime?: string }[];
    json_uri?: string;
  };
  grouping?: { group_key: string; group_value: string }[];
  ownership: { owner: string };
}

/**
 * DAS asset → OwnedNFT. Was duplicated verbatim across the Helius, QuickNode,
 * and Alchemy fetch functions below (three copies, one at each provider's
 * `collectionNFTs.map(...)`), plus one broken call site (Helius's
 * searchAssets fast-path) referencing this exact name without it existing
 * anywhere — a `Cannot find name 'mapDasAsset'` compile error, presumably
 * from an incomplete extraction. Extracted once here as the real fix.
 */
function mapDasAsset(asset: DASAsset): OwnedNFT {
  const image =
    asset.content?.links?.image ??
    asset.content?.files?.find((f) => f.mime?.startsWith("image/"))?.cdn_uri ??
    asset.content?.files?.find((f) => f.mime?.startsWith("image/"))?.uri ??
    "";

  const traits = (asset.content?.metadata?.attributes ?? [])
    .filter((a) => a.trait_type && a.value)
    .map((a) => ({ trait_type: a.trait_type, value: a.value }));

  return {
    mint: asset.id,
    name: asset.content?.metadata?.name ?? "Unknown NFT",
    symbol: asset.content?.metadata?.symbol ?? "",
    image,
    collectionMint: NFT_COLLECTION_ADDRESS,
    traits: traits.length > 0 ? traits : undefined,
  };
}

async function fetchAssetsViaHelius(walletAddress: string): Promise<OwnedNFT[]> {
  const url = HELIUS_NFT_RPC_URL;

  try {
    const res = await fetchWithAbort(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nft-gate-search",
        method: "searchAssets",
        params: {
          ownerAddress: walletAddress,
          grouping: ["collection", NFT_COLLECTION_ADDRESS],
          page: 1,
          limit: 50,
        },
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const items: DASAsset[] = json?.result?.items ?? [];
      const mapped = items
        .filter((asset) =>
          asset.grouping?.some(
            (g) =>
              g.group_key === "collection" &&
              g.group_value === NFT_COLLECTION_ADDRESS,
          ),
        )
        .map(mapDasAsset);
      if (mapped.length > 0) return mapped;
    }
  } catch {
    /* fall through to getAssetsByOwner */
  }

  let page = 1;
  const MAX_PAGES = 10;
  const assets: DASAsset[] = [];

  while (page <= MAX_PAGES) {
    const res = await fetchWithAbort(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nft-gate",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletAddress,
          page,
          limit: 1000,
          displayOptions: {
            showCollectionMetadata: false,
            // Match the worker /api/verify DAS call — hiding unverified
            // collections dropped real Saga Monkes (cNFT grouping is often
            // unverified) and then skipped the worker as "confirmed 0".
            showUnverifiedCollections: true,
            showFungible: false,
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`Helius API error: ${res.status}`);
    const json = await res.json();
    const items: DASAsset[] = json?.result?.items ?? [];
    assets.push(...items);

    if (items.length < 1000) break;
    page++;
  }

  // Filter by collection
  const collectionNFTs = assets.filter((asset) =>
    asset.grouping?.some(
      (g) =>
        g.group_key === "collection" &&
        g.group_value === NFT_COLLECTION_ADDRESS,
    ),
  );

  return collectionNFTs.map(mapDasAsset);
}

// ─── QuickNode DAS Provider (fallback, 30-day trial) ──────────────────────────
// Same getAssetsByOwner DAS shape as Helius. Auth is embedded directly in the
// URL path (QuickNode's convention) rather than an api-key query param, so
// QUICKNODE_DAS_URL is used as-is with no query string appended. Verified
// live against a real multi-Monke wallet 2026-07-13 — correctly returns
// compressed NFTs with accurate collection grouping, unlike Shyft.

async function fetchAssetsViaQuickNode(walletAddress: string): Promise<OwnedNFT[]> {
  let page = 1;
  const MAX_PAGES = 10;
  const assets: DASAsset[] = [];

  while (page <= MAX_PAGES) {
    const res = await fetchWithAbort(QUICKNODE_DAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nft-gate",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletAddress,
          page,
          limit: 1000,
          displayOptions: {
            showCollectionMetadata: false,
            // Match the worker /api/verify DAS call — hiding unverified
            // collections dropped real Saga Monkes (cNFT grouping is often
            // unverified) and then skipped the worker as "confirmed 0".
            showUnverifiedCollections: true,
            showFungible: false,
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`QuickNode API error: ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(`QuickNode RPC error: ${JSON.stringify(json.error)}`);
    const items: DASAsset[] = json?.result?.items ?? [];
    assets.push(...items);

    if (items.length < 1000) break;
    page++;
  }

  const collectionNFTs = assets.filter((asset) =>
    asset.grouping?.some(
      (g) => g.group_key === "collection" && g.group_value === NFT_COLLECTION_ADDRESS,
    ),
  );

  return collectionNFTs.map(mapDasAsset);
}

// ─── Alchemy DAS Provider (fallback, added 2026-08-10) ────────────────────────
// Free tier: 30M CU/month, getAssetsByOwner confirmed to support compressed
// NFTs. IMPORTANT: unlike Helius/QuickNode, Alchemy's DAS methods take
// POSITIONAL array params, not a named object — this is the original
// Metaplex DAS wire shape (see MetaMask/Infura's Solana Snap docs), which
// Helius/QuickNode both diverged from in favor of an object. Verified
// directly against Alchemy's docs before writing this — do not "fix" this
// back to an object shape, it will silently 400/no-op if changed.
// params: [ownerAddress, {sortBy,sortDirection}, limit, page, before, after, displayOptions]

async function fetchAssetsViaAlchemy(walletAddress: string): Promise<OwnedNFT[]> {
  let page = 1;
  const MAX_PAGES = 10;
  const assets: DASAsset[] = [];

  while (page <= MAX_PAGES) {
    const res = await fetchWithAbort(ALCHEMY_DAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nft-gate",
        method: "getAssetsByOwner",
        params: [
          walletAddress,
          { sortBy: "created", sortDirection: "asc" },
          1000,
          page,
          null,
          null,
          {
            showCollectionMetadata: false,
            showUnverifiedCollections: true,
            showFungible: false,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(`Alchemy RPC error: ${JSON.stringify(json.error)}`);
    const items: DASAsset[] = json?.result?.items ?? [];
    assets.push(...items);

    if (items.length < 1000) break;
    page++;
  }

  const collectionNFTs = assets.filter((asset) =>
    asset.grouping?.some(
      (g) => g.group_key === "collection" && g.group_value === NFT_COLLECTION_ADDRESS,
    ),
  );

  return collectionNFTs.map(mapDasAsset);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * On-demand full collection list for a wallet, bypassing the holder-index
 * fast path entirely — that path only ever tracks ONE mint per wallet (see
 * the doc comment on verifyNFTOwnership's step 0), so a multi-Monke holder's
 * `allNfts` from a normal login can be just their single most-recently-cached
 * NFT. Real bug report (2026-09-04): a 2+-Monke holder was stuck seeing the
 * same one NFT no matter how many times they signed out/in, and "Switch PFP"
 * had nothing to switch between because it read from that same stale
 * single-element list.
 *
 * Deliberately NOT called on every login (that would reintroduce exactly the
 * live-DAS-call-per-login cost the fast path exists to avoid) — call this
 * only when the user is about to actually pick a different NFT (the "Switch
 * PFP" flow).
 *
 * 2026-09-12: tries MonkeLedger first (one /wallet + parallel /metadata calls, zero Helius) —
 * only falls through to the live Helius->QuickNode->Alchemy chain if MonkeLedger can't produce a
 * complete list. Returns [] on total failure — callers should keep whatever `allNfts` they
 * already had rather than blanking the picker.
 */
/**
 * MonkeLedger-first path for the full gallery — one /wallet lookup plus a parallel /metadata
 * fetch per owned asset, all served from MonkeLedger's own cache (no Helius call at all).
 * Returns null (not []) on anything short of a genuine "wallet owns N Monkes, here they are" so
 * callers fall through to the live chain rather than confidently showing an empty/stale gallery —
 * same confirm-only contract as every other MonkeLedger fast path in this file.
 */
async function fetchFullCollectionFromMonkeLedger(walletAddress: string): Promise<OwnedNFT[] | null> {
  const fromLedger = await checkMonkeLedgerWalletAssets(walletAddress);
  if (!fromLedger?.owns || fromLedger.assets.length === 0) return null;
  const metadataResults = await Promise.all(fromLedger.assets.map(fetchMonkeLedgerMetadata));
  const nfts: OwnedNFT[] = [];
  for (let i = 0; i < fromLedger.assets.length; i++) {
    const meta = metadataResults[i];
    if (!meta) return null; // any miss — don't show a partial gallery, fall through instead
    nfts.push({
      mint: fromLedger.assets[i],
      name: meta.name,
      symbol: "MONKE",
      image: meta.image,
      collectionMint: NFT_COLLECTION_ADDRESS,
      traits: meta.traits,
    });
  }
  return nfts;
}

export async function fetchFullNftCollection(walletAddress: string): Promise<OwnedNFT[]> {
  const fromLedger = await fetchFullCollectionFromMonkeLedger(walletAddress).catch(() => null);
  if (fromLedger) return fromLedger;

  if (HELIUS_NFT_API_KEY) {
    try {
      const nfts = await fetchAssetsViaHelius(walletAddress);
      if (nfts.length > 0) return nfts;
    } catch { /* fall through */ }
  }
  if (QUICKNODE_DAS_URL) {
    try {
      const nfts = await fetchAssetsViaQuickNode(walletAddress);
      if (nfts.length > 0) return nfts;
    } catch { /* fall through */ }
  }
  if (ALCHEMY_DAS_URL) {
    try {
      const nfts = await fetchAssetsViaAlchemy(walletAddress);
      if (nfts.length > 0) return nfts;
    } catch { /* fall through */ }
  }
  return [];
}

/**
 * Verify whether a wallet owns any NFT from the configured collection.
 *
 * Chain: Helius (×2 retries) → QuickNode (×2 retries) → on-chain → error
 */
export async function verifyNFTOwnership(
  walletAddress: string,
): Promise<NFTVerificationResult> {
  if (!NFT_COLLECTION_ADDRESS) {
    return {
      verified: false,
      nft: null,
      error: "NFT_COLLECTION_ADDRESS is not configured.",
    };
  }

  const errors: string[] = [];
  let confirmedNonHolder = false;

  // ── -1. MonkeLedger fast path (2026-09-12, Tier 1 migration, 48h backup-check
  // period — see project memory). Our own self-hosted indexer, independently
  // verified against the live on-chain root every 10 min — see MonkeLedger repo.
  // Same additive-only contract as the holder-index step below: this can ONLY
  // ever short-circuit to a CONFIRMED holder. Any other outcome (not found,
  // unreachable, indeterminate) falls straight through to the full chain below,
  // completely unchanged — Helius remains the sole authority for every denial
  // during this probation period. Real name/image/traits now come straight from
  // MonkeLedger too (added 2026-09-12) — no live Helius call needed for those
  // either; cache/generic fallback only kicks in if MonkeLedger's metadata call
  // itself misses (e.g. mid-refresh).
  try {
    const fromLedger = await checkMonkeLedgerWalletAssets(walletAddress);
    if (fromLedger?.owns && fromLedger.assets[0]) {
      console.log("[NFTVerify] MonkeLedger fast-confirm: wallet holds a Saga Monke");
      const [cached, metadata] = await Promise.all([
        getCachedVerifiedNft(walletAddress),
        fetchMonkeLedgerMetadata(fromLedger.assets[0]),
      ]);
      const nft: OwnedNFT = {
        mint: fromLedger.assets[0],
        name: metadata?.name ?? cached?.name ?? "Saga Monke",
        symbol: "MONKE",
        image: metadata?.image ?? cached?.image ?? null,
        collectionMint: NFT_COLLECTION_ADDRESS,
        traits: metadata?.traits ?? cached?.traits,
      };
      cacheVerifiedNft(walletAddress, nft).catch(() => {});
      return { verified: true, nft, allNfts: [nft] };
    }
  } catch { /* MonkeLedger unavailable — fall through, no error recorded */ }

  // ── 0. Holder-index fast path — pure KV read on the worker, no live
  // Helius/QuickNode/Alchemy call at all. The worker refreshes this index
  // from a full collection scan every ~4h (see fetchMonkeHolderCount), so
  // this covers the common case (an already-holding, returning user) at
  // near-zero cost instead of burning a live DAS call on every login.
  // Additive only: a miss or failure here changes nothing — falls straight
  // through to the full chain below exactly as before. Never used to deny.
  try {
    const res = await fetchWithAbort(
      `https://onlymonkes-actions.jumpstreet25.workers.dev/api/holders/lookup?wallet=${encodeURIComponent(walletAddress)}`,
      { method: "GET" },
      5_000,
    );
    if (res.ok) {
      const data = await res.json() as { owned?: boolean; mint?: string; name?: string; image?: string | null; traits?: Array<{ trait_type: string; value: string }> };
      if (data.owned && data.mint) {
        console.log("[NFTVerify] Holder-index fast path: confirmed current holder");
        // 2026-09-04: this used to prefer the LOCAL AsyncStorage cache
        // (getCachedVerifiedNft) over the worker's own answer whenever a
        // cache entry existed — but that local cache is never invalidated
        // by sign-out/sign-in (confirmed real bug report: a multi-Monke
        // holder stuck seeing the same NFT no matter how many times they
        // signed out). The worker's holder index refreshes every ~4h, so
        // it's a strictly fresher source of truth than a cache with no TTL
        // at all — use it directly, and only fall back to the local cache
        // for the image URL specifically if the worker didn't have one.
        const cached = await getCachedVerifiedNft(walletAddress);
        const nft: OwnedNFT = {
          mint: data.mint,
          name: data.name ?? cached?.name ?? "Saga Monke",
          symbol: "MONKE",
          image: data.image ?? cached?.image ?? null,
          collectionMint: NFT_COLLECTION_ADDRESS,
          traits: data.traits ?? cached?.traits,
        };
        cacheVerifiedNft(walletAddress, nft).catch(() => {});
        // allNfts is deliberately just [nft] here — the holder index only
        // ever tracks one mint per wallet, so it structurally can't report
        // a full multi-Monke collection. That's fine for the fast path's
        // actual job (confirm + show ONE NFT quickly); fetchFullNftCollection()
        // is what "Switch PFP" now calls on-demand to get the true full
        // collection when a user actually wants to pick between Monkes,
        // rather than paying that cost on every login.
        return { verified: true, nft, allNfts: [nft] };
      }
    }
  } catch { /* index unavailable/slow — fall through, no error recorded */ }

  // ── 1. Helius DAS (primary) ─────────────────────────────────────────────
  if (HELIUS_NFT_API_KEY) {
    try {
      const nfts = await withRetry("Helius", () =>
        fetchAssetsViaHelius(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] Helius: found ${nfts.length} collection NFT(s)`);
        cacheVerifiedNft(walletAddress, nfts[0]).catch(() => {});
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      // Clean 0 is NOT final — worker /api/verify uses a separate Helius
      // key/quota and has confirmed holders this local DAS missed. Keep
      // walking the chain + worker.
      errors.push("Helius: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Helius: ${msg}`);
      console.warn("[NFTVerify] Helius exhausted, falling back to QuickNode");
    }
  }

  // ── 2. QuickNode DAS (fallback, 30-day trial) ───────────────────────────
  // Also DAS-capable (sees compressed NFTs) — a clean "0 found" here is
  // just as authoritative as Helius's.
  if (QUICKNODE_DAS_URL && !confirmedNonHolder) {
    try {
      const nfts = await withRetry("QuickNode", () =>
        fetchAssetsViaQuickNode(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] QuickNode: found ${nfts.length} collection NFT(s)`);
        cacheVerifiedNft(walletAddress, nfts[0]).catch(() => {});
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      errors.push("QuickNode: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`QuickNode: ${msg}`);
      console.warn("[NFTVerify] QuickNode exhausted, falling back to on-chain");
    }
  }

  // ── 3. Alchemy DAS (fallback, added 2026-08-10) ─────────────────────────
  // Genuinely vendor-independent from Helius/QuickNode (different company,
  // different infra) — added specifically because QuickNode's 30-day trial
  // is about to lapse and this is the only remaining *indexed* fallback,
  // vs. jumping straight to the slower on-chain scan below.
  if (ALCHEMY_DAS_URL && !confirmedNonHolder) {
    try {
      const nfts = await withRetry("Alchemy", () =>
        fetchAssetsViaAlchemy(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] Alchemy: found ${nfts.length} collection NFT(s)`);
        cacheVerifiedNft(walletAddress, nfts[0]).catch(() => {});
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      errors.push("Alchemy: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Alchemy: ${msg}`);
      console.warn("[NFTVerify] Alchemy exhausted, falling back to on-chain");
    }
  }

  // ── 4. On-chain fallback — no third-party indexer, immune to Helius/
  // QuickNode/Alchemy outages. Slower (scans wallet history directly), so
  // only tried once the faster indexed providers haven't already given an
  // authoritative answer. Shyft used to sit here as an extra fallback —
  // removed 2026-07-15, confirmed unusable (403, wrong plan tier) and even
  // when it worked it had no cNFT support for this collection anyway.
  // Always try on-chain unless a later source already confirmed a holder.
  // Indexed "0 found" must not skip this — same class of false negative.
  {
    try {
      const onchain = await verifySagaMonkeOnChain(walletAddress);
      if (onchain.verified) {
        console.log("[NFTVerify] On-chain: confirmed current holder");
        // On-chain check confirms ownership but has no way to fetch
        // compressed-NFT metadata on its own. Preference order for a real
        // image: (1) sagaMonkesIndex.ts's static, offline-built collection
        // index — cross-referenced by the real per-leaf asset ID
        // onchainCnftVerify.ts now derives, needs no live DAS call at all;
        // (2) a prior indexed-provider success cached for this wallet;
        // (3) a blank placeholder, which routes the caller to the manual
        // upload fallback (see setUserChosenNftImage's doc comment) — the
        // last resort this index exists to make rare instead of routine.
        let nft: OwnedNFT | null = null;
        if (onchain.assetId) {
          const meta = await getSagaMonkeMeta(onchain.assetId);
          if (meta) {
            nft = {
              mint: onchain.assetId,
              name: meta.name,
              symbol: "MONKE",
              image: meta.image,
              collectionMint: NFT_COLLECTION_ADDRESS,
            };
          }
        }
        if (!nft) {
          const cached = await getCachedVerifiedNft(walletAddress);
          nft = cached ?? {
            mint: onchain.assetId ?? walletAddress,
            name: "Saga Monke",
            symbol: "MONKE",
            image: null,
            collectionMint: NFT_COLLECTION_ADDRESS,
          };
        }
        if (nft.image) cacheVerifiedNft(walletAddress, nft).catch(() => {});
        return { verified: true, nft, allNfts: [nft] };
      }
      if (onchain.inconclusive) {
        errors.push(`On-chain: inconclusive${onchain.error ? ` (${onchain.error})` : ""}`);
      } else {
        errors.push("On-chain: confirmed not a current holder");
        confirmedNonHolder = true;
      }
    } catch (err) {
      errors.push(`On-chain: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 5. Worker-side fallback — /api/verify runs its own independent
  // Helius -> QuickNode chain (separate keys/quotas from whatever's bundled
  // into THIS app build). This is the difference between a per-build key
  // outage being a temporary inconvenience versus a total, unrecoverable
  // block: it's genuinely happened that a shipped build had a missing,
  // exhausted, or misconfigured key with no working fallback at all — see
  // this function's git history. Tried last (after the faster/richer
  // indexed + on-chain checks above) since it only returns a bare
  // owned/not-owned, no NFT metadata for the picker.
  // Always ask the worker — even after a local DAS/on-chain "0". Worker
  // keys have independently confirmed holders the app-side chain missed.
  {
    try {
      const res = await fetchWithAbort(
        `https://onlymonkes-actions.jumpstreet25.workers.dev/api/verify?wallet=${encodeURIComponent(walletAddress)}`,
        { method: "GET" },
      );
      if (res.ok) {
        const data = await res.json() as { owned?: boolean; uncertain?: boolean; mint?: string; name?: string; image?: string | null; traits?: Array<{ trait_type: string; value: string }> };
        if (data.owned && data.mint) {
          console.log("[NFTVerify] Worker fallback: confirmed current holder");
          const cached = await getCachedVerifiedNft(walletAddress);
          const nft: OwnedNFT = cached ?? {
            mint: data.mint,
            name: data.name ?? "Saga Monke",
            symbol: "MONKE",
            image: data.image ?? null,
            collectionMint: NFT_COLLECTION_ADDRESS,
            traits: data.traits,
          };
          return { verified: true, nft, allNfts: [nft] };
        }
        if (data.uncertain) {
          errors.push("Worker fallback: uncertain (both its providers failed too)");
        } else {
          errors.push("Worker fallback: 0 collection NFTs found");
          confirmedNonHolder = true;
        }
      } else {
        errors.push(`Worker fallback: HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(`Worker fallback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 6. Nothing found a holder ────────────────────────────────────────────
  // 2026-08-05: no longer an early-return on "no local key configured" —
  // the worker fallback above runs regardless of THIS build's own Helius/
  // QuickNode/Alchemy keys, using its own independently-provisioned ones, so
  // a build shipped with neither key set can still get a real, authoritative
  // answer. Missing local keys are now just another line in `errors`
  // (surfaced below if every provider, including the worker, comes back
  // uncertain) rather than a hard stop before the worker fallback even had
  // a chance to run.
  if (!HELIUS_NFT_API_KEY && !QUICKNODE_DAS_URL && !ALCHEMY_DAS_URL) {
    errors.unshift("(this build has no local HELIUS_API_KEY, QUICKNODE_DAS_URL, or ALCHEMY_API_KEY configured)");
  }

  // Only an authoritative source (Helius's DAS-capable "0 found", the
  // on-chain check explicitly confirming the wallet gave up/never held it,
  // or the worker fallback's own clean "0 found") counts as real evidence
  // of non-ownership.
  if (confirmedNonHolder) {
    return {
      verified: false,
      nft: null,
      error: "No NFTs from this collection found in your wallet.",
    };
  }

  // At least one provider errored/timed out rather than cleanly confirming
  // zero NFTs — this is an infrastructure outage, not evidence the wallet
  // doesn't hold the collection. Callers must not treat this the same as a
  // confirmed non-holder (see providerError doc on NFTVerificationResult).
  return {
    verified: false,
    nft: null,
    error: `Verification failed after retries: ${errors.join("; ")}`,
    providerError: true,
  };
}

/**
 * Checks MonkeLedger (our own self-hosted indexer) for whether an assetId is a live,
 * currently-held Saga Monke. Returns null (not false) on any failure/timeout/unknown-asset so
 * callers correctly fall through to Helius rather than treating "MonkeLedger doesn't have it" as
 * "not in the collection" — MonkeLedger's index can be mid-refresh, or the asset could be a
 * burned/decompressed one it deliberately excludes even though it was once real.
 */
/**
 * Wallet-keyed counterpart to checkMonkeLedgerMembership — "does this wallet currently hold any
 * Saga Monke". Confirm-only, like every other MonkeLedger fast path in this codebase: only ever
 * returns `true` (a real hit) or `null` (couldn't determine — no answer, unreachable, or
 * MonkeLedger itself confirmed zero assets). A `false` from MonkeLedger is deliberately mapped to
 * null here, not returned as-is — this function's only caller must fall through to the full
 * verification chain for a denial, never treat MonkeLedger's "no" as final.
 */
export async function checkMonkeLedgerWalletOwnership(wallet: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/wallet/${wallet}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { owns?: boolean };
    return data.owns === true ? true : null;
  } catch {
    return null;
  }
}

/**
 * Richer sibling of checkMonkeLedgerWalletOwnership, for verifyNFTOwnership's fast path — needs
 * the actual assetId(s), not just a boolean, to build an OwnedNFT stub. Same null-on-uncertainty
 * contract. Pair with fetchMonkeLedgerMetadata() below to fill in real name/image/traits (2026-09-12
 * — MonkeLedger now captures display metadata for free from the same DAS snapshot it already
 * fetches; no live Helius call needed for this).
 */
async function checkMonkeLedgerWalletAssets(wallet: string): Promise<{ owns: boolean; assets: string[] } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/wallet/${wallet}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { owns?: boolean; assets?: string[] };
    if (typeof data.owns !== "boolean" || !Array.isArray(data.assets)) return null;
    return { owns: data.owns, assets: data.assets };
  } catch {
    return null;
  }
}

/**
 * Real display metadata from MonkeLedger — captured for free from the same getAssetsByGroup
 * snapshot it already fetches every refresh (Helius has already resolved the Arweave JSON on its
 * end; MonkeLedger just saves it instead of discarding it). Returns null on any failure/miss so
 * callers fall back to cache/generic-placeholder exactly as before this existed.
 */
async function fetchMonkeLedgerMetadata(assetId: string): Promise<{ name: string; image: string | null; traits?: NftTrait[] } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/metadata/${assetId}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string | null; image?: string | null; traits?: NftTrait[] | null };
    if (!data.name) return null;
    return { name: data.name, image: data.image ?? null, traits: data.traits ?? undefined };
  } catch {
    return null;
  }
}

export type RarityTier = "Legendary" | "Rare" | "Uncommon" | "Common";

export type BurntMonke = {
  number: number | null;
  name: string | null;
  mint: string;
  image: string | null;
  traits: NftTrait[] | null;
  lastSeenLeafIndex: number | null;
  burnedAtMs: number | null;
  // 2026-09-13: statistical rarity computed across the whole 10,014-Monke collection
  // (live + burnt combined) — see MonkeLedger's computeRarity(). rank 1 = rarest.
  rarityRank: number | null;
  rarityTotal: number | null;
  rarityTier: RarityTier | null;
};

/**
 * The memorial list — every Saga Monke ever burnt, with its last-known name/image/traits.
 * Purely static/historical display data (no ownership/security implications), so unlike the
 * other MonkeLedger helpers in this file this isn't confirm-only — it's the only source for this
 * data at all. Returns null on any failure so the screen can show a friendly error state.
 */
export async function fetchMonkeLedgerBurnt(): Promise<BurntMonke[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/burnt`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data as BurntMonke[];
  } catch {
    return null;
  }
}

async function checkMonkeLedgerMembership(assetId: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/owner/${assetId}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null; // not (currently) in MonkeLedger's index — let Helius decide
    if (!res.ok) return null;
    return true; // a 200 with a body means MonkeLedger has this asset indexed as a live Saga Monke
  } catch {
    return null;
  }
}

/**
 * Verify a single NFT mint belongs to the configured collection.
 *
 * Chain: MonkeLedger → Helius getAsset → QuickNode getAsset → false
 */
export async function verifyNftMintInCollection(nftMint: string): Promise<boolean> {
  if (!NFT_COLLECTION_ADDRESS || !nftMint) return false;

  // ── MonkeLedger (primary — own indexer, isolated from Helius quota) ─────
  const fromLedger = await checkMonkeLedgerMembership(nftMint);
  if (fromLedger !== null) return fromLedger;

  // ── Helius (fallback) ──────────────────────────────────────────────────
  if (HELIUS_NFT_API_KEY) {
    try {
      const res = await fetchWithAbort(
        HELIUS_NFT_RPC_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "mint-check",
            method: "getAsset",
            params: { id: nftMint },
          }),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const grouping: { group_key: string; group_value: string }[] =
          json?.result?.grouping ?? [];
        return grouping.some(
          (g) =>
            g.group_key === "collection" &&
            g.group_value === NFT_COLLECTION_ADDRESS,
        );
      }
    } catch {
      // fall through to QuickNode
    }
  }

  // ── QuickNode DAS (fallback, 30-day trial) ──────────────────────────────
  if (QUICKNODE_DAS_URL) {
    try {
      const res = await fetchWithAbort(QUICKNODE_DAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mint-check",
          method: "getAsset",
          params: { id: nftMint },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const grouping: { group_key: string; group_value: string }[] =
          json?.result?.grouping ?? [];
        return grouping.some(
          (g) =>
            g.group_key === "collection" &&
            g.group_value === NFT_COLLECTION_ADDRESS,
        );
      }
    } catch {
      // both failed
    }
  }

  return false;
}

/**
 * Shorten a wallet address for display: "8xKp...3fQa"
 */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Manually set the verified NFT image for a wallet — used when no indexed
 * provider (Helius/Shyft) can supply one (e.g. Saga Monkes' compressed
 * metadata can't be fetched via the on-chain-only fallback). The user
 * supplies their own image (saved from their wallet app's NFT gallery,
 * uploaded via the app's normal image picker), which then flows through the
 * exact same cache an auto-fetched image would, so future verifications
 * keep showing it.
 */
export async function setUserChosenNftImage(
  walletAddress: string,
  imageUrl: string,
  base?: OwnedNFT | null,
): Promise<OwnedNFT> {
  const nft: OwnedNFT = {
    mint: base?.mint ?? walletAddress,
    name: base?.name ?? "Saga Monke",
    symbol: base?.symbol ?? "MONKE",
    image: imageUrl,
    collectionMint: NFT_COLLECTION_ADDRESS,
    traits: base?.traits,
  };
  await cacheVerifiedNft(walletAddress, nft);
  return nft;
}

/** Look up the cached NFT (if any) for a wallet without re-verifying ownership. */
export async function getCachedNftForWallet(walletAddress: string): Promise<OwnedNFT | null> {
  return getCachedVerifiedNft(walletAddress);
}
