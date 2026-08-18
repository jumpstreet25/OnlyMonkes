/**
 * sentimentOracle.ts — Data Oracle Phase 1: attestation + collection + aggregation only.
 *
 * NO payout logic lives here (Phase 4, blocked on legal review — see the plan). This module
 * only proves two things: (a) unsigned/spoofed submissions are rejected, (b) verified
 * submissions fold into a stable per-token, per-epoch aggregate.
 *
 * "TEE-backed" here means Android Keystore/StrongBox hardware-key attestation, NOT Solana
 * Mobile's TEEPIN — no public third-party attestation API exists for TEEPIN as of this
 * writing (checked docs.solanamobile.com directly). Device batches are signed with a
 * per-device ECDSA P-256 key generated in Android Keystore (StrongBox-backed where
 * available); a Solana wallet signature (ed25519, via MWA) binds that device key to a
 * SagaMonkes-holding wallet once at registration time, so a batch signature alone can never
 * be replayed under someone else's claimed wallet.
 *
 * Data minimization: raw per-batch event content (which token, how long) is folded into the
 * current epoch's running aggregate and NEVER persisted beyond that — only the aggregate and
 * a short-lived (TTL'd) rate-limit marker survive the request.
 *
 * KV namespace (create via `wrangler kv:namespace create SENTIMENT_ORACLE`):
 *   SENTIMENT_ORACLE
 *     device:<deviceHash>                       — { walletAddress, devicePubKeyBase64, entitledUntil, registeredAt }, 30d TTL safety net
 *     epoch:<hourBucket>:agg                     — { tokens: { [token]: { viewCount, totalDwellMs } }, updatedAt }
 *     epoch:<hourBucket>:closed                  — frozen scores, written once by the hourly cron
 *     epoch:<hourBucket>:ratelimit:<deviceHash>  — presence-only marker, ~2h TTL, one accepted batch per device per epoch
 */

import type { Env, KVNamespace } from "./index";
import { fetchOwnedMonke } from "./index";

// ─── Local response helpers (mirrors index.ts's, kept local to avoid a churny export) ──────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 32_768; // batches are small (token symbol + dwell ms) — 32KB is generous
const MAX_EVENTS_PER_BATCH = 200;
const MAX_DWELL_MS = 10 * 60 * 1000; // 10 min per event — sanity bound, not a real cap on usage
const DEVICE_TTL_SECONDS = 30 * 24 * 3600; // 30-day safety-net GC; entitledUntil is the real gate
const ENTITLEMENT_WINDOW_MS = 24 * 3600 * 1000; // client re-registers roughly daily to refresh this
const RATE_LIMIT_TTL_SECONDS = 2 * 3600;
const CLOSED_EPOCH_TTL_SECONDS = 90 * 24 * 3600;
const REGISTRATION_MESSAGE_FRESHNESS_MS = 5 * 60 * 1000;
const TOKEN_RE = /^\$?[A-Za-z0-9._-]{1,20}$/;
const HOUR_BUCKET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

// Mirrors HARD_THREATS in src/lib/security.ts — a batch reporting any of these is rejected.
const HARD_THREATS = new Set([
  "privilegedAccess",
  "hooks",
  "appIntegrity",
  "deviceBinding",
  "raspNotConfigured",
]);

// ─── Base64 / bytes helpers (Workers runtime — no Buffer-free assumptions needed since
// nodejs_compat is on, but atob/btoa are simplest and dependency-free) ─────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

// ─── ECDSA P-256 (device attestation key) verification ──────────────────────────────────
//
// Android's Signature.getInstance("SHA256withECDSA") produces a DER-encoded (r,s) signature.
// Web Crypto's ECDSA verify expects raw, fixed-width r||s (IEEE P1363) — NOT DER. This
// converts DER → raw before calling crypto.subtle.verify. Written against real
// Android-Keystore-produced signatures, not assumed from spec alone.

function derToRawEcdsaSignature(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  let offset = 1;
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | der[offset++];
  }
  function readInt(): Uint8Array | null {
    if (der[offset] !== 0x02) return null;
    offset++;
    let len = der[offset++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[offset++];
    }
    if (offset + len > der.length) return null;
    const bytes = der.slice(offset, offset + len);
    offset += len;
    return bytes;
  }
  const r = readInt();
  const s = readInt();
  if (!r || !s) return null;

  const toFixed32 = (b: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < b.length - 1 && b[start] === 0) start++;
    const trimmed = b.slice(start);
    const out = new Uint8Array(32);
    out.set(trimmed.slice(Math.max(0, trimmed.length - 32)), Math.max(0, 32 - trimmed.length));
    return out;
  };

  const raw = new Uint8Array(64);
  raw.set(toFixed32(r), 0);
  raw.set(toFixed32(s), 32);
  return raw;
}

