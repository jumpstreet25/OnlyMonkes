/**
 * NFT Verification Service
 *
 * Uses Helius Digital Asset Standard (DAS) API to check if a wallet
 * owns any NFT from the configured collection.
 *
 * Falls back to on-chain account parsing via @solana/web3.js if no
 * Helius API key is configured.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  HELIUS_API_KEY,
  HELIUS_RPC_URL,
  NFT_COLLECTION_ADDRESS,
  SOLANA_RPC_URL,
} from "./constants";
import type { NFTVerificationResult, OwnedNFT } from "@/types";

// ─── Helius DAS API ───────────────────────────────────────────────────────────

interface DASAsset {
  id: string;
  content: {
    metadata: { name: string; symbol: string };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string; mime?: string }[];
    json_uri?: string;
  };
  grouping?: { group_key: string; group_value: string }[];
  ownership: { owner: string };
}

async function fetchAssetsViaHelius(walletAddress: string): Promise<DASAsset[]> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  let page = 1;
  const assets: DASAsset[] = [];

  while (true) {
    const res = await fetch(url, {
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

  return assets;
}

function dasAssetToOwnedNFT(asset: DASAsset): OwnedNFT {
  const image =
    asset.content?.links?.image ??
    asset.content?.files?.find((f) => f.mime?.startsWith("image/"))?.cdn_uri ??
    asset.content?.files?.find((f) => f.mime?.startsWith("image/"))?.uri ??
    "";

  return {
    mint: asset.id,
    name: asset.content?.metadata?.name ?? "Unknown NFT",
    symbol: asset.content?.metadata?.symbol ?? "",
    image,
    collectionMint: NFT_COLLECTION_ADDRESS,
  };
}

// ─── Fallback: raw on-chain check ─────────────────────────────────────────────

async function verifyViaOnChain(walletAddress: string): Promise<NFTVerificationResult> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const wallet = new PublicKey(walletAddress);

  // Fetch all token accounts; filter for NFTs (amount == 1, decimals == 0)
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const nftMints = tokenAccounts.value
    .filter(
      (a) =>
        a.account.data.parsed.info.tokenAmount.uiAmount === 1 &&
        a.account.data.parsed.info.tokenAmount.decimals === 0
    )
    .map((a) => a.account.data.parsed.info.mint as string);

  if (nftMints.length === 0) {
    return { verified: false, nft: null, error: "No NFTs found in wallet" };
  }

  // NOTE: Without DAS API, collection membership verification requires
  // fetching on-chain metadata for each NFT and checking the `collection` field.
  // This is rate-limited and slow for large wallets — use Helius in production.
  console.warn(
    "[NFTVerify] Falling back to on-chain check. Add a Helius API key for production."
  );

  // Simplified: check if any mint matches (only works if you know exact mints)
  // A real implementation would use Metaplex to decode each metadata account.
  return {
    verified: false,
    nft: null,
    error: "On-chain fallback does not support collection verification. Please add a Helius API key.",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify whether a wallet owns any NFT from the configured collection.
 * Returns the first matching NFT if found.
 */
export async function verifyNFTOwnership(
  walletAddress: string
): Promise<NFTVerificationResult> {
  if (!NFT_COLLECTION_ADDRESS) {
    return {
      verified: false,
      nft: null,
      error: "NFT_COLLECTION_ADDRESS is not configured.",
    };
  }

  try {
    if (HELIUS_API_KEY) {
      const assets = await fetchAssetsViaHelius(walletAddress);

      // Filter by collection grouping
      const collectionNFTs = assets.filter((asset) =>
        asset.grouping?.some(
          (g) =>
            g.group_key === "collection" &&
            g.group_value === NFT_COLLECTION_ADDRESS
        )
      );

      if (collectionNFTs.length === 0) {
        return {
          verified: false,
          nft: null,
          error: "No NFTs from this collection found in your wallet.",
        };
      }

      const allNfts = collectionNFTs.map(dasAssetToOwnedNFT);
      return {
        verified: true,
        nft: allNfts[0],
        allNfts,
      };
    } else {
      return verifyViaOnChain(walletAddress);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { verified: false, nft: null, error: `Verification failed: ${message}` };
  }
}

/**
 * Verify a single NFT mint belongs to the configured collection.
 * Used by the admin to gate-check incoming join requests without needing the wallet address.
 * Returns true if the mint's verified collection matches NFT_COLLECTION_ADDRESS.
 */
export async function verifyNftMintInCollection(nftMint: string): Promise<boolean> {
  if (!HELIUS_API_KEY || !NFT_COLLECTION_ADDRESS || !nftMint) return false;
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mint-check",
        method: "getAsset",
        params: { id: nftMint },
      }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    const grouping: { group_key: string; group_value: string }[] =
      json?.result?.grouping ?? [];
    return grouping.some(
      (g) => g.group_key === "collection" && g.group_value === NFT_COLLECTION_ADDRESS
    );
  } catch {
    return false;
  }
}

/**
 * Shorten a wallet address for display: "8xKp...3fQa"
 */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
