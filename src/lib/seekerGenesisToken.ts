/**
 * seekerGenesisToken.ts — ownership check for the Seeker Genesis Token (SGT).
 *
 * Two callers, two trust levels:
 *  - Data Oracle consent copy (original use): informational only, NOT a hard gate —
 *    SGTs are transferable Token-2022 NFTs, so holding one only proves the connected
 *    wallet holds a token that was minted to *some* genuine Seeker at some point, not
 *    that THIS specific device is that Seeker.
 *  - genesisTokenVerification.ts's Genesis Chat gate (added 2026-08-20): SGT is
 *    soulbound to the Seeker (not sold on markets). The gate checks that THIS
 *    connected wallet currently holds it. Periodic re-check is for wallet-switch
 *    / stale session flags, not for a resale path.
 *
 * SGT mint authority confirmed against docs.solanamobile.com/marketing/engaging-seeker-users
 * (2026-08-20): GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { HELIUS_RPC_URL } from "./constants";

const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
const CACHE_TTL_MS = 6 * 3600 * 1000;

let _cache: { wallet: string; hasSgt: boolean; checkedAt: number } | null = null;

export async function hasSeekerGenesisToken(walletAddress: string): Promise<boolean> {
  if (_cache && _cache.wallet === walletAddress && Date.now() - _cache.checkedAt < CACHE_TTL_MS) {
    return _cache.hasSgt;
  }
  try {
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const owner = new PublicKey(walletAddress);
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const mints = resp.value
      .map((a) => a.account.data.parsed?.info?.mint as string | undefined)
      .filter((m): m is string => !!m);
    if (mints.length === 0) {
      _cache = { wallet: walletAddress, hasSgt: false, checkedAt: Date.now() };
      return false;
    }

    const mintInfos = await connection.getMultipleParsedAccounts(mints.map((m) => new PublicKey(m)));
    const hasSgt = mintInfos.value.some((info) => {
      const parsed = (info?.data as { parsed?: { info?: { mintAuthority?: string } } } | undefined)?.parsed;
      return parsed?.info?.mintAuthority === SGT_MINT_AUTHORITY;
    });

    _cache = { wallet: walletAddress, hasSgt, checkedAt: Date.now() };
    return hasSgt;
  } catch {
    // Informational only — fail closed to "unknown/false", never throw into a gating path.
    return false;
  }
}
