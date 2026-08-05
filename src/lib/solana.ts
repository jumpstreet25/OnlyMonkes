/**
 * solana.ts
 *
 * SKR token tipping helpers.
 * Builds an SPL token transfer transaction and signs it via Mobile Wallet Adapter.
 *
 * Tips are 100% to the recipient — no platform fee. The dev wallet receives
 * full amount when used as a tip recipient via sendDevTip().
 *
 * Also provides:
 *  - sendSolTipAsSkr(): swap SOL → SKR via Jupiter then tip (for users without SKR)
 *  - sendDevTip(): direct dev-wallet support tip (100% to dev)
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
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET, JUP_API_KEY, USDC_MINT, SKR_DISCOUNT_PCT } from "./constants";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "./security";
import bs58 from "bs58";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://github.com/jumpstreet25/OnlyMonkes",
  icon: "favicon.ico",
};


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
  assertDeviceTrusted("Purchase");
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

  // Skip payment if buyer IS the dev wallet (self-transfer is pointless)
  const myWallet = useAppStore.getState().wallet?.address;
  if (myWallet && myWallet === DEV_WALLET) {
    return "dev-self-purchase";
  }

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Skip if authorized wallet matches dev wallet
    if (senderPubkey.toBase58() === DEV_WALLET) return "dev-self-purchase";

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

// ─── Multi-currency Banana Shop payments ─────────────────────────────────────

export type ShopCurrency = "SOL" | "USDC" | "SKR";

/** Fetch USD price of a Solana SPL token via Jupiter price API v2. */
async function fetchTokenPriceUsd(mint: string): Promise<number> {
  const TIMEOUT = 6000;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`, { signal: c.signal });
    if (!r.ok) throw new Error(`Jupiter price ${r.status}`);
    const d = await r.json() as any;
    const p = parseFloat(d?.data?.[mint]?.price ?? "0");
    if (!Number.isFinite(p) || p <= 0) throw new Error("invalid price");
    return p;
  } finally {
    clearTimeout(t);
  }
}

/** Fetch SKR/USD price. Throws on failure — caller should disable SKR payment. */
export async function fetchSkrPriceUsd(): Promise<number> {
  return fetchTokenPriceUsd(SKR_MINT);
}

/** Fetch SOL/USD via Jupiter v2 (CoinGecko fallback handled by caller if needed). */
export async function fetchSolPriceUsd(): Promise<number> {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  return fetchTokenPriceUsd(SOL_MINT);
}

/** Compute the effective USD cost after applying any currency-specific discount. */
export function effectiveUsdCost(usdCost: number, currency: ShopCurrency): number {
  if (currency === "SKR") return usdCost * (1 - SKR_DISCOUNT_PCT);
  return usdCost;
}

// SKR mint decimals are fetched once and cached (immutable).
let _skrDecimalsCache: number | null = null;
async function getSkrDecimals(connection: Connection): Promise<number> {
  if (_skrDecimalsCache !== null) return _skrDecimalsCache;
  const info = await getMint(connection, new PublicKey(SKR_MINT));
  _skrDecimalsCache = info.decimals;
  return _skrDecimalsCache;
}

/**
 * Pay for a Banana Shop item in SOL, USDC, or SKR.
 * 100% to DEV_WALLET. SKR gets SKR_DISCOUNT_PCT off the USD price.
 *
 * Pre-flight balance checks fail early before opening MWA.
 *
 * @param usdCost  Item's USD price (e.g. 4.99 for a Tier 5 World)
 * @param currency Payment currency
 * @returns transaction signature, or "dev-self-purchase" if buyer is DEV_WALLET
 */
export async function sendShopPaymentMulti(
  usdCost: number,
  currency: ShopCurrency,
): Promise<string> {
  assertDeviceTrusted("Purchase");
  if (!Number.isFinite(usdCost) || usdCost <= 0 || usdCost > 25) {
    throw new Error("Invalid purchase amount");
  }

  const myWallet = useAppStore.getState().wallet?.address;
  if (myWallet && myWallet === DEV_WALLET) return "dev-self-purchase";

  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const devPubkey = new PublicKey(DEV_WALLET);
  const effUsd = effectiveUsdCost(usdCost, currency);

  // ─── SOL ──────────────────────────────────────────────────────────────────
  if (currency === "SOL") {
    const solPrice = await fetchSolPriceUsd();
    const lamports = Math.ceil((effUsd / solPrice) * 1e9);

    if (myWallet) {
      try {
        const bal = await connection.getBalance(new PublicKey(myWallet));
        // Reserve ~0.000005 SOL for tx fee
        if (bal < lamports + 5_000) {
          throw new Error(`Insufficient SOL: ${(bal / 1e9).toFixed(4)} < ${(lamports / 1e9).toFixed(4)}`);
        }
      } catch (err: any) {
        if (err.message?.startsWith("Insufficient")) throw err;
        // ignore RPC errors — let MWA path handle it
      }
    }

    const sig = await transact(async (mobileWallet: Web3MobileWallet) => {
      const senderPubkey = await mwaAuthorize(mobileWallet);
      if (senderPubkey.toBase58() === DEV_WALLET) return "dev-self-purchase";
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey }).add(
        SystemProgram.transfer({ fromPubkey: senderPubkey, toPubkey: devPubkey, lamports }),
      );
      const [s] = await mobileWallet.signAndSendTransactions({ transactions: [tx] });
      return s;
    });
    return typeof sig === "string" ? sig : Buffer.from(sig).toString("base64");
  }

  // ─── SPL token (USDC or SKR) ──────────────────────────────────────────────
  const isUsdc = currency === "USDC";
  const mintPubkey = new PublicKey(isUsdc ? USDC_MINT : SKR_MINT);
  let decimals: number;
  let tokenAmount: number; // ui units

  if (isUsdc) {
    decimals = 6; // USDC always 6
    tokenAmount = effUsd; // 1 USDC = $1
  } else {
    decimals = await getSkrDecimals(connection);
    const skrPrice = await fetchSkrPriceUsd();
    tokenAmount = effUsd / skrPrice;
  }

  const baseUnits = Math.ceil(tokenAmount * Math.pow(10, decimals));

  // Pre-flight ATA balance check
  if (myWallet) {
    try {
      const senderAta = getAssociatedTokenAddressSync(mintPubkey, new PublicKey(myWallet));
      const balanceInfo = await connection.getTokenAccountBalance(senderAta);
      const ui = parseFloat(balanceInfo.value.uiAmountString ?? "0");
      if (ui < tokenAmount) {
        throw new Error(`Insufficient ${currency}: ${ui.toFixed(decimals === 6 ? 2 : 4)} < ${tokenAmount.toFixed(decimals === 6 ? 2 : 4)}`);
      }
    } catch (err: any) {
      if (err.message?.startsWith("Insufficient")) throw err;
      // ATA may not exist — treat as zero balance
      throw new Error(`No ${currency} balance found — you need ${currency} tokens to use this option`);
    }
  }

  const sig = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);
    if (senderPubkey.toBase58() === DEV_WALLET) return "dev-self-purchase";

    const minContextSlot = await connection.getSlot();
    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const devATA = getAssociatedTokenAddressSync(mintPubkey, devPubkey);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    tx.add(
      createTransferInstruction(
        senderATA, devATA, senderPubkey, BigInt(baseUnits), [], TOKEN_PROGRAM_ID,
      ),
    );

    const [s] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });
    return s;
  });

  return typeof sig === "string" ? sig : Buffer.from(sig).toString("base64");
}

/**
 * Send SKR tips — 100% to recipient, no platform fee.
 * @param recipientWallet  Base58 Solana wallet of the message sender to tip
 * @param amountUi         Human-readable SKR amount (e.g. 1 for 1 SKR)
 * @returns transaction signature
 */
export async function sendSkrTip(
  recipientWallet: string,
  amountUi: number
): Promise<string> {
  assertDeviceTrusted("Tip");
  if (!Number.isFinite(amountUi) || amountUi <= 0 || amountUi > 10_000) {
    throw new Error("Invalid tip amount");
  }
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
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

  const lamports = Math.round(amountUi * Math.pow(10, decimals));

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    // Reauthorize with cached token — biometric prompt only, no app switch
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch slot AFTER auth so the simulation context is always fresh
    const minContextSlot = await connection.getSlot();

    // Derive ATAs (sender + recipient only — no dev split)
    const senderATA    = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);

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

    // Transfer 100% to recipient
    tx.add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        senderPubkey,
        BigInt(lamports),
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
  assertDeviceTrusted("Tip");
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
 *  2. Transfer SKR: 100% → recipient (no platform fee)
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
  assertDeviceTrusted("Tip");
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
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

    // 3. Build tip transfer: SKR now in user's ATA — 100% to recipient
    const outAmount = BigInt(buildData.outAmount);

    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tipTx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    tipTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, recipientATA, recipientPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    tipTx.add(
      createTransferInstruction(senderATA, recipientATA, senderPubkey, outAmount, [], TOKEN_PROGRAM_ID)
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
