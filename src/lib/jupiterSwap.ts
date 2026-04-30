/**
 * jupiterSwap.ts
 *
 * Jupiter Swap v2 + Ultra integration via Mobile Wallet Adapter.
 *
 * Flow (v2 — regular):
 *  1. Resolve token mint from symbol (via Jupiter strict token list)
 *  2. Fetch swap instructions (Jupiter v2 /build — fee-free)
 *  3. Assemble VersionedTransaction from raw instructions
 *  4. Sign via MWA → send to Solana
 *
 * Flow (Ultra — gasless):
 *  1. GET /ultra/v1/order → unsigned tx + requestId
 *  2. Sign via MWA
 *  3. POST /ultra/v1/execute → Jupiter lands the tx
 *
 * getSmartQuote() auto-selects: Ultra for trades <= 1 SOL, v2 for larger.
 * executeSwap() handles both paths transparently.
 *
 * Supports /buy, /sell, /swap slash commands.
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, DEV_WALLET, TOKEN_TRADE_FEE_PCT, JUP_API_KEY } from "./constants";
import { useAppStore } from "@/store/appStore";
import { loadCostBasis, recordBuy, getCostBasis, recordSell } from "./costBasis";
import { onBuy as positionOnBuy, onSell as positionOnSell } from "./positions";
import { getUltraQuote, deserializeUltraTransaction, executeUltraSwap } from "./jupiterUltra";
import type { UltraQuote } from "./jupiterUltra";
import bs58 from "bs58";

const JUP_BUILD_URL = "https://api.jup.ag/swap/v2/build";
const JUP_TOKEN_LIST_URL = "https://token.jup.ag/strict";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

// ── Token list cache ────────────────────────────────────────────────────────

interface JupToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

let _tokenListCache: JupToken[] | null = null;
let _tokenListFetchedAt = 0;
const TOKEN_LIST_TTL = 30 * 60 * 1000; // 30 min

async function getTokenList(): Promise<JupToken[]> {
  if (_tokenListCache && Date.now() - _tokenListFetchedAt < TOKEN_LIST_TTL) {
    return _tokenListCache;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(JUP_TOKEN_LIST_URL, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error("Failed to fetch Jupiter token list");
  const list = (await res.json()) as JupToken[];
  if (!Array.isArray(list) || list.length === 0) throw new Error("Invalid Jupiter token list");
  _tokenListCache = list;
  _tokenListFetchedAt = Date.now();
  return _tokenListCache;
}

/**
 * Resolve a token symbol (e.g. "SOL", "BONK", "SKR") to its mint address + decimals.
 * Case-insensitive. Returns null if not found.
 */
export async function resolveToken(
  symbolOrMint: string
): Promise<{ mint: string; decimals: number; symbol: string } | null> {
  // If it looks like a mint address (base58, 32+ chars), use it directly
  if (symbolOrMint.length >= 32 && !symbolOrMint.includes(" ")) {
    const list = await getTokenList();
    const found = list.find(
      (t) => t.address.toLowerCase() === symbolOrMint.toLowerCase()
    );
    if (found) return { mint: found.address, decimals: found.decimals, symbol: found.symbol };
    // Unknown mint — assume 9 decimals (SOL standard)
    return { mint: symbolOrMint, decimals: 9, symbol: symbolOrMint.slice(0, 6) };
  }

  // Strip leading $ if present
  const sym = symbolOrMint.replace(/^\$/, "").toUpperCase();
  if (sym === "SOL") return { mint: SOL_MINT, decimals: SOL_DECIMALS, symbol: "SOL" };

  const list = await getTokenList();
  const match = list.find((t) => t.symbol.toUpperCase() === sym);
  if (!match) return null;
  return { mint: match.address, decimals: match.decimals, symbol: match.symbol };
}

// ── Jupiter v2 /build types ─────────────────────────────────────────────────

interface JupBuildInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

