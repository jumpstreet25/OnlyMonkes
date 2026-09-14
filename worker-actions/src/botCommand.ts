/**
 * POST /api/bot-command — wallet-signed AutonoMonke/portfolio fallback when
 * XMTP DM send/receive is dead.
 *
 * POST /api/inbox-reset — opt-in per-wallet identity hatch. App bumps a
 * per-wallet HKDF salt, Client.create's a new inbox, then this remaps and
 * the bot addMembers to Main/Trades/Genesis. Never removeMembers. Never
 * changes the global XMTP_IDENTITY_DOMAIN.
 *
 * Auth: ed25519 over a fixed message + Saga Monke or Genesis Token on-chain.
 * Worker then Bearer-forwards to the bot's :3001 (BOT_HTTP_URL).
 *
 * Allowlist must stay in lockstep with:
 *   Monke_Eliza/.../lib/botHttpCommand.ts
 *   OnlyMonkes/src/lib/botCommand.ts
 */
import type { Env } from "./index";
import { CORS_HEADERS } from "./index";
import { verifyEd25519, base58ToBytes } from "./cryptoVerify";
import { verifySagaOnChain } from "./onchainHolder";
import { verifyGenesisTokenOwnership } from "./genesisVerify";
import { PublicKey } from "@solana/web3.js";

const AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_COMMAND_CHARS = 4000;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export function isAllowedBotCommand(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_COMMAND_CHARS) return false;

  const setupMatch = trimmed.match(/^\/autonomonke setup\s+(\{[\s\S]*\})$/i)
    ?? trimmed.match(/^\/automonke setup\s+(\{[\s\S]*\})$/i);
  if (setupMatch) {
    try {
      const parsed = JSON.parse(setupMatch[1]);
      return !!parsed && typeof parsed === "object";
    } catch {
      return false;
    }
  }

  const s = trimmed.replace(/\s+/g, " ").replace(/^\/automonke\b/i, "/autonomonke").toLowerCase();
  if (s === "/autonomonke" || s === "/autonomonke status") return true;
  if (s === "/autonomonke start" || s === "/autonomonke enable") return true;
  if (s === "/autonomonke stop" || s === "/autonomonke pause" || s === "/autonomonke resume") return true;
  if (s === "/autonomonke positions" || s === "/autonomonke pos") return true;
  if (s === "/autonomonke limits" || s === "/autonomonke limits on" || s === "/autonomonke limits off"
    || s === "/autonomonke limits toggle" || s === "/autonomonke limits status") return true;
  if (s === "/portfolio" || s === "/positions") return true;
  return false;
}

async function verifyWalletSig(
  action: string,
  wallet: string,
  ts: number,
  signatureB64: string,
  extraLine: string,
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
  const message = new TextEncoder().encode(`OnlyMonkes ${action}\n${wallet}\n${ts}\n${extraLine}`);
  const sigOk = await verifyEd25519(pubkeyBytes, message, sigBytes);
  if (!sigOk) return { ok: false, error: "Signature verification failed" };
  return { ok: true };
}

async function verifyHolder(wallet: string, env: Env): Promise<{ ok: true } | { ok: false; error: string }> {
  const saga = await verifySagaOnChain(wallet);
  if (saga.verified) return { ok: true };
  try {
    const genesis = await verifyGenesisTokenOwnership(wallet, env);
    if (genesis.verified) return { ok: true };
  } catch {
    /* genesis check failed closed below */
  }
  if (saga.inconclusive) {
    return { ok: false, error: "Couldn't verify NFT ownership right now — try again shortly" };
  }
  return { ok: false, error: "No Saga Monke or Genesis Token found in that wallet" };
}

async function botPost(
  env: Env,
  path: string,
  body: unknown,
): Promise<{ ok: true; json: any } | { ok: false; error: string; status: number }> {
  const base = (env.BOT_HTTP_URL ?? "").replace(/\/$/, "");
  if (!base) return { ok: false, error: "Bot HTTP URL not configured", status: 503 };
  if (!env.BOT_HTTP_SECRET) return { ok: false, error: "Bot HTTP secret not configured", status: 503 };
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.BOT_HTTP_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (json as { error?: string }).error ?? `Bot returned ${res.status}`;
      return { ok: false, error: err, status: res.status >= 400 && res.status < 600 ? res.status : 502 };
    }
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Bot unreachable", status: 502 };
  }
}

export async function handleBotCommand(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const { wallet, ts, signature, command } = body ?? {};
  if (!wallet || !signature || !ts || typeof command !== "string") {
    return errorResponse("Missing wallet/signature/ts/command");
  }
  if (!isAllowedBotCommand(command)) {
    return errorResponse("Command not allowlisted", 403);
  }
  const auth = await verifyWalletSig("BotCommand", wallet, ts, signature, command);
  if (!auth.ok) return errorResponse(auth.error, 401);
  const holder = await verifyHolder(wallet, env);
  if (!holder.ok) return errorResponse(holder.error, 401);

  const forwarded = await botPost(env, "/command", { wallet, command });
  if (!forwarded.ok) return errorResponse(forwarded.error, forwarded.status);
  return jsonResponse(forwarded.json);
}

export async function handleInboxReset(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const { wallet, ts, signature, inboxId, generation } = body ?? {};
  if (!wallet || !signature || !ts || typeof inboxId !== "string") {
    return errorResponse("Missing wallet/signature/ts/inboxId");
  }
  if (!/^[a-f0-9]{64}$/i.test(inboxId)) return errorResponse("Invalid inboxId");
  const gen = Number(generation);
  if (!Number.isInteger(gen) || gen < 1 || gen > 99) return errorResponse("Invalid generation");

  const auth = await verifyWalletSig("InboxReset", wallet, ts, signature, `${inboxId}\n${gen}`);
  if (!auth.ok) return errorResponse(auth.error, 401);
  const holder = await verifyHolder(wallet, env);
  if (!holder.ok) return errorResponse(holder.error, 401);

  const forwarded = await botPost(env, "/inbox-reset", { wallet, inboxId, generation: gen });
  if (!forwarded.ok) return errorResponse(forwarded.error, forwarded.status);
  return jsonResponse(forwarded.json);
}
