/**
 * nftSwap.ts — Atomic cNFT ↔ SKR swap via single Solana transaction
 *
 * Both the NFT transfer (seller→buyer) and SKR transfer (buyer→seller)
 * are bundled into ONE transaction. Either both succeed or both fail.
 *
 * 2026-09-11: settlement currency changed from native SOL to the SKR SPL
 * token — MonkeMarkets is SKR-only now (single settlement currency, no more
 * dual SOL/SKR listing modes). A SOL-equivalent price is still shown in the
 * UI for reference (see fetchSolSkrRate below) but every actual transfer in
 * this file moves SKR, not SOL.
 *
 * Flow:
 *   1. Buyer builds the full swap tx (NFT transfer + SKR transfer)
 *   2. Buyer signs via MWA and submits to network
 *   3. Seller's NFT is transferred atomically with SKR payment
 *
 * Security: The buyer builds and submits the transaction. The seller
 * must have already listed the NFT (proven by ownership check). The
 * transaction uses a Bubblegum transfer instruction which requires
 * the seller's signature — obtained via MWA on the seller's device
 * when they tap "Accept".
 *
 * NOTE: Since both parties need to sign and they're on different devices,
 * we use a two-phase approach:
 *   Phase 1 (Seller): Build tx → seller partially signs → serialize → send via XMTP
 *   Phase 2 (Buyer): Deserialize → validate → counter-sign → submit to network
 *
 * 2026-09-11: Saga Monkes are a compressed NFT (cNFT) collection — they live
 * as leaves in a Merkle tree under the Bubblegum program, not as regular SPL
 * token accounts. The previous version of this file used
 * createTransferCheckedInstruction against an Associated Token Account,
 * which doesn't resolve for a cNFT — every real swap would have failed on
 * submit. Rewritten to use Bubblegum's transfer instruction with a Merkle
 * proof fetched from Helius DAS (getAsset + getAssetProof).
 *
 * Verified against real on-chain data before trusting any of this (not
 * assumed from docs): the tree-authority PDA derivation, the transfer
 * instruction's account order, and — critically — that leafOwner/leafDelegate
 * MUST be a signer were all cross-checked against a real, confirmed Saga
 * Monkes transfer tx (4YPEg1QBq9RT63YB3JoA37uyEAQPsB7W3gvxnNQx2hyUQZdvKF6k9chVAGYaom3vkX39YBLuunShXqwmBmErzirQ).
 * That last point matters: @metaplex-foundation/mpl-bubblegum@0.7.0's
 * generated createTransferInstruction() marks every account isSigner:false
 * in its own codegen (a known quirk of that legacy Solita output) — without
 * manually patching the seller's key back to isSigner:true below, MWA would
 * have nothing to sign for the seller and the tx would fail on submit for a
 * missing signature every time.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  createTransferInstruction as createCompressedNftTransferInstruction,
  transferStruct,
  transferInstructionDiscriminator,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import { SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID } from "@solana/spl-account-compression";
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, DEV_WALLET, NFT_SALE_FEE_PCT, SKR_MINT, MONKE_LEDGER_URL } from "./constants";
import { fetchSolPriceUsd, fetchSkrPriceUsd } from "./solana";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "./security";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes-actions.jumpstreet25.workers.dev",
  icon: "favicon.ico",
};

/** Re-authorize with cached MWA auth token (matches solana.ts pattern). */
async function mwaAuthorize(mobileWallet: Web3MobileWallet): Promise<PublicKey> {
  const cachedToken = useAppStore.getState().mwaAuthToken;
  let addrRaw: string | Uint8Array;

  if (cachedToken) {
    try {
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
        auth_token: cachedToken,
      } as Parameters<typeof mobileWallet.authorize>[0]);
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    } catch {
      const result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    }
  } else {
    const result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
    useAppStore.getState().setMwaAuthToken(result.auth_token);
    addrRaw = result.accounts[0].address;
  }

  const pubkeyBytes = typeof addrRaw === "string" ? Buffer.from(addrRaw, "base64") : addrRaw;
  return new PublicKey(pubkeyBytes);
}

// ─── Ownership verification ──────────────────────────────────────────────────

