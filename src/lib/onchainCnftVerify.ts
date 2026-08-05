/**
 * onchainCnftVerify.ts — Direct on-chain compressed-NFT ownership check for
 * Saga Monkes, with zero dependency on any third-party DAS indexer
 * (Helius/QuickNode/Shyft) for the *lookup logic* — this reconstructs
 * ownership from raw transaction history rather than trusting an indexer's
 * "does wallet X hold a leaf" answer.
 *
 * Why this exists: Saga Monkes are compressed NFTs (cNFTs). A Merkle tree
 * account only stores a root hash + a small recent-changes buffer — it does
 * NOT store "leaf N is owned by wallet X" in a directly readable way. That
 * only exists in the tree's transaction history, which is normally
 * reconstructed by a persistent indexer (Helius/Shyft DAS). 2026-07-11: the
 * shared Helius account hit its monthly usage cap (not just rate-limited —
 * a second "dedicated" key on the same account got the same "max usage
 * reached" error, confirming the cap is account-wide) and Shyft has no
 * working DAS/compression endpoint for this collection, so NFT verification
 * had zero working providers.
 *
 * Rather than running a persistent indexer (LightDAS + Postgres + a DAS API
 * server) just to answer "does wallet X currently hold a leaf in tree Y",
 * this does the equivalent lookup on demand: scan the wallet's own recent
 * transaction history for Bubblegum instructions touching a known Saga
 * Monkes tree, and read the most recent one to determine current ownership.
 * Slower per check than an indexed lookup, but needs no indexer
 * infrastructure.
 *
 * 2026-07-23: the RPC transport underneath this was switched from the free
 * public RPC to HELIUS_RPC_URL after the public endpoint's aggressive
 * rate-limiting (documented on withRetry() below) stalled real device
 * testing — but since this path is reached specifically when Helius's DAS
 * API has ALREADY failed/errored on the same request (see
 * verifyNFTOwnership() in nftVerification.ts), pinning the fallback's own
 * transport to Helius meant it failed in lockstep with the tiers above it
 * during an account-wide Helius outage, defeating the point of building it
 * independently in the first place.
 *
 * 2026-08-05: fixed — RPC_URLS is now an ordered list (free public first,
 * QuickNode second, Helius last), with withRetry() rotating to the next
 * provider on every failed attempt instead of hammering one dead endpoint.
 * See RPC_URLS/currentConnection()/rotateRpc() below.
 *
 * Instruction account layouts below were confirmed against real on-chain
 * transactions for this collection's genesis tree, not assumed from docs:
 *   Transfer:  [tree_authority, leaf_owner, leaf_delegate, new_leaf_owner,
 *               merkle_tree, log_wrapper, compression_program, system_program, ...proof]
 *   (tx 4YPEg1QBq9RT63YB3JoA37uyEAQPsB7W3gvxnNQx2hyUQZdvKF6k9chVAGYaom3vkX39YBLuunShXqwmBmErzirQ)
 */

import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { HELIUS_RPC_URL, QUICKNODE_DAS_URL, SOLANA_RPC_URL } from "./constants";

const BUBBLEGUM_PROGRAM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";

// Anchor 8-byte instruction discriminators, decoded directly from real
// on-chain instruction data for this collection (not assumed from an IDL).
// Deliberately NOT using human-readable program logs to identify
// instruction type — logs are best-effort debug output and were observed
// coming back incomplete/unreliable under RPC load, which silently broke
// detection. Discriminator bytes are protocol-level and don't have that
// failure mode.
const DISCRIMINATOR_TRANSFER = "a334c8e78c0345ba";
const DISCRIMINATOR_MINT_TO_COLLECTION_V1 = "9912b22fc59e560f";

