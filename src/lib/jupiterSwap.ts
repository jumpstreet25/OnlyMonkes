/**
 * jupiterSwap.ts
 *
 * Jupiter v6 swap integration via Mobile Wallet Adapter.
 *
 * Flow:
 *  1. Resolve token mint from symbol (via Jupiter strict token list)
 *  2. Fetch swap quote (Jupiter Quote API)
 *  3. Get serialized transaction (Jupiter Swap API)
 *  4. Deserialize → sign via MWA → send to Solana
 *
 * Supports /buy, /sell, /swap slash commands.
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import Constants from "expo-constants";
import { HELIUS_RPC_URL, DEV_WALLET, TOKEN_TRADE_FEE_PCT } from "./constants";
import { useAppStore } from "@/store/appStore";
import { loadCostBasis, recordBuy, getCostBasis, recordSell } from "./costBasis";

const JUP_API_KEY: string =
  (Constants.expoConfig?.extra?.jupApiKey as string) || "";

const JUP_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
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
  const res = await fetch(JUP_TOKEN_LIST_URL);
  if (!res.ok) throw new Error("Failed to fetch Jupiter token list");
  _tokenListCache = (await res.json()) as JupToken[];
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
  /** Full Jupiter quote response — pass to executeSwap */
  raw: any;
}

/**
 * Get a swap quote from Jupiter.
 *
 * @param inputMint   Input token mint address
 * @param outputMint  Output token mint address
 * @param amountRaw   Amount in smallest units (lamports/token-lamports)
 * @param slippageBps Slippage tolerance in basis points (default 50 = 0.5%)
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
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw,
    slippageBps: String(slippageBps),
  });

  const headers: Record<string, string> = {};
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await fetch(`${JUP_QUOTE_URL}?${params}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter quote failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  return {
    inputMint,
    outputMint,
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

    // Request serialized swap transaction from Jupiter
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

    const swapRes = await fetch(JUP_SWAP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: quote.raw,
        userPublicKey: senderPubkey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    if (!swapRes.ok) {
      const body = await swapRes.text().catch(() => "");
      throw new Error(`Jupiter swap API failed (${swapRes.status}): ${body}`);
    }

    const { swapTransaction } = await swapRes.json();

    // Deserialize the versioned transaction
    const txBuf = Buffer.from(swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);

    // Sign and send via MWA
    const minContextSlot = await connection.getSlot();
    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx as any],
      minContextSlot,
    });

    // Send profit fee in same MWA session (wallet already unlocked)
    if (feeSOL > 0.0001) {
      try {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const feeTx = new Transaction({
          recentBlockhash: blockhash,
          feePayer: senderPubkey,
        });
        feeTx.add(
          SystemProgram.transfer({
            fromPubkey: senderPubkey,
            toPubkey: new PublicKey(DEV_WALLET),
            lamports: Math.round(feeSOL * LAMPORTS_PER_SOL),
          }),
        );
        await mobileWallet.signAndSendTransactions({
          transactions: [feeTx as any],
        });
      } catch (err) {
        console.warn("[jupiterSwap] Profit fee transfer failed:", (err as Error).message);
        feeSOL = 0; // didn't actually charge
      }
    }

    return sig;
  });

  // Post-swap: update cost basis
  if (isBuy) {
    recordBuy(quote.outputMint, quote.inAmountUi);
  } else if (isSell) {
    recordSell(quote.inputMint, quote.inAmountUi, preSellBalance);
  }

  return {
    signature: typeof signature === "string"
      ? signature
      : Buffer.from(signature).toString("base64"),
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
