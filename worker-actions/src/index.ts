/**
 * Cloudflare Worker — OnlyMonkes Solana Actions Server
 *
 * Implements the Solana Actions spec so bot trade alerts render as
 * interactive Blink cards in chat. Users tap to one-tap execute.
 *
 * Endpoints:
 *   GET  /api/actions/swap?inputMint=X&outputMint=Y&amount=Z     → Action metadata
 *   POST /api/actions/swap?inputMint=X&outputMint=Y&amount=Z     → Serialized swap tx
 *   GET  /api/actions/tip?to=WALLET&amount=N                     → Action metadata
 *   POST /api/actions/tip?to=WALLET&amount=N                     → Serialized tip tx
 *   GET  /api/actions/predict?marketId=M&side=yes|no&amount=U&slug=S  → Actions metadata (geo-aware)
 *   POST /api/actions/predict?marketId=M&side=yes|no&amount=U           → Jupiter tx (or geo-restricted msg)
 *   GET  /api/actions/bet?marketId=M&side=yes|no&amount=U&slug=S        → Actions metadata (geo-aware, sports)
 *   POST /api/actions/bet?marketId=M&side=yes|no&amount=U               → Jupiter tx (or geo-restricted msg)
 *   GET  /api/actions/kalshi-bet?ticker=T&outputMint=M&side=yes|no&amount=U&slug=S → Actions metadata (US-legal, Kalshi via DFlow)
 *   POST /api/actions/kalshi-bet?ticker=T&outputMint=M&side=yes|no&amount=U        → DFlow tx (or KYC-required msg)
 *   POST /escrow                                                 → Store ephemeral keypair for tip link
 *   GET  /claim?token=T&wallet=W                                 → Claim a tip link
 *
 * Secrets (set via `wrangler secret put`):
 *   HELIUS_API_KEY     — Helius RPC API key (swaps, sales, stats)
 *   HELIUS_NFT_API_KEY — Helius key used only by /api/verify wallet checks
 *   JUP_API_KEY        — Jupiter Swap API v2 key (get from portal.jup.ag)
 *   BOT_HTTP_SECRET    — Bearer token for authenticated bot endpoints
 *   ESCROW_ENCRYPT_KEY — 256-bit hex key for AES-GCM encryption of ephemeral secrets in KV
 *   ADMIN_WALLET_PUBKEY — admin's Solana wallet base58 address (see adminConfig.ts)
 *   ADMIN_GITHUB_PAT     — fine-grained GitHub PAT, scoped to this repo's Contents only
 *
 * KV Namespaces (create via `wrangler kv:namespace create TIP_ESCROW`):
 *   TIP_ESCROW — stores encrypted ephemeral keypairs for tip links (72h TTL)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PhotonImage, SamplingFilter, resize, watermark } from "@cf-wasm/photon/workerd";
import {
  handleSentimentRegisterDevice,
  handleSentimentUnregisterDevice,
  handleSentimentIngest,
  handleSentimentScore,
  closeSentimentEpoch,
} from "./sentimentOracle";
import {
  handleDeviceIntegrityChallenge,
  handleDeviceIntegrityIssue,
  handleDeviceIntegrityStatus,
} from "./deviceIntegrity";
import {
  handleTreasuryStatus,
  handleTreasurySwapGet,
  handleTreasurySwapPost,
  handleTreasuryStakeGet,
  handleTreasuryStakePost,
  handleTreasuryThreshold,
  handleTreasuryWeeklySummary,
  PUBLISHER_WALLET,
} from "./treasury";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  handleAdSkipGet,
  handleAdSkipPost,
  handleAdSkipVerify,
  handleAdSkipStatus,
} from "./adSkip";
import {
  handleGetLocations,
  handleSetLocation,
  handleGetEvents,
  handleGetEvent,
  handleCreateEvent,
  handleRsvp,
  handleGetRsvps,
  handleGetRsvpStatus,
} from "./community";
import { handlePublishAppConfig } from "./adminConfig";

// Cloudflare Workers KV namespace binding (declared locally to avoid @cloudflare/workers-types dependency)
interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}
interface KVListResult {
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete?: boolean;
  cursor?: string;
}
export interface KVNamespace {
  get(key: string, options?: { type?: string }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVListOptions): Promise<KVListResult>;
}

export interface Env {
  HELIUS_API_KEY: string;
  HELIUS_NFT_API_KEY?: string;
  JUP_API_KEY: string;
  BOT_HTTP_SECRET: string;
  ESCROW_ENCRYPT_KEY: string;
  // Optional in dev — DFlow's dev quote endpoint requires no key. Set in
  // production via `wrangler secret put DFLOW_API_KEY` once we cut over.
  DFLOW_API_KEY?: string;
  // v2.38 (2026-05-26): Helius webhook auth. User configures this string
  // as the `Authorization` header in the Helius webhook dashboard so the
  // worker can verify inbound POSTs are actually from Helius and not a
  // public flooder.
  HELIUS_WEBHOOK_SECRET?: string;
  // 2026-08-05: fallback provider for fetchOwnedMonke() when Helius fails —
  // see that function's doc comment for why a single-provider check isn't
  // safe to use as the app's holder-gate fallback anymore.
  QUICKNODE_DAS_URL?: string;
  // 2026-08-15: third DAS when Helius 429s and QuickNode's trial is dead.
  // Secret is the raw Alchemy key; we build the Solana v2 URL ourselves.
  ALCHEMY_API_KEY?: string;
  TIP_ESCROW: KVNamespace;
  FRAME_ALERTS: KVNamespace;
  // Data Oracle Phase 1 (device attestation + sentiment aggregation) — see
  // sentimentOracle.ts. Create via `wrangler kv:namespace create SENTIMENT_ORACLE`.
  SENTIMENT_ORACLE: KVNamespace;
  // Device Integrity Attestation — see deviceIntegrity.ts. Backend-verified
  // (Key Attestation chain + RASP + Saga/Genesis ownership), no on-chain write.
  DEVICE_INTEGRITY: KVNamespace;
  // Pay-$SKR-to-skip-ads entitlements — see adSkip.ts.
  AD_ENTITLEMENTS: KVNamespace;
  // MonkeGlobe/MonkeEvents public web repo backend — see community.ts.
  COMMUNITY_DATA: KVNamespace;
  // Admin config publish (see adminConfig.ts) — replaces the old app-side
  // classic-PAT-in-SecureStore flow. ADMIN_WALLET_PUBKEY is the admin's
  // Solana wallet base58 address (not the XMTP inboxId); ADMIN_GITHUB_PAT
  // should be a fine-grained PAT scoped to just this one repo, Contents:
  // read/write, nothing else.
  ADMIN_WALLET_PUBKEY?: string;
  ADMIN_GITHUB_PAT?: string;
}

// Cron Trigger types (declared locally, same reasoning as KVNamespace above —
// avoid pulling in @cloudflare/workers-types just for two interfaces).
interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

// Cloudflare Worker handler type (declared locally to avoid @cloudflare/workers-types dependency in app tsconfig)
type ExportedHandler<E = unknown> = {
  fetch: (request: Request, env: E) => Promise<Response>;
  scheduled?: (event: ScheduledEvent, env: E, ctx: ExecutionContext) => Promise<void>;
};

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Content-Encoding, Accept-Encoding",
};

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const FETCH_TIMEOUT = 8_000; // 8s timeout for external API calls

// 2026-08-27: flat swap-notional fee via Jupiter's own platformFeeBps —
// separate dimension from the app/bot's existing realized-profit-only fees
// (see JUP_PLATFORM_FEE_BPS's comment in the app repo's src/lib/constants.ts
// for the full policy context). PUBLISHER_WALLET's wrapped-SOL ATA MUST be
// created on-chain before this has any effect — unverified whether Jupiter
// degrades gracefully or rejects the whole /build request if it doesn't
// exist yet, treat creation as a hard prerequisite.
const JUP_PLATFORM_FEE_BPS = 10; // 0.10%
const JUP_FEE_ACCOUNT_SOL = getAssociatedTokenAddressSync(
  new PublicKey(SOL_MINT),
  PUBLISHER_WALLET,
).toBase58();

/** Jupiter requires feeAccount's mint to match a leg of the swap — only
 *  apply when one side is SOL, {} (no fee) otherwise. Mirrors the app
 *  repo's identical helper in src/lib/jupiterSwap.ts. */
function getPlatformFeeParams(inputMint: string, outputMint: string): Record<string, string> {
  if (inputMint !== SOL_MINT && outputMint !== SOL_MINT) return {};
  return {
    platformFeeBps: String(JUP_PLATFORM_FEE_BPS),
    feeAccount: JUP_FEE_ACCOUNT_SOL,
  };
}
const RPC_TIMEOUT = 10_000;  // 10s for RPC calls

export const ACTION_ICON = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/assets/icon.png";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200, actionHeaders = false): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
  };
  // Solana Actions spec: GET responses must include these headers for wallet compatibility
  if (actionHeaders) {
    headers["X-Action-Version"] = "2.0";
    headers["X-Blockchain-Ids"] = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export function rpcUrl(env: Env): string {
  return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
}

/** Wallet-ownership DAS only — isolated quota from swaps/sales/stats. */
export function verifyRpcUrl(env: Env): string {
  const key = env.HELIUS_NFT_API_KEY || env.HELIUS_API_KEY;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

/** Fetch with timeout — prevents worker from hanging on slow upstream APIs. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Jupiter Swap v2 /build helpers ──────────────────────────────────────────

interface JupBuildInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

export interface JupBuildResponse {
  setupInstructions: JupBuildInstruction[];
  swapInstruction: JupBuildInstruction;
  cleanupInstruction: JupBuildInstruction | null;
  otherInstructions: JupBuildInstruction[];
  computeBudgetInstructions: JupBuildInstruction[];
  addressesByLookupTableAddress: Record<string, string[]>;
  blockhashWithMetadata: {
    blockhash: string | number[]; // Jupiter v2 returns raw bytes, not base58
    lastValidBlockHeight: number;
  };
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  routePlan: any[];
  priceImpactPct?: string;
}

/** Convert a Jupiter blockhash (byte array or base58 string) to base58 string. */
function decodeBlockhash(bh: string | number[]): string {
  if (typeof bh === "string") return bh;
  return bs58.encode(Uint8Array.from(bh));
}

/** Convert a Jupiter instruction to a web3.js TransactionInstruction. */
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

/**
 * Fetch swap instructions from Jupiter Swap v2 /build endpoint.
 * Shared by two very different callers — applyPlatformFee (default false,
 * existing callers unaffected) exists so ONLY the intended caller opts in:
 *   - Blink swap action (/api/actions/swap): a real user trade, fee-free
 *     was an explicit design choice until 2026-08-27 — see
 *     getPlatformFeeParams's comment for why that changed.
 *   - treasury.ts's SOL→SKR pipeline: OnlyMonkes converting its OWN
 *     revenue — there's no other party to charge, applying a fee here
 *     would just be self-dealing. MUST stay false for this caller.
 */
export async function getJupiterBuild(
  inputMint: string,
  outputMint: string,
  amountLamports: string,
  taker: string,
  slippageBps: number,
  env: Env,
  applyPlatformFee = false,
): Promise<JupBuildResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountLamports,
    taker,
    slippageBps: String(slippageBps),
    dynamicSlippage: "true",
    prioritizationFeeLamports: "auto",
    wrapAndUnwrapSol: "true",
    ...(applyPlatformFee ? getPlatformFeeParams(inputMint, outputMint) : {}),
  });

  const headers: Record<string, string> = {};
  if (env.JUP_API_KEY) headers["x-api-key"] = env.JUP_API_KEY;

  const res = await fetchWithTimeout(
    `https://api.jup.ag/swap/v2/build?${params}`,
    { headers },
    FETCH_TIMEOUT,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter build failed (${res.status}): ${body}`);
  }

  const data = await res.json() as JupBuildResponse;

  // Validate response has required fields
  if (!data.swapInstruction || !data.blockhashWithMetadata?.blockhash) {
    throw new Error("Jupiter build response missing swapInstruction or blockhash");
  }

  // Normalize blockhash from byte array to base58 string
  data.blockhashWithMetadata.blockhash = decodeBlockhash(data.blockhashWithMetadata.blockhash);

  return data;
}

/**
 * Assemble Jupiter /build instructions into a VersionedTransaction (v0).
 * The user's wallet will sign this — we don't need any keypair here.
 */
export async function buildSwapTransaction(
  build: JupBuildResponse,
  taker: string,
  env: Env,
): Promise<string> {
  // Collect all instructions in order
  const instructions: TransactionInstruction[] = [];

  // 1. Compute budget — use Jupiter's instructions, add CU limit only if not already present
  const CU_LIMIT_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
  const SET_CU_LIMIT_DISCRIMINATOR = 2; // SetComputeUnitLimit instruction discriminator
  let hasCuLimit = false;
  for (const ix of build.computeBudgetInstructions) {
    const decoded = Buffer.from(ix.data, "base64");
    if (ix.programId === CU_LIMIT_PROGRAM_ID && decoded.length >= 1 && decoded[0] === SET_CU_LIMIT_DISCRIMINATOR) {
      hasCuLimit = true;
    }
    instructions.push(toInstruction(ix));
  }
  if (!hasCuLimit) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  }

  // 2. Setup (ATA creation, etc.)
  for (const ix of build.setupInstructions) {
    instructions.push(toInstruction(ix));
  }

  // 3. Swap
  instructions.push(toInstruction(build.swapInstruction));

  // 4. Cleanup
  if (build.cleanupInstruction) {
    instructions.push(toInstruction(build.cleanupInstruction));
  }

  // 5. Other
  for (const ix of build.otherInstructions) {
    instructions.push(toInstruction(ix));
  }

  // Resolve address lookup tables
  const lutAddresses = Object.keys(build.addressesByLookupTableAddress);
  let lookupTables: AddressLookupTableAccount[] = [];

  if (lutAddresses.length > 0) {
    const connection = new Connection(rpcUrl(env), "finalized");
    const lutAccounts = await Promise.all(
      lutAddresses.map(async (addr) => {
        const res = await connection.getAddressLookupTable(new PublicKey(addr));
        return res.value;
      }),
    );
    lookupTables = lutAccounts.filter((a): a is AddressLookupTableAccount => a !== null);
  }

  // Build v0 message
  const payerKey = new PublicKey(taker);
  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: build.blockhashWithMetadata.blockhash as string,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(messageV0);

  // Serialize unsigned — wallet signs via MWA or Blink adapter
  return Buffer.from(tx.serialize()).toString("base64");
}

// ─── SOL transfer helper (for tips) ───────────────────────────────────────────

async function buildSolTransferTx(
  from: string,
  to: string,
  lamports: number,
  env: Env,
): Promise<string> {
  const connection = new Connection(rpcUrl(env), "finalized");
  const { blockhash } = await connection.getLatestBlockhash("finalized");

  const fromPubkey = new PublicKey(from);
  const toPubkey = new PublicKey(to);

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: fromPubkey,
  });

  tx.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    }),
  );

  // Serialize without signatures — the wallet will sign
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString("base64");
}

// ─── Swap Action ──────────────────────────────────────────────────────────────

function handleSwapGet(url: URL): Response {
  const inputMint = url.searchParams.get("inputMint") || SOL_MINT;
  const outputMint = url.searchParams.get("outputMint");
  const amount = url.searchParams.get("amount") || "0.1";
  const symbol = url.searchParams.get("symbol") || "token";

  if (!outputMint) return errorResponse("Missing outputMint");

  const isBuy = inputMint === SOL_MINT;
  const label = isBuy ? `Buy ${symbol}` : `Sell ${symbol}`;
  const description = isBuy
    ? `Swap ${amount} SOL for ${symbol} via Jupiter`
    : `Swap ${symbol} for SOL via Jupiter`;

  // Solana Actions metadata response
  const metadata = {
    type: "action",
    icon: ACTION_ICON,
    title: `OnlyMonkes — ${label}`,
    description,
    label,
    links: {
      actions: [
        {
          label: `${label} (${amount} SOL)`,
          href: `/api/actions/swap?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&symbol=${symbol}`,
          type: "transaction",
        },
        // Quick amount buttons for buys
        ...(isBuy
          ? [
              {
                label: "0.05 SOL",
                href: `/api/actions/swap?inputMint=${inputMint}&outputMint=${outputMint}&amount=0.05&symbol=${symbol}`,
                type: "transaction" as const,
              },
              {
                label: "0.5 SOL",
                href: `/api/actions/swap?inputMint=${inputMint}&outputMint=${outputMint}&amount=0.5&symbol=${symbol}`,
                type: "transaction" as const,
              },
            ]
          : []),
      ],
    },
  };

  return jsonResponse(metadata, 200, true);
}

async function handleSwapPost(url: URL, body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") {
    return errorResponse("Missing account");
  }

  // Validate wallet address
  try { new PublicKey(account); } catch {
    return errorResponse("Invalid wallet address");
  }

  const inputMint = url.searchParams.get("inputMint") || SOL_MINT;
  const outputMint = url.searchParams.get("outputMint");
  const amount = parseFloat(url.searchParams.get("amount") || "0");

  if (!outputMint) return errorResponse("Missing outputMint");

  // Validate mints
  try { new PublicKey(inputMint); new PublicKey(outputMint); } catch {
    return errorResponse("Invalid token mint");
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 5) {
    return errorResponse("Invalid amount (max 5 SOL)");
  }

  try {
    // Convert SOL amount to lamports
    const amountLamports = String(Math.round(amount * LAMPORTS_PER_SOL));

    // 1. Get swap instructions from Jupiter v2 /build
    // 2026-08-27: applyPlatformFee=true — see getJupiterBuild's doc comment
    // for why Blinks moved off "fee-free" and what stays unaffected.
    const build = await getJupiterBuild(inputMint, outputMint, amountLamports, account, 50, env, true);

    // Validate price impact
    const priceImpact = parseFloat(build.priceImpactPct || "0");
    if (priceImpact > 15) {
      return errorResponse("Price impact too high (>15%)");
    }

    // 2. Assemble into VersionedTransaction
    const swapTransaction = await buildSwapTransaction(build, account, env);

    return jsonResponse({
      type: "transaction",
      transaction: swapTransaction,
      message: `Swapping ${amount} SOL via Jupiter`,
    });
  } catch (err) {
    return errorResponse(`Swap failed: ${(err as Error).message}`, 500);
  }
}

// ─── Tip Action ───────────────────────────────────────────────────────────────

function handleTipGet(url: URL): Response {
  const to = url.searchParams.get("to");
  const amount = url.searchParams.get("amount") || "0.01";
  const username = encodeURIComponent(url.searchParams.get("username") || "Monke");

  if (!to) return errorResponse("Missing recipient wallet (to)");

  const metadata = {
    type: "action",
    icon: ACTION_ICON,
    title: `Tip ${decodeURIComponent(username)}`,
    description: `Send ${amount} SOL to ${decodeURIComponent(username)}`,
    label: `Tip ${amount} SOL`,
    links: {
      actions: [
        {
          label: `Tip ${amount} SOL`,
          href: `/api/actions/tip?to=${to}&amount=${amount}&username=${username}`,
          type: "transaction",
        },
        {
          label: "0.01 SOL",
          href: `/api/actions/tip?to=${to}&amount=0.01&username=${username}`,
          type: "transaction" as const,
        },
        {
          label: "0.05 SOL",
          href: `/api/actions/tip?to=${to}&amount=0.05&username=${username}`,
          type: "transaction" as const,
        },
        {
          label: "0.1 SOL",
          href: `/api/actions/tip?to=${to}&amount=0.1&username=${username}`,
          type: "transaction" as const,
        },
      ],
    },
  };

  return jsonResponse(metadata, 200, true);
}

async function handleTipPost(url: URL, body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") {
    return errorResponse("Missing account");
  }

  // Validate wallet addresses
  try { new PublicKey(account); } catch {
    return errorResponse("Invalid wallet address");
  }

  const to = url.searchParams.get("to");
  const amount = parseFloat(url.searchParams.get("amount") || "0");

  if (!to) return errorResponse("Missing recipient wallet (to)");
  try { new PublicKey(to); } catch {
    return errorResponse("Invalid recipient wallet");
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10) {
    return errorResponse("Invalid amount (0 < amount <= 10 SOL)");
  }

  try {
    const lamports = Math.round(amount * LAMPORTS_PER_SOL);
    const tx = await buildSolTransferTx(account, to, lamports, env);

    return jsonResponse({
      type: "transaction",
      transaction: tx,
      message: `Sending ${amount} SOL tip`,
    });
  } catch (err) {
    return errorResponse(`Tip failed: ${(err as Error).message}`, 500);
  }
}

// ─── Jupiter Prediction API (Polymarket + Kalshi via Jupiter) ────────────────
//
// Geo policy: Jupiter blocks US + KR IPs on the /orders endpoint. Rather than
// return 500s to those users, we detect the caller's country via Cloudflare's
// `cf-ipcountry` header and return a graceful "View on Polymarket" card. Users
// can also mute the channel entirely via the menu drawer if they'd rather not
// see the alerts at all.

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP_PREDICTION_BASE = "https://api.jup.ag/prediction/v1";
const USDC_MICRO = 1_000_000;
const PREDICTION_MAX_USDC = 100;
const GEOBLOCKED_COUNTRIES = new Set(["US", "KR"]);

interface JupOrderResponse {
  transaction?: string;
  message?: string;
  error?: string;
}

/** Request an unsigned prediction order transaction from Jupiter. */
async function getJupiterPredictionOrder(
  ownerPubkey: string,
  marketId: string,
  isYes: boolean,
  amountUsdc: number,
  env: Env,
): Promise<string> {
  const depositAmount = String(Math.round(amountUsdc * USDC_MICRO));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.JUP_API_KEY) headers["x-api-key"] = env.JUP_API_KEY;

  const body = JSON.stringify({
    ownerPubkey, marketId, isYes, isBuy: true, depositAmount, depositMint: USDC_MINT,
  });

  const res = await fetchWithTimeout(
    `${JUP_PREDICTION_BASE}/orders`,
    { method: "POST", headers, body },
    FETCH_TIMEOUT,
  );

  const text = await res.text();
  let data: JupOrderResponse;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!res.ok || !data.transaction) {
    const detail = data.error || data.message || text.slice(0, 200);
    throw new Error(`Jupiter prediction order failed (${res.status}): ${detail}`);
  }
  return data.transaction;
}

// ─── Predict / Bet Actions ────────────────────────────────────────────────────

type PredictKind = "predict" | "bet";

function handlePredictGet(url: URL, kind: PredictKind, request: Request): Response {
  const marketId = url.searchParams.get("marketId");
  const side = (url.searchParams.get("side") || "yes").toLowerCase();
  const amount = url.searchParams.get("amount") || "5";
  const label = url.searchParams.get("label") || "market";
  const slug = url.searchParams.get("slug") || "";

  if (!marketId) return errorResponse("Missing marketId");
  if (side !== "yes" && side !== "no") return errorResponse("side must be yes or no");

  const country = (request.headers.get("cf-ipcountry") || "").toUpperCase();
  const isGeoBlocked = GEOBLOCKED_COUNTRIES.has(country);

  const sideUpper = side.toUpperCase();

  // Geo-blocked region: show informational card with Polymarket link only.
  if (isGeoBlocked) {
    const polymarketUrl = slug
      ? `https://polymarket.com/event/${encodeURIComponent(slug)}`
      : "https://polymarket.com/";
    const title = kind === "bet"
      ? `Trading restricted — ${decodeURIComponent(label)}`
      : `Trading restricted — ${decodeURIComponent(label)}`;

    return jsonResponse({
      type: "action",
      icon: ACTION_ICON,
      title: `OnlyMonkes — ${title}`,
      description: `Jupiter & Polymarket block one-click trading in ${country}. Tap to view the market directly, or mute this channel in the OnlyMonkes menu drawer to hide alerts like this.`,
      label: "View on Polymarket",
      links: {
        actions: [
          { label: "View on Polymarket", href: polymarketUrl, type: "external-link" as const },
        ],
      },
    }, 200, true);
  }

  // Non-blocked regions: full Blink with Custom $ + quick amounts
  const verb = kind === "bet" ? "Bet" : "Buy";
  const title = kind === "bet"
    ? `Bet ${sideUpper} — ${decodeURIComponent(label)}`
    : `Predict ${sideUpper} — ${decodeURIComponent(label)}`;
  const description = `${verb} ${sideUpper} shares on this market via Jupiter (Polymarket liquidity). Settles in USDC.`;

  const mkHref = (amt: string) =>
    `/api/actions/${kind}?marketId=${encodeURIComponent(marketId)}&side=${side}&amount=${amt}&label=${encodeURIComponent(label)}&slug=${encodeURIComponent(slug)}`;

  const metadata = {
    type: "action",
    icon: ACTION_ICON,
    title: `OnlyMonkes — ${title}`,
    description,
    label: `${verb} ${sideUpper}`,
    links: {
      actions: [
        {
          label: `${verb} ${sideUpper} Custom $`,
          href: mkHref("{amount}"),
          type: "transaction" as const,
          parameters: [
            {
              name: "amount",
              label: "USDC amount (1–100)",
              type: "number" as const,
              required: true,
              min: 1,
              max: PREDICTION_MAX_USDC,
            },
          ],
        },
        { label: "$5",  href: mkHref("5"),  type: "transaction" as const },
        { label: "$25", href: mkHref("25"), type: "transaction" as const },
      ],
    },
  };
  return jsonResponse(metadata, 200, true);
}