// 2026-08-05: the five below were computed from the canonical program IDL
// (github.com/metaplex-foundation/mpl-bubblegum, idls/bubblegum.json) via
// the standard Anchor sighash formula sha256("global:<snake_case_name>")[0:8]
// — verified by reproducing the two discriminators above EXACTLY from the
// same formula before trusting it for the rest. Account orderings below are
// also pulled directly from that IDL's `accounts` arrays, not guessed.
// DecompressV1 deliberately has no discriminator constant here: its accounts
// list doesn't include the merkle tree account at all, so this file's own
// tree-membership filter (`ixAccounts.find(a => SAGA_MONKES_TREES.has(a))`)
// can never match it — interpretBubblegumInstruction() is structurally
// unreachable for that instruction regardless of whether we decode it.
const DISCRIMINATOR_BURN = "746e1d386bdb2a5d";
const DISCRIMINATOR_DELEGATE = "5a934bb255580489";
const DISCRIMINATOR_CANCEL_REDEEM = "6f4ce83227af30f2";
const DISCRIMINATOR_REDEEM = "b80c569546c461e1";
const DISCRIMINATOR_COMPRESS = "52c1b075b01573fd";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str: string): Uint8Array {
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base58 char: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of str) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

function instructionDiscriminator(dataBase58: string): string | null {
  try {
    const bytes = base58Decode(dataBase58);
    if (bytes.length < 8) return null;
    return Buffer.from(bytes.slice(0, 8)).toString("hex");
  } catch {
    return null;
  }
}

// Transfer instruction data layout (Anchor fixed-field serialization, no
// length prefixes): 8-byte discriminator + root[32] + data_hash[32] +
// creator_hash[32] + nonce(u64 LE) + index(u32 LE). Verified byte-for-byte
// against the real transfer tx referenced in the module doc: total length
// 116 bytes matched exactly, and the nonce decoded at this offset equals the
// index field (both 8978), which is the expected relationship for a leaf
// that has never been re-indexed by a tree resize.
// `nonce` uniquely identifies one specific leaf/asset in the tree — without
// it, a Transfer-away of ONE asset a wallet holds looks identical to the
// wallet giving up its ONLY asset, which is the root cause of the
// multi-asset false-negative this decode exists to fix.
function decodeTransferNonce(dataBase58: string): string | null {
  try {
    const bytes = base58Decode(dataBase58);
    const nonceOffset = 8 + 32 + 32 + 32;
    if (bytes.length < nonceOffset + 8) return null;
    let nonce = 0n;
    for (let i = 7; i >= 0; i--) nonce = (nonce << 8n) | BigInt(bytes[nonceOffset + i]);
    return nonce.toString();
  } catch {
    return null;
  }
}

/**
 * Known Saga Monkes trees. The genesis tree (Jan 2024, 8,888 mints) is
 * confirmed on-chain. The Dec 2025 "tech noir" expansion (1,026 more) may
 * live in a second tree that hasn't been traced yet — if a legitimate
 * holder from that batch fails this check, that's the likely reason.
 */
const SAGA_MONKES_TREES = new Set(["2uH9TkmYkAKGrK7EPnd4Y7JVYswpQ2aED9deMn8QoYVy"]);

// 2026-08-05: was pinned to HELIUS_RPC_URL alone (see the 2026-07-23 note
// above) — meant this "independent on-chain fallback" tier actually failed
// in lockstep with the Helius DAS tiers above it during an account-wide
// Helius outage, defeating the whole point of building it. Now an ordered
// list, free-tier public RPC first (genuinely no shared quota with either
// DAS provider), QuickNode second (separate quota from Helius — its DAS
// add-on URL also serves plain JSON-RPC methods like getSignaturesForAddress/
// getParsedTransaction), Helius last since by the time this tier is reached
// (see verifyNFTOwnership() in nftVerification.ts) Helius DAS has usually
// already failed for this same request. withRetry() below rotates to the
// next URL on every failed attempt rather than hammering one dead endpoint.
const RPC_URLS: string[] = [SOLANA_RPC_URL, QUICKNODE_DAS_URL, HELIUS_RPC_URL].filter(
  (u): u is string => !!u,
);
const MAX_SIGNATURE_PAGES = 20; // 20 * 100 = 2000 signatures deep, bounds worst-case latency
const PAGE_SIZE = 100;