/**
 * Verify the current on-chain owner of a specific NFT mint via Helius DAS.
 * Returns true only if the current owner matches the expected wallet.
 */
export async function verifyCurrentOwner(
  nftMint: string,
  expectedOwner: string,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "owner-check",
        method: "getAsset",
        params: { id: nftMint },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = await res.json() as {
      result?: { ownership?: { owner?: string } };
    };
    const owner = json?.result?.ownership?.owner;
    return owner === expectedOwner;
  } catch {
    return false;
  }
}

// ─── Build atomic swap transaction ──────────────────────────────────────────

export interface SwapParams {
  nftMint: string;         // cNFT asset ID (Helius DAS "id" — same string used by verifyCurrentOwner)
  sellerWallet: string;    // Seller's Solana wallet (base58)
  buyerWallet: string;     // Buyer's Solana wallet (base58)
  skrPrice: number;        // Price in SKR (whole tokens, not base units)
}

// SKR mint decimals are fetched once and cached (immutable) — mirrors the
// same pattern already used for Banana Shop's SKR payment path in solana.ts.
let _skrDecimalsCache: number | null = null;
async function getSkrDecimals(connection: Connection): Promise<number> {
  if (_skrDecimalsCache !== null) return _skrDecimalsCache;
  const info = await getMint(connection, new PublicKey(SKR_MINT));
  _skrDecimalsCache = info.decimals;
  return _skrDecimalsCache;
}

// Cache the SOL/SKR reference rate briefly — this is a DISPLAY-ONLY
// convenience ("≈0.60 SOL" next to a SKR-denominated listing), never used
// for the actual on-chain transfer amount, so a short staleness window is
// harmless. Avoids re-quoting Jupiter on every listing row render.
let _solSkrRateCache: { rate: number; fetchedAt: number } | null = null;
const SOL_SKR_RATE_TTL_MS = 60_000;

/**
 * SOL-per-SKR reference rate, for display only. Derived from two existing,
 * already-live Jupiter-quote price feeds (fetchSolPriceUsd / fetchSkrPriceUsd
 * in solana.ts, already used by Banana Shop) rather than a new price source.
 * Throws on failure — caller should fall back to showing SKR-only.
 */
export async function fetchSolSkrRate(): Promise<number> {
  const now = Date.now();
  if (_solSkrRateCache && now - _solSkrRateCache.fetchedAt < SOL_SKR_RATE_TTL_MS) {
    return _solSkrRateCache.rate;
  }
  const [solUsd, skrUsd] = await Promise.all([fetchSolPriceUsd(), fetchSkrPriceUsd()]);
  const rate = skrUsd / solUsd; // SOL per 1 SKR
  _solSkrRateCache = { rate, fetchedAt: now };
  return rate;
}

interface CompressionData {
  tree: PublicKey;
  root: number[];
  dataHash: number[];
  creatorHash: number[];
  nonce: number;
  index: number;
  proof: PublicKey[];
  leafOwner: PublicKey;
  leafDelegate: PublicKey;
}

/** 32-byte base58 hash string → plain byte array, the shape Bubblegum's Borsh args expect. */
function base58To32Bytes(s: string): number[] {
  const bytes = bs58.decode(s);
  if (bytes.length !== 32) throw new Error(`Expected 32-byte hash, got ${bytes.length} bytes`);
  return Array.from(bytes);
}

