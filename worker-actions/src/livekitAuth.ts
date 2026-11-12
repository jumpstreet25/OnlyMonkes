/**
 * Who may get a LiveKit room token. The token worker (onlymonkes-livekit-token)
 * asks this over its service binding before it mints anything:
 *
 *   POST https://internal.onlymonkes/api/livekit/authorize
 *        { roomName, identity, proof }  →  { ok: true, wallet, tier } | 401/403
 *
 * The internal host never matches a public request (those carry the worker's
 * real hostname), so this route is only reachable through the binding.
 *
 * Proofs:
 *  - { kind: "holder", token }  — the web app's holder sign-in token
 *    (webAuth.ts; wallet signature + holder check, 24 h).
 *  - { kind: "device", wallet, devicePubKey, nonce, sig } — the phone app:
 *    the hardware Keystore key that Device Integrity already verified and
 *    bound to this holder wallet (verdict in KV, 7 days) signs this exact
 *    room + identity + a fresh single-use nonce. No wallet prompt needed.
 *  - { kind: "bot", secret } — Monke's voice (agents/monke-voice on the VPS)
 *    joining a room it was called into; BOT_HTTP_SECRET, bot identity only.
 *
 * Identity (audit 2026-11-04): a proof shows a wallet, not an inbox, and
 * LiveKit kicks whoever already holds an identity. So holder/device proofs
 * may never take the bot's identity, and an inbox identity (or its `~phone`
 * companion) is refused when that inbox's own PROFILE_UPDATE named a
 * different wallet — the bot keeps that claim under the real XMTP sender, so
 * only the inbox itself could have written it. Unknown (bot unreachable, inbox
 * never named a wallet) still mints and logs `[livekit] identity unchecked`.
 */

import type { Env } from "./index";
import { base58ToBytes, base64ToBytes, sha256Hex, verifyEcdsaP256 } from "./cryptoVerify";
import { holderWalletFromToken } from "./webAuth";
import { deviceVerdict } from "./deviceIntegrity";

export const INTERNAL_HOST = "internal.onlymonkes";
const ROOM = /^omv?-\d{10,14}-[A-Za-z0-9]{1,8}$/;
// AI Agent #9385 (src/lib/constants.ts BOT_INBOX_IDS); "~probe" is the voice self-test listener.
const BOT_INBOX_ID = "998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363";

export function livekitProofMessage(roomName: string, identity: string, nonce: string): string {
  return `OnlyMonkes LiveKit\nroom:${roomName}\nidentity:${identity}\nnonce:${nonce}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handleLivekitAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid body" }, 400); }
  const roomName = typeof body?.roomName === "string" ? body.roomName : "";
  const identity = typeof body?.identity === "string" ? body.identity : "";
  const proof = body?.proof;
  if (!ROOM.test(roomName) || !identity || identity.length > 128) return json({ error: "invalid room or identity" }, 400);

  const isBotIdentity = identity.split("~")[0] === BOT_INBOX_ID;

  if (proof?.kind === "holder") {
    if (isBotIdentity) return json({ error: "not authorized" }, 403);
    const wallet = await holderWalletFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    if (!wallet) return json({ error: "sign in again" }, 401);
    if ((await identityWalletMatch(env, identity, wallet)) === false) return json({ error: "identity belongs to another wallet" }, 403);
    return json({ ok: true, wallet, via: "holder" });
  }

  if (proof?.kind === "bot") {
    const secret = typeof proof.secret === "string" ? proof.secret : "";
    const okId = identity === BOT_INBOX_ID || identity === `${BOT_INBOX_ID}~probe`;
    if (!okId || !env.BOT_HTTP_SECRET || !(await sameSecret(secret, env.BOT_HTTP_SECRET))) return json({ error: "not authorized" }, 403);
    return json({ ok: true, wallet: "bot", via: "bot" });
  }

  if (proof?.kind === "device") {
    if (isBotIdentity) return json({ error: "not authorized" }, 403);
    const r = await walletFromDeviceProof(env, proof, (nonce) => livekitProofMessage(roomName, identity, nonce));
    if ("error" in r) return json({ error: r.error }, r.status);
    if ((await identityWalletMatch(env, identity, r.wallet)) === false) return json({ error: "identity belongs to another wallet" }, 403);
    return json({ ok: true, wallet: r.wallet, tier: r.tier, via: "device" });
  }

  return json({ error: "proof required" }, 401);
}

/**
 * The phone's hardware-key proof: { wallet, devicePubKey, nonce, sig }, where sig
 * signs message(nonce) and the key is the one Device Integrity verified and
 * bound to this holder wallet. The nonce is single use. Shared by LiveKit
 * tokens and referrals (referrals.ts).
 */
export async function walletFromDeviceProof(
  env: Env,
  proof: any,
  message: (nonce: string) => string,
): Promise<{ wallet: string; tier: string } | { error: string; status: number }> {
  const wallet = typeof proof?.wallet === "string" ? proof.wallet : "";
  const devicePubKey = typeof proof?.devicePubKey === "string" ? proof.devicePubKey : "";
  const nonce = typeof proof?.nonce === "string" ? proof.nonce : "";
  const sig = typeof proof?.sig === "string" ? proof.sig : "";
  if (base58ToBytes(wallet)?.length !== 32 || !devicePubKey || !nonce || !sig) return { error: "invalid proof", status: 400 };

  const nonceKey = `nonce:${nonce}`;
  if (!(await env.DEVICE_INTEGRITY.get(nonceKey))) return { error: "nonce expired", status: 401 };
  await env.DEVICE_INTEGRITY.delete(nonceKey);

  let keyBytes: Uint8Array, sigBytes: Uint8Array;
  try { keyBytes = base64ToBytes(devicePubKey); sigBytes = base64ToBytes(sig); } catch { return { error: "invalid proof", status: 400 }; }
  const verdict = await deviceVerdict(env, wallet, await sha256Hex(keyBytes));
  if (!verdict || !verdict.hardwareVerified || !verdict.raspClean || verdict.holderTier === "none") {
    return { error: "device not verified for this wallet", status: 403 };
  }
  if (!(await verifyEcdsaP256(keyBytes, new TextEncoder().encode(message(nonce)), sigBytes))) return { error: "bad device signature", status: 401 };
  return { wallet, tier: verdict.holderTier };
}

/**
 * Did this inbox (identity minus any `~phone` suffix) name `wallet` in its own
 * PROFILE_UPDATE? true / false, or null when unknown — non-inbox identity, bot
 * unreachable, or the inbox never named a wallet.
 */
export async function identityWalletMatch(env: Env, identity: string, wallet: string): Promise<boolean | null> {
  const inboxId = identity.split("~")[0];
  if (!/^[0-9a-f]{64}$/.test(inboxId)) return null;
  const base = (env.BOT_PROFILE_URL ?? "").replace(/\/$/, "");
  let match: boolean | null = null;
  if (base && env.BOT_HTTP_SECRET) {
    try {
      const res = await fetch(`${base}/web-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BOT_HTTP_SECRET}` },
        body: JSON.stringify({ inboxId, checkWallet: wallet }),
        signal: AbortSignal.timeout(3_000),
      });
      const m = res.ok ? ((await res.json()) as { walletMatch?: unknown }).walletMatch : undefined;
      if (typeof m === "boolean") match = m;
    } catch { /* unknown */ }
  }
  console.log(`[livekit] identity ${match === null ? "unchecked" : match ? "matches" : "REFUSED (other wallet)"}`);
  return match;
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(new TextEncoder().encode(a)), sha256Hex(new TextEncoder().encode(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