interface JupBuildResponse {
  setupInstructions: JupBuildInstruction[];
  swapInstruction: JupBuildInstruction;
  cleanupInstruction: JupBuildInstruction | null;
  otherInstructions: JupBuildInstruction[];
  computeBudgetInstructions: JupBuildInstruction[];
  addressesByLookupTableAddress: Record<string, string[]>;
  blockhashWithMetadata: { blockhash: string | number[]; lastValidBlockHeight: number };
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  priceImpactPct?: string;
}

function toInstruction(ix: JupBuildInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

// ── Quote ───────────────────────────────────────────────────────────────────

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inAmount: string;      // raw lamports
  outAmount: string;     // raw lamports
  inAmountUi: number;    // human-readable
  outAmountUi: number;   // human-readable
  priceImpactPct: number;
  slippageBps: number;
  /** Jupiter v2 /build response — used by executeSwap to assemble transaction */
  raw: JupBuildResponse;
  /** True when this quote came from Jupiter Ultra (gasless) */
  isUltra?: boolean;
  /** True when Ultra confirmed this swap is gasless */
  gasless?: boolean;
  /** Ultra requestId — needed for /execute submission */
  ultraRequestId?: string;
  /** Ultra base64 unsigned transaction — sign and submit to /execute */
  ultraTransaction?: string;
}

/**
 * Get a swap quote + build instructions from Jupiter v2 /build.
 * Returns both quote data AND raw instructions in one call (fee-free path).
 *
 * NOTE: `taker` is required by v2 — we pass a placeholder here since
 * the actual signer pubkey comes from MWA during executeSwap().
 * The /build endpoint uses taker for ATA resolution; we re-fetch inside
 * executeSwap with the real wallet address.
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  inputDecimals: number,
  outputDecimals: number,
  inputSymbol: string,
  outputSymbol: string,
  slippageBps = 50
): Promise<SwapQuote> {
  // Use stored wallet if available; v2 /build needs a taker address for ATA creation
  const taker = useAppStore.getState().wallet?.address || "11111111111111111111111111111111";

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw,
    taker,
    slippageBps: String(slippageBps),
    wrapAndUnwrapSol: "true",
  });

  const headers: Record<string, string> = {};
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await fetch(`${JUP_BUILD_URL}?${params}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter quote failed (${res.status}): ${body}`);
  }

  const data = await res.json() as JupBuildResponse;

  if (!data.swapInstruction || !data.blockhashWithMetadata?.blockhash) {
    throw new Error("Jupiter build response missing swapInstruction or blockhash");
  }

  // Normalize blockhash: Jupiter v2 returns byte array, web3.js needs base58 string
  const bh = data.blockhashWithMetadata.blockhash;
  if (Array.isArray(bh)) {
    data.blockhashWithMetadata.blockhash = bs58.encode(Uint8Array.from(bh));
  }

  return {
    inputMint: data.inputMint || inputMint,
    outputMint: data.outputMint || outputMint,
    inputSymbol,
    outputSymbol,
    inAmount: data.inAmount,
    outAmount: data.outAmount,
    inAmountUi: Number(data.inAmount) / Math.pow(10, inputDecimals),
    outAmountUi: Number(data.outAmount) / Math.pow(10, outputDecimals),
    priceImpactPct: parseFloat(data.priceImpactPct || "0"),
    slippageBps,
    raw: data,
  };
}

// ── Smart Quote (Ultra-first with v2 fallback) ────────────────────────────

/** Max SOL input to attempt Ultra (gasless). Above this, use v2 directly. */
const ULTRA_MAX_SOL = 1.0;

/**
 * Get a swap quote, trying Jupiter Ultra (gasless) first for small trades.
 * Falls back to regular v2 /build if Ultra fails or trade is too large.
 *
 * Ultra threshold: trades <= 1 SOL input use Ultra; larger use v2.
 * When selling tokens, Ultra is always attempted since the user may have no SOL for gas.
 */
