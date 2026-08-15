/**
 * NFT Verification Service (runtime 3.3 / store OTA)
 *
 * Chain: Helius DAS → worker /api/verify.
 * Shyft is no longer called — 401 on a dead key used to surface as
 * "Verification failed after retries: Helius API error 429, SHYFT API error 401"
 * and lock out real holders when the shared Helius key was rate-limited.
 */

import {
  HELIUS_NFT_API_KEY,
  HELIUS_NFT_RPC_URL,
  NFT_COLLECTION_ADDRESS,
} from "./constants";
import { verifySagaMonkeOnChain } from "./onchainCnftVerify";
import type { NFTVerificationResult, OwnedNFT } from "@/types";

const TIMEOUT_MS = 15_000;
const WORKER_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 2;
const WORKER_VERIFY =
  "https://onlymonkes-actions.jumpstreet25.workers.dev/api/verify";

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
      // 429/401 will not recover in 2s — fall through to the worker.
      if (/ (429|401|403)\b/.test(lastErr.message)) break;
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr!;
}

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

  return assets
    .filter((asset) =>
      asset.grouping?.some(
        (g) =>
          g.group_key === "collection" &&
          g.group_value === NFT_COLLECTION_ADDRESS,
      ),
    )
    .map(mapDasAsset);
}

async function fetchViaWorker(walletAddress: string): Promise<OwnedNFT | null | "uncertain"> {
  const res = await fetchWithAbort(
    `${WORKER_VERIFY}?wallet=${encodeURIComponent(walletAddress)}`,
    { method: "GET" },
    WORKER_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`Worker API error: ${res.status}`);
  const data = await res.json() as {
    owned?: boolean;
    uncertain?: boolean;
    mint?: string;
    name?: string;
    image?: string | null;
    traits?: Array<{ trait_type: string; value: string }>;
  };
  if (data.uncertain) return "uncertain";
  if (!data.owned || !data.mint) return null;
  return {
    mint: data.mint,
    name: data.name ?? "Saga Monke",
    symbol: "MONKE",
    image: data.image ?? "",
    collectionMint: NFT_COLLECTION_ADDRESS,
    traits: data.traits,
  };
}

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

  if (HELIUS_NFT_API_KEY) {
    try {
      const nfts = await withRetry("Helius", () =>
        fetchAssetsViaHelius(walletAddress),
      );
      if (nfts.length > 0) {
        console.log(`[NFTVerify] Helius: found ${nfts.length} collection NFT(s)`);
        return { verified: true, nft: nfts[0], allNfts: nfts };
      }
      errors.push("Helius: 0 collection NFTs found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Helius: ${msg}`);
      console.warn("[NFTVerify] Helius exhausted, falling back to worker");
    }
  }

  try {
    const worker = await fetchViaWorker(walletAddress);
    if (worker && worker !== "uncertain") {
      console.log("[NFTVerify] Worker fallback: confirmed current holder");
      return { verified: true, nft: worker, allNfts: [worker] };
    }
    if (worker === "uncertain") {
      errors.push("Worker fallback: uncertain");
    } else {
      errors.push("Worker fallback: 0 collection NFTs found");
    }
  } catch (err) {
    errors.push(`Worker fallback: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const onchain = await verifySagaMonkeOnChain(walletAddress);
    if (onchain.verified) {
      console.log("[NFTVerify] On-chain: confirmed current holder");
      const nft: OwnedNFT = {
        mint: onchain.assetId ?? walletAddress,
        name: "Saga Monke",
        symbol: "MONKE",
        image: "",
        collectionMint: NFT_COLLECTION_ADDRESS,
      };
      return { verified: true, nft, allNfts: [nft] };
    }
    if (onchain.inconclusive) {
      errors.push(`On-chain: inconclusive${onchain.error ? ` (${onchain.error})` : ""}`);
    } else {
      errors.push("On-chain: confirmed not a current holder");
    }
  } catch (err) {
    errors.push(`On-chain: ${err instanceof Error ? err.message : String(err)}`);
  }

  const allZero = errors.length > 0 && errors.every((e) => e.includes("0 collection NFTs"));
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
    providerError: true,
  };
}

export async function verifyNftMintInCollection(nftMint: string): Promise<boolean> {
  if (!NFT_COLLECTION_ADDRESS || !nftMint) return false;

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
      /* fall through */
    }
  }

  return false;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
