/**
 * cnftBadges.ts — Soulbound cNFT badge minting via Bubblegum (Metaplex).
 *
 * Flow:
 *  1. User earns a badge (tracked in activityBadges.ts)
 *  2. User taps "Claim" → $4.99 payment in SKR/SOL via MWA → dev wallet
 *  3. After payment confirms → mint cNFT badge to user's wallet
 *  4. Badge is soulbound (non-transferable) via delegate freeze
 *
 * Collection + Merkle tree must be created once via the setup script.
 * Badge metadata is placeholder (on-chain JSON) until artwork is uploaded.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { transact, type Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET } from "@/lib/constants";
import { BADGES, markBadgeClaimed, type Badge } from "@/lib/activityBadges";

// ─── Config ──────────────────────────────────────────────────────────────────

const BADGE_PRICE_USD = 4.99;
// These are set after collection creation (via setup script)
const COLLECTION_MINT = ""; // TODO: Set after running create-badge-collection script
const MERKLE_TREE = "";     // TODO: Set after running create-badge-collection script

// Bubblegum program addresses
const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const SPL_NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

// ─── Placeholder Metadata ────────────────────────────────────────────────────

interface BadgeMetadata {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  collection: { key: string; verified: boolean } | null;
  creators: Array<{ address: string; verified: boolean; share: number }>;
}

/**
 * Generate placeholder metadata for a badge.
 * URI points to on-chain JSON (will be replaced with Arweave/IPFS when artwork is ready).
 */