async function handlePredictPost(url: URL, body: any, env: Env, kind: PredictKind, request: Request): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") return errorResponse("Missing account");
  try { new PublicKey(account); } catch { return errorResponse("Invalid wallet address"); }

  // Geo gate: US/KR → return a clean completed-action payload instead of 500
  const country = (request.headers.get("cf-ipcountry") || "").toUpperCase();
  if (GEOBLOCKED_COUNTRIES.has(country)) {
    return jsonResponse({
      type: "completed",
      icon: ACTION_ICON,
      title: "Trading restricted in your region",
      description: `Jupiter & Polymarket do not permit one-click trading from ${country}. View the market on polymarket.com to trade via their own interface.`,
      label: "Restricted",
    }, 200, true);
  }

  const marketId = url.searchParams.get("marketId");
  const side = (url.searchParams.get("side") || "").toLowerCase();
  const amount = parseFloat(url.searchParams.get("amount") || "0");

  if (!marketId) return errorResponse("Missing marketId");
  if (side !== "yes" && side !== "no") return errorResponse("side must be yes or no");
  if (!Number.isFinite(amount) || amount <= 0 || amount > PREDICTION_MAX_USDC) {
    return errorResponse(`Invalid amount (0 < amount <= ${PREDICTION_MAX_USDC} USDC)`);
  }

  try {
    const tx = await getJupiterPredictionOrder(account, marketId, side === "yes", amount, env);
    const verb = kind === "bet" ? "bet" : "prediction";
    return jsonResponse({
      type: "transaction",
      transaction: tx,
      message: `Placing $${amount} USDC ${verb} on ${side.toUpperCase()}`,
    });
  } catch (err) {
    return errorResponse(`${kind} failed: ${(err as Error).message}`, 500);
  }
}

// ─── DFlow + Kalshi (US-legal one-click bet via Solflare KYC) ─────────────────
//
// Why this exists:
//   Polymarket via Jupiter is geo-blocked for US/KR. Kalshi is the only
//   CFTC-regulated US-legal prediction exchange, and DFlow tokenizes Kalshi
//   contracts as SPL tokens on Solana. Solflare ships KYC + DFlow trading
//   in-wallet to 4M+ users. This endpoint is the matching one-click trade
//   surface for OnlyMonkes alerts that flow from `dflowKalshiClient.ts`.
//
// Geo policy:
//   NO geo gate. Kalshi is US-legal — that's the entire point. We DO surface
//   a clean "wallet not KYC'd" error when DFlow rejects the order so users
//   know to complete the Proof flow in Solflare first.
//
// KYC model:
//   Kalshi binds verification to a wallet PUBLIC KEY (not to Solflare
//   specifically). Once a wallet completes the DFlow Proof + Kalshi KYC
//   handshake, the same keypair can sign DFlow orders from any signer —
//   Solflare in-app, MWA on Seeker, or any wallet that signs Solana txs.

const DFLOW_QUOTE_BASE = "https://quote-api.dflow.net";
const KALSHI_MAX_USDC = 100;
// Inline kalshiYesMint / kalshiNoMint instead of a separate side enum: DFlow
// has no side flag — passing the YES mint as outputMint = buying YES, and
// vice versa. The bot still sends a `side=yes|no` query param so the GET
// metadata can render "Bet YES" copy without us having to look up which mint
// is which.

interface DFlowOrderResponse {
  outAmount?: string;
  executionMode?: "sync" | "async";
  transaction?: string;        // base64 VersionedTransaction
  lastValidBlockHeight?: number;
  revertMint?: string;
  error?: string;
  message?: string;
}

/** Build the DFlow /order URL. All params are URL-encoded query string. */
function buildDFlowOrderUrl(opts: {
  ownerPubkey: string;
  outputMint: string;
  amountUsdc: number;
}): string {
  const amountBaseUnits = String(Math.round(opts.amountUsdc * USDC_MICRO));
  const params = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: opts.outputMint,
    amount: amountBaseUnits,
    userPublicKey: opts.ownerPubkey,
    slippageBps: "auto",
    dynamicComputeUnitLimit: "true",
    prioritizationFeeLamports: "5000",
  });
  return `${DFLOW_QUOTE_BASE}/order?${params}`;
}

/** Hit DFlow's /order endpoint and return the base64 unsigned transaction. */
async function getDFlowKalshiOrder(opts: {
  ownerPubkey: string;
  outputMint: string;
  amountUsdc: number;
  env: Env;
}): Promise<string> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (opts.env.DFLOW_API_KEY) headers["x-api-key"] = opts.env.DFLOW_API_KEY;

  const res = await fetchWithTimeout(
    buildDFlowOrderUrl(opts),
    { method: "GET", headers },
    FETCH_TIMEOUT,
  );

  const text = await res.text();
  let data: DFlowOrderResponse;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!res.ok || !data.transaction) {
    const detail = data.error || data.message || text.slice(0, 200);
    // Surface the raw status + message so the caller can pattern-match for
    // KYC rejection and route to a friendlier action card.
    throw new Error(`DFlow order failed (${res.status}): ${detail}`);
  }
  return data.transaction;
}

/** Detect "wallet not KYC'd" in DFlow's error message. DFlow's exact wording
 * isn't documented for the dev endpoint, so match on common substrings.
 * Falls back to false → show generic error. */
function isKycError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("kyc") ||
    m.includes("verified") ||
    m.includes("verification") ||
    m.includes("proof") ||
    m.includes("not allowed") ||
    m.includes("forbidden")
  );
}

/** Kalshi prices are 0..1 probabilities — but the Blink URL passes them as
 * cents (integer 1..99) for clean URL encoding. Decode back to a fraction
 * for payout math. Returns null if missing/invalid → payout copy is omitted. */
function parseEntryPriceCents(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 1 || n > 99) return null;
  return n / 100;
}

/** Estimated payout USDC if the bet wins. Kalshi YES/NO contracts settle to
 * $1 each — buying YES @ $0.42 with $5 nets ~$11.90 if YES wins. Approximate
 * (ignores DFlow fee + slippage) — the wallet shows the exact figure on sign. */
function estimatePayoutUsdc(amountUsdc: number, entryPrice: number): number {
  if (entryPrice <= 0) return 0;
  return amountUsdc / entryPrice;
}

function handleKalshiBetGet(url: URL): Response {
  const ticker = url.searchParams.get("ticker");
  const outputMint = url.searchParams.get("outputMint");
  const side = (url.searchParams.get("side") || "yes").toLowerCase();
  const amount = url.searchParams.get("amount") || "5";
  const label = url.searchParams.get("label") || "market";
  const slug = url.searchParams.get("slug") || "";
  const entryPriceRaw = url.searchParams.get("entryPrice") || "";

  if (!ticker) return errorResponse("Missing ticker");
  if (!outputMint) return errorResponse("Missing outputMint");
  try { new PublicKey(outputMint); } catch { return errorResponse("Invalid outputMint"); }
  if (side !== "yes" && side !== "no") return errorResponse("side must be yes or no");

  const sideUpper = side.toUpperCase();
  const entryPrice = parseEntryPriceCents(entryPriceRaw);
  const priceCopy = entryPrice !== null ? ` @ ${(entryPrice * 100).toFixed(0)}¢` : "";
  const title = `Bet ${sideUpper}${priceCopy} — ${decodeURIComponent(label)}`;
  const description = `Bet ${sideUpper} on this Kalshi market via DFlow (CFTC-regulated, US-legal). Settles in USDC. Wallet must be Kalshi-verified through Solflare's Proof flow.`;

  // Preserve entryPrice on every action button so the post-trade card has it.
  const mkHref = (amt: string) =>
    `/api/actions/kalshi-bet?ticker=${encodeURIComponent(ticker)}&outputMint=${encodeURIComponent(outputMint)}&side=${side}&amount=${amt}&label=${encodeURIComponent(label)}&slug=${encodeURIComponent(slug)}${entryPriceRaw ? `&entryPrice=${encodeURIComponent(entryPriceRaw)}` : ""}`;

  const kalshiUrl = slug
    ? `https://kalshi.com/markets/${encodeURIComponent(slug)}`
    : "https://kalshi.com/";

  return jsonResponse({
    type: "action",
    icon: ACTION_ICON,
    title: `OnlyMonkes — ${title}`,
    description,
    label: `Bet ${sideUpper}`,
    links: {
      actions: [
        {
          label: `Bet ${sideUpper} Custom $`,
          href: mkHref("{amount}"),
          type: "transaction" as const,
          parameters: [
            {
              name: "amount",
              label: "USDC amount (1–100)",
              type: "number" as const,
              required: true,
              min: 1,
              max: KALSHI_MAX_USDC,
            },
          ],
        },
        { label: "$5",  href: mkHref("5"),  type: "transaction" as const },
        { label: "$25", href: mkHref("25"), type: "transaction" as const },
        { label: "View on Kalshi", href: kalshiUrl, type: "external-link" as const },
      ],
    },
  }, 200, true);
}

