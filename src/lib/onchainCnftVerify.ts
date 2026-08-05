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
 * 2026-07-23: the RPC transport underneath this (getConnection() below) was
 * switched from the free public RPC to HELIUS_RPC_URL after the public
 * endpoint's aggressive rate-limiting (documented on withRetry() below)
 * stalled real device testing. Trade-off, explicitly accepted at the time:
 * this path is reached specifically when Helius's DAS API has ALREADY
 * failed/errored on the same request (see verifyNFTOwnership() in
 * nftVerification.ts — on-chain only runs when Helius didn't cleanly
 * answer), so during an actual account-wide Helius outage like 2026-07-11's,
 * this fallback would now likely fail in lockstep with it rather than
 * surviving independently, which was the original point of building it this
 * way. If Helius has another outage and this stops being a working
 * fallback, that's why — revisit RPC choice then (QuickNode's general RPC,
 * if it has one, would restore true independence).
 *
 * Instruction account layouts below were confirmed against real on-chain
 * transactions for this collection's genesis tree, not assumed from docs:
 *   Transfer:  [tree_authority, leaf_owner, leaf_delegate, new_leaf_owner,
 *               merkle_tree, log_wrapper, compression_program, system_program, ...proof]
 *   (tx 4YPEg1QBq9RT63YB3JoA37uyEAQPsB7W3gvxnNQx2hyUQZdvKF6k9chVAGYaom3vkX39YBLuunShXqwmBmErzirQ)
 */

import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { HELIUS_RPC_URL } from "./constants";

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

// 2026-07-23: was the free public RPC (api.mainnet-beta.solana.com) — see
// the module doc above for why that changed and the trade-off it accepts.
const RPC_URL = HELIUS_RPC_URL;
const MAX_SIGNATURE_PAGES = 20; // 20 * 100 = 2000 signatures deep, bounds worst-case latency
const PAGE_SIZE = 100;

let _connection: Connection | null = null;
function getConnection(): Connection {
  if (!_connection) _connection = new Connection(RPC_URL, "confirmed");
  return _connection;
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

  // Burn/MintV1/Delegate/CancelRedeem/Redeem/DecompressV1/Compress/etc. —
  // discriminators not yet verified against real transactions for this
  // collection, so deliberately not hardcoded/guessed here (a wrong
  // discriminator could misclassify an instruction). Unrecognized
  // instructions are a safe "keep scanning further back", not a signal
  // either way.
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
  const connection = getConnection();
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
          connection.getSignaturesForAddress(owner, { before, limit: PAGE_SIZE }),
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
              connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 }),
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