async function dasRpc<T>(method: string, params: object): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: "nftSwap", method, params }),
    });
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "unknown DAS error"}`);
    if (!json.result) throw new Error(`${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch everything needed to build a Bubblegum transfer for this cNFT: its tree, current
 * Merkle root, leaf hashes, and inclusion proof. A proof is only valid against the tree's
 * CURRENT root, so this can never be cached across a listing's lifetime.
 *
 * MonkeLedger (our own self-hosted indexer, isolated on its own VPS process — see
 * constants.ts) is the primary source: one call instead of two, and it doesn't cost either
 * of us a Helius request per swap attempt. Helius DAS is the fallback for when MonkeLedger
 * is unreachable, not ready yet, or doesn't have the asset (e.g. it's mid-refresh or the
 * asset isn't a Saga Monke) — same fields, sourced the original way.
 */
async function fetchCompressionDataFromMonkeLedger(assetId: string): Promise<CompressionData | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    let res: Response;
    try {
      res = await fetch(`${MONKE_LEDGER_URL}/compression/${assetId}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null; // 404/503/etc. — fall back to Helius, don't throw
    const data = (await res.json()) as {
      tree?: string; root?: string; dataHash?: string; creatorHash?: string;
      leafIndex?: number; proof?: string[]; owner?: string; delegate?: string | null;
    };
    if (!data.tree || !data.root || !data.dataHash || !data.creatorHash || data.leafIndex == null || !data.proof || !data.owner) {
      return null;
    }
    return {
      tree: new PublicKey(data.tree),
      root: base58To32Bytes(data.root),
      dataHash: base58To32Bytes(data.dataHash),
      creatorHash: base58To32Bytes(data.creatorHash),
      nonce: data.leafIndex,
      index: data.leafIndex,
      proof: data.proof.map((p) => new PublicKey(p)),
      leafOwner: new PublicKey(data.owner),
      leafDelegate: new PublicKey(data.delegate ?? data.owner),
    };
  } catch {
    return null; // network error, timeout, malformed response — fall back to Helius
  }
}

async function fetchCompressionDataFromHelius(assetId: string): Promise<CompressionData> {
  const asset = await dasRpc<{
    compression?: { compressed?: boolean; tree?: string; data_hash?: string; creator_hash?: string; leaf_id?: number };
    ownership?: { owner?: string; delegate?: string | null };
  }>("getAsset", { id: assetId });

  if (!asset.compression?.compressed) {
    throw new Error("Asset is not a compressed NFT — cannot build a Bubblegum transfer for it");
  }
  const { tree, data_hash, creator_hash, leaf_id } = asset.compression;
  if (!tree || !data_hash || !creator_hash || leaf_id == null) {
    throw new Error("DAS getAsset response missing compression fields");
  }
  const owner = asset.ownership?.owner;
  if (!owner) throw new Error("DAS getAsset response missing ownership.owner");

  const proofRes = await dasRpc<{ root?: string; proof?: string[] }>("getAssetProof", { id: assetId });
  if (!proofRes.root || !proofRes.proof) {
    throw new Error("DAS getAssetProof response missing root/proof");
  }

  return {
    tree: new PublicKey(tree),
    root: base58To32Bytes(proofRes.root),
    dataHash: base58To32Bytes(data_hash),
    creatorHash: base58To32Bytes(creator_hash),
    nonce: leaf_id,
    index: leaf_id,
    proof: proofRes.proof.map((p) => new PublicKey(p)),
    leafOwner: new PublicKey(owner),
    leafDelegate: new PublicKey(asset.ownership?.delegate ?? owner),
  };
}

async function fetchCompressionData(assetId: string): Promise<CompressionData> {
  const fromLedger = await fetchCompressionDataFromMonkeLedger(assetId);
  if (fromLedger) return fromLedger;
  return fetchCompressionDataFromHelius(assetId);
}

/**
 * Build the full atomic swap transaction:
 *   1. Transfer the cNFT leaf from seller → buyer via Bubblegum (requires
 *      the seller's signature)
 *   2. Create the buyer's, seller's, and dev wallet's SKR token accounts if
 *      they don't already exist (idempotent — no-op otherwise)
 *   3. Transfer SKR from buyer → seller, minus fee (requires buyer signature)
 *   4. Transfer the 2% fee (in SKR) from buyer → treasury/vault (DEV_WALLET)
 *
 * Returns the unsigned Transaction object. Caller must get both signatures.
 */
export async function buildSwapTransaction(params: SwapParams): Promise<{
  transaction: Transaction;
  blockhash: string;
}> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const sellerPk = new PublicKey(params.sellerWallet);
  const buyerPk = new PublicKey(params.buyerWallet);

  const comp = await fetchCompressionData(params.nftMint);
  if (!comp.leafOwner.equals(sellerPk)) {
    throw new Error("On-chain leaf owner does not match the expected seller — listing may be stale");
  }

  const [treeAuthority] = PublicKey.findProgramAddressSync([comp.tree.toBuffer()], BUBBLEGUM_PROGRAM_ID);
  const proofAccounts: AccountMeta[] = comp.proof.map((p) => ({ pubkey: p, isSigner: false, isWritable: false }));

  const transferIx = createCompressedNftTransferInstruction(
    {
      treeAuthority,
      leafOwner: sellerPk,
      leafDelegate: comp.leafDelegate,
      newLeafOwner: buyerPk,
      merkleTree: comp.tree,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      anchorRemainingAccounts: proofAccounts,
    },
    {
      root: comp.root,
      dataHash: comp.dataHash,
      creatorHash: comp.creatorHash,
      nonce: comp.nonce,
      index: comp.index,
    },
  );
  // See the module-doc note above — the legacy package's codegen marks
  // every account isSigner:false. Patch the seller's own key(s) back to
  // true so MWA actually has something to sign here.
  for (const key of transferIx.keys) {
    if (key.pubkey.equals(sellerPk)) key.isSigner = true;
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Buyer pays tx fees (they're the one submitting)
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: buyerPk });
  tx.add(transferIx);

  // SKR from buyer → seller (minus fee), plus the fee leg to the dev wallet.
  const skrMintPk = new PublicKey(SKR_MINT);
  const devPk = new PublicKey(DEV_WALLET);
  const decimals = await getSkrDecimals(connection);

  const buyerSkrATA = getAssociatedTokenAddressSync(skrMintPk, buyerPk);
  const sellerSkrATA = getAssociatedTokenAddressSync(skrMintPk, sellerPk);
  const devSkrATA = getAssociatedTokenAddressSync(skrMintPk, devPk);

  // A buyer initiating a SKR-denominated purchase almost certainly already holds an SKR ATA,
  // but there's no reason to make that a hard assumption when idempotent-create is free (a no-op
  // if it already exists) — cheaper than risking a confusing "account not found" failure for a
  // buyer who holds SKR some other way. Seller and dev wallet may never have received SKR before,
  // so their ATAs need the same treatment. Buyer pays these small creation costs as part of the
  // fees they already cover by submitting the transaction.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyerPk, buyerSkrATA, buyerPk, skrMintPk, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyerPk, sellerSkrATA, sellerPk, skrMintPk, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyerPk, devSkrATA, devPk, skrMintPk, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );

  const totalBaseUnits = Math.round(params.skrPrice * 10 ** decimals);
  const feeBaseUnits = Math.round(totalBaseUnits * NFT_SALE_FEE_PCT);
  const sellerBaseUnits = totalBaseUnits - feeBaseUnits;

  tx.add(
    createTransferCheckedInstruction(
      buyerSkrATA, skrMintPk, sellerSkrATA, buyerPk, sellerBaseUnits, decimals, [], TOKEN_PROGRAM_ID,
    ),
  );
  // 2% trading fee → dev wallet, in SKR
  tx.add(
    createTransferCheckedInstruction(
      buyerSkrATA, skrMintPk, devSkrATA, buyerPk, feeBaseUnits, decimals, [], TOKEN_PROGRAM_ID,
    ),
  );

  return { transaction: tx, blockhash };
}

// ─── Seller sign (Phase 1) ──────────────────────────────────────────────────

/**
 * Seller partially signs the swap transaction via MWA.
 * Returns the serialized partially-signed transaction (base64).
 *
 * The seller approves the NFT transfer instruction. The buyer
 * will counter-sign the SKR transfer and submit.
 */
export async function sellerSignSwap(params: SwapParams): Promise<string> {
  assertDeviceTrusted("NFT sale");
  const { transaction } = await buildSwapTransaction(params);

  const serialized = await transact(async (mobileWallet: Web3MobileWallet) => {
    const sellerPk = await mwaAuthorize(mobileWallet);

    // Verify the authorized wallet matches the seller
    if (sellerPk.toBase58() !== params.sellerWallet) {
      throw new Error("Connected wallet does not match seller wallet");
    }

    // signTransactions partially signs — only the seller's required signatures
    const [signed] = await mobileWallet.signTransactions({
      transactions: [transaction],
    });

    // Serialize the partially-signed transaction
    const buf = signed.serialize({ requireAllSignatures: false });
    return Buffer.from(buf).toString("base64");
  });

  return serialized;
}

// ─── Transaction validation (buyer safety check) ────────────────────────────

export interface SwapParties {
  buyer: PublicKey;
  seller: PublicKey;
  dev: PublicKey;
  skrMint: PublicKey;
  /** Total SKR the buyer agreed to pay, in base units. */
  expectedBaseUnits: number;
}

/**
 * Structural check of a seller-built swap transaction. Every instruction must
 * be one of the six buildSwapTransaction writes, in any order:
 *   - 1 Bubblegum transfer, seller → buyer, seller signing
 *   - 3 idempotent SKR ATA creates paid by the buyer, for buyer, seller, dev
 *   - 2 SKR TransferChecked from the buyer: one to the seller, one to dev
 * Anything else (a SOL transfer, an approve, a second Bubblegum transfer that
 * moves the buyer's own cNFT) is rejected — the buyer signs the whole tx.
 * Returns the reason it fails, or null. The listed asset itself is checked
 * separately (validateSwapTransaction compares the dataHash against DAS).
 */
export function checkSwapInstructions(tx: Transaction, p: SwapParties): string | null {
  if (tx.instructions.length !== 6) return `Unexpected instruction count: ${tx.instructions.length}`;
  if (!tx.feePayer?.equals(p.buyer)) return "Fee payer is not the buyer";

  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(p.skrMint, owner);
  const buyerAta = ata(p.buyer);
  const sellerAta = ata(p.seller);
  const devAta = ata(p.dev);
  const pendingAtas = [
    { ata: buyerAta, owner: p.buyer },
    { ata: sellerAta, owner: p.seller },
    { ata: devAta, owner: p.dev },
  ];
  let bubblegum = 0;
  let toSeller = 0;
  let toDev = 0;
  let total = 0;

  for (const ix of tx.instructions) {
    const k = ix.keys.map((m) => m.pubkey);

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // CreateIdempotent: data [1]; keys [payer, ata, owner, mint, system, token]
      if (ix.data.length !== 1 || ix.data[0] !== 1 || k.length !== 6) return "Unexpected token-account instruction";
      if (!k[0].equals(p.buyer) || !k[3].equals(p.skrMint)) return "Token account is not the buyer's SKR account setup";
      if (!k[4].equals(SystemProgram.programId) || !k[5].equals(TOKEN_PROGRAM_ID)) return "Unexpected token-account programs";
      const i = pendingAtas.findIndex((a) => a.ata.equals(k[1]) && a.owner.equals(k[2]));
      if (i < 0) return "Token account is not for the buyer, seller or OnlyMonkes vault";
      pendingAtas.splice(i, 1);
      continue;
    }

    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      // TransferChecked: data [12, u64 amount, u8 decimals]; keys [source, mint, destination, authority]
      if (ix.data.length !== 10 || ix.data[0] !== 12 || k.length !== 4) return "Unexpected token instruction";
      if (!k[1].equals(p.skrMint)) return "SKR transfer is not for the SKR mint";
      if (!k[0].equals(buyerAta) || !k[3].equals(p.buyer)) return "SKR transfer source/authority is not the buyer";
      if (k[2].equals(sellerAta)) toSeller++;
      else if (k[2].equals(devAta)) toDev++;
      else return "SKR transfer destination is not the seller or OnlyMonkes vault";
      total += Number(ix.data.readBigUInt64LE(1));
      continue;
    }

    if (ix.programId.equals(BUBBLEGUM_PROGRAM_ID)) {
      if (!transferInstructionDiscriminator.every((b, i) => ix.data[i] === b)) return "Unexpected NFT instruction";
      // [treeAuthority, leafOwner, leafDelegate, newLeafOwner, merkleTree, ...]
      if (k.length < 8) return "Bubblegum transfer instruction has wrong key count";
      if (!k[1].equals(p.seller)) return "NFT transfer leafOwner is not the seller";
      if (!k[3].equals(p.buyer)) return "NFT transfer newLeafOwner is not the buyer";
      if (!ix.keys[1].isSigner) return "Seller is not a required signer on the transfer instruction";
      bubblegum++;
      continue;
    }

    return `Unexpected instruction from program ${ix.programId.toBase58().slice(0, 8)}…`;
  }

  if (bubblegum !== 1) return `Expected one NFT transfer, found ${bubblegum}`;
  if (toSeller !== 1 || toDev !== 1) return "Expected one SKR payment to the seller and one to the vault";
  if (pendingAtas.length) return "Missing SKR token-account setup";
  // 1% tolerance for rounding of the 98/2 split
  if (Math.abs(total - p.expectedBaseUnits) > p.expectedBaseUnits * 0.01) {
    return `SKR amount mismatch: expected ${p.expectedBaseUnits}, got ${total}`;
  }
  return null;
}

/**
 * Validate a serialized swap transaction before the buyer counter-signs:
 * checkSwapInstructions, then the Bubblegum transfer's embedded dataHash must
 * match a fresh DAS lookup for expectedMint — that pins the transfer to the
 * SPECIFIC listed asset (a cNFT has no mint key to compare, and a seller could
 * otherwise send a cheaper cNFT they also own).
 */
export async function validateSwapTransaction(
  serializedTx: string,
  expectedMint: string,
  expectedSkrPrice: number,
  sellerWallet: string,
  buyerWallet: string,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const tx = Transaction.from(Buffer.from(serializedTx, "base64"));
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const decimals = await getSkrDecimals(connection);

    const reason = checkSwapInstructions(tx, {
      buyer: new PublicKey(buyerWallet),
      seller: new PublicKey(sellerWallet),
      dev: new PublicKey(DEV_WALLET),
      skrMint: new PublicKey(SKR_MINT),
      expectedBaseUnits: Math.round(expectedSkrPrice * 10 ** decimals),
    });
    if (reason) return { valid: false, reason };

    const transferIx = tx.instructions.find((ix) => ix.programId.equals(BUBBLEGUM_PROGRAM_ID))!;
    const [decoded] = transferStruct.deserialize(transferIx.data);
    const freshDataHash = (await fetchCompressionData(expectedMint)).dataHash;
    const embeddedDataHash: number[] = Array.from(decoded.dataHash as Uint8Array | number[]);
    if (
      embeddedDataHash.length !== freshDataHash.length ||
      !embeddedDataHash.every((b, i) => b === freshDataHash[i])
    ) {
      return { valid: false, reason: "Transfer instruction does not match the listed NFT" };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Validation error: ${(err as Error).message}` };
  }
}