export async function getSmartQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  inputDecimals: number,
  outputDecimals: number,
  inputSymbol: string,
  outputSymbol: string,
  slippageBps = 50,
): Promise<SwapQuote> {
  const taker = useAppStore.getState().wallet?.address;
  const isSolInput = inputMint === SOL_MINT;
  const inputAmountUi = Number(amountRaw) / Math.pow(10, inputDecimals);

  // Try Ultra for: sells (user might have no SOL), or small buys (<= 1 SOL)
  const shouldTryUltra = taker && (!isSolInput || inputAmountUi <= ULTRA_MAX_SOL);

  if (shouldTryUltra) {
    try {
      const ultraQuote = await getUltraQuote(
        inputMint, outputMint, amountRaw, taker,
        inputDecimals, outputDecimals, inputSymbol, outputSymbol,
      );

      // Convert UltraQuote to SwapQuote with Ultra metadata
      return {
        inputMint: ultraQuote.inputMint,
        outputMint: ultraQuote.outputMint,
        inputSymbol: ultraQuote.inputSymbol,
        outputSymbol: ultraQuote.outputSymbol,
        inAmount: ultraQuote.inAmount,
        outAmount: ultraQuote.outAmount,
        inAmountUi: ultraQuote.inAmountUi,
        outAmountUi: ultraQuote.outAmountUi,
        priceImpactPct: ultraQuote.priceImpactPct,
        slippageBps: ultraQuote.slippageBps,
        raw: null as any, // Not used for Ultra path
        isUltra: true,
        gasless: ultraQuote.gasless,
        ultraRequestId: ultraQuote.requestId,
        ultraTransaction: ultraQuote.transaction,
      };
    } catch (err) {
      console.warn("[jupiterSwap] Ultra quote failed, falling back to v2:", (err as Error).message);
      // Fall through to v2
    }
  }

  // Fallback: regular v2 /build
  return getSwapQuote(
    inputMint, outputMint, amountRaw,
    inputDecimals, outputDecimals, inputSymbol, outputSymbol,
    slippageBps,
  );
}

// ── Execute swap ────────────────────────────────────────────────────────────

export interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
  inputSymbol: string;
  outputSymbol: string;
  profitFee?: number; // SOL fee charged on profit (0 if no profit)
}

/**
 * Execute a Jupiter swap via MWA.
 * Takes the quote from getSwapQuote() and signs/sends the transaction.
 *
 * Profit-based fee: 3% charged only on gains when selling back to SOL.
 * On buys, cost basis is recorded for future profit calculation.
 */