let _rpcIndex = 0;
const _connections = new Map<string, Connection>();
function currentConnection(): Connection {
  const url = RPC_URLS[_rpcIndex % RPC_URLS.length];
  let c = _connections.get(url);
  if (!c) {
    c = new Connection(url, "confirmed");
    _connections.set(url, c);
  }
  return c;
}
function rotateRpc(): void {
  _rpcIndex = (_rpcIndex + 1) % RPC_URLS.length;
}

// 2026-07-30: neither RPC call below had any timeout — @solana/web3.js's
// Connection falls back to the RN global fetch with no built-in deadline.
// withRetry() only catches REJECTED promises; if the RPC call simply
// stalls (no response, no error) rather than erroring, `await` never
// returns and the retry loop never even gets a chance to run, hanging
// verifyNFTOwnership() -> useNFTVerification -> VerifyScreen forever on
// "Verifying NFT ownership…" with no error ever shown. Flagged as a known
// gap back on 2026-07-12 (see project memory) but never closed until now.
// Deliberately a Promise.race timeout, NOT AbortSignal.timeout() — that API
// throws on Hermes and gets silently swallowed elsewhere in this codebase.
const RPC_TIMEOUT_MS = 15_000;
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Originally tuned for the free public RPC, which was observed rate-limiting
// in bursts of 20-40+ consecutive 429s before responding — a short retry
// budget (originally 4 attempts, ~3s total) bailed out and reported
// "inconclusive" almost every time under real conditions, which read as
// "verification keeps failing/retrying" to the user even though the check
// itself was correct. Pushing through with more patience worked — confirmed
// empirically during testing. Left at 12 attempts after the RPC_URL swap to
// Helius above — general resilience against transient errors is still
// worth keeping even though Helius rate-limits far less aggressively.
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 12): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Rotate to the next RPC provider before the next attempt — a failing
      // endpoint gets retried on a DIFFERENT provider instead of hammering
      // the same dead one for all 12 attempts.
      rotateRpc();
      if (attempt < maxAttempts) {
        const backoff = Math.min(500 * attempt, 6_000);
        const jitter = Math.random() * 300;
        await new Promise((r) => setTimeout(r, backoff + jitter));
      }
    }
  }
  throw lastErr;
}

type BubblegumSignal =
  | { kind: "holds"; assetHint: string; nonce: string | null }
  | { kind: "gave_up"; nonce: string | null }
  | { kind: "inconclusive" };

/**
 * Inspect a single Bubblegum instruction (already confirmed to reference one
 * of our known trees) and decide what it tells us about whether
 * `walletAddress` currently holds a leaf in that tree.
 *
 * A wallet can hold MULTIPLE distinct leaves (assets) in the same tree.
 * Every signal here is per-leaf (identified by `nonce`, when decodable) —
 * the caller is responsible for tracking per-nonce state across the scan
 * rather than treating any single signal as decisive for the whole wallet.
 */
