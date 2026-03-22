/**
 * solana.ts
 *
 * SKR token tipping helpers.
 * Builds an SPL token transfer transaction and signs it via Mobile Wallet Adapter.
 *
 * Split: 95% to message recipient, 5% to the dev wallet (Jump.skr).
 *
 * Also provides:
 *  - sendSolTipAsSkr(): swap SOL → SKR via Jupiter then tip (for users without SKR)
 *  - getSkrBalance(): check user's SKR balance
 *  - validateRecipientWallet(): verify a wallet address is valid + on-chain
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import Constants from "expo-constants";
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET } from "./constants";
import { useAppStore } from "@/store/appStore";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

const DEV_FEE_PERCENT = 0.05;

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_API_KEY: string =
  (Constants.expoConfig?.extra?.jupApiKey as string) || "";

/**
 * Re-authorize using the cached MWA auth token (biometric prompt, no app switch).
 * Falls back to full authorize if the token is missing or expired.
 * Returns the sender's PublicKey derived from the auth result.
 */
async function mwaAuthorize(mobileWallet: Web3MobileWallet): Promise<PublicKey> {
  const cachedToken = useAppStore.getState().mwaAuthToken;

  let addrRaw: string | Uint8Array;

  if (cachedToken) {
    try {
      // Reauthorize — shows biometric/PIN overlay without switching apps
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
        auth_token: cachedToken,
      } as Parameters<typeof mobileWallet.authorize>[0]);
      // Refresh token in store in case it rotated
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    } catch {
      // Token expired — fall through to full authorize
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

/**
 * Send SKR tips to a recipient with a 5% dev fee.
 * @param recipientWallet  Base58 Solana wallet of the message sender to tip
 * @param amountUi         Human-readable SKR amount (e.g. 1 for 1 SKR)
 * @returns transaction signature
 */
export async function sendSkrTip(
  recipientWallet: string,
  amountUi: number
): Promise<string> {
  if (!Number.isFinite(amountUi) || amountUi <= 0 || amountUi > 10_000) {
    throw new Error("Invalid tip amount");
  }
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey  = new PublicKey(DEV_WALLET);
  const recipientPubkey = new PublicKey(recipientWallet);

  // Fetch token decimals
  const mintInfo = await getMint(connection, mintPubkey);
  const decimals = mintInfo.decimals;

  const totalLamports = Math.round(amountUi * Math.pow(10, decimals));
  const devLamports   = Math.round(totalLamports * DEV_FEE_PERCENT);
  const userLamports  = totalLamports - devLamports;

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    // Reauthorize with cached token — biometric prompt only, no app switch
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch slot AFTER auth so the simulation context is always fresh
    const minContextSlot = await connection.getSlot();

    // Derive all ATAs
    const senderATA    = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);
    const devATA       = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    // Create recipient ATA if needed (idempotent — no-op if already exists)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey,
        recipientATA,
        recipientPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // Create dev ATA if needed
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey,
        devATA,
        devPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // Transfer to recipient (95%)
    tx.add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        senderPubkey,
        BigInt(userLamports),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Transfer to dev (5%)
    tx.add(
      createTransferInstruction(
        senderATA,
        devATA,
        senderPubkey,
        BigInt(devLamports),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Sign and send — minContextSlot pre-fetched so wallet simulation has fresh state
    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });

    return sig;
  });

  return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
}

/**
 * Send a direct tip to the developer wallet (100% to dev, no split).
 */
export async function sendDevTip(amountUi: number): Promise<string> {
  if (!Number.isFinite(amountUi) || amountUi <= 0 || amountUi > 10_000) {
    throw new Error("Invalid tip amount");
  }
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey  = new PublicKey(DEV_WALLET);

  const mintInfo = await getMint(connection, mintPubkey);
  const lamports = Math.round(amountUi * Math.pow(10, mintInfo.decimals));

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch slot AFTER auth so the simulation context is always fresh
    const minContextSlot = await connection.getSlot();

    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const devATA    = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    tx.add(
      createTransferInstruction(
        senderATA, devATA, senderPubkey, BigInt(lamports), [], TOKEN_PROGRAM_ID
      )
    );

    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });

    return sig;
  });

  return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
}

// ── Recipient validation ──────────────────────────────────────────────────────

/**
 * Validate that a wallet address is a valid Solana public key and exists on-chain.
 */
export async function validateRecipientWallet(walletAddress: string): Promise<boolean> {
  try {
    const pubkey = new PublicKey(walletAddress);
    if (!PublicKey.isOnCurve(pubkey.toBytes())) return false;
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const info = await connection.getAccountInfo(pubkey);
    return info !== null;
  } catch {
    return false;
  }
}