export async function executeSwap(quote: SwapQuote): Promise<SwapResult> {
  if (!Number.isFinite(quote.inAmountUi) || quote.inAmountUi <= 0) {
    throw new Error("Invalid swap input amount");
  }
  if (quote.priceImpactPct > 15) {
    throw new Error("Price impact too high (>15%). Aborting swap.");
  }
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const walletAddress = useAppStore.getState().wallet?.address;

  const isBuy = quote.inputMint === SOL_MINT;
  const isSell = quote.outputMint === SOL_MINT && quote.inputMint !== SOL_MINT;

  // Pre-calculate profit for sells
  await loadCostBasis();
  let feeSOL = 0;
  let profitSOL = 0;
  let proportionalCost = 0;
  let preSellBalance = 0;

  if (isSell && walletAddress) {
    const costBasis = getCostBasis(quote.inputMint);
    if (costBasis > 0) {
      preSellBalance = await getTokenBalance(walletAddress, quote.inputMint, 0);
      if (preSellBalance > 0) {
        proportionalCost = costBasis * Math.min(quote.inAmountUi / preSellBalance, 1);
        profitSOL = quote.outAmountUi - proportionalCost;
        if (profitSOL > 0) {
          feeSOL = profitSOL * TOKEN_TRADE_FEE_PCT;
        }
      }
    }
  }

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    // Re-authorize with cached token
    const senderPubkey = await mwaAuthorize(mobileWallet);
    const build = quote.raw;

    // If the taker in the /build response doesn't match the actual wallet,
    // re-fetch with the real address (ATAs may differ)
    let buildData = build;
    const realWallet = senderPubkey.toBase58();
    const quoteTaker = useAppStore.getState().wallet?.address || "";
    if (quoteTaker !== realWallet) {
      const rebuildHeaders: Record<string, string> = {};
      if (JUP_API_KEY) rebuildHeaders["x-api-key"] = JUP_API_KEY;
      const params = new URLSearchParams({
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        amount: quote.inAmount,
        taker: realWallet,
        slippageBps: String(quote.slippageBps),
        wrapAndUnwrapSol: "true",
      });
      const rebuildRes = await fetch(`${JUP_BUILD_URL}?${params}`, { headers: rebuildHeaders });
      if (rebuildRes.ok) {
        buildData = await rebuildRes.json() as JupBuildResponse;
      }
    }

    // Assemble instructions from /build response
    const instructions: TransactionInstruction[] = [];

    // 1. Compute budget — use Jupiter's instructions, add CU limit only if not present
    const SET_CU_LIMIT_DISC = 2;
    let hasCuLimit = false;
    for (const ix of buildData.computeBudgetInstructions) {
      const decoded = Buffer.from(ix.data, "base64");
      if (decoded.length >= 1 && decoded[0] === SET_CU_LIMIT_DISC) {
        hasCuLimit = true;
      }
      instructions.push(toInstruction(ix));
    }
    if (!hasCuLimit) {
      instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    }

    // 2. Setup (ATA creation, etc.)
    for (const ix of buildData.setupInstructions) {
      instructions.push(toInstruction(ix));
    }

    // 3. Swap
    instructions.push(toInstruction(buildData.swapInstruction));

    // 4. Cleanup
    if (buildData.cleanupInstruction) {
      instructions.push(toInstruction(buildData.cleanupInstruction));
    }


    // 5. Other
    for (const ix of buildData.otherInstructions) {
      instructions.push(toInstruction(ix));
    }

    // 6. ATOMIC profit fee — same tx as the swap, after cleanup unwraps WSOL.
    // Native SOL is in the wallet account post-cleanup; SystemProgram.transfer
    // sends from there. If the swap fails, the fee transfer cannot fire.
    // Per CLAUDE.md security rule: "Fee injection must be atomic (same transaction)
    // — never separate transfers."
    if (feeSOL > 0.0001) {
      const feeLamports = Math.round(feeSOL * LAMPORTS_PER_SOL);
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: senderPubkey,
          toPubkey: new PublicKey(DEV_WALLET),
          lamports: feeLamports,
        }),
      );
    }

    // Resolve address lookup tables for v0 transaction
    const lutAddresses = Object.keys(buildData.addressesByLookupTableAddress);
    let lookupTables: AddressLookupTableAccount[] = [];
    if (lutAddresses.length > 0) {
      const lutAccounts = await Promise.all(
        lutAddresses.map(async (addr) => {
          const res = await connection.getAddressLookupTable(new PublicKey(addr));
          return res.value;
        }),
      );
      lookupTables = lutAccounts.filter((a): a is AddressLookupTableAccount => a !== null);
    }

    // Build VersionedTransaction (v0)
    const messageV0 = new TransactionMessage({
      payerKey: senderPubkey,
      recentBlockhash: buildData.blockhashWithMetadata.blockhash as string,
      instructions,
    }).compileToV0Message(lookupTables);

    const tx = new VersionedTransaction(messageV0);

    // Sign and send via MWA — fee transfer is now part of the same atomic tx
    const minContextSlot = await connection.getSlot();
    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx as any],
      minContextSlot,
    });

    return sig;
  });

  const sigStr = typeof signature === "string"
    ? signature
    : Buffer.from(signature).toString("base64");

  // Post-swap: update cost basis + emit closed-trade for round-trip sells
  if (isBuy) {
    recordBuy(quote.outputMint, quote.inAmountUi);
    positionOnBuy({ mint: quote.outputMint, symbol: quote.outputSymbol, ts: Date.now() });
  } else if (isSell) {
    recordSell(quote.inputMint, quote.inAmountUi, preSellBalance);
    if (proportionalCost > 0) {
      positionOnSell({
        mint: quote.inputMint,
        symbol: quote.inputSymbol,
        proportionalCost,
        exitSolAmount: quote.outAmountUi,
        ts: Date.now(),
        fullClose: getCostBasis(quote.inputMint) === 0,
        signature: sigStr,
      });
    }
  }

  return {
    signature: sigStr,
    inputAmount: quote.inAmountUi,
    outputAmount: quote.outAmountUi,
    inputSymbol: quote.inputSymbol,
    outputSymbol: quote.outputSymbol,
    profitFee: feeSOL > 0.0001 ? feeSOL : undefined,
  };
}

