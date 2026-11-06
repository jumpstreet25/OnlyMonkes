/**
 * POST /api/rpc — Solana JSON-RPC + DAS proxy for the OnlyMonkes web app and
 * phones.
 *
 * Neither a public website nor an APK/OTA can hide a key (audit 2026-11-06, H6:
 * the bot's Helius + Alchemy keys were readable in the APK and OTA manifest).
 * Both send RPC here and the worker adds the Helius key server-side. Phones
 * send no Origin header (native fetch); browsers always do. Helius credits are one pooled budget
 * (swaps, MonkeLedger, NFT checks), so this is deliberately narrow:
 *  - a browser origin must be in WEB_APP_ORIGINS (or localhost while developing);
 *    no Origin = the phone app
 *  - only the methods the app actually calls; nothing like getProgramAccounts
 *  - ≤10 calls per batch, ≤64 KB body
 *  - per-IP (or per signed-in wallet) limit via WEB_RPC_LIMITER, plus a global
 *    ceiling via RPC_GLOBAL_LIMITER
 *
 * The Origin header proves nothing outside a browser (audit 2026-11-04: a
 * forged Origin reached Helius), so the proxy takes the holder sign-in token
 * (Authorization: Bearer, webAuth.ts) and WEB_RPC_REQUIRE_AUTH="1" makes it
 * required. Phones don't send the token yet, so that flag would lock phones out
 * of RPC: give them one (Device Integrity key) before turning it on.
 */

import { holderWalletFromRequest, type WebAuthEnv } from "./webAuth";

type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface WebRpcEnv extends WebAuthEnv {
  HELIUS_API_KEY: string;
  HELIUS_NFT_API_KEY?: string;
  WEB_APP_ORIGINS?: string;
  WEB_RPC_LIMITER?: RateLimiter;
  RPC_GLOBAL_LIMITER?: RateLimiter;
  WEB_RPC_REQUIRE_AUTH?: string;
}

const RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getFeeForMessage",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getParsedTokenAccountsByOwner",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
  "getPriorityFeeEstimate",
]);

const DAS_METHODS = new Set(["getAsset", "getAssetsByOwner", "searchAssets", "getAssetProof"]);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 10;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowedOrigin(origin: string | null, env: WebRpcEnv): string | null {
  if (!origin) return null;
  if (LOCAL_ORIGIN.test(origin)) return origin;
  const list = (env.WEB_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleWebRpc(request: Request, env: WebRpcEnv): Promise<Response> {
  const rawOrigin = request.headers.get("Origin");
  const origin = allowedOrigin(rawOrigin, env);
  if (rawOrigin && !origin) return reply({ error: "origin not allowed" }, 403, null);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  if (!env.HELIUS_NFT_API_KEY && !env.HELIUS_API_KEY) return reply({ error: "rpc not configured" }, 503, origin);

  const wallet = await holderWalletFromRequest(request, env);
  if (!wallet && env.WEB_RPC_REQUIRE_AUTH === "1") return reply({ error: "sign in again" }, 401, origin);

  if (env.WEB_RPC_LIMITER) {
    const who = wallet ? `w:${wallet}` : request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.WEB_RPC_LIMITER.limit({ key: `rpc:${who}` });
    if (!success) return reply({ error: "rate limited" }, 429, origin);
  }
  if (env.RPC_GLOBAL_LIMITER && !(await env.RPC_GLOBAL_LIMITER.limit({ key: "global" })).success) {
    console.warn("[rpc] global ceiling hit");
    return reply({ error: "busy — try again in a minute" }, 429, origin);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "body too large" }, 413, origin);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reply(rpcError(null, -32700, "Parse error"), 400, origin);
  }

  const batch = Array.isArray(parsed);
  const calls = (batch ? parsed : [parsed]) as Array<Record<string, unknown>>;
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return reply(rpcError(null, -32600, `batch must be 1-${MAX_BATCH} calls`), 400, origin);
  }

  for (const c of calls) {
    const method = typeof c?.method === "string" ? c.method : "";
    if (!DAS_METHODS.has(method) && !RPC_METHODS.has(method)) {
      return reply(rpcError(c?.id, -32601, `method not allowed: ${method.slice(0, 64)}`), 400, origin);
    }
  }
  // The NFT key's account serves plain RPC and DAS, and that key was never in
  // an app build; HELIUS_API_KEY only when it isn't set.
  const key = env.HELIUS_NFT_API_KEY || env.HELIUS_API_KEY;

  const upstream = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch ? calls : calls[0]),
  });
  const text = await upstream.text();
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(text, { status: upstream.status, headers });
}
