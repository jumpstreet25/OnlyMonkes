/**
 * portfolio.ts — direct-to-worker /portfolio fetch, bypassing XMTP entirely.
 *
 * 2026-09-05: the bot's /portfolio DM reply occasionally sits on XMTP's own
 * send-side "database locked" retry loop (single local MLS SQLite store, one
 * writer, shared with every other stream/scan the bot runs). This is a
 * fast-path RACE the app kicks off alongside its normal /portfolio DM send —
 * never a replacement for it. If this fails or times out, the app falls back
 * to whatever the existing XMTP DM reply produces, unchanged.
 *
 * Auth: same wallet-signature scheme as community.ts's verifyCommunityAuth
 * (ed25519 over a fixed, domain-separated message), but WITHOUT the
 * on-chain Saga Monke check — access here is gated by AutonoMonke
 * enrollment itself (the bot 404s any wallet it doesn't know), and a longer
 * signature-age window (10 min, vs the general 5 min) so the app can cache
 * one signature across several /portfolio taps instead of prompting MWA
 * every time — this is checked frequently, unlike "share my location".
 */
import type { Env } from "./index";
import { CORS_HEADERS } from "./index";
import { verifyEd25519, base58ToBytes } from "./cryptoVerify";
import { PublicKey } from "@solana/web3.js";

const AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const BOT_TIMEOUT_MS = 8_000;

// Bot's public HTTP server (agents/monke-trader/src/services/xmtpOnlyMonkes.ts
// startHttpServer) — BIND_HOST=0.0.0.0, port 3001, firewalled open for the
// Helius webhook already. Bearer-secret gated, not meant for direct client
// access — only this worker calls it.
const BOT_HOST = "http://157.173.192.39:3001";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function verifyPortfolioAuth(
  wallet: string,
  ts: number,
  signatureB64: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Signature expired — try again" };
  }
  let pubkeyBytes: Uint8Array;
  try {
    new PublicKey(wallet);
    pubkeyBytes = base58ToBytes(wallet) ?? new Uint8Array();
    if (pubkeyBytes.length !== 32) throw new Error("bad key length");
  } catch {
    return { ok: false, error: "Invalid wallet address" };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, error: "Invalid signature encoding" };
  }

  const message = new TextEncoder().encode(`OnlyMonkes Portfolio\nfetch\n${wallet}\n${ts}`);
  const sigOk = await verifyEd25519(pubkeyBytes, message, sigBytes);
  if (!sigOk) return { ok: false, error: "Signature verification failed" };
  return { ok: true };
}

// GET /api/portfolio?wallet=...&ts=...&signature=...
export async function handleGetPortfolio(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  const ts = Number(url.searchParams.get("ts"));
  const signature = url.searchParams.get("signature") ?? "";
  if (!wallet || !signature || !ts) return errorResponse("Missing wallet/ts/signature");

  const auth = await verifyPortfolioAuth(wallet, ts, signature);
  if (!auth.ok) return errorResponse(auth.error, 401);

  try {
    const botRes = await fetch(`${BOT_HOST}/api/portfolio?wallet=${encodeURIComponent(wallet)}`, {
      headers: { Authorization: `Bearer ${env.BOT_HTTP_SECRET}` },
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
    });
    if (botRes.status === 404) return errorResponse("No AutonoMonke portfolio yet", 404);
    if (!botRes.ok) return errorResponse("Bot unavailable", 502);
    const data = await botRes.json();
    return jsonResponse(data);
  } catch {
    return errorResponse("Bot unavailable", 502);
  }
}