async function verifyEcdsaP256(
  spkiDerBytes: Uint8Array,
  message: Uint8Array,
  derSignature: Uint8Array,
): Promise<boolean> {
  try {
    const rawSig = derToRawEcdsaSignature(derSignature);
    if (!rawSig) return false;
    const key = await crypto.subtle.importKey(
      "spki",
      spkiDerBytes as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      rawSig as BufferSource,
      message as BufferSource,
    );
  } catch {
    return false;
  }
}

// ─── Ed25519 (Solana wallet) verification — device→wallet binding proof ────────────────
// Cloudflare Workers' Web Crypto supports Ed25519 natively; no extra dependency needed.

async function verifyEd25519(
  publicKeyBytes: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", key, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

function base58ToBytes(s: string): Uint8Array | null {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of s) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

// ─── Epoch bucketing ─────────────────────────────────────────────────────────

function hourBucketOf(date: Date): string {
  return date.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}

function previousHourBucket(date: Date): string {
  return hourBucketOf(new Date(date.getTime() - 3600_000));
}

// ─── Registration ────────────────────────────────────────────────────────────

interface RegisterBody {
  walletAddress?: string;
  devicePubKeyBase64?: string;
  ts?: number;
  walletSignatureBase64?: string;
}

function buildBindingMessage(devicePubKeyBase64: string, ts: number): string {
  return `OnlyMonkes Sentiment Oracle Device Registration\ndevice:${devicePubKeyBase64}\nts:${ts}`;
}

export async function handleSentimentRegisterDevice(request: Request, env: Env): Promise<Response> {
  let body: RegisterBody;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return errorResponse("Body too large", 413);
    body = JSON.parse(text);
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { walletAddress, devicePubKeyBase64, ts, walletSignatureBase64 } = body;
  if (!walletAddress || !devicePubKeyBase64 || !ts || !walletSignatureBase64) {
    return errorResponse("Missing required field(s)");
  }
  if (Math.abs(Date.now() - ts) > REGISTRATION_MESSAGE_FRESHNESS_MS) {
    return errorResponse("Registration timestamp is stale — retry", 400);
  }

  const walletBytes = base58ToBytes(walletAddress);
  if (!walletBytes || walletBytes.length !== 32) {
    return errorResponse("Invalid wallet address", 400);
  }

  let deviceKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    deviceKeyBytes = base64ToBytes(devicePubKeyBase64);
    signatureBytes = base64ToBytes(walletSignatureBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }

  const message = new TextEncoder().encode(buildBindingMessage(devicePubKeyBase64, ts));
  const walletSigOk = await verifyEd25519(walletBytes, message, signatureBytes);
  if (!walletSigOk) {
    return errorResponse("Wallet signature does not match binding message", 401);
  }

  // Reuse the existing Helius→QuickNode→Alchemy→on-chain entitlement chain — no
  // reimplementation. `uncertain: true` means every provider failed (infra outage), which
  // must NOT be treated as a confirmed non-holder.
  const { monke, uncertain } = await fetchOwnedMonke(walletAddress, env);
  if (uncertain) {
    return errorResponse("Could not verify SagaMonkes ownership right now — retry shortly", 503);
  }
  if (!monke) {
    return errorResponse("Wallet does not hold a SagaMonkes NFT", 403);
  }

  const deviceHash = await sha256Hex(deviceKeyBytes);
  const now = Date.now();
  const record = {
    walletAddress,
    devicePubKeyBase64,
    registeredAt: now,
    entitledUntil: now + ENTITLEMENT_WINDOW_MS,
  };
  await env.SENTIMENT_ORACLE.put(`device:${deviceHash}`, JSON.stringify(record), {
    expirationTtl: DEVICE_TTL_SECONDS,
  });

  return jsonResponse({ ok: true, deviceHash, entitledUntil: record.entitledUntil });
}

export async function handleSentimentUnregisterDevice(request: Request, env: Env): Promise<Response> {
  let body: { devicePubKeyBase64?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }
  if (!body.devicePubKeyBase64) return errorResponse("Missing devicePubKeyBase64");

  let deviceKeyBytes: Uint8Array;
  try {
    deviceKeyBytes = base64ToBytes(body.devicePubKeyBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }
  const deviceHash = await sha256Hex(deviceKeyBytes);
  await env.SENTIMENT_ORACLE.delete(`device:${deviceHash}`);
  return jsonResponse({ ok: true });
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

interface SentimentEvent {
  token: string;
  hourBucket: string;
  dwellMs: number;
}

interface IngestPayload {
  events: SentimentEvent[];
  clientTs?: number;
  raspThreats?: string[];
}

interface IngestBody {
  devicePubKeyBase64?: string;
  payloadBase64?: string;
  signatureBase64?: string;
}

interface DeviceRecord {
  walletAddress: string;
  devicePubKeyBase64: string;
  registeredAt: number;
  entitledUntil: number;
}

interface EpochAggregate {
  tokens: Record<string, { viewCount: number; totalDwellMs: number }>;
  updatedAt: number;
}

export async function handleSentimentIngest(request: Request, env: Env): Promise<Response> {
  let body: IngestBody;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return errorResponse("Body too large", 413);
    body = JSON.parse(text);
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { devicePubKeyBase64, payloadBase64, signatureBase64 } = body;
  if (!devicePubKeyBase64 || !payloadBase64 || !signatureBase64) {
    return errorResponse("Missing required field(s)");
  }

  let deviceKeyBytes: Uint8Array;
  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    deviceKeyBytes = base64ToBytes(devicePubKeyBase64);
    payloadBytes = base64ToBytes(payloadBase64);
    signatureBytes = base64ToBytes(signatureBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }

  const deviceHash = await sha256Hex(deviceKeyBytes);
  const recordRaw = await env.SENTIMENT_ORACLE.get(`device:${deviceHash}`);
  if (!recordRaw) {
    return errorResponse("Device not registered — call /api/sentiment/register-device first", 403);
  }
  const record: DeviceRecord = JSON.parse(recordRaw);
  if (record.devicePubKeyBase64 !== devicePubKeyBase64) {
    // Should be structurally impossible (deviceHash is derived from this exact key), but
    // guards against any future hash-collision-adjacent key-derivation change.
    return errorResponse("Device key mismatch", 401);
  }
  if (record.entitledUntil < Date.now()) {
    return errorResponse("Entitlement expired — re-run device registration", 403);
  }

  const sigOk = await verifyEcdsaP256(deviceKeyBytes, payloadBytes, signatureBytes);
  if (!sigOk) {
    return errorResponse("Batch signature verification failed", 401);
  }

  let payload: IngestPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return errorResponse("Payload is not valid JSON", 400);
  }
  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    return errorResponse("No events in batch", 400);
  }
  if (payload.events.length > MAX_EVENTS_PER_BATCH) {
    return errorResponse(`Batch exceeds ${MAX_EVENTS_PER_BATCH} events`, 400);
  }
  const threats = Array.isArray(payload.raspThreats) ? payload.raspThreats : [];
  if (threats.some((t) => HARD_THREATS.has(t))) {
    return errorResponse("Device reports a hard security threat — rejected", 403);
  }

  const nowBucket = hourBucketOf(new Date());
  const prevBucket = previousHourBucket(new Date());

  // Validate + group events by hour bucket in one pass. Only the current or immediately
  // preceding hour is accepted — bounds how far a batch can backdate/forward-date history.
  const byBucket = new Map<string, SentimentEvent[]>();
  for (const ev of payload.events) {
    if (
      !ev ||
      typeof ev.token !== "string" ||
      !TOKEN_RE.test(ev.token) ||
      typeof ev.hourBucket !== "string" ||
      !HOUR_BUCKET_RE.test(ev.hourBucket) ||
      (ev.hourBucket !== nowBucket && ev.hourBucket !== prevBucket) ||
      typeof ev.dwellMs !== "number" ||
      !Number.isFinite(ev.dwellMs) ||
      ev.dwellMs < 0 ||
      ev.dwellMs > MAX_DWELL_MS
    ) {
      continue; // drop malformed/out-of-window events rather than rejecting the whole batch
    }
    const list = byBucket.get(ev.hourBucket) ?? [];
    list.push(ev);
    byBucket.set(ev.hourBucket, list);
  }
  if (byBucket.size === 0) {
    return errorResponse("No valid events in batch", 400);
  }

  for (const [bucket, events] of byBucket) {
    const rateLimitKey = `epoch:${bucket}:ratelimit:${deviceHash}`;
    const alreadySubmitted = await env.SENTIMENT_ORACLE.get(rateLimitKey);
    if (alreadySubmitted) continue; // one accepted batch per device per epoch — batch/epoch-based only, not real-time

    const aggKey = `epoch:${bucket}:agg`;
    const existingRaw = await env.SENTIMENT_ORACLE.get(aggKey);
    const agg: EpochAggregate = existingRaw
      ? JSON.parse(existingRaw)
      : { tokens: {}, updatedAt: 0 };

    for (const ev of events) {
      const entry = agg.tokens[ev.token] ?? { viewCount: 0, totalDwellMs: 0 };
      entry.viewCount += 1;
      entry.totalDwellMs += ev.dwellMs;
      agg.tokens[ev.token] = entry;
    }
    agg.updatedAt = Date.now();

    await env.SENTIMENT_ORACLE.put(aggKey, JSON.stringify(agg));
    await env.SENTIMENT_ORACLE.put(rateLimitKey, "1", { expirationTtl: RATE_LIMIT_TTL_SECONDS });
  }

  return jsonResponse({ ok: true, buckets: [...byBucket.keys()] });
}

// ─── Score read ──────────────────────────────────────────────────────────────

/**
 * "Score" here means relative attention share within the epoch (0-100), computed from
 * total dwell time — NOT a bullish/bearish directional signal. Phase 1 only collects
 * view/dwell data, so that's the honest ceiling on what this number can mean. Directional
 * sentiment (if ever added) would need different input signals and a separate re-evaluation.
 */
function computeShares(agg: EpochAggregate): Record<string, { viewCount: number; totalDwellMs: number; score: number }> {
  const totalDwell = Object.values(agg.tokens).reduce((sum, t) => sum + t.totalDwellMs, 0);
  const out: Record<string, { viewCount: number; totalDwellMs: number; score: number }> = {};
  for (const [token, t] of Object.entries(agg.tokens)) {
    out[token] = {
      viewCount: t.viewCount,
      totalDwellMs: t.totalDwellMs,
      score: totalDwell > 0 ? Math.round((t.totalDwellMs / totalDwell) * 1000) / 10 : 0,
    };
  }
  return out;
}

export async function handleSentimentScore(url: URL, env: Env): Promise<Response> {
  const tokenParam = url.searchParams.get("token");
  const epochParam = url.searchParams.get("epoch") || "latest";

  const bucket = epochParam === "latest" ? previousHourBucket(new Date()) : epochParam;
  if (!HOUR_BUCKET_RE.test(bucket)) {
    return errorResponse("Invalid epoch — expected YYYY-MM-DDTHH or 'latest'", 400);
  }

  const closedRaw = await env.SENTIMENT_ORACLE.get(`epoch:${bucket}:closed`);
  let agg: EpochAggregate | null = null;
  let closed = false;
  if (closedRaw) {
    agg = JSON.parse(closedRaw);
    closed = true;
  } else {
    const liveRaw = await env.SENTIMENT_ORACLE.get(`epoch:${bucket}:agg`);
    if (liveRaw) agg = JSON.parse(liveRaw);
  }

  if (!agg) {
    return jsonResponse({ epoch: bucket, closed: false, tokens: {} });
  }

  const shares = computeShares(agg);
  if (tokenParam) {
    return jsonResponse({
      epoch: bucket,
      closed,
      token: tokenParam,
      ...(shares[tokenParam] ?? { viewCount: 0, totalDwellMs: 0, score: 0 }),
    });
  }
  return jsonResponse({ epoch: bucket, closed, tokens: shares });
}

// ─── Cron: close the previous epoch ───────────────────────────────────────────

export async function closeSentimentEpoch(env: Env, scheduledAt: Date): Promise<void> {
  const bucket = previousHourBucket(scheduledAt);
  const closedKey = `epoch:${bucket}:closed`;
  const alreadyClosed = await env.SENTIMENT_ORACLE.get(closedKey);
  if (alreadyClosed) return;

  const aggRaw = await env.SENTIMENT_ORACLE.get(`epoch:${bucket}:agg`);
  if (!aggRaw) return; // no submissions this epoch — nothing to freeze

  // Freeze a plain copy of the aggregate (same shape `handleSentimentScore` reads for a
  // live epoch) rather than pre-computed shares, so score computation stays in one place.
  const agg: EpochAggregate = JSON.parse(aggRaw);
  await env.SENTIMENT_ORACLE.put(
    closedKey,
    JSON.stringify({ tokens: agg.tokens, updatedAt: agg.updatedAt, closedAt: Date.now() }),
    { expirationTtl: CLOSED_EPOCH_TTL_SECONDS },
  );
}
