/**
 * jupiterUltra.ts
 *
 * Jupiter Ultra API integration — gasless swaps.
 *
 * Ultra flow:
 *  1. GET /ultra/v1/order — returns unsigned transaction + requestId
 *  2. Sign via MWA
 *  3. POST /ultra/v1/execute — Jupiter lands the tx (handles priority fees, retries)
 *
 * Gasless: Ultra routes through Jupiter Z (RFQ) where the market maker pays gas,
 * or provides gasless support for qualifying trades (wallet < 0.01 SOL, trade > $10).
 *
 * Fallback: If Ultra fails (unsupported pair, low liquidity), caller falls back to
 * regular Jupiter v2 /build path in jupiterSwap.ts.
 */

import {
  VersionedTransaction,
} from "@solana/web3.js";
import { JUP_API_KEY } from "./constants";

const ULTRA_ORDER_URL = "https://api.jup.ag/ultra/v1/order";
const ULTRA_EXECUTE_URL = "https://api.jup.ag/ultra/v1/execute";
const ULTRA_TIMEOUT = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface UltraOrderResponse {
  requestId: string;
  transaction: string; // base64 unsigned VersionedTransaction
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  swapType: string;
  gasless: boolean;
  feeBps: number;
  feeMint: string;
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
}

export interface UltraQuote {
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inAmount: string;
  outAmount: string;
  inAmountUi: number;
  outAmountUi: number;
  priceImpactPct: number;
  slippageBps: number;
  gasless: boolean;
  requestId: string;
  /** Raw base64 unsigned transaction from Ultra — sign and submit to /execute */
  transaction: string;
  /** Marks this as an Ultra quote for the confirm modal and execution path */
  isUltra: true;
}

export interface UltraExecuteResponse {
  status: "Success" | "Failed";
  signature?: string;
  error?: string;
}

// ── Fetch with timeout ─────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = ULTRA_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Get Ultra Quote (order) ────────────────────────────────────────────────

/**
 * Get a gasless swap quote from Jupiter Ultra.
 * Returns an UltraQuote with the unsigned transaction ready to sign.
 *
 * Throws on failure — caller should catch and fall back to regular swap.
 */
export async function getUltraQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  taker: string,
  inputDecimals: number,
  outputDecimals: number,
  inputSymbol: string,
  outputSymbol: string,
): Promise<UltraQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw,
    taker,
  });

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await fetchWithTimeout(
    `${ULTRA_ORDER_URL}?${params}`,
    { headers },
    ULTRA_TIMEOUT,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ultra order failed (${res.status}): ${body}`);
  }

  const data = await res.json() as UltraOrderResponse;

  if (!data.transaction || !data.requestId) {
    throw new Error("Ultra order response missing transaction or requestId");
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
    slippageBps: data.slippageBps,
    gasless: data.gasless ?? false,
    requestId: data.requestId,
    transaction: data.transaction,
    isUltra: true,
  };
}

// ── Execute Ultra Swap ─────────────────────────────────────────────────────

/**
 * Deserialize the Ultra transaction for MWA signing.
 * Returns a VersionedTransaction the wallet can sign.
 */
export function deserializeUltraTransaction(base64Tx: string): VersionedTransaction {
  const txBytes = Buffer.from(base64Tx, "base64");
  return VersionedTransaction.deserialize(txBytes);
}

/**
 * Submit the signed transaction to Jupiter Ultra /execute endpoint.
 * Jupiter handles priority fees, retries, and transaction landing.
 *
 * Can be polled with the same signedTransaction + requestId for up to 2 minutes.
 */
export async function executeUltraSwap(
  signedTransactionBase64: string,
  requestId: string,
): Promise<UltraExecuteResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await fetchWithTimeout(
    ULTRA_EXECUTE_URL,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        signedTransaction: signedTransactionBase64,
        requestId,
      }),
    },
    ULTRA_TIMEOUT,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ultra execute failed (${res.status}): ${body}`);
  }

  const data = await res.json() as UltraExecuteResponse;

  if (data.status === "Failed") {
    throw new Error(data.error || "Ultra swap execution failed");
  }

  return data;
}