// ── MWA authorize helper (shared with solana.ts pattern) ────────────────────

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
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
      });
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    }
  } else {
    const result = await mobileWallet.authorize({
      cluster: "mainnet-beta",
      identity: APP_IDENTITY,
    });
    useAppStore.getState().setMwaAuthToken(result.auth_token);
    addrRaw = result.accounts[0].address;
  }

  const pubkeyBytes =
    typeof addrRaw === "string" ? Buffer.from(addrRaw, "base64") : addrRaw;
  return new PublicKey(pubkeyBytes);
}

// ── Slash command parsers ───────────────────────────────────────────────────

export interface ParsedSwapCommand {
  type: "buy" | "sell" | "swap";
  inputSymbol: string;
  outputSymbol: string;
  amount: number;        // human-readable amount of the INPUT token
}

/**
 * Parse a /buy, /sell, or /swap command.
 * Returns null if the text is not a valid swap command.
 *
 * Formats:
 *   /buy $TOKEN [amount_in_SOL]     → buy TOKEN with SOL (default 0.1 SOL)
 *   /sell $TOKEN [percentage]        → sell percentage of TOKEN for SOL (default 100%)
 *   /swap $A for $B [amount]         → swap amount of A for B
 */
export function parseSwapCommand(text: string): ParsedSwapCommand | null {
  const trimmed = text.trim();

  // /buy $TOKEN [amount]
  const buyMatch = trimmed.match(
    /^\/buy\s+\$?(\w+)(?:\s+([\d.]+))?$/i
  );
  if (buyMatch) {
    const token = buyMatch[1];
    const amount = buyMatch[2] ? parseFloat(buyMatch[2]) : 0.1;
    if (isNaN(amount) || amount <= 0) return null;
    return { type: "buy", inputSymbol: "SOL", outputSymbol: token, amount };
  }

  // /sell $TOKEN [percentage]
  const sellMatch = trimmed.match(
    /^\/sell\s+\$?(\w+)(?:\s+([\d.]+)%?)?$/i
  );
  if (sellMatch) {
    const token = sellMatch[1];
    const pct = sellMatch[2] ? parseFloat(sellMatch[2]) : 100;
    if (isNaN(pct) || pct <= 0 || pct > 100) return null;
    // For /sell, amount represents the percentage — caller handles conversion
    return { type: "sell", inputSymbol: token, outputSymbol: "SOL", amount: pct };
  }

  // /swap $A for $B [amount]
  const swapMatch = trimmed.match(
    /^\/swap\s+\$?(\w+)\s+for\s+\$?(\w+)(?:\s+([\d.]+))?$/i
  );
  if (swapMatch) {
    const tokenA = swapMatch[1];
    const tokenB = swapMatch[2];
    const amount = swapMatch[3] ? parseFloat(swapMatch[3]) : 0.1;
    if (isNaN(amount) || amount <= 0) return null;
    return { type: "swap", inputSymbol: tokenA, outputSymbol: tokenB, amount };
  }

  return null;
}

// ── Token balance helper ────────────────────────────────────────────────────

/**
 * Get the user's token balance for a given mint.
 * Returns the balance in human-readable units.
 */
export async function getTokenBalance(
  walletAddress: string,
  mintAddress: string,
  decimals: number
): Promise<number> {
  if (mintAddress === SOL_MINT) {
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");
    const balance = await connection.getBalance(new PublicKey(walletAddress));
    return balance / Math.pow(10, SOL_DECIMALS);
  }

  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(mintAddress),
    new PublicKey(walletAddress)
  );

  try {
    const info = await connection.getTokenAccountBalance(ata);
    return parseFloat(info.value.uiAmountString || "0");
  } catch {
    return 0;
  }
}
