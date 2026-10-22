/**
 * Web sign-in for the OnlyMonkes web app → short-lived XMTP access tokens.
 *
 *   POST /api/auth/challenge  { address }            → { nonce, message }
 *   POST /api/auth/login      { nonce, signature }   → { token, expiresAt, tier }
 *   POST /api/auth/refresh    Authorization: Bearer  → { token, expiresAt, tier }
 *
 * The wallet signs a Sign-In-With-Solana style message the worker issued
 * (single-use nonce, 5 min). The worker verifies the Ed25519 signature, then
 * holder status (Saga Monke, else Genesis Token), and signs an EdDSA JWT the
 * self-hosted XMTP backend accepts ([auth] keys in its backend.toml carry the
 * matching public key). Holders only — the backend has no quotas of its own.
 *
 * The chat identity signature (src/lib/xmtpIdentity.ts in the app) never
 * comes here: it derives the user's XMTP key and stays in the browser.
 */

import { base58ToBytes, verifyEd25519 } from "./cryptoVerify";

type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface WebAuthEnv {
  DEVICE_INTEGRITY: KV;
  WEB_APP_ORIGINS?: string;
  WEB_RPC_LIMITER?: RateLimiter;
  XMTP_JWT_PRIVATE_KEY?: string;
  XMTP_JWT_KID?: string;
  BOT_HTTP_URL?: string;
  BOT_HTTP_SECRET: string;
}

export type HolderTier = "monke" | "genesis";
/** Supplied by the router (index.ts owns the holder lookups). */
export type HolderCheck = (wallet: string) => Promise<HolderTier | null | "uncertain">;

export const JWT_ISSUER = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const AUDIENCE = "xmtp";
const SCOPE = "xmtp:access";
const TOKEN_TTL_S = 24 * 3600;
const NONCE_TTL_S = 300;
const NONCE_PREFIX = "siws:";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowedOrigin(origin: string | null, env: WebAuthEnv): string | null {
  if (!origin) return null;
  if (LOCAL_ORIGIN.test(origin)) return origin;
  const list = (env.WEB_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(v: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(v)));
}

function fromB64(s: string): Uint8Array | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > 4096) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

let _signingKey: Promise<CryptoKey> | null = null;
function signingKey(env: WebAuthEnv): Promise<CryptoKey> {
  if (!_signingKey) {
    const der = fromB64(env.XMTP_JWT_PRIVATE_KEY ?? "");
    if (!der) throw new Error("XMTP_JWT_PRIVATE_KEY not configured");
    _signingKey = crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, false, ["sign"]);
    _signingKey.catch(() => { _signingKey = null; });
  }
  return _signingKey;
}

async function issueToken(env: WebAuthEnv, wallet: string, tier: HolderTier) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_S;
  const header = { alg: "EdDSA", typ: "JWT", kid: env.XMTP_JWT_KID || "om-1" };
  const claims = { iss: JWT_ISSUER, aud: AUDIENCE, sub: wallet, scope: SCOPE, tier, iat: now, nbf: now - 30, exp, jti: hex(crypto.getRandomValues(new Uint8Array(12))) };
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", await signingKey(env), new TextEncoder().encode(input)));
  return { token: `${input}.${b64url(sig)}`, expiresAt: exp, tier };
}

/** Our own token's claims, if its signature is ours. Expiry is the caller's call. */
async function readOwnToken(env: WebAuthEnv, token: string): Promise<{ sub: string; exp: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const sig = fromB64(parts[2]);
  if (!sig) return null;
  // Verify by re-signing: Ed25519 is deterministic and the key is ours.
  const expected = new Uint8Array(await crypto.subtle.sign("Ed25519", await signingKey(env), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
  if (expected.length !== sig.length || expected.some((b, i) => b !== sig[i])) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64(parts[1]) ?? new Uint8Array()));
    if (claims.iss !== JWT_ISSUER || claims.aud !== AUDIENCE || typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
    return { sub: claims.sub, exp: claims.exp };
  } catch {
    return null;
  }
}

