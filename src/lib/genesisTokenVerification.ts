/**
 * Genesis Token Verification Service
 *
 * Gates the Genesis Chat tier: wallets holding a Saga Genesis Token OR a
 * Seeker Genesis Token (soulbound proof of owning a Solana phone) but NOT a
 * Saga Monke get read-only access to Genesis Chat + BananaShop + Leaderboard.
 *
 * Saga Genesis Token: standard Metaplex collection NFT, collection address
 * confirmed by the project owner 2026-08-20 — 46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC.
 * Verified the same way as Saga Monkes (DAS collection grouping).
 *
 * Seeker Genesis Token: Token-2022, mint authority GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4
 * (confirmed against docs.solanamobile.com 2026-08-20). Reuses hasSeekerGenesisToken()
 * from seekerGenesisToken.ts, which was previously informational-only — this is
 * its first use as an actual access gate.
 */

import {
  HELIUS_NFT_API_KEY,
  HELIUS_NFT_RPC_URL,
  QUICKNODE_DAS_URL,
  ALCHEMY_DAS_URL,
} from "./constants";
import { hasSeekerGenesisToken } from "./seekerGenesisToken";

export const SAGA_GENESIS_COLLECTION_ADDRESS = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";

const TIMEOUT_MS = 15_000;

export type GenesisTokenKind = "saga" | "seeker" | null;

export interface GenesisVerificationResult {
  verified: boolean;
  kind: GenesisTokenKind;
}

async function fetchWithAbort(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hasCollectionGrouping(items: any[], collection: string): boolean {
  return items.some((asset: any) =>
    (asset.grouping ?? []).some(
      (g: any) => g.group_key === "collection" && g.group_value === collection,
    ),
  );
}

async function walletHoldsCollectionViaHelius(walletAddress: string, collection: string): Promise<boolean> {
  const res = await fetchWithAbort(HELIUS_NFT_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "searchAssets",
      params: {
        ownerAddress: walletAddress,
        grouping: ["collection", collection],
        page: 1,
        limit: 50,
      },
    }),
  });
  if (!res.ok) throw new Error(`Helius API error: ${res.status}`);
  const json = await res.json();
  const items: any[] = json?.result?.items ?? [];
  if (hasCollectionGrouping(items, collection)) return true;

  // Fallback: some cNFT groupings don't surface via searchAssets — confirm with getAssetsByOwner.
  const res2 = await fetchWithAbort(HELIUS_NFT_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000,
        displayOptions: { showCollectionMetadata: false, showUnverifiedCollections: true, showFungible: false },
      },
    }),
  });
  if (!res2.ok) return false;
  const json2 = await res2.json();
  return hasCollectionGrouping(json2?.result?.items ?? [], collection);
}

async function walletHoldsCollectionViaQuickNode(walletAddress: string, collection: string): Promise<boolean> {
  const res = await fetchWithAbort(QUICKNODE_DAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000,
        displayOptions: { showCollectionMetadata: false, showUnverifiedCollections: true, showFungible: false },
      },
    }),
  });
  if (!res.ok) throw new Error(`QuickNode API error: ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`QuickNode RPC error: ${JSON.stringify(json.error)}`);
  return hasCollectionGrouping(json?.result?.items ?? [], collection);
}

async function walletHoldsCollectionViaAlchemy(walletAddress: string, collection: string): Promise<boolean> {
  const res = await fetchWithAbort(ALCHEMY_DAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "getAssetsByOwner",
      // Alchemy's DAS uses positional params, not a named object — see nftVerification.ts.
      params: [
        walletAddress,
        { sortBy: "created", sortDirection: "asc" },
        1000,
        1,
        null,
        null,
        { showCollectionMetadata: false, showUnverifiedCollections: true, showFungible: false },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`Alchemy RPC error: ${JSON.stringify(json.error)}`);
  return hasCollectionGrouping(json?.result?.items ?? [], collection);
}

/** Verify a wallet holds a Saga Genesis Token — Helius → QuickNode → Alchemy → false. */
export async function verifySagaGenesisToken(walletAddress: string): Promise<boolean> {
  if (!walletAddress) return false;
  if (HELIUS_NFT_API_KEY) {
    try {
      return await walletHoldsCollectionViaHelius(walletAddress, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* fall through */ }
  }
  if (QUICKNODE_DAS_URL) {
    try {
      return await walletHoldsCollectionViaQuickNode(walletAddress, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* fall through */ }
  }
  if (ALCHEMY_DAS_URL) {
    try {
      return await walletHoldsCollectionViaAlchemy(walletAddress, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* all providers failed */ }
  }
  return false;
}

/**
 * Check whether a wallet is eligible for Genesis Chat: holds a Saga Genesis Token
 * OR a Seeker Genesis Token. Checked independently (Saga first, since it's the
 * cheaper single DAS call) — the first hit wins.
 */
export async function verifyGenesisTokenOwnership(walletAddress: string): Promise<GenesisVerificationResult> {
  if (!walletAddress) return { verified: false, kind: null };
  if (await verifySagaGenesisToken(walletAddress)) return { verified: true, kind: "saga" };
  if (await hasSeekerGenesisToken(walletAddress)) return { verified: true, kind: "seeker" };
  return { verified: false, kind: null };
}