async function handleKalshiBetPost(url: URL, body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") return errorResponse("Missing account");
  try { new PublicKey(account); } catch { return errorResponse("Invalid wallet address"); }

  const outputMint = url.searchParams.get("outputMint");
  const side = (url.searchParams.get("side") || "").toLowerCase();
  const amount = parseFloat(url.searchParams.get("amount") || "0");
  const label = url.searchParams.get("label") || "market";
  const slug = url.searchParams.get("slug") || "";
  const entryPrice = parseEntryPriceCents(url.searchParams.get("entryPrice"));

  if (!outputMint) return errorResponse("Missing outputMint");
  try { new PublicKey(outputMint); } catch { return errorResponse("Invalid outputMint"); }
  if (side !== "yes" && side !== "no") return errorResponse("side must be yes or no");
  if (!Number.isFinite(amount) || amount <= 0 || amount > KALSHI_MAX_USDC) {
    return errorResponse(`Invalid amount (0 < amount <= ${KALSHI_MAX_USDC} USDC)`);
  }

  try {
    const tx = await getDFlowKalshiOrder({
      ownerPubkey: account,
      outputMint,
      amountUsdc: amount,
      env,
    });

    // Build the polished post-trade card. Inline `links.next` means the wallet
    // renders this immediately after the user signs — no extra round-trip to
    // the worker. Spec: any ActionGetResponse shape works; we use `completed`
    // so it shows as a finished action with no further buttons.
    const sideUpper = side.toUpperCase();
    const labelDecoded = decodeURIComponent(label);
    const payoutCopy = entryPrice !== null
      ? ` If ${sideUpper} settles, you'll receive ~$${estimatePayoutUsdc(amount, entryPrice).toFixed(2)} USDC (${(1 / entryPrice).toFixed(2)}x).`
      : "";
    const entryCopy = entryPrice !== null ? ` @ ${(entryPrice * 100).toFixed(0)}¢` : "";
    const kalshiUrl = slug
      ? `https://kalshi.com/markets/${encodeURIComponent(slug)}`
      : "https://kalshi.com/";

    return jsonResponse({
      type: "transaction",
      transaction: tx,
      message: `Bet $${amount} USDC on ${sideUpper}${entryCopy} — ${labelDecoded}`,
      links: {
        next: {
          type: "inline" as const,
          action: {
            type: "completed" as const,
            icon: ACTION_ICON,
            title: `Position open — ${sideUpper}${entryCopy}`,
            description: `You bought $${amount} of ${sideUpper} on "${labelDecoded}".${payoutCopy} Tracking via Kalshi — settles to your wallet automatically.`,
            label: "Done",
            links: {
              actions: [
                { label: "View on Kalshi", href: kalshiUrl, type: "external-link" as const },
              ],
            },
          },
        },
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    // KYC rejection path: return a `completed`-type action card with a clear
    // call-to-action to verify in Solflare. We can't open Solflare's KYC flow
    // from a Blink directly, so the user has to leave the chat — frame it as
    // a one-time setup instead of a generic 500.
    if (isKycError(msg)) {
      return jsonResponse({
        type: "completed",
        icon: ACTION_ICON,
        title: "Wallet not Kalshi-verified",
        description: "Kalshi requires KYC before trading prediction markets. Open Solflare → Settings → Proof to complete a one-time identity verification, then come back and try again.",
        label: "Open Solflare",
      }, 200, true);
    }
    return errorResponse(`Kalshi bet failed: ${msg}`, 500);
  }
}

// ─── actions.json (spec: well-known discovery) ────────────────────────────────

function handleActionsJson(requestUrl: URL): Response {
  return jsonResponse({
    rules: [
      {
        pathPattern: "/api/actions/swap**",
        apiPath: "/api/actions/swap**",
      },
      {
        pathPattern: "/api/actions/tip**",
        apiPath: "/api/actions/tip**",
      },
      {
        pathPattern: "/api/actions/predict**",
        apiPath: "/api/actions/predict**",
      },
      {
        pathPattern: "/api/actions/bet**",
        apiPath: "/api/actions/bet**",
      },
      {
        pathPattern: "/api/actions/kalshi-bet**",
        apiPath: "/api/actions/kalshi-bet**",
      },
    ],
  });
}

// ─── Escrow Encryption (AES-256-GCM via Web Crypto API) ──────────────────────

const ESCROW_TTL_SECONDS = 72 * 60 * 60; // 72 hours
const CLAIM_RATE_LIMIT_WINDOW = 60; // 60 seconds
const CLAIM_RATE_LIMIT_MAX = 10; // max 10 claim attempts per IP per window

/** Import the ESCROW_ENCRYPT_KEY (hex string) as a CryptoKey for AES-GCM. */
async function getEncryptionKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  if (keyBytes.length !== 32) throw new Error("ESCROW_ENCRYPT_KEY must be 64 hex chars (256 bits)");
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt data with AES-256-GCM, returns base64(iv + ciphertext). */
async function encryptData(plaintext: string, hexKey: string): Promise<string> {
  const key = await getEncryptionKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  // Convert to base64 using btoa (available in CF Workers)
  let binary = "";
  for (const byte of combined) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decrypt data from base64(iv + ciphertext). */
async function decryptData(encoded: string, hexKey: string): Promise<string> {
  const key = await getEncryptionKey(hexKey);
  const binary = atob(encoded);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

function checkBotAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.BOT_HTTP_SECRET}`;
}

// ─── Escrow: POST /escrow ────────────────────────────────────────────────────

async function handleEscrowPost(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) {
    return errorResponse("Unauthorized", 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { token, ephemeralSecret, pubkey, amountSol, fundingTx } = body;

  // Validate token
  if (!token || typeof token !== "string" || token.length < 16 || token.length > 128) {
    return errorResponse("Invalid or missing token");
  }

  // Validate ephemeralSecret is a 64-byte array
  if (
    !Array.isArray(ephemeralSecret) ||
    ephemeralSecret.length !== 64 ||
    !ephemeralSecret.every((b: unknown) => typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255)
  ) {
    return errorResponse("ephemeralSecret must be a 64-byte integer array");
  }

  // Validate amountSol
  const amount = typeof amountSol === "number" ? amountSol : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10) {
    return errorResponse("amountSol must be > 0 and <= 10");
  }

  // Validate pubkey is valid base58 Solana address
  try {
    new PublicKey(pubkey);
  } catch {
    return errorResponse("Invalid pubkey (must be valid base58 Solana address)");
  }

  // Validate fundingTx
  if (!fundingTx || typeof fundingTx !== "string") {
    return errorResponse("Missing fundingTx");
  }

  // Encrypt the ephemeral secret before storing
  const encryptedSecret = await encryptData(JSON.stringify(ephemeralSecret), env.ESCROW_ENCRYPT_KEY);

  const kvValue = JSON.stringify({
    ephemeralSecret: encryptedSecret,
    pubkey,
    amountSol: amount,
    fundingTx,
    createdAt: Date.now(),
  });

  await env.TIP_ESCROW.put(token, kvValue, { expirationTtl: ESCROW_TTL_SECONDS });

  return jsonResponse({ ok: true });
}

// ─── Escrow: GET /claim ──────────────────────────────────────────────────────

async function handleClaim(url: URL, request: Request, env: Env): Promise<Response> {
  // Rate limiting by IP — simple KV counter
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:claim:${clientIp}`;
  const currentCount = parseInt(await env.TIP_ESCROW.get(rateLimitKey) || "0", 10);
  if (currentCount >= CLAIM_RATE_LIMIT_MAX) {
    return errorResponse("Too many claim attempts. Try again later.", 429);
  }
  // Increment rate limit counter (fire-and-forget, non-blocking)
  await env.TIP_ESCROW.put(rateLimitKey, String(currentCount + 1), { expirationTtl: CLAIM_RATE_LIMIT_WINDOW });

  const token = url.searchParams.get("token");
  const wallet = url.searchParams.get("wallet");

  if (!token || typeof token !== "string") {
    return errorResponse("Missing token parameter");
  }
  if (!wallet || typeof wallet !== "string") {
    return errorResponse("Missing wallet parameter");
  }

  // Validate recipient wallet
  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(wallet);
  } catch {
    return errorResponse("Invalid wallet address");
  }

  // Retrieve escrow entry
  const kvRaw = await env.TIP_ESCROW.get(token);
  if (!kvRaw) {
    return errorResponse("Tip already claimed or expired", 404);
  }

  // Delete BEFORE submitting tx to prevent double-claim race condition
  await env.TIP_ESCROW.delete(token);

  let escrow: { ephemeralSecret: string; pubkey: string; amountSol: number; fundingTx: string; createdAt: number };
  try {
    escrow = JSON.parse(kvRaw);
  } catch {
    return errorResponse("Corrupted escrow data", 500);
  }

  // Decrypt ephemeral secret
  let secretBytes: number[];
  try {
    const decrypted = await decryptData(escrow.ephemeralSecret, env.ESCROW_ENCRYPT_KEY);
    secretBytes = JSON.parse(decrypted);
  } catch {
    return errorResponse("Failed to decrypt escrow", 500);
  }

  // Reconstruct ephemeral keypair
  let ephemeralKeypair: Keypair;
  try {
    ephemeralKeypair = Keypair.fromSecretKey(Uint8Array.from(secretBytes));
  } catch {
    return errorResponse("Invalid ephemeral keypair", 500);
  }

  // Verify pubkey matches
  if (ephemeralKeypair.publicKey.toBase58() !== escrow.pubkey) {
    return errorResponse("Escrow keypair mismatch", 500);
  }

  try {
    const connection = new Connection(rpcUrl(env), "confirmed");

    // Get ephemeral account balance
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    if (balance === 0) {
      return errorResponse("Escrow account has no funds", 400);
    }

    // Estimate fee for a simple transfer (5000 lamports typical)
    const estimatedFee = 5000;
    const transferAmount = balance - estimatedFee;
    if (transferAmount <= 0) {
      return errorResponse("Escrow balance too low to cover transaction fee", 400);
    }

    // Build transfer: ephemeral → recipient
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: ephemeralKeypair.publicKey,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: ephemeralKeypair.publicKey,
        toPubkey: recipientPubkey,
        lamports: transferAmount,
      }),
    );

    // Sign with ephemeral keypair
    tx.sign(ephemeralKeypair);

    // Submit transaction
    const rawTx = tx.serialize();
    const signature = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    // Wait for confirmation (with timeout)
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    const claimedSol = transferAmount / LAMPORTS_PER_SOL;

    return jsonResponse({
      ok: true,
      signature,
      amountSol: parseFloat(claimedSol.toFixed(6)),
    });
  } catch (err) {
    return errorResponse(`Claim failed: ${(err as Error).message}`, 500);
  }
}

// ─── Helius webhook relay (v2.38, 2026-05-26) ───────────────────────────────
//
// Architecture:
//   Helius webhook delivers parsed tx batches → POST /helius-webhook (this).
//   We append each tx to a single FRAME_ALERTS key `helius:queue` (ring of
//   200, TTL 10 min). Bot polls GET /helius-events?since=<epoch-ms> to drain.
//   A per-event-key + KV list() scan blew Cloudflare's daily list cap and
//   surfaced as error 1101 — do not go back to list().
//
// Auth:
//   Helius → us: validate `Authorization` header matches HELIUS_WEBHOOK_SECRET.
//   Bot → us: standard Bearer BOT_HTTP_SECRET (same gate as /escrow).
//
// Reuses FRAME_ALERTS KV namespace to avoid asking the operator to provision
// a new binding. The `helius:` key prefix isolates this traffic from frames.

const HELIUS_EVENT_TTL = 10 * 60; // 10 minutes
const HELIUS_QUEUE_KEY = "helius:queue";
const HELIUS_QUEUE_CAP = 200;

type QueuedHeliusEvent = { ts: number; event: Record<string, unknown> };

async function handleHeliusWebhook(request: Request, env: Env): Promise<Response> {
  // Validate Helius's outbound auth header. If HELIUS_WEBHOOK_SECRET isn't
  // configured we refuse the write rather than accept anonymous input —
  // makes misconfiguration loud instead of silent.
  const secret = env.HELIUS_WEBHOOK_SECRET || "";
  if (!secret) {
    return errorResponse("Webhook secret not configured", 503);
  }
  const auth = request.headers.get("Authorization") || "";
  if (auth !== secret) {
    return errorResponse("Unauthorized", 401);
  }
  if (!env.FRAME_ALERTS) {
    return errorResponse("FRAME_ALERTS unbound", 503);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return errorResponse("Invalid JSON body");
  }
  // Helius sends an array of parsed transactions. Defensive: accept either
  // a single object or an array, then normalize.
  const events: Array<Record<string, unknown>> = Array.isArray(body)
    ? body as Array<Record<string, unknown>>
    : [body as Record<string, unknown>];

  let queue: QueuedHeliusEvent[] = [];
  try {
    const raw = await env.FRAME_ALERTS.get(HELIUS_QUEUE_KEY);
    if (raw) queue = JSON.parse(raw) as QueuedHeliusEvent[];
    if (!Array.isArray(queue)) queue = [];
  } catch {
    queue = [];
  }

  let written = 0;
  for (const event of events) {
    const sig = typeof event.signature === "string" ? event.signature : null;
    if (!sig) continue;
    const tsSec = typeof event.timestamp === "number" ? event.timestamp : Math.floor(Date.now() / 1000);
    queue.push({ ts: tsSec * 1000, event });
    written++;
  }
  if (queue.length > HELIUS_QUEUE_CAP) queue = queue.slice(-HELIUS_QUEUE_CAP);
  try {
    await env.FRAME_ALERTS.put(HELIUS_QUEUE_KEY, JSON.stringify(queue), { expirationTtl: HELIUS_EVENT_TTL });
  } catch (err) {
    return errorResponse(`KV put failed: ${(err as Error).message}`, 500);
  }
  return jsonResponse({ ok: true, written, received: events.length });
}

async function handleHeliusEvents(url: URL, request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  if (!env.FRAME_ALERTS) {
    return errorResponse("FRAME_ALERTS unbound", 503);
  }
  try {
    const sinceParam = url.searchParams.get("since") ?? "0";
    const since = parseInt(sinceParam, 10) || 0;
    const limitParam = url.searchParams.get("limit") ?? "100";
    const limit = Math.max(1, Math.min(parseInt(limitParam, 10) || 100, 500));

    // Single-key ring buffer — Workers KV `list()` has a daily op cap that
    // the previous per-event-key scan blew every 10s (CF 1101 / "list()
    // limit exceeded for the day"). GET of one key is the allowed hot path.
    const raw = await env.FRAME_ALERTS.get(HELIUS_QUEUE_KEY);
    let queue: QueuedHeliusEvent[] = [];
    if (raw) {
      try { queue = JSON.parse(raw) as QueuedHeliusEvent[]; } catch { queue = []; }
    }
    if (!Array.isArray(queue)) queue = [];
    const collected = queue
      .filter((row) => row && typeof row.ts === "number" && row.ts > since && row.event)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, limit);
    const nextCursor = collected.length > 0 ? collected[collected.length - 1].ts : since;
    return jsonResponse({
      events: collected.map((c) => c.event),
      count: collected.length,
      nextCursor,
    });
  } catch (err) {
    return errorResponse(`helius-events: ${(err as Error).message ?? "unknown"}`, 500);
  }
}

// ─── Farcaster Frames — Trade Alert Frames ──────────────────────────────────

const FRAME_ALERT_TTL = 30 * 24 * 60 * 60; // 30 days

interface FrameAlertData {
  id: string;
  token: string;       // e.g. "SOL", "BONK"
  signal: "BULLISH" | "BEARISH";
  confluence: number;  // 0-100
  entry: number;
  target1: number;
  target2?: number;
  stop: number;
  price: number;       // current price at alert time
  timestamp: number;
}

const WORKER_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const APP_DEEP_LINK = "https://onlymonkes.app";
const DAPP_STORE_LINK = "https://dappstore.app/onlymonkes";
// 2026-07-30: not everyone sharing/receiving a /monke/:mint link is on a
// Solana Mobile device with the dApp Store available — a direct APK link
// is the fallback for regular Android phones. Resolved dynamically (see
// getLatestApkUrl) rather than hardcoding a version, so it never goes stale.
const GITHUB_RELEASES_API = "https://api.github.com/repos/jumpstreet25/OnlyMonkes/releases/latest";
const GITHUB_RELEASES_PAGE = "https://github.com/jumpstreet25/OnlyMonkes/releases/latest";
const APK_URL_KV_KEY = "apk:latest-url";
const APK_URL_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — avoid hammering GitHub's API on every click

// ─── Public stats / "Check Your Monke" preview page ──────────────────────────
// 2026-07-30: zero-install growth funnel. Independently fetches the same
// public data the bot's chat digests already show (holder count, floor
// price, recent sales) so this page never depends on the bot process, the
// cloudflared tunnel (rotates URL on every restart — confirmed unstable),
// or the Mac being awake. Same collection/creator addresses the bot uses
// (src/lib/alerts/holderSnapshot.ts, src/lib/nft/sagaMonkesSales.ts).

const SAGA_COLLECTION_MINT = "GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF";
const SAGA_CREATOR_WALLET = "8McVhmNjsYSkwQ34QXJb2ADgLWERcHcpqxSzRZUCRZfQ";
const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const STATS_KV_KEY = "stats:latest";
const TOP_TRADERS_KV_KEY = "top_traders:latest";
// AutonoMonke Signals API, Phase 1 (2026-08-25 research digest). Free/
// unauthenticated GET for now — no x402 gate yet, see handleSignalsGet's
// doc comment. Reuses FRAME_ALERTS rather than a dedicated KV namespace,
// same reasoning as the other keys on this binding.
const SIGNALS_KV_KEY = "signals:latest";
/** Full-collection wallet → Monke map, built by the same getAssetsByGroup
 *  indexer as fetchMonkeHolderCount / discover-saga-monke-holders. Last
 *  resort for /api/verify when live getAssetsByOwner is 429/dead. */
const HOLDERS_INDEX_KV_KEY = "holders:index:v1";

interface HolderIndexEntry {
  mint: string;
  name: string;
  image: string | null;
}
interface HolderIndexFile {
  updatedAt: number;
  assets?: number;
  owners: Record<string, HolderIndexEntry>;
}
// Same asset + bottom-right placement convention as ShareablePnLCard.tsx —
// "Shot using OnlyMonkes" watermark, ~28% of the base image's width.
const WATERMARK_URL = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/assets/watermark.png";
const WATERMARK_ASPECT = 1024 / 1536; // native watermark.png dimensions (h/w)

// Known marketplace escrow programs — excluded from the holder count so it
// matches what the bot's own daily digest shows (same set as holderSnapshot.ts).
const MARKETPLACE_ESCROWS: Set<string> = new Set([
  "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K", // Magic Eden v2
  "MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8", // Magic Eden v1
  "TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN", // Tensor TSWAP
  "TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp", // Tensor TCOMP (compressed)
  "hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu", // Hadeswap
]);

interface StatsSnapshot {
  holders: number;
  holdersDelta: number | null; // vs previous snapshot
  floorSol: number | null;
  floorChg24h: number | null;
  volume24hSol: number | null;
  skrPriceUsd: number | null;
  recentSales: Array<{ signature: string; priceSol: number; source?: string; ts: number }>;
  updatedAt: number;
}

export interface MonkeAsset {
  mint: string;
  name: string;
  image: string | null;
  traits: Array<{ trait_type: string; value: string }>;
}

/** Full-collection getAssetsByGroup scan — same indexer as the bot's
 *  discover-saga-monke-holders / holderSnapshot. Builds wallet → first
 *  Monke so /api/verify can answer when getAssetsByOwner is down. */
async function scanHolderIndexFrom(url: string): Promise<HolderIndexFile | null> {
  const owners: Record<string, HolderIndexEntry> = {};
  const ownerCounts = new Map<string, number>();
  let cursor: string | undefined;
  let pages = 0;
  while (pages < 20) {
    const params: Record<string, any> = { groupKey: "collection", groupValue: SAGA_COLLECTION_MINT, limit: 1000 };
    if (cursor) params.cursor = cursor;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `holders-${pages}`, method: "getAssetsByGroup", params }),
    }, 20_000);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data?.error) return null;
    const items = data?.result?.items ?? [];
    for (const item of items) {
      const owner = item?.ownership?.owner as string | undefined;
      if (!owner) continue;
      ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
      if (owners[owner] || MARKETPLACE_ESCROWS.has(owner)) continue;
      const image =
        item?.content?.links?.image ??
        item?.content?.files?.find((f: any) => f?.mime?.startsWith("image/"))?.cdn_uri ??
        item?.content?.files?.find((f: any) => f?.mime?.startsWith("image/"))?.uri ??
        null;
      owners[owner] = {
        mint: item.id,
        name: item?.content?.metadata?.name ?? "Saga Monke",
        image,
      };
    }
    pages++;
    const nextCursor = data?.result?.cursor;
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }
  if (Object.keys(owners).length < 1000) return null;
  return { updatedAt: Date.now(), owners };
}

async function persistHolderIndex(env: Env, file: HolderIndexFile): Promise<void> {
  await env.FRAME_ALERTS.put(HOLDERS_INDEX_KV_KEY, JSON.stringify(file));
}

