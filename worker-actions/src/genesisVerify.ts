/**
 * genesisVerify.ts — worker-side port of Genesis Token ownership checks.
 *
 * Until now this logic only existed app-side (src/lib/genesisTokenVerification.ts) and
 * bot-side (agents/monke-trader/src/lib/nft/genesisGate.ts) — Device Integrity Attestation
 * needs it worker-side too, since the worker is what issues the device-integrity verdict and
 * must independently confirm holder tier rather than trusting a client-claimed one.
 *
 * Saga Genesis Token: standard Metaplex collection NFT, collection address
 * 46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC (confirmed 2026-08-20, same as the app-side
 * constant). Verified the same way as Saga Monkes (DAS collection grouping).
 *
 * Seeker Genesis Token: Token-2022, mint authority GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4
 * (confirmed against docs.solanamobile.com 2026-08-20). Direct on-chain check — no DAS needed.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { Env } from "./index";
import { rpcUrl, verifyRpcUrl, fetchWithTimeout } from "./index";

export const SAGA_GENESIS_COLLECTION_ADDRESS = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";
const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
const DAS_TIMEOUT_MS = 12_000;

function hasCollectionGrouping(items: any[], collection: string): boolean {
  return items.some((asset: any) =>
    (asset.grouping ?? []).some(
      (g: any) => g?.group_key === "collection" && g?.group_value === collection,
    ),
  );
}

async function searchCollectionViaHeliusStyle(
  url: string,
  wallet: string,
  collection: string,
): Promise<boolean> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "searchAssets",
      params: { ownerAddress: wallet, grouping: ["collection", collection], page: 1, limit: 10 },
    }),
  }, DAS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data?.error) throw new Error(`RPC ${String(data.error.message ?? data.error).slice(0, 120)}`);
  return hasCollectionGrouping(data?.result?.items ?? [], collection);
}

// Alchemy's DAS diverges from Helius/QuickNode: positional params, no searchAssets support —
// same divergence already documented in index.ts's dasParams()/fetchOwnedMonke() Alchemy tier.
async function searchCollectionViaAlchemy(
  url: string,
  wallet: string,
  collection: string,
): Promise<boolean> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "genesis-gate",
      method: "getAssetsByOwner",
      params: [wallet, { sortBy: "created", sortDirection: "asc" }, 1000, 1, null, null],
    }),
  }, DAS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data?.error) throw new Error(`RPC ${String(data.error.message ?? data.error).slice(0, 120)}`);
  return hasCollectionGrouping(data?.result?.items ?? [], collection);
}

/** Verify a wallet holds a Saga Genesis Token — Helius → QuickNode → Alchemy → false. */
export async function verifySagaGenesisToken(wallet: string, env: Env): Promise<boolean> {
  if (!wallet) return false;
  if (env.HELIUS_API_KEY || env.HELIUS_NFT_API_KEY) {
    try {
      return await searchCollectionViaHeliusStyle(verifyRpcUrl(env), wallet, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* fall through */ }
  }
  if (env.QUICKNODE_DAS_URL) {
    try {
      return await searchCollectionViaHeliusStyle(env.QUICKNODE_DAS_URL, wallet, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* fall through */ }
  }
  if (env.ALCHEMY_API_KEY) {
    try {
      const alchemyUrl = `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
      return await searchCollectionViaAlchemy(alchemyUrl, wallet, SAGA_GENESIS_COLLECTION_ADDRESS);
    } catch { /* all providers failed */ }
  }
  return false;
}

/**
 * Verify a wallet holds the Seeker Genesis Token — direct on-chain Token-2022 mint-authority
 * check, no DAS needed. Uses the general RPC key (not the isolated verify key) since this is a
 * plain getParsedTokenAccountsByOwner call, same tier as other general RPC reads.
 */
export async function hasSeekerGenesisToken(wallet: string, env: Env): Promise<boolean> {
  if (!wallet) return false;
  try {
    const connection = new Connection(rpcUrl(env), "confirmed");
    const owner = new PublicKey(wallet);
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const mints = resp.value
      .map((a) => a.account.data.parsed?.info?.mint as string | undefined)
      .filter((m): m is string => !!m);
    if (mints.length === 0) return false;

    const mintInfos = await connection.getMultipleParsedAccounts(mints.map((m) => new PublicKey(m)));
    return mintInfos.value.some((info) => {
      const parsed = (info?.data as { parsed?: { info?: { mintAuthority?: string } } } | undefined)?.parsed;
      return parsed?.info?.mintAuthority === SGT_MINT_AUTHORITY;
    });
  } catch {
    // Fail closed to "unknown/false" — never throw into a gating path.
    return false;
  }
}

export type GenesisTokenKind = "saga" | "seeker" | null;

/**
 * Check whether a wallet is eligible as a Genesis holder: Saga Genesis Token OR Seeker Genesis
 * Token. Saga checked first (cheaper single DAS call) — first hit wins. Mirrors the app-side
 * verifyGenesisTokenOwnership()'s ordering.
 */
export async function verifyGenesisTokenOwnership(
  wallet: string,
  env: Env,
): Promise<{ verified: boolean; kind: GenesisTokenKind }> {
  if (!wallet) return { verified: false, kind: null };
  if (await verifySagaGenesisToken(wallet, env)) return { verified: true, kind: "saga" };
  if (await hasSeekerGenesisToken(wallet, env)) return { verified: true, kind: "seeker" };
  return { verified: false, kind: null };
}
