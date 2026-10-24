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
 */

import type { Env } from "./index";
import { base58ToBytes, base64ToBytes, sha256Hex, verifyEcdsaP256 } from "./cryptoVerify";
import { holderWalletFromToken } from "./webAuth";
import type { DeviceIntegrityVerdict } from "./deviceIntegrity";

export const INTERNAL_HOST = "internal.onlymonkes";
const ROOM = /^omv?-\d{10,14}-[A-Za-z0-9]{1,8}$/;

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

  if (proof?.kind === "holder") {
    const wallet = await holderWalletFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    return wallet ? json({ ok: true, wallet, via: "holder" }) : json({ error: "sign in again" }, 401);
  }

  if (proof?.kind === "device") {
    const r = await walletFromDeviceProof(env, proof, (nonce) => livekitProofMessage(roomName, identity, nonce));
    return "error" in r ? json({ error: r.error }, r.status) : json({ ok: true, wallet: r.wallet, tier: r.tier, via: "device" });
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

  const raw = await env.DEVICE_INTEGRITY.get(`wallet:${wallet}`);
  const verdict = raw ? (JSON.parse(raw) as DeviceIntegrityVerdict) : null;
  if (!verdict || verdict.expiresAt < Date.now() || !verdict.hardwareVerified || !verdict.raspClean || verdict.holderTier === "none") {
    return { error: "device not verified for this wallet", status: 403 };
  }
  let keyBytes: Uint8Array, sigBytes: Uint8Array;
  try { keyBytes = base64ToBytes(devicePubKey); sigBytes = base64ToBytes(sig); } catch { return { error: "invalid proof", status: 400 }; }
  if ((await sha256Hex(keyBytes)) !== verdict.deviceHash) return { error: "device not verified for this wallet", status: 403 };
  if (!(await verifyEcdsaP256(keyBytes, new TextEncoder().encode(message(nonce)), sigBytes))) return { error: "bad device signature", status: 401 };
  return { wallet, tier: verdict.holderTier };
}