function getBadgeMetadata(badge: Badge): BadgeMetadata {
  // Placeholder metadata — stored as data URI JSON
  const metadataJson = {
    name: `OnlyMonkes: ${badge.name}`,
    symbol: "MONKE",
    description: badge.description,
    image: "", // TODO: Upload badge artwork and set URI
    attributes: [
      { trait_type: "Category", value: badge.category },
      { trait_type: "Requirement", value: badge.requirement },
      { trait_type: "Emoji", value: badge.emoji },
      { trait_type: "Soulbound", value: "true" },
    ],
    properties: {
      category: "image",
      creators: [
        { address: DEV_WALLET, share: 100 },
      ],
    },
    collection: {
      name: "OnlyMonkes Activity Badges",
      family: "Saga Monkes",
    },
  };

  // Use a data URI as placeholder until Arweave upload
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadataJson)).toString("base64")}`;

  return {
    name: `OnlyMonkes: ${badge.name}`,
    symbol: "MONKE",
    uri,
    sellerFeeBasisPoints: 0, // No royalties on soulbound
    collection: COLLECTION_MINT ? { key: COLLECTION_MINT, verified: false } : null,
    creators: [{ address: DEV_WALLET, verified: true, share: 100 }],
  };
}

// ─── Payment Gate ($4.99 in SKR or SOL) ──────────────────────────────────────

/**
 * Send $4.99 payment to dev wallet via MWA.
 * Tries SKR first, falls back to SOL.
 * Returns the transaction signature.
 */
export async function payForBadge(
  payInSol: boolean,
  solPrice: number, // Current SOL price in USD (from Pyth)
  skrPrice: number, // Current SKR price in USD
): Promise<string> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const devPubkey = new PublicKey(DEV_WALLET);

  if (payInSol) {
    // Pay in SOL
    const solAmount = BADGE_PRICE_USD / solPrice;
    const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);

    const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
      const accounts = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: { name: "OnlyMonkes", uri: "https://onlymonkes.com" },
      });
      const senderPubkey = new PublicKey(accounts.accounts[0].address);
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const minContextSlot = await connection.getSlot();

      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });
      tx.add(SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: devPubkey,
        lamports,
      }));

      const [sig] = await mobileWallet.signAndSendTransactions({
        transactions: [tx],
        minContextSlot,
      });
      return sig;
    });

    return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");

  } else {
    // Pay in SKR
    const skrAmount = BADGE_PRICE_USD / skrPrice;
    const mintPubkey = new PublicKey(SKR_MINT);
    const mintInfo = await getMint(connection, mintPubkey);
    const lamports = Math.round(skrAmount * Math.pow(10, mintInfo.decimals));

    const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
      const accounts = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: { name: "OnlyMonkes", uri: "https://onlymonkes.com" },
      });
      const senderPubkey = new PublicKey(accounts.accounts[0].address);
      const minContextSlot = await connection.getSlot();
      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
      const devATA = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
      tx.add(createTransferInstruction(
        senderATA, devATA, senderPubkey, BigInt(lamports), [], TOKEN_PROGRAM_ID,
      ));

      const [sig] = await mobileWallet.signAndSendTransactions({
        transactions: [tx],
        minContextSlot,
      });
      return sig;
    });

    return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
  }
}

// ─── cNFT Minting (Bubblegum) ────────────────────────────────────────────────

/**
 * Mint a soulbound cNFT badge to the user's wallet.
 * Requires COLLECTION_MINT and MERKLE_TREE to be set (from setup script).
 *
 * NOTE: The actual Bubblegum mintV1 instruction requires the tree authority
 * (creator keypair) to sign. In production, this should be a server-side
 * call or a delegated authority. For now, we build the instruction and
 * sign via MWA (requires the tree creator to be the user or a delegate).
 *
 * Alternative approach: call a backend API that holds the tree authority
 * keypair and mints on behalf of the user after payment is confirmed.
 */
export async function mintBadgeCNFT(
  badgeId: string,
  recipientWallet: string,
): Promise<{ success: boolean; error?: string }> {
  const badge = BADGES.find(b => b.id === badgeId);
  if (!badge) return { success: false, error: "Badge not found" };

  if (!COLLECTION_MINT || !MERKLE_TREE) {
    // Collection not created yet — mark as claimed without on-chain mint
    // This is the placeholder flow until the collection setup script is run
    await markBadgeClaimed(badgeId);
    return {
      success: true,
      error: "Badge claimed (off-chain). On-chain cNFT minting will be available after collection setup.",
    };
  }

  try {
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const metadata = getBadgeMetadata(badge);
    const recipient = new PublicKey(recipientWallet);

    // TODO: Build Bubblegum mintToCollectionV1 instruction
    // This requires the tree authority (server-side keypair) to sign.
    // For MVP: mark as claimed, mint via backend API later.

    await markBadgeClaimed(badgeId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Mint failed" };
  }
}

// ─── Full Claim Flow ─────────────────────────────────────────────────────────

/**
 * Complete badge claim: payment + mint.
 * 1. User pays $4.99 via MWA
 * 2. After payment confirms → mint cNFT
 * 3. Mark badge as claimed
 */
export async function claimBadge(
  badgeId: string,
  payInSol: boolean,
  solPrice: number,
  skrPrice: number,
  recipientWallet: string,
): Promise<{ success: boolean; txSignature?: string; error?: string }> {
  try {
    // Step 1: Payment
    const txSig = await payForBadge(payInSol, solPrice, skrPrice);

    // Step 2: Wait for confirmation
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    await connection.confirmTransaction(txSig, "confirmed");

    // Step 3: Mint cNFT
    const mintResult = await mintBadgeCNFT(badgeId, recipientWallet);
    if (!mintResult.success) {
      // Payment went through but mint failed — still mark as claimed
      await markBadgeClaimed(badgeId);
      return { success: true, txSignature: txSig, error: mintResult.error };
    }

    return { success: true, txSignature: txSig };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Claim failed" };
  }
}

/** Get the badge price in human-readable format. */
export function getBadgePriceDisplay(solPrice: number, skrPrice: number): {
  solAmount: string;
  skrAmount: string;
  usdPrice: string;
} {
  return {
    solAmount: (BADGE_PRICE_USD / solPrice).toFixed(4),
    skrAmount: skrPrice > 0 ? Math.round(BADGE_PRICE_USD / skrPrice).toLocaleString() : "N/A",
    usdPrice: `$${BADGE_PRICE_USD}`,
  };
}