function interpretBubblegumInstruction(
  dataBase58: string,
  accounts: string[],
  walletAddress: string,
): BubblegumSignal {
  const disc = instructionDiscriminator(dataBase58);

  if (disc === DISCRIMINATOR_TRANSFER) {
    // Confirmed layout: [tree_authority, leaf_owner, leaf_delegate, new_leaf_owner, merkle_tree, ...]
    const leafOwner = accounts[1];
    const newLeafOwner = accounts[3];
    const nonce = decodeTransferNonce(dataBase58);
    if (newLeafOwner === walletAddress) return { kind: "holds", assetHint: accounts[4] ?? "", nonce };
    if (leafOwner === walletAddress) return { kind: "gave_up", nonce };
    return { kind: "inconclusive" };
  }

  if (disc === DISCRIMINATOR_MINT_TO_COLLECTION_V1) {
    // Mints for this collection were observed going to an intermediary
    // distribution wallet, not directly to end holders (see module doc) —
    // so a mint match is a weak, best-effort signal only. A later Transfer
    // (checked first, since we scan newest-first) always takes precedence.
    if (accounts.includes(walletAddress)) return { kind: "holds", assetHint: "", nonce: null };
    return { kind: "inconclusive" };
  }

  // Same arg layout as Transfer (root+dataHash+creatorHash+nonce+index,
  // confirmed against the IDL) — decodeTransferNonce() works unchanged.
  // Accounts: [tree_authority, leaf_owner, leaf_delegate, merkle_tree, ...]
  if (disc === DISCRIMINATOR_BURN) {
    // Unambiguous: burn permanently destroys the leaf/asset — unlike Redeem
    // (below), there's no decompressed form it could still exist as. Safe
    // to treat as a definitive give-up.
    const leafOwner = accounts[1];
    const nonce = decodeTransferNonce(dataBase58);
    if (leafOwner === walletAddress) return { kind: "gave_up", nonce };
    return { kind: "inconclusive" };
  }

  if (disc === DISCRIMINATOR_DELEGATE) {
    // Accounts: [tree_authority, leaf_owner, previous_leaf_delegate,
    // new_leaf_delegate, merkle_tree, ...] — leaf_owner never changes here,
    // only who's delegated to act on the leaf. Carries no ownership signal;
    // explicitly classified (rather than falling through as "unrecognized")
    // purely for documentation — behavior is the same either way.
    return { kind: "inconclusive" };
  }

  if (disc === DISCRIMINATOR_CANCEL_REDEEM) {
    // Args are just `root` — no nonce field, so we can't identify which
    // leaf this refers to even if we wanted to. Also carries no ownership
    // signal regardless (cancels a pending Redeem, returning the leaf to
    // normal in-tree state under the same leaf_owner at accounts[1]).
    return { kind: "inconclusive" };
  }

  if (disc === DISCRIMINATOR_REDEEM) {
    // Same arg layout as Transfer, so the nonce IS decodable — but
    // deliberately NOT treated as "gave_up". Redeem moves a leaf out of the
    // compressed tree into a pending-decompress "voucher" state; the wallet
    // very plausibly still holds the asset moments later as a normal SPL
    // NFT (see DecompressV1's own doc note above — that follow-up
    // instruction can't even be observed by this scanner since its accounts
    // never include the merkle tree). Reporting "gave_up" here risks a false
    // negative against a wallet that's still a legitimate holder, which is
    // exactly the failure mode this file's own doc/comments elsewhere are
    // built to avoid — so this stays "inconclusive" and the scan keeps
    // looking further back for a clearer signal.
    return { kind: "inconclusive" };
  }

  if (disc === DISCRIMINATOR_COMPRESS) {
    // No args at all (confirmed against the IDL) — no nonce available,
    // same as MintToCollectionV1 above. This is the reverse of Redeem: an
    // existing decompressed SPL NFT is being compressed INTO the tree, so
    // accounts[1] (leaf_owner) now genuinely holds a leaf. Mirrors the mint
    // case's nonce-null "holds" handling exactly.
    const leafOwner = accounts[1];
    if (leafOwner === walletAddress) return { kind: "holds", assetHint: accounts[3] ?? "", nonce: null };
    return { kind: "inconclusive" };
  }

  // MintV1/DecompressV1/etc. — remaining discriminators either not verified
  // against real transactions for this collection, or (DecompressV1)
  // structurally unreachable here — see the module-level discriminator
  // comment above. Unrecognized instructions are a safe "keep scanning
  // further back", not a signal either way.
  return { kind: "inconclusive" };
}

/**
 * Scan `walletAddress`'s recent transaction history for the most recent
 * Bubblegum event touching a known Saga Monkes tree, and determine current
 * ownership from it. Returns null if inconclusive within the scan depth
 * (not evidence of non-ownership — just means the answer wasn't found in
 * the signatures checked).
 */
