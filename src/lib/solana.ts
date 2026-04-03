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
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  SystemProgram,
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
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET, JUP_API_KEY } from "./constants";
import { useAppStore } from "@/store/appStore";
import bs58 from "bs58";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

const DEV_FEE_PERCENT = 0.05;

const SOL_MINT = "So11111111111111111111111111111111111111112";

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
 * Send SOL to DEV_WALLET for Banana Shop purchases.
 * @param usdCost  The item's USD price ($1-4)
 * @param solPrice Current SOL price in USD
 * @returns transaction signature
 */
export async function sendShopPayment(
  usdCost: number,
  solPrice: number,
): Promise<string> {
  if (!Number.isFinite(usdCost) || usdCost <= 0 || usdCost > 10) {
    throw new Error("Invalid purchase amount");
  }
  if (!Number.isFinite(solPrice) || solPrice <= 0) {
    throw new Error("Could not fetch SOL price");
  }

  const solAmount = usdCost / solPrice;
  const lamports = Math.ceil(solAmount * 1e9);
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const devPubkey = new PublicKey(DEV_WALLET);

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: senderPubkey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: devPubkey,
        lamports,
      }),
    );

    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
    });
    return sig;
  });

  return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
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

  // Pre-flight balance check — fail early before opening MWA
  const senderWallet = useAppStore.getState().wallet?.address;
  if (senderWallet) {
    try {
      const senderAta = getAssociatedTokenAddressSync(mintPubkey, new PublicKey(senderWallet));
      const balanceInfo = await connection.getTokenAccountBalance(senderAta);
      const balance = parseFloat(balanceInfo.value.uiAmountString ?? "0");
      if (balance < amountUi) {
        throw new Error(`Insufficient SKR balance: ${balance.toFixed(1)} < ${amountUi}`);
      }
    } catch (err) {
      if ((err as Error).message.includes("Insufficient")) throw err;
      // ATA doesn't exist = 0 balance
      throw new Error("No SKR balance found — you need SKR tokens to tip");
    }
  }

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

const JUP_BUILD_URL = "https://api.jup.ag/swap/v2/build";

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

  // 1. Get Jupiter v2 /build: SOL → SKR (quote + instructions in one call)
  const solLamports = Math.floor(solAmount * 1e9);

  const result = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch build with real wallet address for correct ATA resolution
    const buildParams = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: SKR_MINT,
      amount: String(solLamports),
      taker: senderPubkey.toBase58(),
      slippageBps: String(slippageBps),
      wrapAndUnwrapSol: "true",
    });
    const buildHeaders: Record<string, string> = {};
    if (JUP_API_KEY) buildHeaders["x-api-key"] = JUP_API_KEY;

    const buildRes = await fetch(`${JUP_BUILD_URL}?${buildParams}`, { headers: buildHeaders });
    if (!buildRes.ok) throw new Error(`Jupiter build failed (${buildRes.status})`);
    const buildData = await buildRes.json() as any;

    if (!buildData.swapInstruction || !buildData.blockhashWithMetadata?.blockhash) {
      throw new Error("Jupiter build response missing required fields");
    }

    // Normalize blockhash: Jupiter v2 returns byte array, web3.js needs base58 string
    const bh = buildData.blockhashWithMetadata.blockhash;
    if (Array.isArray(bh)) {
      buildData.blockhashWithMetadata.blockhash = bs58.encode(Uint8Array.from(bh));
    }

    // Helper to convert Jupiter instruction to web3.js
    const toIx = (ix: any): TransactionInstruction => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((a: any) => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      data: Buffer.from(ix.data, "base64"),
    });

    // Assemble swap instructions
    const swapInstructions: TransactionInstruction[] = [];
    for (const ix of buildData.computeBudgetInstructions) swapInstructions.push(toIx(ix));
    swapInstructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    for (const ix of buildData.setupInstructions) swapInstructions.push(toIx(ix));
    swapInstructions.push(toIx(buildData.swapInstruction));
    if (buildData.cleanupInstruction) swapInstructions.push(toIx(buildData.cleanupInstruction));
    for (const ix of buildData.otherInstructions) swapInstructions.push(toIx(ix));

    // Resolve lookup tables
    const lutAddrs = Object.keys(buildData.addressesByLookupTableAddress || {});
    let luts: AddressLookupTableAccount[] = [];
    if (lutAddrs.length > 0) {
      const results = await Promise.all(
        lutAddrs.map(a => connection.getAddressLookupTable(new PublicKey(a))),
      );
      luts = results.map(r => r.value).filter((a): a is AddressLookupTableAccount => a !== null);
    }

    // Build v0 swap transaction
    const msgV0 = new TransactionMessage({
      payerKey: senderPubkey,
      recentBlockhash: buildData.blockhashWithMetadata.blockhash,
      instructions: swapInstructions,
    }).compileToV0Message(luts);
    const swapTx = new VersionedTransaction(msgV0);

    const minContextSlot = await connection.getSlot();
    const [swapSig] = await mobileWallet.signAndSendTransactions({
      transactions: [swapTx as any],
      minContextSlot,
    });

    // Use outAmount from the build response
    const quoteData = { outAmount: buildData.outAmount };

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
