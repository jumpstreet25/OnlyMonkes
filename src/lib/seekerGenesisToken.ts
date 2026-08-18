/**
 * seekerGenesisToken.ts — best-effort "this wallet is associated with a genuine Seeker
 * device" signal, based on ownership of a Seeker Genesis Token (SGT).
 *
 * NOT a hard gate, and never used to block entitlement or batch acceptance. SGTs are
 * transferable Token-2022 NFTs, so holding one only proves the connected wallet holds a
 * token that was minted to *some* genuine Seeker at some point — not that THIS specific
 * device is that Seeker. Informational only, surfaced in the Data Oracle consent copy.
 *
 * SGT mint authority per public research (Aug 2026):
 * GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4 — reconfirm against
 * docs.solanamobile.com/solana-mobile-stack/seeker-genesis-token before relying on this for
 * anything beyond an informational badge.
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