// ─── Buyer complete swap (Phase 2) ──────────────────────────────────────────

/**
 * Buyer counter-signs the partially-signed transaction and submits to network.
 * Returns the transaction signature on success.
 */
export async function buyerCompleteSwap(
  serializedTx: string,
  expectedMint: string,
  expectedSkrPrice: number,
  sellerWallet: string,
): Promise<string> {
  assertDeviceTrusted("NFT purchase");
  // Validate before signing
  const buyerWallet = useAppStore.getState().wallet?.address;
  if (!buyerWallet) throw new Error("Wallet not connected");

  const validation = await validateSwapTransaction(
    serializedTx, expectedMint, expectedSkrPrice, sellerWallet, buyerWallet,
  );
  if (!validation.valid) {
    throw new Error(`Transaction validation failed: ${validation.reason}`);
  }

  const connection = new Connection(HELIUS_RPC_URL, "confirmed");

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    const buyerPk = await mwaAuthorize(mobileWallet);

    if (buyerPk.toBase58() !== buyerWallet) {
      throw new Error("Connected wallet does not match buyer wallet");
    }

    const minContextSlot = await connection.getSlot();

    // Deserialize the partially-signed transaction
    const buf = Buffer.from(serializedTx, "base64");
    const tx = Transaction.from(buf);

    // signAndSendTransactions adds the buyer's signature and submits
    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });

    return sig;
  });

  return typeof signature === "string"
    ? signature
    : Buffer.from(signature).toString("base64");
}