// ── SKR balance check ─────────────────────────────────────────────────────────

/**
 * Get the user's SKR token balance. Returns 0 if no ATA exists.
 */
export async function getSkrBalance(walletAddress: string): Promise<number> {
  try {
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const mintPubkey = new PublicKey(SKR_MINT);
    const owner = new PublicKey(walletAddress);
    const ata = getAssociatedTokenAddressSync(mintPubkey, owner);
    const info = await connection.getTokenAccountBalance(ata);
    return parseFloat(info.value.uiAmountString || "0");
  } catch {
    return 0;
  }
}

// ── SOL → SKR swap tip (for users without SKR) ───────────────────────────────

const JUP_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP_URL = "https://quote-api.jup.ag/v6/swap";

/**
 * Tip a recipient by swapping SOL → SKR via Jupiter, then transferring the SKR.
 * Two MWA-signed transactions in a single transact() session (one biometric prompt):
 *  1. Jupiter swap SOL → SKR
 *  2. Transfer SKR: 95% → recipient, 5% → dev
 *
 * @param recipientWallet  Base58 Solana wallet of the tip recipient
 * @param solAmount        Amount of SOL to swap into SKR for the tip
 * @param slippageBps      Slippage tolerance (default 100 = 1%)
 */
export async function sendSolTipAsSkr(
  recipientWallet: string,
  solAmount: number,
  slippageBps = 100
): Promise<{ swapSig: string; tipSig: string }> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey = new PublicKey(DEV_WALLET);
  const recipientPubkey = new PublicKey(recipientWallet);

  // 1. Get Jupiter quote: SOL → SKR
  const solLamports = Math.floor(solAmount * 1e9);
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: SKR_MINT,
    amount: String(solLamports),
    slippageBps: String(slippageBps),
  });
  const headers: Record<string, string> = {};
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const quoteRes = await fetch(`${JUP_QUOTE_URL}?${params}`, { headers });
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed (${quoteRes.status})`);
  const quoteData = await quoteRes.json();

  const result = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // 2. Get swap transaction from Jupiter
    const swapHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (JUP_API_KEY) swapHeaders["x-api-key"] = JUP_API_KEY;

    const swapRes = await fetch(JUP_SWAP_URL, {
      method: "POST",
      headers: swapHeaders,
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: senderPubkey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    if (!swapRes.ok) throw new Error(`Jupiter swap API failed (${swapRes.status})`);
    const { swapTransaction } = await swapRes.json();

    // Sign and send the swap transaction
    const swapTxBuf = Buffer.from(swapTransaction, "base64");
    const swapTx = VersionedTransaction.deserialize(swapTxBuf);
    const minContextSlot = await connection.getSlot();
    const [swapSig] = await mobileWallet.signAndSendTransactions({
      transactions: [swapTx as any],
      minContextSlot,
    });

    // 3. Build tip transfer: SKR now in user's ATA
    const outAmount = BigInt(quoteData.outAmount);
    const devLamports = outAmount * BigInt(5) / BigInt(100);
    const userLamports = outAmount - devLamports;

    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);
    const devATA = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tipTx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    tipTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, recipientATA, recipientPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    tipTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    tipTx.add(
      createTransferInstruction(senderATA, recipientATA, senderPubkey, userLamports, [], TOKEN_PROGRAM_ID)
    );
    tipTx.add(
      createTransferInstruction(senderATA, devATA, senderPubkey, devLamports, [], TOKEN_PROGRAM_ID)
    );

    const tipSlot = await connection.getSlot();
    const [tipSig] = await mobileWallet.signAndSendTransactions({
      transactions: [tipTx],
      minContextSlot: tipSlot,
    });

    return {
      swapSig: typeof swapSig === "string" ? swapSig : Buffer.from(swapSig).toString("base64"),
      tipSig: typeof tipSig === "string" ? tipSig : Buffer.from(tipSig).toString("base64"),
    };
  });

  return result;
}

// ── /tip command parser ───────────────────────────────────────────────────────

export interface ParsedTipCommand {
  username: string;    // without @
  amount: number;      // SKR amount
}

/**
 * Parse /tip @username [amount].
 * Default 10 SKR, max 500.
 */
export function parseTipCommand(text: string): ParsedTipCommand | null {
  const match = text.trim().match(/^\/tip\s+@(\w+)(?:\s+([\d.]+))?$/i);
  if (!match) return null;
  const username = match[1];
  const amount = match[2] ? parseFloat(match[2]) : 10;
  if (isNaN(amount) || amount <= 0 || amount > 500) return null;
  return { username, amount };
}
