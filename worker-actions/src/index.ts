/**
 * Cloudflare Worker — OnlyMonkes Solana Actions Server
 *
 * Implements the Solana Actions spec so bot trade alerts render as
 * interactive Blink cards in chat. Users tap to one-tap execute.
 *
 * Endpoints:
 *   GET  /api/actions/swap?inputMint=X&outputMint=Y&amount=Z  → Action metadata
 *   POST /api/actions/swap?inputMint=X&outputMint=Y&amount=Z  → Serialized swap tx
 *   GET  /api/actions/tip?to=WALLET&amount=N                  → Action metadata
 *   POST /api/actions/tip?to=WALLET&amount=N                  → Serialized tip tx
 *
 * Secrets (set via `wrangler secret put`):
 *   HELIUS_API_KEY — Helius RPC API key
 *   JUP_API_KEY    — Jupiter Swap API v2 key (get from portal.jup.ag)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";

interface Env {
  HELIUS_API_KEY: string;
  JUP_API_KEY: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Content-Encoding, Accept-Encoding",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const FETCH_TIMEOUT = 8_000; // 8s timeout for external API calls
const RPC_TIMEOUT = 10_000;  // 10s for RPC calls

const ACTION_ICON = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/assets/icon.png";

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

function rpcUrl(env: Env): string {
  return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
}

/** Fetch with timeout — prevents worker from hanging on slow upstream APIs. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
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

interface JupBuildResponse {
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
 * This is fee-free (no Jupiter platform fee) and returns raw instructions
 * we assemble into a VersionedTransaction for the user to sign.
 */
async function getJupiterBuild(
  inputMint: string,
  outputMint: string,
  amountLamports: string,
  taker: string,
  slippageBps: number,
  env: Env,
): Promise<JupBuildResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountLamports,
    taker,
    slippageBps: String(slippageBps),
    wrapAndUnwrapSol: "true",
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
async function buildSwapTransaction(
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
    recentBlockhash: build.blockhashWithMetadata.blockhash,
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

    // 1. Get swap instructions from Jupiter v2 /build (fee-free)
    const build = await getJupiterBuild(inputMint, outputMint, amountLamports, account, 50, env);

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
    ],
  });
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
      return jsonResponse({ status: "ok", version: "1.1.0", endpoints: ["/api/actions/swap", "/api/actions/tip"] });
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

    return errorResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