export async function verifySagaMonkeOnChain(
  walletAddress: string,
): Promise<{ verified: boolean; assetId: string | null; inconclusive: boolean; error?: string }> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    return { verified: false, assetId: null, inconclusive: false, error: "Invalid wallet address" };
  }

  let before: string | undefined;
  // A wallet can hold multiple distinct leaves (assets) in the same tree.
  // We scan newest-first, so the FIRST time we see a given nonce is its
  // current status. Giving up one asset (a "gave_up" signal for nonce A)
  // says nothing about whether the wallet still holds a DIFFERENT asset
  // (nonce B) — so a gave_up no longer short-circuits the scan. We only
  // stop early on a "holds" signal, since holding even one currently-owned
  // leaf is sufficient for verification.
  const resolvedGaveUpNonces = new Set<string>();
  let reachedFullHistory = false;

  try {
    for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
      const sigs = await withRetry(() =>
        withTimeout(
          currentConnection().getSignaturesForAddress(owner, { before, limit: PAGE_SIZE }),
          RPC_TIMEOUT_MS,
          "getSignaturesForAddress",
        ),
      );
      if (sigs.length === 0) {
        reachedFullHistory = true;
        break;
      }
      before = sigs[sigs.length - 1].signature;

      for (const sigInfo of sigs) {
        if (sigInfo.err) continue;

        // A failed fetch here must NOT be silently skipped — skipping could
        // cause us to miss the true most recent event (e.g. a transfer-away)
        // and fall through to a stale "holds" signal from an older
        // transaction, a false positive. Halt and report inconclusive
        // instead of guessing past a gap in what we were able to check.
        let tx: ParsedTransactionWithMeta | null;
        try {
          tx = await withRetry(() =>
            withTimeout(
              currentConnection().getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 }),
              RPC_TIMEOUT_MS,
              "getParsedTransaction",
            ),
          );
        } catch (err) {
          return {
            verified: false,
            assetId: null,
            inconclusive: true,
            error: `Fetch failed at signature ${sigInfo.signature}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        if (!tx) continue; // confirmed absent (e.g. pruned), safe to skip — not a fetch failure

        const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
        if (!keys.includes(BUBBLEGUM_PROGRAM)) continue;

        const bubblegumIx = tx.transaction.message.instructions.find(
          (ix) => "programId" in ix && ix.programId.toBase58() === BUBBLEGUM_PROGRAM,
        ) as { accounts?: PublicKey[]; data?: string } | undefined;
        if (!bubblegumIx?.accounts || !bubblegumIx.data) continue;

        const ixAccounts = bubblegumIx.accounts.map((a) => a.toBase58());
        const treeInIx = ixAccounts.find((a) => SAGA_MONKES_TREES.has(a));
        if (!treeInIx) continue; // this Bubblegum tx is for a different tree/collection

        const signal = interpretBubblegumInstruction(
          bubblegumIx.data,
          ixAccounts,
          walletAddress,
        );
        if (signal.kind === "holds") {
          return { verified: true, assetId: signal.assetHint || null, inconclusive: false };
        }
        if (signal.kind === "gave_up") {
          // Record this specific leaf as resolved (given up) and keep
          // scanning — other nonces may still be currently held. Only the
          // FIRST time we see a given nonce is meaningful (newest-first),
          // but since we never revisit a nonce after resolving it, a raw
          // Set is sufficient without needing to check for duplicates.
          if (signal.nonce) resolvedGaveUpNonces.add(signal.nonce);
        }
        // inconclusive — keep scanning further back for an earlier, clearer signal
      }
    }
  } catch (err) {
    return {
      verified: false,
      assetId: null,
      inconclusive: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // No "holds" signal found for any leaf within the scan. Only confidently
  // report "not a holder" if we scanned the wallet's ENTIRE transaction
  // history (reachedFullHistory) — otherwise older, unscanned activity
  // could still contain a currently-held leaf, and reporting a confident
  // false here would be a false negative (this is exactly the bug that
  // broke verification for wallets holding multiple Saga Monkes, where the
  // most recent tree activity happened to be giving up just one of them).
  if (reachedFullHistory && resolvedGaveUpNonces.size > 0) {
    return { verified: false, assetId: null, inconclusive: false };
  }

  // Either the scan depth cap was hit before reaching full history, or no
  // Bubblegum activity for this tree was seen at all — genuinely unknown,
  // not evidence of non-ownership. Caller should treat like a provider error.
  return { verified: false, assetId: null, inconclusive: true };
}
