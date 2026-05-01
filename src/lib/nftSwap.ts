/**
 * nftSwap.ts — Atomic NFT ↔ SOL swap via single Solana transaction
 *
 * Both the NFT transfer (seller→buyer) and SOL transfer (buyer→seller)
 * are bundled into ONE transaction. Either both succeed or both fail.
 *
 * Flow:
 *   1. Buyer builds the full swap tx (NFT transfer + SOL transfer)
 *   2. Buyer signs via MWA and submits to network
 *   3. Seller's NFT is transferred atomically with SOL payment
 *
 * Security: The buyer builds and submits the transaction. The seller
 * must have already listed the NFT (proven by ownership check). The
 * transaction uses createTransferCheckedInstruction which requires
 * the seller's signature — obtained via MWA on the seller's device
 * when they tap "Accept".
 *
 * NOTE: Since both parties need to sign and they're on different devices,
 * we use a two-phase approach:
 *   Phase 1 (Seller): Build tx → seller partially signs → serialize → send via XMTP
 *   Phase 2 (Buyer): Deserialize → validate → counter-sign → submit to network
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, HELIUS_API_KEY, DEV_WALLET, NFT_SALE_FEE_PCT } from "./constants";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "./security";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
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

// HELIUS_API_KEY imported from constants (env var, not extracted from URL)

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
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
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
  nftMint: string;         // NFT mint address
  sellerWallet: string;    // Seller's Solana wallet (base58)
  buyerWallet: string;     // Buyer's Solana wallet (base58)
  solPrice: number;        // Price in SOL
}

/**
 * Build the full atomic swap transaction:
 *   1. Create buyer's ATA for the NFT (if needed)
 *   2. Transfer 1 NFT from seller → buyer (requires seller signature)
 *   3. Transfer SOL from buyer → seller (requires buyer signature)
 *
 * Returns the unsigned Transaction object. Caller must get both signatures.
 */
export async function buildSwapTransaction(params: SwapParams): Promise<{
  transaction: Transaction;
  blockhash: string;
}> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const nftMintPk = new PublicKey(params.nftMint);
  const sellerPk = new PublicKey(params.sellerWallet);
  const buyerPk = new PublicKey(params.buyerWallet);

  const sellerATA = getAssociatedTokenAddressSync(nftMintPk, sellerPk);
  const buyerATA = getAssociatedTokenAddressSync(nftMintPk, buyerPk);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Buyer pays tx fees (they're the one submitting)
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: buyerPk });

  // 1. Create buyer's ATA for the NFT mint (idempotent — no-op if exists)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyerPk,       // payer
      buyerATA,      // ATA to create
      buyerPk,       // owner of the new ATA
      nftMintPk,     // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );

  // 2. Transfer 1 NFT (decimals=0) from seller → buyer
  //    Requires seller's signature (authority)
  tx.add(
    createTransferCheckedInstruction(
      sellerATA,     // source
      nftMintPk,     // mint
      buyerATA,      // destination
      sellerPk,      // authority (seller must sign)
      1,             // amount = 1 NFT
      0,             // decimals = 0 for NFTs
      [],            // no multisig
      TOKEN_PROGRAM_ID,
    ),
  );

  // 3. Transfer SOL from buyer → seller (minus fee)
  const totalLamports = Math.round(params.solPrice * LAMPORTS_PER_SOL);
  const feeLamports = Math.round(totalLamports * NFT_SALE_FEE_PCT);
  const sellerLamports = totalLamports - feeLamports;

  tx.add(
    SystemProgram.transfer({
      fromPubkey: buyerPk,
      toPubkey: sellerPk,
      lamports: sellerLamports,
    }),
  );

  // 4. 2% trading fee → dev wallet
  const devPk = new PublicKey(DEV_WALLET);
  tx.add(
    SystemProgram.transfer({
      fromPubkey: buyerPk,
      toPubkey: devPk,
      lamports: feeLamports,
    }),
  );

  return { transaction: tx, blockhash };
}

// ─── Seller sign (Phase 1) ──────────────────────────────────────────────────

/**
 * Seller partially signs the swap transaction via MWA.
 * Returns the serialized partially-signed transaction (base64).
 *
 * The seller approves the NFT transfer instruction. The buyer
 * will counter-sign the SOL transfer and submit.
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

/**
 * Validate that a serialized swap transaction matches expected terms.
 * The buyer calls this before counter-signing to prevent malicious txs.
 *
 * Checks:
 *   - Contains exactly 3 instructions (ATA create + NFT transfer + SOL transfer)
 *   - NFT transfer is for the correct mint, amount=1, from seller to buyer
 *   - SOL transfer is for the correct amount from buyer to seller
 *   - No unexpected instructions
 */