async function loadHolderIndex(env: Env): Promise<HolderIndexFile | null> {
  const raw = await env.FRAME_ALERTS.get(HOLDERS_INDEX_KV_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HolderIndexFile;
    if (!parsed?.owners || typeof parsed.owners !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function refreshHolderIndex(env: Env): Promise<HolderIndexFile | null> {
  const urls: string[] = [rpcUrl(env)];
  if (env.QUICKNODE_DAS_URL) urls.push(env.QUICKNODE_DAS_URL);
  for (const url of urls) {
    const file = await scanHolderIndexFrom(url);
    if (file) {
      await persistHolderIndex(env, file);
      return file;
    }
  }
  return null;
}

const MAX_INDEX_OWNERS = 20_000;
const MIN_INDEX_OWNERS = 1_000;

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidHolderIndexPayload(body: unknown): body is HolderIndexFile {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  if (rec.updatedAt != null && (typeof rec.updatedAt !== "number" || !Number.isFinite(rec.updatedAt))) return false;
  if (rec.assets != null && (typeof rec.assets !== "number" || !Number.isFinite(rec.assets))) return false;
  if (!rec.owners || typeof rec.owners !== "object" || Array.isArray(rec.owners)) return false;
  const owners = rec.owners as Record<string, unknown>;
  const keys = Object.keys(owners);
  if (keys.length < MIN_INDEX_OWNERS || keys.length > MAX_INDEX_OWNERS) return false;
  for (const wallet of keys) {
    try { new PublicKey(wallet); } catch { return false; }
    const entry = owners[wallet];
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.mint !== "string") return false;
    try { new PublicKey(e.mint); } catch { return false; }
    if (typeof e.name !== "string" || e.name.length === 0 || e.name.length > 80) return false;
    if (e.image != null && (typeof e.image !== "string" || e.image.length > 500 || !isHttpsUrl(e.image))) return false;
  }
  return true;
}

function sanitizeHolderIndex(body: HolderIndexFile): HolderIndexFile {
  const owners: Record<string, HolderIndexEntry> = {};
  for (const [wallet, entry] of Object.entries(body.owners)) {
    owners[wallet] = {
      mint: entry.mint,
      name: entry.name.slice(0, 80),
      image: entry.image ?? null,
    };
  }
  return {
    updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
    assets: typeof body.assets === "number" ? body.assets : Object.keys(owners).length,
    owners,
  };
}

/** POST /api/holders/index — bot-authenticated full-collection owner map. */
async function handleHoldersIndexPost(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) return errorResponse("Unauthorized", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isValidHolderIndexPayload(body)) {
    return errorResponse("Invalid holder index — expected { updatedAt, owners: { wallet: { mint, name, image } } } with 1000–20000 owners", 400);
  }
  const existing = await loadHolderIndex(env);
  const incomingCount = Object.keys(body.owners).length;
  const existingCount = existing ? Object.keys(existing.owners).length : 0;
  if (existing && incomingCount < existingCount * 0.8) {
    return errorResponse(`Rejected shrink ${existingCount} → ${incomingCount}`, 409);
  }
  const file = sanitizeHolderIndex(body);
  await persistHolderIndex(env, file);
  return jsonResponse({ ok: true, owners: incomingCount, updatedAt: file.updatedAt });
}

/** GET /api/holders/index — public counts only, never wallet list. */
async function handleHoldersIndexGet(env: Env): Promise<Response> {
  const index = await loadHolderIndex(env);
  if (!index) return jsonResponse({ available: false });
  return jsonResponse({
    available: true,
    owners: Object.keys(index.owners).length,
    assets: index.assets ?? null,
    updatedAt: index.updatedAt,
    ageMs: Date.now() - (index.updatedAt || 0),
  });
}

/**
 * GET /api/holders/lookup?wallet=X — single-wallet check against the KV
 * holder index, no live Helius/QuickNode call at all. Same privacy footprint
 * as /api/verify (reveals ownership only for the one wallet the caller
 * already controls/queried) — not the "public counts only" restriction on
 * /api/holders/index above, which exists to avoid exposing the full owner list.
 *
 * Reuses lookupHolderIndex's existing freshness policy (fresh miss = real
 * negative, stale miss = null/uncertain) unchanged. Callers should treat
 * anything other than `owned: true` as "no answer" and fall through to their
 * own live verification chain — this endpoint only exists to short-circuit
 * the common case (an already-indexed returning holder) fast, never to deny.
 */
async function handleHoldersLookup(url: URL, env: Env): Promise<Response> {
  const wallet = url.searchParams.get("wallet");
  if (!wallet || wallet.length < 32 || wallet.length > 48) {
    return errorResponse("Missing or invalid wallet address", 400);
  }
  try {
    new PublicKey(wallet);
  } catch {
    return errorResponse("Invalid wallet address", 400);
  }

  const result = await lookupHolderIndex(wallet, env, []);
  if (!result || !result.monke) return jsonResponse({ owned: false });
  return jsonResponse({
    owned: true,
    mint: result.monke.mint,
    name: result.monke.name,
    image: result.monke.image,
    traits: result.monke.traits,
  });
}

/** Holder count via the collection indexer. Also refreshes the verify map. */
async function fetchMonkeHolderCount(env: Env): Promise<number> {
  const file = await refreshHolderIndex(env);
  if (file) {
    let unique = 0;
    for (const owner of Object.keys(file.owners)) {
      if (!MARKETPLACE_ESCROWS.has(owner)) unique++;
    }
    return unique;
  }
  throw new Error("holder indexer failed");
}

/** Floor price + 24h volume (CoinGecko) and $SKR price (DexScreener) —
 *  same endpoints/field mapping as the bot's fetchSagaMonkes() in
 *  overnightSnapshot.ts and ChatScreen.tsx's support-banner fetch. */
async function fetchFloorAndMarket(env: Env): Promise<{ floorSol: number | null; floorChg24h: number | null; volume24hSol: number | null; skrPriceUsd: number | null }> {
  let floorSol: number | null = null;
  let floorChg24h: number | null = null;
  let volume24hSol: number | null = null;
  let skrPriceUsd: number | null = null;

  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/nfts/saga-monkes", {
      headers: { "User-Agent": "OnlyMonkes-Web/1.0" },
    }, 8_000);
    if (res.ok) {
      const d = await res.json() as any;
      floorSol = d?.floor_price?.native_currency ?? null;
      floorChg24h = d?.floor_price_24h_percentage_change?.native_currency ?? null;
      volume24hSol = d?.volume_24h?.native_currency ?? null;
    }
  } catch { /* best-effort, page still works without market data */ }

  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${SKR_MINT}`, {}, 8_000);
    if (res.ok) {
      const d = await res.json() as any;
      const price = d?.pairs?.[0]?.priceUsd;
      skrPriceUsd = price ? parseFloat(price) : null;
    }
  } catch { /* best-effort */ }

  return { floorSol, floorChg24h, volume24hSol, skrPriceUsd };
}

/** Recent Saga Monkes sales via Helius Enhanced Transaction API against the
 *  known creator/royalty wallet — same source as SagaMonkesSalesMonitor,
 *  trimmed to a short public-safe feed (no buyer/seller wallets, no name
 *  lookup per sale to avoid N extra DAS calls on every cron run). */
async function fetchRecentSales(env: Env): Promise<StatsSnapshot["recentSales"]> {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${SAGA_CREATOR_WALLET}/transactions?api-key=${env.HELIUS_API_KEY}&type=NFT_SALE&limit=10`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "OnlyMonkes-Web/1.0" } }, 10_000);
    if (!res.ok) return [];
    const body = await res.json();
    const txs = Array.isArray(body) ? body : [];
    const sales: StatsSnapshot["recentSales"] = [];
    for (const tx of txs) {
      const nft = tx?.events?.nft;
      if (!nft?.amount) continue;
      sales.push({
        signature: tx.signature as string,
        priceSol: nft.amount / 1e9,
        source: nft.source as string | undefined,
        ts: typeof tx.timestamp === "number" ? tx.timestamp * 1000 : Date.now(),
      });
      if (sales.length >= 6) break;
    }
    return sales;
  } catch {
    return [];
  }
}

/** Assemble a fresh stats snapshot, diffing holder count against whatever's
 *  currently cached in KV for the day-over-day delta shown on the page. */
async function computeStatsSnapshot(env: Env): Promise<StatsSnapshot> {
  const previousRaw = await env.FRAME_ALERTS.get(STATS_KV_KEY);
  const previous: StatsSnapshot | null = previousRaw ? JSON.parse(previousRaw) : null;

  const [holders, market, recentSales] = await Promise.all([
    fetchMonkeHolderCount(env).catch(() => previous?.holders ?? 0),
    fetchFloorAndMarket(env),
    fetchRecentSales(env),
  ]);

  return {
    holders,
    holdersDelta: previous ? holders - previous.holders : null,
    floorSol: market.floorSol,
    floorChg24h: market.floorChg24h,
    volume24hSol: market.volume24hSol,
    skrPriceUsd: market.skrPriceUsd,
    recentSales,
    updatedAt: Date.now(),
  };
}

async function getCachedStats(env: Env): Promise<StatsSnapshot | null> {
  const raw = await env.FRAME_ALERTS.get(STATS_KV_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StatsSnapshot; } catch { return null; }
}

/** Resolves the current latest GitHub release's signed APK asset URL,
 *  cached in KV for an hour so a burst of downloads doesn't hammer GitHub's
 *  API. Falls back to the plain releases page (still functional, just one
 *  more click) if resolution fails for any reason. */
async function getLatestApkUrl(env: Env): Promise<string> {
  const cached = await env.FRAME_ALERTS.get(APK_URL_KV_KEY);
  if (cached) {
    try {
      const { url, ts } = JSON.parse(cached) as { url: string; ts: number };
      if (Date.now() - ts < APK_URL_CACHE_TTL_MS) return url;
    } catch { /* fall through to re-resolve */ }
  }

  try {
    const res = await fetchWithTimeout(GITHUB_RELEASES_API, {
      headers: { "User-Agent": "OnlyMonkes-Web/1.0", "Accept": "application/vnd.github+json" },
    }, 8_000);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json() as any;
    const asset = (data?.assets ?? []).find((a: any) => typeof a?.name === "string" && a.name.endsWith(".apk"));
    const url = asset?.browser_download_url ?? GITHUB_RELEASES_PAGE;
    await env.FRAME_ALERTS.put(APK_URL_KV_KEY, JSON.stringify({ url, ts: Date.now() }), { expirationTtl: 24 * 60 * 60 });
    return url;
  } catch {
    return GITHUB_RELEASES_PAGE;
  }
}

/** GET /download/apk — redirects to whichever APK is attached to the
 *  current latest GitHub release, resolved dynamically so this link never
 *  needs updating as new versions ship. */
async function handleDownloadApk(env: Env): Promise<Response> {
  const url = await getLatestApkUrl(env);
  return Response.redirect(url, 302);
}

/** Fetch a single Saga Monke's metadata by mint/asset id — Helius DAS
 *  getAsset, same call shape as sagaMonkesSales.ts's fetchNftImage/fetchNftName. */
async function fetchMonkeByMint(mint: string, env: Env): Promise<MonkeAsset | null> {
  try {
    const res = await fetchWithTimeout(rpcUrl(env), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "monke-asset", method: "getAsset", params: { id: mint } }),
    }, 10_000);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const asset = data?.result;
    if (!asset) return null;
    return {
      mint,
      name: asset?.content?.metadata?.name ?? "Saga Monke",
      image: asset?.content?.links?.image ?? asset?.content?.files?.[0]?.uri ?? null,
      traits: asset?.content?.metadata?.attributes ?? [],
    };
  } catch {
    return null;
  }
}

/** Look up the first Saga Monke owned by a wallet — Helius DAS
 *  getAssetsByOwner filtered to the collection, same pattern as the app's
 *  nftVerification.ts fetchAssetsViaHelius (ported here without the
 *  AsyncStorage caching layer, which doesn't apply to a Worker). */
/** DAS getAssetsByOwner against one endpoint. Returns the owned Saga Monke,
 *  or null if the collection wasn't found in a CLEAN (HTTP ok) response.
 *  Throws on any transport/HTTP failure — callers must not treat a throw
 *  the same as a clean null, see fetchOwnedMonke below. */
function pickOwnedMonke(items: any[]): MonkeAsset | null {
  const owned = items.find((item: any) =>
    Array.isArray(item?.grouping) &&
    item.grouping.some((g: any) => g?.group_key === "collection" && g?.group_value === SAGA_COLLECTION_MINT),
  );
  if (!owned) return null;
  return {
    mint: owned.id,
    name: owned?.content?.metadata?.name ?? "Saga Monke",
    image: owned?.content?.links?.image ?? owned?.content?.files?.[0]?.uri ?? null,
    traits: owned?.content?.metadata?.attributes ?? [],
  };
}

function dasParams(wallet: string, page: number, style: "helius" | "alchemy"): unknown {
  const display = {
    showCollectionMetadata: false,
    showUnverifiedCollections: true,
    showFungible: false,
  };
  if (style === "alchemy") {
    return [wallet, { sortBy: "created", sortDirection: "asc" }, 1000, page, null, null, display];
  }
  return { ownerAddress: wallet, page, limit: 1000, displayOptions: display };
}

/** DAS getAssetsByOwner. Throws on transport / HTTP / JSON-RPC error.
 *  Returns null only on a clean "this wallet has no Saga Monke in these pages." */
async function dasLookupOwnedMonke(
  url: string,
  wallet: string,
  timeoutMs: number,
  style: "helius" | "alchemy" = "helius",
): Promise<MonkeAsset | null> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const MAX_PAGES = 5;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "owned-monkes",
            method: "getAssetsByOwner",
            params: dasParams(wallet, page, style),
          }),
        }, timeoutMs);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as any;
        if (data?.error) {
          const msg = data.error.message ?? JSON.stringify(data.error);
          throw new Error(`RPC ${msg}`.slice(0, 120));
        }
        const items = data?.result?.items ?? [];
        const hit = pickOwnedMonke(items);
        if (hit) return hit;
        if (items.length < 1000) return null;
      }
      return null;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const retryable = /HTTP 429|HTTP 5\d\d|abort/i.test(lastErr.message);
      if (!retryable || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr ?? new Error("DAS lookup failed");
}

/** Helius (primary) -> QuickNode (fallback) -> uncertain.
 *
 * 2026-08-05: the original version of this function treated ANY failure
 * (HTTP error, timeout, network blip) identically to a clean "this wallet
 * doesn't hold one" — `if (!res.ok) return null` and a catch-all `return
 * null`, both indistinguishable from a real negative result. That's exactly
 * the bug class that blocked real holders app-side for weeks (see
 * nftVerification.ts's `providerError` doc comment for the full story) —
 * this endpoint had the identical flaw, just undiscovered because it was
 * originally a "low-stakes preview check," not something the app's holder
 * gate depended on. Confirmed live: this returned `owned: false` for a
 * wallet holding 10 Saga Monkes, purely because Helius was failing at the
 * time. Now: Helius failing falls through to QuickNode (separate key/
 * quota) before ever reporting a negative, and a confirmed-clean "not
 * found" from either provider is the only thing that counts as a real
 * non-holder result. */
async function lookupHolderIndex(
  wallet: string,
  env: Env,
  reasons: string[],
): Promise<{ monke: MonkeAsset | null; uncertain: boolean; reasons: string[] } | null> {
  try {
    const index = await loadHolderIndex(env);
    if (!index) {
      reasons.push("index:unavailable");
      return null;
    }
    const hit = index.owners[wallet];
    const ageMs = Date.now() - (index.updatedAt || 0);
    if (hit) {
      reasons.push("index:hit");
      return {
        monke: { mint: hit.mint, name: hit.name, image: hit.image, traits: [] },
        uncertain: false,
        reasons,
      };
    }
    // Fresh miss = really not a holder. Stale miss stays uncertain so a
    // recent buyer isn't locked out of a days-old snapshot.
    if (ageMs < 48 * 60 * 60 * 1000) {
      reasons.push("index:miss");
      return { monke: null, uncertain: false, reasons };
    }
    reasons.push("index:stale-miss");
    return null;
  } catch (err) {
    reasons.push(`index:${(err as Error).message}`.slice(0, 80));
    return null;
  }
}

async function searchOwnedMonke(url: string, wallet: string, timeoutMs: number): Promise<MonkeAsset | null> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "search-owned-monke",
      method: "searchAssets",
      params: {
        ownerAddress: wallet,
        grouping: ["collection", SAGA_COLLECTION_MINT],
        page: 1,
        limit: 10,
      },
    }),
  }, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data?.error) throw new Error(`RPC ${String(data.error.message ?? data.error).slice(0, 120)}`);
  const items = data?.result?.items ?? [];
  return pickOwnedMonke(items);
}

