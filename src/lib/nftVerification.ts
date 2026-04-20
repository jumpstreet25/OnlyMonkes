/**
 * NFT Verification Service
 *
 * Provider chain: Helius DAS (primary) → Shyft (fallback)
 * Each provider gets 2 attempts with exponential backoff before falling through.
 *
 * Helius DAS is primary — authoritative on-chain source via getAssetsByOwner.
 * Shyft is fallback in case Helius is down or rate-limited.
 */

import {
  HELIUS_API_KEY,
  NFT_COLLECTION_ADDRESS,
  SHYFT_API_KEY,
} from "./constants";
import type { NFTVerificationResult, OwnedNFT } from "@/types";

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 2; // per provider

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

// ─── Shyft Provider (primary) ─────────────────────────────────────────────────

interface ShyftNft {
  mint: string;
  name: string;
  symbol: string;
  image_uri: string;
  attributes?: Record<string, string | number>;
  collection?: { address?: string; verified?: boolean };
}

async function fetchViaSHyft(walletAddress: string): Promise<OwnedNFT[]> {
  const url =
    `https://api.shyft.to/sol/v1/nft/read_all` +
    `?network=mainnet-beta` +
    `&address=${walletAddress}` +
    `&collection=${NFT_COLLECTION_ADDRESS}`;

  const res = await fetchWithAbort(url, {
    method: "GET",
    headers: { "x-api-key": SHYFT_API_KEY },
  });

  if (!res.ok) throw new Error(`Shyft API error: ${res.status}`);
  const json = await res.json();

  if (!json?.success || !json?.result) {
    throw new Error(json?.message ?? "Shyft returned unsuccessful response");
  }

  const nfts: ShyftNft[] = json.result;

  return nfts.map((n) => {
    const traits = n.attributes
      ? Object.entries(n.attributes).map(([k, v]) => ({
          trait_type: k,
          value: String(v),
        }))
      : undefined;

    return {
      mint: n.mint,
      name: n.name || "Unknown NFT",
      symbol: n.symbol || "",
      image: n.image_uri || "",
      collectionMint: NFT_COLLECTION_ADDRESS,
      traits: traits && traits.length > 0 ? traits : undefined,
    };
  });
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

async function fetchAssetsViaHelius(walletAddress: string): Promise<OwnedNFT[]> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

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
            showUnverifiedCollections: false,
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

  return collectionNFTs.map((asset) => {
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
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify whether a wallet owns any NFT from the configured collection.
 *
 * Chain: Shyft (×2 retries) → Helius (×2 retries) → error
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

  // ── 1. Helius DAS (primary) ─────────────────────────────────────────────
  if (HELIUS_API_KEY) {
    try {
      const nfts = await withRetry("Helius", () =>
        fetchAssetsViaHelius(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] Helius: found ${nfts.length} collection NFT(s)`);
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      // Helius succeeded but found 0 NFTs — still try Shyft in case of index lag
      errors.push("Helius: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Helius: ${msg}`);
      console.warn("[NFTVerify] Helius exhausted, falling back to Shyft");
    }
  }

  // ── 2. Shyft (fallback) ────────────────────────────────────────────────
  if (SHYFT_API_KEY) {
    try {
      const nfts = await withRetry("Shyft", () =>
        fetchViaSHyft(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] Shyft: found ${nfts.length} collection NFT(s)`);
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      errors.push("Shyft: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Shyft: ${msg}`);
      console.warn("[NFTVerify] Shyft exhausted");
    }
  }

  // ── 3. Both failed or returned 0 ───────────────────────────────────────
  if (!HELIUS_API_KEY && !SHYFT_API_KEY) {
    return {
      verified: false,
      nft: null,
      error: "No NFT verification API key configured (HELIUS_API_KEY or SHYFT_API_KEY).",
    };
  }

  // If both providers returned 0 NFTs, user genuinely doesn't hold one
  const allZero = errors.every((e) => e.includes("0 collection NFTs"));
  if (allZero) {
    return {
      verified: false,
      nft: null,
      error: "No NFTs from this collection found in your wallet.",
    };
  }

  return {
    verified: false,
    nft: null,
    error: `Verification failed after retries: ${errors.join("; ")}`,
  };
}

/**
 * Verify a single NFT mint belongs to the configured collection.
 *
 * Chain: Helius getAsset → Shyft getAsset → false
 */
export async function verifyNftMintInCollection(nftMint: string): Promise<boolean> {
  if (!NFT_COLLECTION_ADDRESS || !nftMint) return false;

  // ── Helius (primary) ──────────────────────────────────────────────────
  if (HELIUS_API_KEY) {
    try {
      const res = await fetchWithAbort(
        `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
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
      // fall through to Shyft
    }
  }

  // ── Shyft (fallback) ────────────────────────────────────────────────────
  if (SHYFT_API_KEY) {
    try {
      const url =
        `https://api.shyft.to/sol/v1/nft/read` +
        `?network=mainnet-beta` +
        `&token_address=${nftMint}`;

      const res = await fetchWithAbort(url, {
        method: "GET",
        headers: { "x-api-key": SHYFT_API_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        const collection = json?.result?.collection?.address;
        if (collection === NFT_COLLECTION_ADDRESS) return true;
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