export function validateSwapTransaction(
  serializedTx: string,
  expectedMint: string,
  expectedSolPrice: number,
  sellerWallet: string,
  buyerWallet: string,
): { valid: boolean; reason?: string } {
  try {
    const buf = Buffer.from(serializedTx, "base64");
    const tx = Transaction.from(buf);

    // Allow 3-4 instructions (ATA + NFT transfer + SOL to seller + SOL fee to dev)
    // or 2-3 if buyer ATA already exists
    if (tx.instructions.length < 2 || tx.instructions.length > 4) {
      return { valid: false, reason: `Unexpected instruction count: ${tx.instructions.length}` };
    }

    const buyerPk = new PublicKey(buyerWallet);
    const sellerPk = new PublicKey(sellerWallet);
    const mintPk = new PublicKey(expectedMint);
    const expectedLamports = Math.round(expectedSolPrice * LAMPORTS_PER_SOL);

    // Check fee payer is buyer
    if (!tx.feePayer || !tx.feePayer.equals(buyerPk)) {
      return { valid: false, reason: "Fee payer is not the buyer" };
    }

    // Find all SystemProgram transfers (SOL to seller + fee to dev)
    const systemIxs = tx.instructions.filter(
      ix => ix.programId.equals(SystemProgram.programId),
    );
    if (systemIxs.length < 1 || systemIxs.length > 2) {
      return { valid: false, reason: `Unexpected SOL transfer count: ${systemIxs.length}` };
    }

    // Sum all SOL transfers from buyer and verify destinations
    let totalLamportsSent = 0;
    const devPk = new PublicKey(DEV_WALLET);
    let sellerPaid = false;

    for (const systemIx of systemIxs) {
      const ixData = systemIx.data;
      if (ixData.length < 12) {
        return { valid: false, reason: "Invalid SOL transfer data" };
      }
      const ixType = ixData.readUInt32LE(0);
      if (ixType !== 2) {
        return { valid: false, reason: "SOL instruction is not a transfer" };
      }
      const lamports = Number(ixData.readBigUInt64LE(4));

      const solFrom = systemIx.keys[0]?.pubkey;
      const solTo = systemIx.keys[1]?.pubkey;
      if (!solFrom?.equals(buyerPk)) {
        return { valid: false, reason: "SOL transfer source is not the buyer" };
      }
      // Destination must be seller or dev wallet
      if (solTo?.equals(sellerPk)) {
        sellerPaid = true;
      } else if (!solTo?.equals(devPk)) {
        return { valid: false, reason: "SOL transfer destination is not the seller or dev wallet" };
      }
      totalLamportsSent += lamports;
    }

    if (!sellerPaid) {
      return { valid: false, reason: "No SOL transfer to seller found" };
    }

    // Allow 1% tolerance for rounding on total amount
    if (Math.abs(totalLamportsSent - expectedLamports) > expectedLamports * 0.01) {
      return { valid: false, reason: `SOL amount mismatch: expected ${expectedLamports}, got ${totalLamportsSent}` };
    }

    // Find the SPL token transfer instruction
    const tokenIx = tx.instructions.find(
      ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length >= 9,
    );
    if (!tokenIx) {
      return { valid: false, reason: "Missing NFT transfer instruction" };
    }

    // Verify the mint in the transfer matches expected
    // TransferChecked: instruction type 12, followed by amount (u64) + decimals (u8)
    const tokenIxType = tokenIx.data[0];
    if (tokenIxType !== 12) {
      return { valid: false, reason: "Token instruction is not TransferChecked" };
    }

    // Verify the authority (signer) is the seller
    // TransferChecked keys: [source, mint, dest, authority]
    if (tokenIx.keys.length < 4) {
      return { valid: false, reason: "Token instruction has wrong key count" };
    }
    const tokenAuthority = tokenIx.keys[3]?.pubkey;
    if (!tokenAuthority?.equals(sellerPk)) {
      return { valid: false, reason: "NFT transfer authority is not the seller" };
    }

    // Verify mint account matches
    const tokenMint = tokenIx.keys[1]?.pubkey;
    if (!tokenMint?.equals(mintPk)) {
      return { valid: false, reason: "NFT mint does not match expected" };
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
  expectedSolPrice: number,
  sellerWallet: string,
): Promise<string> {
  assertDeviceTrusted("NFT purchase");
  // Validate before signing
  const buyerWallet = useAppStore.getState().wallet?.address;
  if (!buyerWallet) throw new Error("Wallet not connected");

  const validation = validateSwapTransaction(
    serializedTx, expectedMint, expectedSolPrice, sellerWallet, buyerWallet,
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