export async function fetchOwnedMonke(
  wallet: string,
  env: Env,
): Promise<{ monke: MonkeAsset | null; uncertain: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // searchAssets(owner + collection) is one RPC vs paging getAssetsByOwner
  // (whales with 1000+ assets used to miss their Monke past page 5).
  try {
    const monke = await searchOwnedMonke(verifyRpcUrl(env), wallet, 12_000);
    if (monke) return { monke, uncertain: false, reasons };
    reasons.push("helius-search:0");
  } catch (err) {
    reasons.push(`helius-search:${(err as Error).message}`.slice(0, 80));
  }

  try {
    const monke = await dasLookupOwnedMonke(verifyRpcUrl(env), wallet, 12_000, "helius");
    return { monke, uncertain: false, reasons };
  } catch (err) {
    reasons.push(`helius:${(err as Error).message}`.slice(0, 80));
  }

  // Published 3.3 aborts /api/verify at 15s. Helius+QuickNode+Alchemy+
  // on-chain each take up to 12s, so the holder index never ran in time.
  // After live DAS fails, admit known holders from KV immediately.
  {
    const indexed = await lookupHolderIndex(wallet, env, reasons);
    if (indexed) return indexed;
  }

  if (env.QUICKNODE_DAS_URL) {
    try {
      const monke = await dasLookupOwnedMonke(env.QUICKNODE_DAS_URL, wallet, 12_000, "helius");
      return { monke, uncertain: false, reasons };
    } catch (err) {
      reasons.push(`quicknode:${(err as Error).message}`.slice(0, 80));
    }
  } else {
    reasons.push("quicknode:unset");
  }

  if (env.ALCHEMY_API_KEY) {
    try {
      const alchemyUrl = `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
      const monke = await dasLookupOwnedMonke(alchemyUrl, wallet, 12_000, "alchemy");
      return { monke, uncertain: false, reasons };
    } catch (err) {
      reasons.push(`alchemy:${(err as Error).message}`.slice(0, 80));
    }
  } else {
    reasons.push("alchemy:unset");
  }

  try {
    const { verifySagaOnChain } = await import("./onchainHolder.js");
    const onchain = await verifySagaOnChain(wallet);
    if (onchain.verified) {
      reasons.push("onchain:hit");
      return {
        monke: {
          mint: onchain.mint ?? wallet,
          name: "Saga Monke",
          image: null,
          traits: [],
        },
        uncertain: false,
        reasons,
      };
    }
    if (onchain.inconclusive) {
      reasons.push(`onchain:inconclusive${onchain.error ? `:${onchain.error.slice(0, 40)}` : ""}`);
    } else {
      reasons.push("onchain:not-holder");
    }
  } catch (err) {
    reasons.push(`onchain:${(err as Error).message}`.slice(0, 80));
  }

  return { monke: null, uncertain: true, reasons };
}

function timeAgo(ts: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

/** GET / — public landing page. Live "proof of life" stats + wallet connect
 *  entry point into /monke/:mint + a Get OnlyMonkes CTA. Reads the cron-
 *  refreshed stats:latest KV cache (see scheduled() below) rather than
 *  fetching anything live, so the page loads fast regardless of API health. */
async function handleLandingPage(env: Env): Promise<Response> {
  const stats = await getCachedStats(env);

  const holdersLine = stats
    ? `${stats.holders.toLocaleString()} holders` + (stats.holdersDelta ? ` (${stats.holdersDelta > 0 ? "+" : ""}${stats.holdersDelta} since last check)` : "")
    : "Loading holder count…";
  const floorLine = stats?.floorSol != null ? `${stats.floorSol.toFixed(2)} SOL floor` : "Floor price unavailable";
  const skrLine = stats?.skrPriceUsd != null ? `$SKR $${stats.skrPriceUsd.toFixed(6)}` : "";
  const volLine = stats?.volume24hSol != null ? `${stats.volume24hSol.toFixed(1)} SOL volume (24h)` : "";

  const salesRows = (stats?.recentSales ?? []).map(s => `
    <div class="sale-row">
      <span class="sale-price">${s.priceSol.toFixed(2)} SOL</span>
      <span class="sale-source">${escapeHtml(s.source ?? "")}</span>
      <span class="sale-time">${timeAgo(s.ts)}</span>
      <a class="sale-link" href="https://solscan.io/tx/${encodeURIComponent(s.signature)}" target="_blank" rel="noopener">view</a>
    </div>`).join("") || `<p class="muted">No recent sales in the feed yet.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="index, follow">
  <title>OnlyMonkes — Check Your Monke</title>
  <meta property="og:title" content="OnlyMonkes — Check Your Monke" />
  <meta property="og:description" content="Live Saga Monkes community stats. Connect your wallet to find your Monke." />
  <meta property="og:type" content="website" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0F; color: #F8F8FF; line-height: 1.6; padding: 40px 20px; }
    .container { max-width: 560px; margin: 0 auto; }
    h1 { font-size: 30px; color: #6CB4EE; margin-bottom: 6px; }
    .tagline { color: #8B8B9E; font-size: 15px; margin-bottom: 32px; }
    .stat-card { background: #12121A; border: 1px solid #1E1E2E; border-radius: 16px; padding: 22px; margin-bottom: 20px; }
    .stat-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 16px; padding: 6px 0; }
    .stat-row strong { color: #F8F8FF; font-size: 18px; }
    .muted { color: #8B8B9E; font-size: 13px; }
    h2 { font-size: 15px; color: #8B8B9E; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 10px; }
    .sale-row { display: flex; gap: 10px; align-items: center; font-size: 14px; padding: 8px 0; border-bottom: 1px solid #1E1E2E; }
    .sale-price { color: #14F195; font-weight: 600; min-width: 80px; }
    .sale-source { color: #8B8B9E; flex: 1; }
    .sale-time { color: #8B8B9E; }
    .sale-link { color: #6CB4EE; text-decoration: none; }
    button, .cta { display: block; width: 100%; text-align: center; border: none; border-radius: 14px; padding: 16px; font-size: 16px; font-weight: 600; margin-top: 12px; cursor: pointer; text-decoration: none; }
    .btn-primary { background: #6CB4EE; color: #0A0A0F; }
    .btn-secondary { background: transparent; border: 1px solid #6CB4EE; color: #6CB4EE; }
    #wallet-status { text-align: center; font-size: 13px; color: #8B8B9E; margin-top: 10px; min-height: 18px; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #8B8B9E; }
    .footer a { color: #6CB4EE; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐒 OnlyMonkes</h1>
    <p class="tagline">The Saga Monkes chat, trading bot, and community — live right now.</p>

    <div class="stat-card">
      <div class="stat-row"><span>Holders</span><strong>${escapeHtml(holdersLine)}</strong></div>
      <div class="stat-row"><span>Floor</span><strong>${escapeHtml(floorLine)}</strong></div>
      ${volLine ? `<div class="stat-row"><span>24h Volume</span><strong>${escapeHtml(volLine)}</strong></div>` : ""}
      ${skrLine ? `<div class="stat-row"><span>$SKR</span><strong>${escapeHtml(skrLine)}</strong></div>` : ""}
      <p class="muted">${stats ? `Updated ${timeAgo(stats.updatedAt)}` : ""}</p>
    </div>

    <h2>Recent Sales</h2>
    ${salesRows}

    <button class="btn-secondary" onclick="connectWallet()">🔗 Connect Wallet — Find Your Monke</button>
    <div id="wallet-status"></div>

    <a class="cta btn-primary" href="${DAPP_STORE_LINK}">Get OnlyMonkes</a>

    <div class="footer">
      <a href="/legal">Legal</a> &nbsp;·&nbsp; <a href="/terms">Terms</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a>
    </div>
  </div>

  <script>
    async function connectWallet() {
      const statusEl = document.getElementById('wallet-status');
      statusEl.textContent = 'Connecting…';
      try {
        const provider = (window.solana && window.solana.isPhantom) ? window.solana : window.solflare;
        if (!provider) {
          statusEl.textContent = 'No Solana wallet extension found — open this page with Phantom or Solflare installed.';
          return;
        }
        const resp = await provider.connect();
        const pubkey = (resp && resp.publicKey) ? resp.publicKey : provider.publicKey;
        const address = pubkey.toString();
        statusEl.textContent = 'Checking for your Monke…';
        const res = await fetch('/api/verify?wallet=' + encodeURIComponent(address));
        const data = await res.json();
        if (data.owned) {
          window.location.href = '/monke/' + encodeURIComponent(data.mint);
        } else {
          statusEl.textContent = 'No Saga Monke found in this wallet.';
        }
      } catch (err) {
        statusEl.textContent = 'Connection failed — try again.';
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...CORS_HEADERS,
    },
  });
}

/** GET /api/stats — public JSON, no auth. Reads the cron-refreshed KV cache. */
async function handleStatsApi(env: Env): Promise<Response> {
  const stats = await getCachedStats(env);
  if (!stats) return jsonResponse({ error: "Stats not available yet" }, 503);
  return jsonResponse(stats);
}

// ── Top Traders scorecard (2026-07-31) ───────────────────────────────────────
//
// Saga-Monkes-holder-sourced smart-money cohort, ranked by trading skill —
// see Monke_Eliza's smart-money pipeline (discover-saga-monke-holders.ts ->
// vet-smart-wallets.ts -> build-smart-wallet-list.ts, weekly Friday refresh)
// and smartMoneyMonitor.ts's live PnL tracking.
//
// Privacy-critical: the bot pushes ONLY rank + winRatePct + weeklyGainPct.
// NEVER a wallet address, NEVER a $/SOL amount, NEVER anything that could
// identify or size a specific holder's position — CLAUDE.md's standing rule
// against exposing wallet addresses in user-visible UI applies here even
// though these are third-party wallets we don't otherwise interact with.
interface TopTraderEntry {
  rank: number;
  winRatePct: number;   // 0-100, rounded
  weeklyGainPct: number; // rounded, can be negative
  /** Avg closed PnL % across every closed trade ever tracked for this wallet/book. */
  lifetimeGainPct?: number;
  /** Optional public CDN image for a Saga Monke held by the trader — never a wallet. */
  nftImage?: string;
  /** Optional public display name e.g. "MONKE #622" */
  monkeName?: string;
  /**
   * bot_entered  — AutonoMonke trades the bot opened
   * bot_monitored — smart-money wallets the bot tracks
   * holder       — community Saga Monkes trader (default)
   */
  kind?: "bot_entered" | "bot_monitored" | "holder";
}
interface TopTradersSnapshot {
  updatedAt: number;
  traders: TopTraderEntry[];
}

function isValidTopTradersPayload(v: unknown): v is TopTradersSnapshot {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.updatedAt !== "number") return false;
  if (!Array.isArray(obj.traders) || obj.traders.length > 25) return false;
  const ALLOWED = new Set(["rank", "winRatePct", "weeklyGainPct", "lifetimeGainPct", "nftImage", "monkeName", "kind"]);
  const KIND_OK = new Set(["bot_entered", "bot_monitored", "holder"]);
  return obj.traders.every((t: unknown) => {
    if (!t || typeof t !== "object") return false;
    const e = t as Record<string, unknown>;
    // Reject wallet/amount fields and anything else not on the allowlist
    for (const k of Object.keys(e)) {
      if (!ALLOWED.has(k)) return false;
    }
    if (typeof e.rank !== "number" || typeof e.winRatePct !== "number" || typeof e.weeklyGainPct !== "number") {
      return false;
    }
    if (e.lifetimeGainPct !== undefined && typeof e.lifetimeGainPct !== "number") {
      return false;
    }
    if (e.nftImage !== undefined) {
      if (typeof e.nftImage !== "string" || !/^https:\/\//i.test(e.nftImage) || e.nftImage.length > 512) {
        return false;
      }
    }
    if (e.monkeName !== undefined) {
      if (typeof e.monkeName !== "string" || e.monkeName.length > 40) return false;
    }
    if (e.kind !== undefined) {
      if (typeof e.kind !== "string" || !KIND_OK.has(e.kind)) return false;
    }
    return true;
  });
}

/** GET /api/top-traders — public JSON, no auth. */
async function handleTopTradersGet(env: Env): Promise<Response> {
  const raw = await env.FRAME_ALERTS.get(TOP_TRADERS_KV_KEY);
  if (!raw) return jsonResponse({ error: "Not available yet" }, 503);
  return jsonResponse(JSON.parse(raw));
}

/** POST /api/top-traders — bot-authenticated (same Bearer gate as /escrow).
 *  Validates shape strictly so a bot-side bug can't accidentally leak a
 *  wallet address or SOL amount through this endpoint. */
async function handleTopTradersPost(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) return errorResponse("Unauthorized", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isValidTopTradersPayload(body)) {
    return errorResponse(
      "Invalid payload shape — expected { updatedAt, traders: [{rank, winRatePct, weeklyGainPct, nftImage?, monkeName?}] }",
      400,
    );
  }
  await env.FRAME_ALERTS.put(TOP_TRADERS_KV_KEY, JSON.stringify(body));
  return jsonResponse({ ok: true, count: body.traders.length });
}

// ── AutonoMonke Signals API, Phase 1 (2026-08-25) ────────────────────────────
//
// Read-only scanner snapshot (composite score, regime, reference price) for
// every token in AutonoMonke's scan universe, pushed once per ~10 min scan
// cycle from signalsPublisher.ts. Free and unauthenticated GET.
//
// A Phase 2 x402 payment gate (facilitator: PayAI) was built and reviewed
// 2026-08-25 but deliberately NOT shipped: PayAI's own materials mention a
// free tier capped at 1,000 settlements/month, with no confirmed answer on
// what happens above that (paid tier? per-call fee? unclear) — exactly the
// open-ended paid-API-dependency risk this project avoids by standing rule.
// Nothing here pays out under Phase 1 (no facilitator, no gas, no external
// dependency at all) — reintroduce Phase 2 only once that facilitator-fee
// question has a real, confirmed answer, not before.
//
// Never carries: wallet addresses, inbox IDs, open positions, stop-loss
// levels, Bull/Bear/Risk breakdowns, or recent-alerts (those need more
// wiring — deferred to a follow-up once this pipeline is proven live).
interface SignalSnapshotEntry {
  mint: string;
  symbol: string;
  composite: number;
  regime: string;
  price: number;
  liquidity: number;
  alignedTFs: number;
}
interface SignalsSnapshot {
  updatedAt: number;
  tokens: SignalSnapshotEntry[];
}

function isValidSignalsPayload(v: unknown): v is SignalsSnapshot {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.updatedAt !== "number") return false;
  if (!Array.isArray(obj.tokens) || obj.tokens.length > 200) return false;
  const ALLOWED = new Set(["mint", "symbol", "composite", "regime", "price", "liquidity", "alignedTFs"]);
  return obj.tokens.every((t: unknown) => {
    if (!t || typeof t !== "object") return false;
    const e = t as Record<string, unknown>;
    // Reject wallet/position fields and anything else not on the allowlist —
    // same defensive shape-lock as isValidTopTradersPayload above.
    for (const k of Object.keys(e)) {
      if (!ALLOWED.has(k)) return false;
    }
    if (typeof e.mint !== "string" || e.mint.length < 32 || e.mint.length > 44) return false;
    if (typeof e.symbol !== "string" || e.symbol.length > 20) return false;
    if (typeof e.composite !== "number" || e.composite < -100 || e.composite > 100) return false;
    if (typeof e.regime !== "string" || e.regime.length > 20) return false;
    if (typeof e.price !== "number" || e.price < 0) return false;
    if (typeof e.liquidity !== "number" || e.liquidity < 0) return false;
    if (typeof e.alignedTFs !== "number") return false;
    return true;
  });
}

/** GET /api/signals — full snapshot, public, no auth (Phase 1).
 *  GET /api/signals?mint=X — single token, 404 if not in the current
 *  scan universe. */
async function handleSignalsGet(url: URL, env: Env): Promise<Response> {
  const raw = await env.FRAME_ALERTS.get(SIGNALS_KV_KEY);
  if (!raw) return jsonResponse({ error: "Not available yet" }, 503);
  const snapshot = JSON.parse(raw) as SignalsSnapshot;
  const mint = url.searchParams.get("mint");
  if (!mint) return jsonResponse(snapshot);
  const entry = snapshot.tokens.find(t => t.mint === mint);
  if (!entry) return jsonResponse({ error: "Not in current scan universe" }, 404);
  return jsonResponse({ updatedAt: snapshot.updatedAt, ...entry });
}

/** POST /api/signals — bot-authenticated (same Bearer gate as /escrow and
 *  /api/top-traders). Validates shape strictly, same reasoning as
 *  isValidTopTradersPayload's doc comment. */
async function handleSignalsPost(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) return errorResponse("Unauthorized", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isValidSignalsPayload(body)) {
    return errorResponse(
      "Invalid payload shape — expected { updatedAt, tokens: [{mint, symbol, composite, regime, price, liquidity, alignedTFs}] }",
      400,
    );
  }
  await env.FRAME_ALERTS.put(SIGNALS_KV_KEY, JSON.stringify(body));
  return jsonResponse({ ok: true, count: body.tokens.length });
}

/** GET /api/verify?wallet=<address> — public JSON.
 *
 * 2026-08-05: also now the app-side holder gate's fallback (see
 * nftVerification.ts) when the app's OWN bundled Helius/QuickNode keys are
 * unavailable — no longer just a "low-stakes preview." fetchOwnedMonke()
 * now runs its own Helius -> QuickNode chain and only reports a definitive
 * owned/not-owned when at least one provider gave a clean answer; `uncertain:
 * true` means neither provider could confirm anything (transient outage on
 * BOTH), and callers must not treat that as a negative result. */
async function handleVerifyApi(url: URL, env: Env): Promise<Response> {
  const wallet = url.searchParams.get("wallet");
  if (!wallet || wallet.length < 32 || wallet.length > 48) {
    return errorResponse("Missing or invalid wallet address", 400);
  }
  try {
    new PublicKey(wallet); // throws on malformed base58
  } catch {
    return errorResponse("Invalid wallet address", 400);
  }

  const { monke, uncertain, reasons } = await fetchOwnedMonke(wallet, env);
  if (uncertain) return jsonResponse({ owned: false, uncertain: true, reasons }, 200);
  if (!monke) return jsonResponse({ owned: false });
  return jsonResponse({ owned: true, mint: monke.mint, name: monke.name, image: monke.image, traits: monke.traits });
}

/** GET /monke/:mint — shareable, OG-preview-rich page for a specific Saga
 *  Monke. Mirrors handleFrameAlertGet's OG/fc:frame meta-tag pattern below,
 *  so pasting the link into Discord/X renders a rich card. No wallet needed
 *  to view — this is the piece meant to spread when people flex their Monke. */
async function handleMonkePage(mint: string, env: Env): Promise<Response> {
  const [monke, stats] = await Promise.all([
    fetchMonkeByMint(mint, env),
    getCachedStats(env),
  ]);

  if (!monke) {
    return new Response("Monke not found", { status: 404, headers: { "Content-Type": "text/plain", ...CORS_HEADERS } });
  }

  const title = `${monke.name} — OnlyMonkes`;
  const traitsLine = monke.traits.slice(0, 4).map(t => `${escapeHtml(t.trait_type)}: ${escapeHtml(t.value)}`).join(" · ");
  const floorLine = stats?.floorSol != null ? `Floor: ${stats.floorSol.toFixed(2)} SOL` : "";
  const description = [traitsLine, floorLine].filter(Boolean).join(" — ") || "Saga Monkes holder on OnlyMonkes";
  const pageUrl = `${WORKER_BASE}/monke/${encodeURIComponent(mint)}`;
  // Watermarked composite (see handleMonkeImage) so the OnlyMonkes brand
  // shows up wherever this card gets shared, not just the raw NFT art.
  const imageUrl = monke.image ? `${WORKER_BASE}/monke/${encodeURIComponent(mint)}/image` : WATERMARK_URL;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <!-- Farcaster Frame -->
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${escapeHtml(imageUrl)}" />
  <meta property="fc:frame:image:aspect_ratio" content="1:1" />
  <meta property="fc:frame:button:1" content="Get OnlyMonkes" />
  <meta property="fc:frame:button:1:action" content="link" />
  <meta property="fc:frame:button:1:target" content="${escapeHtml(DAPP_STORE_LINK)}" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0F; color: #F8F8FF; padding: 40px 20px; text-align: center; }
    img { width: 280px; height: 280px; border-radius: 20px; object-fit: cover; margin-bottom: 20px; }
    h1 { font-size: 24px; color: #6CB4EE; margin-bottom: 8px; }
    p { color: #8B8B9E; margin-bottom: 24px; }
    .cta-group { max-width: 320px; margin: 0 auto; }
    a.cta { display: block; background: #6CB4EE; color: #0A0A0F; font-weight: 600; padding: 14px 28px; border-radius: 14px; text-decoration: none; margin-bottom: 10px; }
    a.cta-secondary { display: block; background: transparent; border: 1px solid #6CB4EE; color: #6CB4EE; font-weight: 600; padding: 13px 28px; border-radius: 14px; text-decoration: none; }
    .cta-caption { font-size: 12px; color: #8B8B9E; margin-top: 12px; }
  </style>
</head>
<body>
  ${monke.image ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(monke.name)}" />` : ""}
  <h1>${escapeHtml(monke.name)}</h1>
  <p>${escapeHtml(description)}</p>
  <div class="cta-group">
    <a class="cta" href="${DAPP_STORE_LINK}">Get OnlyMonkes — Solana dApp Store</a>
    <a class="cta-secondary" href="${WORKER_BASE}/download/apk">Download APK Directly</a>
    <p class="cta-caption">On a Solana Mobile device? Use the dApp Store. Any other Android phone — download the APK directly.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...CORS_HEADERS,
    },
  });
}

/** GET /monke/:mint/image — composites the NFT art + OnlyMonkes watermark
 *  bottom-right (same asset/proportion convention as ShareablePnLCard.tsx),
 *  baked into real JPEG pixels via @cf-wasm/photon (Workers has no native
 *  canvas). Deliberately raster, not SVG — social-preview crawlers (X,
 *  Discord) don't reliably rasterize SVG og:image/twitter:image. */
async function handleMonkeImage(mint: string, env: Env): Promise<Response> {
  const monke = await fetchMonkeByMint(mint, env);
  if (!monke?.image) {
    return new Response("Image not found", { status: 404, headers: { "Content-Type": "text/plain", ...CORS_HEADERS } });
  }

  let baseImage: PhotonImage | undefined;
  let wmRaw: PhotonImage | undefined;
  let wmResized: PhotonImage | undefined;
  try {
    const [baseRes, wmRes] = await Promise.all([
      // 2026-07-30: some Arweave gateway files 302 to a shard subdomain
      // (e.g. arweave.net -> <hash>.arweave.net) — explicit redirect:"follow"
      // rather than relying on fetch()'s implicit default, which silently
      // returned the 302 itself (res.ok === false) for some NFTs and not
      // others, sending them down the raw-image fallback path unnecessarily.
      fetchWithTimeout(monke.image, { redirect: "follow" }, 10_000),
      fetchWithTimeout(WATERMARK_URL, { redirect: "follow" }, 10_000),
    ]);
    if (!baseRes.ok || !wmRes.ok) throw new Error("upstream image fetch failed");

    baseImage = PhotonImage.new_from_byteslice(new Uint8Array(await baseRes.arrayBuffer()));
    wmRaw = PhotonImage.new_from_byteslice(new Uint8Array(await wmRes.arrayBuffer()));

    const wmWidth = Math.round(baseImage.get_width() * 0.28);
    const wmHeight = Math.round(wmWidth * WATERMARK_ASPECT);
    wmResized = resize(wmRaw, wmWidth, wmHeight, SamplingFilter.Lanczos3);

    const margin = Math.round(baseImage.get_width() * 0.03);
    const xOffset = BigInt(Math.max(0, baseImage.get_width() - wmWidth - margin));
    const yOffset = BigInt(Math.max(0, baseImage.get_height() - wmHeight - margin));
    watermark(baseImage, wmResized, xOffset, yOffset);

    const outBytes = baseImage.get_bytes_jpeg(90);

    return new Response(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    // Compositing failed for any reason — fall back to the raw NFT image
    // rather than a broken preview card.
    console.error("[monke-image] compositing failed:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.redirect(monke.image, 302);
  } finally {
    baseImage?.free();
    wmRaw?.free();
    wmResized?.free();
  }
}

/** POST /frames/alert — bot stores alert data (authenticated). */
async function handleFrameAlertPost(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) {
    return errorResponse("Unauthorized", 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { id, token, signal, confluence, entry, target1, target2, stop, price } = body;

  if (!id || typeof id !== "string" || id.length > 128) {
    return errorResponse("Invalid or missing id");
  }
  if (!token || typeof token !== "string" || token.length > 20) {
    return errorResponse("Invalid or missing token");
  }
  if (signal !== "BULLISH" && signal !== "BEARISH") {
    return errorResponse("signal must be BULLISH or BEARISH");
  }
  if (typeof confluence !== "number" || confluence < 0 || confluence > 100) {
    return errorResponse("confluence must be 0-100");
  }
  for (const [name, val] of Object.entries({ entry, target1, stop, price })) {
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
      return errorResponse(`${name} must be a positive number`);
    }
  }
  if (target2 !== undefined && (typeof target2 !== "number" || !Number.isFinite(target2) || target2 <= 0)) {
    return errorResponse("target2 must be a positive number if provided");
  }

  const alertData: FrameAlertData = {
    id,
    token,
    signal,
    confluence,
    entry,
    target1,
    target2,
    stop,
    price,
    timestamp: Date.now(),
  };

  await env.FRAME_ALERTS.put(id, JSON.stringify(alertData), { expirationTtl: FRAME_ALERT_TTL });

  const frameUrl = `${WORKER_BASE}/frames/alert/${encodeURIComponent(id)}`;

  return jsonResponse({ ok: true, frameUrl });
}

/** GET /frames/alert/:id — returns Farcaster Frame HTML with OG + fc:frame meta tags. */
async function handleFrameAlertGet(alertId: string, env: Env): Promise<Response> {
  const raw = await env.FRAME_ALERTS.get(alertId);
  if (!raw) {
    return new Response("Alert not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  let alert: FrameAlertData;
  try {
    alert = JSON.parse(raw);
  } catch {
    return new Response("Corrupted alert data", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  const direction = alert.signal === "BULLISH" ? "Bullish" : "Bearish";
  const emoji = alert.signal === "BULLISH" ? "🟢" : "🔴";
  const title = `${emoji} ${alert.token} — ${direction} Alert (${alert.confluence}% confluence)`;
  const description = `Entry: $${alert.entry} | Target: $${alert.target1} | Stop: $${alert.stop}`;
  const imageUrl = `${WORKER_BASE}/frames/alert/${encodeURIComponent(alertId)}/image`;
  const alertUrl = `${APP_DEEP_LINK}/alert/${encodeURIComponent(alertId)}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${WORKER_BASE}/frames/alert/${encodeURIComponent(alertId)}" />
  <meta property="og:type" content="website" />

  <!-- Farcaster Frame -->
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${imageUrl}" />
  <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />

  <meta property="fc:frame:button:1" content="View Alert" />
  <meta property="fc:frame:button:1:action" content="link" />
  <meta property="fc:frame:button:1:target" content="${escapeHtml(alertUrl)}" />

  <meta property="fc:frame:button:2" content="Join OnlyMonkes" />
  <meta property="fc:frame:button:2:action" content="link" />
  <meta property="fc:frame:button:2:target" content="${escapeHtml(DAPP_STORE_LINK)}" />
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...CORS_HEADERS,
    },
  });
}

/** GET /frames/alert/:id/image — returns an SVG image rendered as image/svg+xml for Frame cards. */
async function handleFrameAlertImage(alertId: string, env: Env): Promise<Response> {
  const raw = await env.FRAME_ALERTS.get(alertId);
  if (!raw) {
    return new Response("Alert not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  let alert: FrameAlertData;
  try {
    alert = JSON.parse(raw);
  } catch {
    return new Response("Corrupted alert data", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  const isBullish = alert.signal === "BULLISH";
  const bgColor = isBullish ? "#0a2e1a" : "#2e0a0a";
  const accentColor = isBullish ? "#00ff88" : "#ff4444";
  const direction = isBullish ? "BULLISH" : "BEARISH";
  const arrow = isBullish ? "▲" : "▼";

  const target2Line = alert.target2
    ? `<text x="570" y="280" font-family="monospace" font-size="22" fill="#cccccc" text-anchor="end">T2: $${formatPrice(alert.target2)}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgColor}" />
      <stop offset="100%" stop-color="#111111" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="628" fill="url(#bg)" rx="0" />

  <!-- Top bar -->
  <rect x="0" y="0" width="1200" height="4" fill="${accentColor}" />

  <!-- Branding -->
  <text x="40" y="60" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#ffffff">OnlyMonkes</text>
  <text x="260" y="60" font-family="Arial, sans-serif" font-size="20" fill="#888888">Trade Alert</text>

  <!-- Token + Signal -->
  <text x="40" y="150" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="#ffffff">${escapeHtml(alert.token)}</text>
  <text x="40" y="200" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="${accentColor}">${arrow} ${direction}</text>

  <!-- Confluence bar background -->
  <rect x="40" y="230" width="400" height="16" rx="8" fill="#333333" />
  <!-- Confluence bar fill -->
  <rect x="40" y="230" width="${Math.round(4 * alert.confluence)}" height="16" rx="8" fill="${accentColor}" />
  <text x="460" y="244" font-family="monospace" font-size="20" fill="${accentColor}">${alert.confluence}%</text>

  <!-- Price info -->
  <text x="40" y="310" font-family="monospace" font-size="22" fill="#cccccc">Price: $${formatPrice(alert.price)}</text>
  <text x="40" y="350" font-family="monospace" font-size="22" fill="#cccccc">Entry: $${formatPrice(alert.entry)}</text>

  <!-- Targets -->
  <text x="570" y="310" font-family="monospace" font-size="22" fill="#00ff88" text-anchor="end">T1: $${formatPrice(alert.target1)}</text>
  ${target2Line}
  <text x="570" y="350" font-family="monospace" font-size="22" fill="#ff4444" text-anchor="end">Stop: $${formatPrice(alert.stop)}</text>

  <!-- Right side — large confluence circle -->
  <circle cx="900" cy="280" r="140" fill="none" stroke="#333333" stroke-width="16" />
  <circle cx="900" cy="280" r="140" fill="none" stroke="${accentColor}" stroke-width="16"
    stroke-dasharray="${Math.round(879.6 * alert.confluence / 100)} 880"
    stroke-linecap="round" transform="rotate(-90 900 280)" />
  <text x="900" y="270" font-family="Arial, sans-serif" font-size="56" font-weight="bold" fill="#ffffff" text-anchor="middle">${alert.confluence}%</text>
  <text x="900" y="310" font-family="Arial, sans-serif" font-size="20" fill="#888888" text-anchor="middle">confluence</text>

  <!-- Footer -->
  <line x1="40" y1="560" x2="1160" y2="560" stroke="#333333" stroke-width="1" />
  <text x="40" y="595" font-family="Arial, sans-serif" font-size="18" fill="#555555">${new Date(alert.timestamp).toISOString().replace("T", " ").slice(0, 19)} UTC</text>
  <text x="1160" y="595" font-family="Arial, sans-serif" font-size="18" fill="#555555" text-anchor="end">onlymonkes.app</text>
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

/** Format price for display — auto-detect decimals. */
function formatPrice(p: number): string {
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

/** Escape HTML special characters to prevent XSS in generated HTML/SVG. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Legal pages (Terms / Privacy / Copyright / Index) ───────────────────────
// Hosted here to satisfy Solana Mobile dApp Store publisher requirements:
// dedicated, publicly accessible legal documents on a stable URL.
// Source of truth — do not duplicate this content elsewhere.

const LEGAL_LAST_UPDATED = "April 28, 2026 (v2.37)";
const LEGAL_CONTACT_EMAIL = "Jumpstreet25@icloud.com";
const LEGAL_GITHUB_ISSUES = "https://github.com/jumpstreet25/OnlyMonkes/issues";

function legalShell(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="index, follow">
  <title>OnlyMonkes — ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0F; color: #F8F8FF; line-height: 1.7; padding: 40px 20px; }
    .container { max-width: 720px; margin: 0 auto; }
    nav { font-size: 13px; color: #8B8B9E; margin-bottom: 24px; }
    nav a { color: #6CB4EE; text-decoration: none; margin-right: 14px; }
    nav a:hover { text-decoration: underline; }
    h1 { font-size: 28px; margin-bottom: 6px; color: #6CB4EE; }
    h2 { font-size: 20px; margin-top: 32px; margin-bottom: 12px; color: #6CB4EE; border-bottom: 1px solid #1E1E2E; padding-bottom: 6px; }
    h3 { font-size: 16px; margin-top: 20px; margin-bottom: 8px; color: #A78BFA; }
    p, li { font-size: 15px; color: #CCCCE0; margin-bottom: 10px; }
    ul, ol { padding-left: 24px; margin-bottom: 16px; }
    li { margin-bottom: 6px; }
    a { color: #6CB4EE; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .updated { font-size: 13px; color: #8B8B9E; margin-bottom: 28px; }
    .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #1E1E2E; font-size: 13px; color: #8B8B9E; }
    strong { color: #F8F8FF; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; background: #1E1E2E; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <a href="/legal">Legal Index</a>
      <a href="/terms">Terms of Use</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/copyright">Copyright &amp; DMCA</a>
    </nav>
    ${body}
    <div class="footer">
      &copy; 2026 OnlyMonkes. All rights reserved. &nbsp;|&nbsp; <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...CORS_HEADERS,
    },
  });
}

function handleLegalIndex(): Response {
  const body = `
    <h1>OnlyMonkes — Legal</h1>
    <p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>
    <p>Public legal documents for the OnlyMonkes mobile application.</p>
    <h2>Documents</h2>
    <ul>
      <li><a href="/terms"><strong>Terms of Use &amp; End User License Agreement</strong></a> &mdash; license grant, eligibility, acceptable use, fees, AI &amp; trading disclaimers, liability.</li>
      <li><a href="/privacy"><strong>Privacy Policy</strong></a> &mdash; what we collect (and don&rsquo;t), third-party services, your rights.</li>
      <li><a href="/copyright"><strong>Copyright &amp; DMCA Notice</strong></a> &mdash; copyright ownership and procedure for filing infringement notices.</li>
    </ul>
    <h2>Contact</h2>
    <p>Email: <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a></p>
    <p>Issue tracker: <a href="${LEGAL_GITHUB_ISSUES}" target="_blank" rel="noopener">github.com/jumpstreet25/OnlyMonkes/issues</a></p>`;
  return legalShell("Legal", body);
}

function handleTerms(): Response {
  const body = `
    <h1>Terms of Use &amp; End User License Agreement</h1>
    <p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>

    <p>Please read these Terms of Use and End User License Agreement ("Terms") carefully before using the OnlyMonkes application ("the App"). By downloading, installing, or using the App, you agree to be bound by these Terms. If you do not agree, do not use the App.</p>

    <p>Our <a href="/privacy">Privacy Policy</a> describes how we handle information you provide to us when you use the App. By using the App, you also agree to our Privacy Policy.</p>

    <h2>1. License Grant</h2>
    <ul>
      <li>Subject to your compliance with these Terms, OnlyMonkes grants you a limited, non-exclusive, non-transferable, revocable license to download, install, and use the App on a compatible mobile device that you own or control, solely for your personal, non-commercial use.</li>
      <li>You may not copy, modify, distribute, sell, lease, sublicense, or create derivative works of the App or any part thereof.</li>
      <li>You may not reverse-engineer, decompile, disassemble, or attempt to extract the source code of the App, except to the extent that such restriction is prohibited by applicable law.</li>
      <li>This license is effective until terminated. It terminates automatically if you fail to comply with any provision of these Terms.</li>
    </ul>

    <h2>2. Eligibility</h2>
    <ul>
      <li>You must be at least 18 years of age to use the App.</li>
      <li>You must own a verified Saga Monkes NFT in a compatible Solana wallet to access the App's features.</li>
      <li>You are responsible for maintaining the security of your wallet and private keys.</li>
    </ul>

    <h2>3. Account and Access</h2>
    <ul>
      <li>Access to the App is gated by on-chain NFT verification. You do not create a traditional account &mdash; your Solana wallet and NFT serve as your identity.</li>
      <li>Your username, profile picture, and bio are broadcast to other users via the XMTP protocol and are visible to all community members.</li>
      <li>We reserve the right to remove or restrict access to users who violate these Terms.</li>
    </ul>

    <h2>4. Acceptable Use</h2>
    <p>You agree NOT to use the App to:</p>
    <ul>
      <li>Send spam, unsolicited advertising, or promotional content.</li>
      <li>Harass, threaten, bully, or intimidate other users.</li>
      <li>Share illegal content, including but not limited to content that promotes violence, exploitation, or illegal activities.</li>
      <li>Impersonate other users, public figures, or entities.</li>
      <li>Distribute malware, phishing links, or other malicious content.</li>
      <li>Attempt to exploit, hack, or reverse-engineer the App or its infrastructure.</li>
      <li>Manipulate or abuse the in-app tipping, trading, or swap features for fraudulent purposes.</li>
      <li>Share content that infringes on the intellectual property rights of others.</li>
    </ul>

    <h2>5. User Content</h2>
    <ul>
      <li>You retain ownership of all content (messages, images, videos) you create and share through the App.</li>
      <li>By sharing content, you grant other users the ability to view and interact with it within the App.</li>
      <li>Messages are end-to-end encrypted via XMTP. We cannot access, moderate, or delete message content on the decentralized network.</li>
      <li>You are solely responsible for the content you share.</li>
    </ul>

    <h2>6. Digital Assets and Transactions</h2>
    <ul>
      <li>The App enables in-app token transfers (tipping with $SKR), token swaps via the Jupiter aggregator, peer-to-peer NFT trading (MonkeMarkets), and autonomous trading (AutonoMonke), all using Solana Mobile Wallet Adapter.</li>
      <li>All blockchain transactions are <strong>irreversible</strong>. We cannot reverse, cancel, or refund any on-chain transaction.</li>
      <li>You are solely responsible for verifying transaction details before approving them in your wallet.</li>
      <li>We are not responsible for any financial losses resulting from token swaps, tips, NFT trades, or autonomous trades made through the App.</li>
    </ul>

    <h2>6a. Trading Fees</h2>
    <p>OnlyMonkes charges a platform fee only on specific trading surfaces. All fees are injected atomically into the same transaction as the swap &mdash; if the swap fails, the fee transfer cannot fire. Fees are sent to the OnlyMonkes development wallet to support ongoing development, infrastructure, and maintenance.</p>
    <ul>
      <li><strong>NFT Sales (MonkeMarkets):</strong> A <strong>2% fee</strong> is deducted from the sale price of every NFT sold through MonkeMarkets. The fee is built into the atomic swap transaction &mdash; the buyer pays the listed price, the seller receives 98%. Applies to all sales regardless of profit or loss.</li>
      <li><strong>In-App Token Swap UI:</strong> A <strong>0.10% fee on every swap</strong> (via Jupiter's own platform fee mechanism, deducted automatically as part of the swap), plus a <strong>3% fee on realized profits only</strong> when selling tokens back to SOL. The profit-based fee is never charged on a loss; the 0.10% applies to both buys and sells. Profit is calculated as: sell proceeds minus proportional cost basis (SOL spent buying those units, tracked locally on your device).</li>
      <li><strong>Bot-Executed Trades (DM <code>/buy</code> <code>/sell</code> <code>/swap</code> with enrolled hot wallet):</strong> A <strong>0.10% fee on every swap</strong> (Jupiter platform fee), plus a <strong>3% fee on realized profits only</strong> when the bot executes a sell back to SOL on your behalf from your encrypted hot wallet. The bot DMs you a quote and waits for an explicit <code>YES</code> reply (30-second window) before signing. If you have no enrolled hot wallet, these commands instead generate a fee-free Jupiter web URL (see 6b). Cost basis is tracked server-side per-wallet, AES-256-GCM encrypted at rest.</li>
      <li><strong>Autonomous Trades (AutonoMonke):</strong> A <strong>0.10% fee on every swap</strong> (Jupiter platform fee), plus a <strong>5% fee on realized profits only</strong> on positions closed by the AutonoMonke autonomous trading engine. The 5% is never charged on a loss.</li>
      <li><strong>Solana Actions / Blinks:</strong> A <strong>0.10% fee on every swap</strong> executed via a one-tap swap card rendered in chat, taken automatically as part of the same transaction via Jupiter's platform fee mechanism.</li>
    </ul>
    <p>The 0.10% swap fee (added 2026-08-27) is a flat fee on swap volume, separate from the profit-based fees above &mdash; it applies regardless of whether the trade is a win or a loss. You will be presented with a fee agreement before your first use of each trading feature. By tapping "I Understand" you acknowledge and accept the applicable fees.</p>

    <h2>6b. Fee-Free Surfaces</h2>
    <p>These features do <strong>not</strong> incur an OnlyMonkes platform fee. Standard Solana network fees and third-party routing fees may still apply.</p>
    <ul>
      <li><strong>SKR Tips and SOL Tips</strong> &mdash; <strong>100% to the recipient</strong>. The <code>/tip</code> command and tip-link claims do not skim a platform fee. (As of v2.37; earlier versions of the App applied a 5% dev fee on SKR tips &mdash; that fee has been removed.)</li>
      <li><strong>Bot swap commands without an enrolled hot wallet</strong> &mdash; <code>/buy</code>, <code>/sell</code>, and <code>/swap</code> sent in group chat, or in DM by users who have not enrolled an AutonoMonke hot wallet, generate a Jupiter web URL that you click to execute on Jupiter's web interface. OnlyMonkes does not take a platform fee or referral fee on these external links. (Same commands sent in DM with an enrolled hot wallet are bot-executed; see 6a.)</li>
      <li><strong>Treasury operations</strong> &mdash; OnlyMonkes' own conversion of ad/tip revenue to $SKR for staking does not charge itself a fee.</li>
      <li><strong>Non-trading bot commands</strong> &mdash; <code>/risk</code>, <code>/limit</code>, <code>/dca</code>, <code>/stake</code>, <code>/unstake</code>, <code>/hermes</code>, <code>/portfolio</code>, and informational commands.</li>
      <li><strong>Predictions and Sports Bets</strong> &mdash; routed through the Jupiter Prediction API. Jupiter's own fee structure applies, but OnlyMonkes adds no platform fee.</li>
    </ul>

    <h2>6c. MonkeMarkets (Peer-to-Peer NFT Trading)</h2>
    <ul>
      <li>MonkeMarkets enables peer-to-peer trading of Saga Monkes NFTs directly within the App. Listings, bids, and trades are coordinated via XMTP protocol messages and executed as atomic Solana transactions.</li>
      <li>All NFT trades are <strong>peer-to-peer</strong> &mdash; OnlyMonkes is not a party to the transaction and does not hold or custody any NFTs or funds at any time.</li>
      <li>Non-holders may browse MonkeMarkets listings (read-only access). Bidding and listing require a verified Saga Monkes NFT.</li>
      <li>The 2% sale fee described in Section 6a is injected atomically into the swap transaction and cannot be circumvented.</li>
      <li>You are solely responsible for setting fair prices and verifying transaction details before approving in your wallet.</li>
      <li>OnlyMonkes does not guarantee the authenticity, quality, or value of any NFT listed on MonkeMarkets beyond on-chain verification of the Saga Monkes collection.</li>
    </ul>

    <h2>7. AI Trading Agent</h2>
    <ul>
      <li>The App includes an AI-powered trading agent ("AI Agent #9385") that provides automated technical analysis of Solana tokens, alerts, and the AutonoMonke autonomous trading service.</li>
      <li>All signals, alerts, and analysis are for <strong>informational and entertainment purposes only</strong> and do not constitute financial advice, investment advice, or trading recommendations.</li>
      <li>Past performance and hypothetical PNL reports do not guarantee future results.</li>
      <li>You should conduct your own research (DYOR) and consult a qualified financial advisor before making any investment decisions.</li>
    </ul>

    <h2>7a. Multi-Device Wallets, Encrypted Backend Memory, and Backups</h2>
    <p>To enable autonomous trading and consistent service across multiple devices, OnlyMonkes operates an encrypted backend ("Hermes Memory") with the following properties:</p>
    <ul>
      <li><strong>Wallet-keyed identity.</strong> Your durable identity is your Solana wallet address. Multiple device sessions (XMTP inbox IDs) may be bound to the same wallet without losing data &mdash; reinstalling the App or signing in on a new device preserves your hot wallet, AutonoMonke positions, alert preferences, and trading history.</li>
      <li><strong>Per-user AES-256-GCM encryption at rest.</strong> Each user's data is encrypted with a per-wallet salt derived from your wallet address and a master vault key held only by the bot operator. One user's data cannot be decrypted with another user's key derivation path.</li>
      <li><strong>Operator-encrypted, not end-to-end.</strong> The bot operator (OnlyMonkes) <em>can</em> decrypt your encrypted data when actively managing your AutonoMonke vault or processing trade commands. This is necessary for AutonoMonke to function on your behalf. We do not access your data outside of providing the service. <em>If you require fully end-to-end encryption with no operator access, do not use AutonoMonke.</em></li>
      <li><strong>Encrypted nightly backups.</strong> Per-user encrypted state is backed up nightly with a separate backup encryption key (split-key disaster recovery). Backups are retained for 30 days then rotated out.</li>
      <li><strong>What is stored:</strong> AutonoMonke vault state (encrypted hot wallet keypair, position history, risk config), per-user trading memory and alert outcomes, and cost basis for bot-executed <code>/buy</code>/<code>/sell</code>/<code>/swap</code> trades (used to compute the 3%-on-realized-gains fee atomically when you sell). The in-app swap UI cost basis remains on your device only.</li>
      <li><strong>What is NOT stored centrally:</strong> XMTP messages (decentralized network), private keys of your main connected wallet (we never have access; only your wallet app does), Banana Shop balance and purchases (stored locally on your device, optionally restorable via the in-app "Restore from previous device" flow which signs with your wallet to confirm ownership).</li>
      <li><strong>Data retention &amp; purge.</strong> Trading data is retained while your AutonoMonke vault is active and for 30 days after vault closure or last activity, then archived to anonymized aggregates and per-user records purged. You may request earlier purge by contacting <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> from the email associated with your account, signed with the wallet.</li>
    </ul>

    <h2>8. Avatar Rooms and Video Calls</h2>
    <ul>
      <li><strong>Avatar Rooms</strong> &mdash; animated NFT PFP avatar rooms with MediaPipe face tracking and Krisp AI noise cancellation. Voice + face-driven avatar animation; audio is transmitted in real time and not recorded by us.</li>
      <li><strong>Video Calls</strong> &mdash; multi-person video built on LiveKit WebRTC with PiP mode. Streams are not recorded or stored by us.</li>
      <li><strong>Live Audio Rooms</strong> were discontinued in v2.33; messages tagged <code>LIVE_ROOM:</code> remain parsed for backward compatibility but no new audio rooms can be started.</li>
      <li>You agree to follow the same acceptable use standards in rooms as in text chat.</li>
      <li>Room hosts may mute or remove participants at their discretion.</li>
    </ul>

    <h2>9. Third-Party Services</h2>
    <p>The App integrates with third-party services including but not limited to:</p>
    <ul>
      <li><strong>XMTP</strong> &mdash; Decentralized end-to-end encrypted messaging protocol</li>
      <li><strong>Helius</strong> &mdash; NFT ownership verification via DAS API</li>
      <li><strong>Cloudinary</strong> &mdash; Media hosting for photos and videos shared in chat</li>
      <li><strong>LiveKit</strong> &mdash; Live audio, video, and avatar room infrastructure</li>
      <li><strong>Jupiter</strong> &mdash; Token swap aggregator and prediction order routing</li>
      <li><strong>Expo / Firebase</strong> &mdash; Push notification delivery</li>
      <li><strong>Sentry</strong> &mdash; Crash reporting (opt-in)</li>
    </ul>
    <p>Your use of these services is subject to their respective terms of service and privacy policies. We are not responsible for the availability, accuracy, or conduct of third-party services.</p>

    <h2>10. Intellectual Property</h2>
    <ul>
      <li>The OnlyMonkes name, logo, branding, and app design are the property of the OnlyMonkes team.</li>
      <li>Saga Monkes NFT artwork is the property of its respective creators and rights holders.</li>
      <li>You may not reproduce, distribute, or create derivative works of the App without permission.</li>
      <li>For copyright infringement notices, see our <a href="/copyright">Copyright &amp; DMCA Notice</a>.</li>
    </ul>

    <h2>11. Disclaimers</h2>
    <ul>
      <li>The App is provided <strong>"AS IS"</strong> and <strong>"AS AVAILABLE"</strong> without warranties of any kind, whether express or implied, including but not limited to the implied warranties of merchantability, fitness for a particular purpose, and non-infringement.</li>
      <li>We do not guarantee uninterrupted access, error-free operation, or that the App will meet your specific requirements.</li>
      <li>We do not warrant the accuracy, completeness, or reliability of any content, data, or information provided through the App, including AI-generated trading signals.</li>
      <li>We are not responsible for any loss of data, tokens, NFTs, or other digital assets.</li>
      <li>We are not responsible for the conduct of other users.</li>
    </ul>

    <h2>12. Limitation of Liability</h2>
    <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ONLYMONKES AND ITS DEVELOPERS, OFFICERS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, TOKENS, NFTS, OR OTHER DIGITAL ASSETS, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE APP, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
    <p>In no event shall our total liability to you for all claims arising from or relating to the App exceed the amount you paid us, if any, during the twelve (12) months preceding the claim.</p>

    <h2>13. Indemnification</h2>
    <p>You agree to indemnify, defend, and hold harmless OnlyMonkes and its developers from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or in any way connected with your use of the App, your violation of these Terms, or your violation of any rights of another party.</p>

    <h2>14. Modifications</h2>
    <ul>
      <li>We reserve the right to modify these Terms at any time. Updated Terms will be posted on this page with a revised "Last updated" date.</li>
      <li>Continued use of the App after changes constitutes acceptance of the updated Terms.</li>
      <li>We may update, modify, or discontinue the App or any feature at any time without prior notice.</li>
    </ul>

    <h2>15. Termination</h2>
    <p>We may suspend or terminate your access to the App at any time, for any reason, including violation of these Terms. Upon termination, your right to use the App ceases immediately and you must delete all copies of the App from your devices. Provisions relating to intellectual property, disclaimers, limitation of liability, and indemnification survive termination.</p>

    <h2>16. Governing Law</h2>
    <p>These Terms shall be governed by and construed in accordance with applicable laws. Any disputes arising from these Terms or your use of the App shall be resolved through good-faith negotiation. If a dispute cannot be resolved through negotiation, it shall be submitted to binding arbitration in accordance with applicable rules.</p>

    <h2>17. Severability</h2>
    <p>If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect.</p>

    <h2>18. Entire Agreement</h2>
    <p>These Terms, together with the <a href="/privacy">Privacy Policy</a> and <a href="/copyright">Copyright &amp; DMCA Notice</a>, constitute the entire agreement between you and OnlyMonkes regarding your use of the App and supersede any prior agreements.</p>

    <h2>19. Contact</h2>
    <p>For questions about these Terms, contact us at <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> or open an issue at <a href="${LEGAL_GITHUB_ISSUES}" target="_blank" rel="noopener">github.com/jumpstreet25/OnlyMonkes</a>.</p>`;
  return legalShell("Terms of Use", body);
}

function handlePrivacy(): Response {
  const body = `
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>

    <h2>Overview</h2>
    <p>OnlyMonkes is an NFT-gated social application for verified Saga Monkes holders on Solana Mobile. We are committed to protecting your privacy and being transparent about the data we handle.</p>

    <h2>Data We Collect</h2>

    <h3>Wallet Address</h3>
    <ul>
      <li>Your Solana wallet public address is used solely to verify Saga Monkes NFT ownership via the Helius DAS API.</li>
      <li>Your wallet address is <strong>never</strong> stored on our servers.</li>
    </ul>

    <h3>Messages</h3>
    <ul>
      <li>All messages are end-to-end encrypted using the XMTP v5 MLS protocol.</li>
      <li>Messages are stored on the XMTP decentralized network &mdash; we cannot read, access, or decrypt your messages.</li>
      <li>Message content is cached locally on your device for performance.</li>
    </ul>

    <h3>Push Notifications</h3>
    <ul>
      <li>An Expo push token or FCM token is stored in your XMTP profile to enable push notifications.</li>
      <li>This token is used only to deliver notifications about new messages, mentions, reactions, live rooms, and community activity.</li>
      <li>You can disable notifications at any time in your device settings or within the app.</li>
    </ul>

    <h3>NFT Metadata</h3>
    <ul>
      <li>Your selected Saga Monkes NFT image and metadata are cached locally on your device.</li>
      <li>This data is fetched from public on-chain sources (Helius DAS API, IPFS) and is publicly available on the Solana blockchain.</li>
    </ul>

    <h3>Photos and Videos</h3>
    <ul>
      <li>Photos and videos you choose to share in chat are uploaded to Cloudinary for delivery to other users.</li>
      <li>Media is uploaded only when you explicitly choose to send it.</li>
      <li>We do not access or analyze the content of your media.</li>
    </ul>

    <h3>Username and Profile</h3>
    <ul>
      <li>Your chosen username, bio, location, and linked social accounts (e.g., X/Twitter handle) are broadcast to other users via the XMTP protocol.</li>
      <li>This information is not stored on any centralized server.</li>
    </ul>

    <h3>In-App Token Swap Cost Basis (device-local)</h3>
    <ul>
      <li>If you use the in-app token swap UI, your per-token cost basis (amount of SOL spent per token) is stored locally on your device via AsyncStorage. This data is used solely to calculate the 3%-on-realized-gains fee and is never transmitted off-device.</li>
      <li>Your acceptance of fee agreements (MonkeMarkets, token trades, AutonoMonke) is stored locally on your device so you are not prompted repeatedly.</li>
    </ul>

    <h3>Banana Shop and Bananas Balance (device-local)</h3>
    <ul>
      <li>Your bananas balance, daily reward streak, and Banana Shop cosmetic purchases are stored locally on your device via AsyncStorage, scoped to your wallet address (so different wallets on the same device don't overwrite each other).</li>
      <li>This data is <strong>not</strong> automatically synchronized across devices. The "Restore from previous device" flow in Settings allows you to manually copy banana state from one device to another by signing with your wallet to prove ownership.</li>
      <li>Server-side wallet-keyed banana sync is on the v2.38 roadmap.</li>
    </ul>

    <h3>AutonoMonke Vault, Trading History, and Bot DM State (encrypted backend)</h3>
    <ul>
      <li>If you opt in to AutonoMonke or interact with bot DM commands, the following data is stored on a backend service operated by OnlyMonkes ("Hermes Memory"), encrypted with AES-256-GCM at rest:
        <ul>
          <li>Your AutonoMonke hot wallet keypair (encrypted)</li>
          <li>AutonoMonke vault state (deposit balance, open positions, risk configuration, enrollment status)</li>
          <li>Per-user trading memory (alerts received, alert outcomes, win-rate, position history)</li>
          <li>Cost basis for bot-executed trades (separate from the device-local cost basis used by the in-app swap UI)</li>
        </ul>
      </li>
      <li><strong>Per-wallet isolation.</strong> Each user's encrypted data is keyed on a per-wallet salt derived from your wallet address. Even if backend storage were compromised, one user's data cannot be decrypted with another user's key derivation path.</li>
      <li><strong>Operator-encrypted, not end-to-end.</strong> The bot operator can decrypt your data when actively managing your vault or processing your trade commands. This is necessary for AutonoMonke to function. We do not access your data outside of providing the service.</li>
      <li><strong>Multi-device support.</strong> Your wallet address is the durable identity &mdash; multiple devices (XMTP inbox IDs) may bind to the same wallet, and switching devices preserves your data.</li>
      <li><strong>Retention.</strong> Active trading data is retained while your vault is active and for 30 days after vault closure or last activity, then archived to anonymized aggregates and per-user records purged.</li>
      <li><strong>Encrypted backups.</strong> Per-user encrypted state is backed up nightly with a separate backup encryption key (split-key disaster recovery), retained 30 days, dual-destination (local + external drive), then rotated out.</li>
      <li><strong>Per-user purge on request.</strong> You may request purge of your per-user data by emailing <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> from the address associated with your account, signed with the wallet.</li>
    </ul>

    <h3>Crash Reporting (Optional)</h3>
    <ul>
      <li>The App may send anonymized crash reports to Sentry to help us diagnose and fix bugs. Reports do not include private keys, message content, or wallet addresses.</li>
    </ul>

    <h2>Data We Do NOT Collect</h2>
    <ul>
      <li><strong>Private keys of your main connected wallet</strong> &mdash; we never have access. All transaction signing happens in your wallet app (Phantom, Solflare, etc.) via Mobile Wallet Adapter. The AutonoMonke vault keypair is a <em>separate</em> hot wallet that the bot generates and encrypts on your behalf when you opt in to autonomous trading.</li>
      <li>Personal identification information (legal name, email address, phone number)</li>
      <li>Precise device location (only approximate region if you opt in to share it on the Globe feature)</li>
      <li>Device identifiers beyond the push notification token</li>
      <li>Browsing history or behavioral analytics</li>
    </ul>

    <h2>Data Storage Summary</h2>
    <ul>
      <li><strong>XMTP messages, profile broadcasts, reactions:</strong> stored on the decentralized XMTP MLS network. Cached locally on your device for performance. Not on OnlyMonkes servers.</li>
      <li><strong>Session credentials, MWA auth tokens:</strong> device's secure storage (SecureStore).</li>
      <li><strong>In-app cost basis, fee acceptance flags, bananas balance, Banana Shop purchases, login streak:</strong> device-local AsyncStorage, scoped to your wallet address.</li>
      <li><strong>NFT image cache, profile cache:</strong> device-local.</li>
      <li><strong>AutonoMonke vault, bot trading history, per-user trading memory, cost basis for bot-executed trades:</strong> encrypted backend (Hermes Memory) operated by OnlyMonkes &mdash; AES-256-GCM at rest, per-wallet salted.</li>
      <li><strong>Encrypted nightly backups:</strong> separate backup key, 30-day retention, dual-destination (local + external drive).</li>
    </ul>

    <h2>Data Sharing</h2>
    <p>We do not sell, rent, or share your personal data with any third parties. The only data shared externally is:</p>
    <ul>
      <li>Your public wallet address, sent to Helius for NFT ownership verification.</li>
      <li>Push notification tokens, sent to Expo/Google for notification delivery.</li>
      <li>Media files you choose to share, uploaded to Cloudinary for delivery.</li>
      <li>Anonymized crash reports, sent to Sentry (if not disabled).</li>
    </ul>

    <h2>Third-Party Services</h2>
    <ul>
      <li><strong>XMTP</strong> &mdash; Decentralized messaging protocol. <a href="https://xmtp.org/privacy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>Helius</strong> &mdash; NFT verification via DAS API. <a href="https://helius.dev/privacy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>Cloudinary</strong> &mdash; Media hosting for in-chat photos and videos. <a href="https://cloudinary.com/privacy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>LiveKit</strong> &mdash; Live audio, video, and avatar room infrastructure. <a href="https://livekit.io/privacy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>Jupiter</strong> &mdash; Token swap aggregator and prediction order routing. <a href="https://docs.jup.ag/legal/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>Expo</strong> &mdash; Push notification delivery. <a href="https://expo.dev/privacy" target="_blank" rel="noopener">Privacy Policy</a></li>
      <li><strong>Sentry</strong> &mdash; Crash reporting. <a href="https://sentry.io/privacy/" target="_blank" rel="noopener">Privacy Policy</a></li>
    </ul>

    <h2>Children's Privacy</h2>
    <p>OnlyMonkes is not intended for use by anyone under the age of 18. We do not knowingly collect data from minors. If we become aware that we have collected data from a person under 18, we will take steps to delete that data.</p>

    <h2>Your Rights</h2>
    <p>Because OnlyMonkes does not store user data on centralized servers, most data control is in your hands directly:</p>
    <ul>
      <li><strong>Access &amp; deletion</strong> &mdash; uninstalling the App removes locally stored data. Messages on the XMTP network are subject to XMTP's own retention.</li>
      <li><strong>Profile visibility</strong> &mdash; update or clear your profile (username, bio, social handles) at any time from the in-app settings.</li>
      <li><strong>Notifications</strong> &mdash; disable per-channel or globally from the in-app menu drawer or device settings.</li>
      <li><strong>Crash reports</strong> &mdash; disable Sentry from the in-app settings.</li>
    </ul>

    <h2>International Users</h2>
    <p>The App is operated from the United States. By using the App, users outside the United States acknowledge that their information may be processed in the United States and other locations where our service providers operate.</p>

    <h2>Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. Any changes will be reflected on this page with an updated revision date. Continued use of the App after changes constitutes acceptance of the revised policy.</p>

    <h2>Contact</h2>
    <p>For privacy questions or concerns, contact us at <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> or open an issue at <a href="${LEGAL_GITHUB_ISSUES}" target="_blank" rel="noopener">github.com/jumpstreet25/OnlyMonkes</a>.</p>

    <p>Please also review our <a href="/terms">Terms of Use &amp; End User License Agreement</a> and <a href="/copyright">Copyright &amp; DMCA Notice</a>.</p>`;
  return legalShell("Privacy Policy", body);
}

function handleCopyright(): Response {
  const body = `
    <h1>Copyright &amp; DMCA Notice</h1>
    <p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>

    <h2>Copyright Notice</h2>
    <p>&copy; 2026 OnlyMonkes. All rights reserved.</p>
    <ul>
      <li>The OnlyMonkes name, logo, mascot, banana iconography, and App user interface design are the property of the OnlyMonkes team.</li>
      <li>The App's source code, server code, and original artwork are protected by copyright laws and international treaties.</li>
      <li>"Saga Monkes" NFT artwork displayed within the App is the property of its respective creators and rights holders. Display within the App is incidental to on-chain verification of holder identity and does not transfer or imply transfer of any rights.</li>
      <li>Third-party trademarks, logos, and brand names referenced in the App (e.g., Solana, XMTP, Jupiter, LiveKit, Helius, Cloudinary) are the property of their respective owners.</li>
    </ul>

    <h2>License to End Users</h2>
    <p>End users receive a limited, revocable license to use the App as described in our <a href="/terms">Terms of Use</a>. No rights to copy, redistribute, sublicense, or create derivative works of the App or its assets are granted.</p>

    <h2>DMCA &mdash; Reporting Copyright Infringement</h2>
    <p>OnlyMonkes respects the intellectual property rights of others. If you believe that material accessible through the App infringes your copyright, you may submit a notice in accordance with the Digital Millennium Copyright Act (DMCA), 17 U.S.C. &sect; 512.</p>

    <h3>How to Submit a Notice</h3>
    <p>Send a written notice to our designated agent at <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> with the subject line <strong>"DMCA Notice"</strong>. Your notice must include:</p>
    <ol>
      <li>A physical or electronic signature of the copyright owner or a person authorized to act on their behalf.</li>
      <li>Identification of the copyrighted work claimed to have been infringed.</li>
      <li>Identification of the material that is claimed to be infringing, with sufficient detail to permit us to locate it (including, where applicable, a Solana transaction signature, XMTP message identifier, or NFT mint address).</li>
      <li>Your contact information (name, address, telephone number, email).</li>
      <li>A statement that you have a good-faith belief that the use of the material is not authorized by the copyright owner, its agent, or the law.</li>
      <li>A statement, made under penalty of perjury, that the information in the notice is accurate and that you are the copyright owner or are authorized to act on behalf of the owner.</li>
    </ol>
    <p><strong>Note:</strong> Because messages on the XMTP network are end-to-end encrypted and stored on a decentralized protocol, OnlyMonkes does not have the technical ability to remove individual messages from the network. We can, however, take action against repeat infringers within the App where feasible.</p>

    <h3>Counter-Notice</h3>
    <p>If you believe that material you posted was removed or disabled by mistake or misidentification, you may submit a counter-notice to <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a> containing:</p>
    <ol>
      <li>Your physical or electronic signature.</li>
      <li>Identification of the material that has been removed or to which access has been disabled, and the location at which it appeared before removal or disablement.</li>
      <li>A statement under penalty of perjury that you have a good-faith belief that the material was removed or disabled as a result of mistake or misidentification.</li>
      <li>Your name, address, telephone number, and a statement that you consent to the jurisdiction of the federal court in your judicial district (or, if outside the United States, any judicial district in which OnlyMonkes may be found), and that you will accept service of process from the person who provided the original notice or an agent of that person.</li>
    </ol>

    <h3>Repeat Infringers</h3>
    <p>OnlyMonkes will, in appropriate circumstances and at its discretion, restrict or terminate access for users who are determined to be repeat infringers.</p>

    <h2>Misrepresentation</h2>
    <p>Under 17 U.S.C. &sect; 512(f), any person who knowingly materially misrepresents that material is infringing, or that it was removed by mistake, may be liable for damages.</p>

    <h2>Contact</h2>
    <p>Designated DMCA Agent: <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a></p>
    <p>Issue tracker: <a href="${LEGAL_GITHUB_ISSUES}" target="_blank" rel="noopener">github.com/jumpstreet25/OnlyMonkes/issues</a></p>`;
  return legalShell("Copyright & DMCA Notice", body);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/health") {
      return jsonResponse({ status: "ok", version: "1.10.0", endpoints: ["/api/actions/swap", "/api/actions/tip", "/api/actions/predict", "/api/actions/bet", "/api/actions/kalshi-bet", "/api/actions/treasury-swap", "/api/actions/treasury-stake", "/api/treasury/status", "/api/treasury/threshold-check", "/api/treasury/weekly-summary", "/api/actions/ad-skip", "/api/ad-skip/status", "/api/ad-skip/verify", "/escrow", "/claim", "/frames/alert", "/legal", "/terms", "/privacy", "/copyright", "/", "/api/stats", "/api/verify", "/api/holders/index", "/api/top-traders", "/api/signals", "/monke/:mint", "/api/sentiment/register-device", "/api/sentiment/unregister-device", "/api/sentiment/ingest", "/api/sentiment/score", "/api/community/locations", "/api/community/location", "/api/community/events", "/api/community/events/:id", "/api/community/events/:id/rsvp", "/api/community/events/:id/rsvps", "/api/admin/publish-app-config"] });
    }

    // 2026-07-30: public "Check Your Monke" growth page — see the section
    // comment above SAGA_COLLECTION_MINT for context.
    if (path === "/") {
      if (request.method === "GET") return handleLandingPage(env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/stats") {
      if (request.method === "GET") return handleStatsApi(env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/verify") {
      if (request.method === "GET") return handleVerifyApi(url, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/holders/index") {
      if (request.method === "GET") return handleHoldersIndexGet(env);
      if (request.method === "POST") return handleHoldersIndexPost(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/holders/lookup") {
      if (request.method === "GET") return handleHoldersLookup(url, env);
      return errorResponse("Method not allowed", 405);
    }

    // Admin config publish — see adminConfig.ts. Wallet-signed, no GitHub
    // credential ever leaves this worker.
    if (path === "/api/admin/publish-app-config") {
      if (request.method === "POST") return handlePublishAppConfig(request, env);
      return errorResponse("Method not allowed", 405);
    }

    // MonkeGlobe/MonkeEvents — public web repo backend, see community.ts.
    if (path === "/api/community/locations") {
      if (request.method === "GET") return handleGetLocations(env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/community/location") {
      if (request.method === "POST") return handleSetLocation(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/community/events") {
      if (request.method === "GET") return handleGetEvents(env);
      if (request.method === "POST") return handleCreateEvent(request, env);
      return errorResponse("Method not allowed", 405);
    }
    const eventRsvpsMatch = path.match(/^\/api\/community\/events\/([^/]+)\/rsvps$/);
    if (eventRsvpsMatch) {
      if (request.method === "GET") return handleGetRsvps(decodeURIComponent(eventRsvpsMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }
    const eventRsvpStatusMatch = path.match(/^\/api\/community\/events\/([^/]+)\/rsvp-status$/);
    if (eventRsvpStatusMatch) {
      if (request.method === "GET") {
        const wallet = url.searchParams.get("wallet");
        if (!wallet) return errorResponse("Missing wallet");
        return handleGetRsvpStatus(decodeURIComponent(eventRsvpStatusMatch[1]), wallet, env);
      }
      return errorResponse("Method not allowed", 405);
    }
    const eventRsvpMatch = path.match(/^\/api\/community\/events\/([^/]+)\/rsvp$/);
    if (eventRsvpMatch) {
      if (request.method === "POST") return handleRsvp(decodeURIComponent(eventRsvpMatch[1]), request, env);
      return errorResponse("Method not allowed", 405);
    }
    const eventMatch = path.match(/^\/api\/community\/events\/([^/]+)$/);
    if (eventMatch) {
      if (request.method === "GET") return handleGetEvent(decodeURIComponent(eventMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/top-traders") {
      if (request.method === "GET") return handleTopTradersGet(env);
      if (request.method === "POST") return handleTopTradersPost(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/signals") {
      if (request.method === "GET") return handleSignalsGet(url, env);
      if (request.method === "POST") return handleSignalsPost(request, env);
      return errorResponse("Method not allowed", 405);
    }
    // Data Oracle Phase 1 — attestation + collection + aggregation only, no payouts.
    // See sentimentOracle.ts for the full design (device→wallet binding, batch signature
    // verification, anonymized epoch aggregation).
    if (path === "/api/sentiment/register-device") {
      if (request.method === "POST") return handleSentimentRegisterDevice(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/sentiment/unregister-device") {
      if (request.method === "POST") return handleSentimentUnregisterDevice(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/sentiment/ingest") {
      if (request.method === "POST") return handleSentimentIngest(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/sentiment/score") {
      if (request.method === "GET") return handleSentimentScore(url, env);
      return errorResponse("Method not allowed", 405);
    }

    // Device Integrity Attestation — backend-verified (Key Attestation cert chain + RASP +
    // Saga/Genesis ownership), cached per wallet, no on-chain write. See deviceIntegrity.ts.
    if (path === "/api/device-integrity/challenge") {
      if (request.method === "POST") return handleDeviceIntegrityChallenge(env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/device-integrity/issue") {
      if (request.method === "POST") return handleDeviceIntegrityIssue(request, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/device-integrity/status") {
      if (request.method === "GET") return handleDeviceIntegrityStatus(url, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/download/apk") {
      if (request.method === "GET") return handleDownloadApk(env);
      return errorResponse("Method not allowed", 405);
    }
    const monkeImageMatch = path.match(/^\/monke\/([^/]+)\/image$/);
    if (monkeImageMatch) {
      if (request.method === "GET") return handleMonkeImage(decodeURIComponent(monkeImageMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }
    const monkeMatch = path.match(/^\/monke\/([^/]+)$/);
    if (monkeMatch) {
      if (request.method === "GET") return handleMonkePage(decodeURIComponent(monkeMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }

    // Legal pages (Solana Mobile dApp Store compliance)
    if (path === "/legal" || path === "/legal/") {
      if (request.method === "GET") return handleLegalIndex();
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/terms" || path === "/terms.html") {
      if (request.method === "GET") return handleTerms();
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/privacy" || path === "/privacy.html") {
      if (request.method === "GET") return handlePrivacy();
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/copyright" || path === "/copyright.html") {
      if (request.method === "GET") return handleCopyright();
      return errorResponse("Method not allowed", 405);
    }

    // Well-known actions discovery
    if (path === "/actions.json" || path === "/.well-known/actions.json") {
      return handleActionsJson(url);
    }

    // Swap endpoint
    if (path === "/api/actions/swap") {
      if (request.method === "GET") return handleSwapGet(url);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleSwapPost(url, body, env);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Treasury: sweep publisher-wallet SOL → SKR, then stake with the Guardian.
    // Read-only status + two tap-to-sign Blinks — see treasury.ts's doc
    // comment for why this never touches a private key.
    if (path === "/api/treasury/status") {
      if (request.method === "GET") return handleTreasuryStatus(env);
      return errorResponse("Method not allowed", 405);
    }
    // 2026-08-27: $20-of-income sweep alert (bot polls this, DMs the admin a
    // tap-to-sign link — no hot key involved) + the Treasury bot's weekly
    // digest source. See treasury.ts doc comments on each handler.
    if (path === "/api/treasury/threshold-check") {
      if (request.method === "GET") return handleTreasuryThreshold(env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/treasury/weekly-summary") {
      if (request.method === "GET") return handleTreasuryWeeklySummary(url, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/actions/treasury-swap") {
      if (request.method === "GET") return handleTreasurySwapGet(url);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleTreasurySwapPost(url, body, env);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/actions/treasury-stake") {
      if (request.method === "GET") return handleTreasuryStakeGet(url, env);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleTreasuryStakePost(url, body, env);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Pay-$SKR-to-skip-ads: Blink builds the transfer, /api/ad-skip/verify
    // confirms it on-chain before granting 30 days in AD_ENTITLEMENTS KV.
    // See adSkip.ts's doc comment for why this is a plain transfer, not a
    // bundled swap.
    if (path === "/api/actions/ad-skip") {
      if (request.method === "GET") return handleAdSkipGet();
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleAdSkipPost(body, env);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/ad-skip/status") {
      if (request.method === "GET") return handleAdSkipStatus(url, env);
      return errorResponse("Method not allowed", 405);
    }
    if (path === "/api/ad-skip/verify") {
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleAdSkipVerify(body, env);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Tip endpoint
    if (path === "/api/actions/tip") {
      if (request.method === "GET") return handleTipGet(url);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleTipPost(url, body, env);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Predict / Bet endpoints (Jupiter Prediction API — geo-gated for US/KR)
    if (path === "/api/actions/predict" || path === "/api/actions/bet") {
      const kind: PredictKind = path === "/api/actions/bet" ? "bet" : "predict";
      if (request.method === "GET") return handlePredictGet(url, kind, request);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handlePredictPost(url, body, env, kind, request);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Kalshi bet endpoint (DFlow /order — US-legal via wallet KYC, no geo gate)
    if (path === "/api/actions/kalshi-bet") {
      if (request.method === "GET") return handleKalshiBetGet(url);
      if (request.method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        return handleKalshiBetPost(url, body, env);
      }
      return errorResponse("Method not allowed", 405);
    }

    // Farcaster Frames: trade alert frames
    if (path === "/frames/alert") {
      if (request.method === "POST") return handleFrameAlertPost(request, env);
      return errorResponse("Method not allowed", 405);
    }

    // Farcaster Frames: alert frame HTML (public)
    const frameAlertMatch = path.match(/^\/frames\/alert\/([^/]+)$/);
    if (frameAlertMatch) {
      if (request.method === "GET") return handleFrameAlertGet(decodeURIComponent(frameAlertMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }

    // Farcaster Frames: alert image (public)
    const frameImageMatch = path.match(/^\/frames\/alert\/([^/]+)\/image$/);
    if (frameImageMatch) {
      if (request.method === "GET") return handleFrameAlertImage(decodeURIComponent(frameImageMatch[1]), env);
      return errorResponse("Method not allowed", 405);
    }

    // Escrow: store ephemeral keypair for tip link (bot-authenticated)
    if (path === "/escrow") {
      if (request.method === "POST") return handleEscrowPost(request, env);
      return errorResponse("Method not allowed", 405);
    }

    // Claim: public endpoint to claim a tip link
    if (path === "/claim") {
      if (request.method === "GET") return handleClaim(url, request, env);
      return errorResponse("Method not allowed", 405);
    }

    // v2.38 (2026-05-26) — Helius webhook ingress.
    // Helius POSTs an array of parsed transactions when watched accounts
    // see activity. We auth via `Authorization: <HELIUS_WEBHOOK_SECRET>`,
    // write each event to KV under a lex-sortable key, and return 200.
    // Bot polls /helius-events to drain the queue.
    if (path === "/helius-webhook") {
      if (request.method !== "POST") return errorResponse("Method not allowed", 405);
      return handleHeliusWebhook(request, env);
    }

    // Bot-side drain of the Helius event queue. Authenticated via the same
    // BOT_HTTP_SECRET that gates /escrow.
    if (path === "/helius-events") {
      if (request.method !== "GET") return errorResponse("Method not allowed", 405);
      return handleHeliusEvents(url, request, env);
    }

    return errorResponse("Not found", 404);
  },

  // 2026-07-30: refreshes the stats:latest KV cache every 4h (see
  // wrangler.toml [triggers]) so GET / and /monke/:mint always render from
  // a fast KV read instead of making live Helius/CoinGecko calls per page
  // view. Runs independently of the bot process — see the section comment
  // above SAGA_COLLECTION_MINT for why that matters.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 * * * *") {
      // Hourly: close the previous hour's sentiment epoch (Data Oracle Phase 1).
      ctx.waitUntil(
        closeSentimentEpoch(env, new Date(event.scheduledTime))
          .catch(err => console.error("[scheduled] sentiment epoch close failed:", err)),
      );
      return;
    }
    ctx.waitUntil(
      computeStatsSnapshot(env)
        .then(snapshot => env.FRAME_ALERTS.put(STATS_KV_KEY, JSON.stringify(snapshot)))
        .catch(err => console.error("[scheduled] stats refresh failed:", err)),
    );
  },
} satisfies ExportedHandler<Env>;