function signInMessage(origin: string, address: string, nonce: string, issued: Date, expires: Date): string {
  const host = new URL(origin).host;
  return [
    `${host} wants you to sign in with your Solana account:`,
    address,
    "",
    "Sign in to OnlyMonkes web chat. This proves you own this wallet; it costs nothing and moves no funds.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${issued.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join("\n");
}

async function rateLimited(env: WebAuthEnv, request: Request): Promise<boolean> {
  if (!env.WEB_RPC_LIMITER) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return !(await env.WEB_RPC_LIMITER.limit({ key: `auth:${ip}` })).success;
}

export async function handleWebAuth(path: string, request: Request, env: WebAuthEnv, holder: HolderCheck): Promise<Response> {
  const origin = allowedOrigin(request.headers.get("Origin"), env);
  if (!origin) return reply({ error: "origin not allowed" }, 403, null);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  if (!env.XMTP_JWT_PRIVATE_KEY) return reply({ error: "sign-in not configured" }, 503, origin);
  if (await rateLimited(env, request)) return reply({ error: "rate limited" }, 429, origin);

  if (path === "/api/auth/challenge") {
    const body = await readJson(request);
    const address = typeof body?.address === "string" ? body.address : "";
    const pub = address.length >= 32 && address.length <= 44 ? base58ToBytes(address) : null;
    if (!pub || pub.length !== 32) return reply({ error: "invalid address" }, 400, origin);
    const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
    const issued = new Date();
    const message = signInMessage(origin, address, nonce, issued, new Date(issued.getTime() + NONCE_TTL_S * 1000));
    await env.DEVICE_INTEGRITY.put(NONCE_PREFIX + nonce, JSON.stringify({ address, message }), { expirationTtl: NONCE_TTL_S });
    return reply({ nonce, message }, 200, origin);
  }

  if (path === "/api/auth/login") {
    const body = await readJson(request);
    const nonce = typeof body?.nonce === "string" && /^[0-9a-f]{32}$/.test(body.nonce) ? body.nonce : "";
    const signature = typeof body?.signature === "string" ? fromB64(body.signature) : null;
    if (!nonce || !signature || signature.length !== 64) return reply({ error: "invalid request" }, 400, origin);
    const stored = await env.DEVICE_INTEGRITY.get(NONCE_PREFIX + nonce);
    if (!stored) return reply({ error: "challenge expired or already used" }, 401, origin);
    await env.DEVICE_INTEGRITY.delete(NONCE_PREFIX + nonce);
    const { address, message } = JSON.parse(stored) as { address: string; message: string };
    const pub = base58ToBytes(address);
    if (!pub || !(await verifyEd25519(pub, new TextEncoder().encode(message), signature))) {
      return reply({ error: "signature does not match this wallet" }, 401, origin);
    }
    const tier = await holder(address);
    if (tier === "uncertain") return reply({ error: "could not check holder status — try again shortly" }, 503, origin);
    if (!tier) return reply({ error: "no Saga Monke or Genesis Token in this wallet" }, 403, origin);
    return reply(await issueToken(env, address, tier), 200, origin);
  }

  if (path === "/api/auth/refresh") {
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const claims = token ? await readOwnToken(env, token) : null;
    if (!claims || claims.exp <= Math.floor(Date.now() / 1000)) return reply({ error: "sign in again" }, 401, origin);
    const tier = await holder(claims.sub);
    if (tier === "uncertain") return reply({ error: "could not check holder status — try again shortly" }, 503, origin);
    if (!tier) return reply({ error: "no Saga Monke or Genesis Token in this wallet" }, 403, origin);
    return reply(await issueToken(env, claims.sub, tier), 200, origin);
  }

  return reply({ error: "not found" }, 404, origin);
}

const PROFILE_FIELDS = ["u", "b", "x", "tw", "loc", "ni", "nm", "lg", "bd", "ss", "bb", "so", "pb", "sm"];

/**
 * POST /api/profile/me  { inboxId, identifier }  Authorization: Bearer <holder token>
 *
 * Phone → web profile import. The web app passes its own XMTP inbox ID, which
 * is the same wallet-bound inbox the phone app broadcasts from, and gets back
 * the latest public profile that inbox broadcast (the bot keeps it, see the
 * bot's lib/reclaim/inboxProfiles.ts). Holders only.
 */
export async function handleWebProfile(request: Request, env: WebAuthEnv): Promise<Response> {
  const origin = allowedOrigin(request.headers.get("Origin"), env);
  if (!origin) return reply({ error: "origin not allowed" }, 403, null);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  if (!env.XMTP_JWT_PRIVATE_KEY) return reply({ error: "sign-in not configured" }, 503, origin);
  if (await rateLimited(env, request)) return reply({ error: "rate limited" }, 429, origin);
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const claims = token ? await readOwnToken(env, token) : null;
  if (!claims || claims.exp <= Math.floor(Date.now() / 1000)) return reply({ error: "sign in again" }, 401, origin);
  const body = await readJson(request);
  const inboxId = typeof body?.inboxId === "string" && /^[0-9a-f]{64}$/.test(body.inboxId) ? body.inboxId : "";
  // The web client's XMTP identity (0x key derived from the wallet signature);
  // the bot resolves the phone inbox it belongs to, even an older random one.
  const identifier = typeof body?.identifier === "string" && /^0x[0-9a-f]{40}$/.test(body.identifier) ? body.identifier : "";
  if (!inboxId && !identifier) return reply({ error: "invalid inbox" }, 400, origin);
  const base = (env.BOT_HTTP_URL ?? "").replace(/\/$/, "");
  if (!base || !env.BOT_HTTP_SECRET) return reply({ error: "profile import unavailable" }, 503, origin);
  try {
    const res = await fetch(`${base}/web-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BOT_HTTP_SECRET}` },
      body: JSON.stringify({ inboxId, identifier }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return reply({ profile: null }, 200, origin);
    if (!res.ok) return reply({ error: "profile import unavailable" }, 502, origin);
    const raw = ((await res.json()) as { profile?: Record<string, unknown> }).profile ?? {};
    const profile: Record<string, unknown> = {};
    for (const k of PROFILE_FIELDS) if (raw[k] !== undefined) profile[k] = raw[k];
    return reply({ profile }, 200, origin);
  } catch {
    return reply({ error: "profile import unavailable" }, 502, origin);
  }
}
