/**
 * GIFs and uploads for the phone app and the web app, so neither carries a key.
 *
 *   GET  /api/giphy/(gifs|stickers)/(search|trending)?q=&limit=&offset=&username=
 *        → GIPHY's JSON, with the key added here. Cached 10 min.
 *   POST /api/upload  multipart `file`
 *        Web: Authorization: Bearer <holder token>.
 *        Phone: X-OM-Proof: base64 JSON of the holder proof (hardware-key
 *        signature of uploadProofMessage(nonce), or { kind: "holder", token }).
 *        → { url } on media.onlymonkes.app (our own R2 bucket, MEDIA).
 *        Images 10 MB, videos and other files 25 MB, 60 per wallet per day.
 *        Images, MP4/WebM/MOV and PDFs open inline; anything else downloads.
 *
 * Browsers: Origin must be in WEB_APP_ORIGINS (or localhost while developing).
 * The phone sends no Origin, so it gets no CORS header, which a browser on some
 * other site can't use.
 */

import { holderClaimsFromToken, holderWalletFromRequest, type WebAuthEnv } from "./webAuth";
import { walletFromDeviceProof } from "./livekitAuth";

type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
type R2Put = { httpMetadata?: { contentType?: string; contentDisposition?: string; cacheControl?: string } };
type MediaBucket = {
  put(key: string, value: ArrayBuffer | ReadableStream, opts?: R2Put): Promise<unknown>;
  list(opts?: { cursor?: string; limit?: number }): Promise<{ objects: { size: number }[]; truncated: boolean; cursor?: string }>;
};

export interface WebMediaEnv extends WebAuthEnv {
  DEVICE_INTEGRITY: KV & WebAuthEnv["DEVICE_INTEGRITY"];
  FRAME_ALERTS: KV;
  GIPHY_API_KEY?: string;
  MEDIA?: MediaBucket;
}

export const MEDIA_BASE = "https://media.onlymonkes.app";
/** Uploads stop at this much stored (R2 free plan is 10 GB). */
export const MEDIA_MAX_BYTES = 8 * 1024 ** 3;
const MEDIA_FULL_KEY = "media:full";

export function uploadProofMessage(nonce: string): string {
  return `OnlyMonkes Upload\nnonce:${nonce}`;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const GIPHY_PATH = /^\/api\/giphy\/(gifs|stickers)\/(search|trending)$/;
const GIPHY_USERNAMES = new Set(["sagamonkes"]);
const MB = 1024 * 1024;
const UPLOADS_PER_DAY = 60;
const INLINE: Record<string, { ext: string; max: number }> = {
  "image/jpeg": { ext: "jpg", max: 10 * MB },
  "image/png": { ext: "png", max: 10 * MB },
  "image/gif": { ext: "gif", max: 10 * MB },
  "image/webp": { ext: "webp", max: 10 * MB },
  "video/mp4": { ext: "mp4", max: 25 * MB },
  "video/webm": { ext: "webm", max: 25 * MB },
  "video/quicktime": { ext: "mov", max: 25 * MB },
  "application/pdf": { ext: "pdf", max: 25 * MB },
};
const OTHER_MAX = 25 * MB;

/** Stored type + headers for an upload. Anything outside INLINE is served as a download. */
export function mediaKind(type: string, name: string): { contentType: string; ext: string; max: number; disposition?: string } {
  const t = type.toLowerCase().split(";")[0].trim();
  const known = INLINE[t];
  if (known) return { contentType: t, ...known };
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "file";
  const ext = (base.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "bin").toLowerCase();
  return { contentType: "application/octet-stream", ext, max: OTHER_MAX, disposition: `attachment; filename="${base}"` };
}

/** Wallet behind the request: web holder token, or the phone's X-OM-Proof. */
async function uploaderWallet(request: Request, env: WebMediaEnv): Promise<string | null> {
  const fromBearer = await holderWalletFromRequest(request, env);
  if (fromBearer) return fromBearer;
  const raw = request.headers.get("X-OM-Proof");
  if (!raw || raw.length > 4096) return null;
  let proof: any;
  try { proof = JSON.parse(atob(raw)); } catch { return null; }
  if (proof?.kind === "holder") return (await holderClaimsFromToken(env, typeof proof.token === "string" ? proof.token : ""))?.wallet ?? null;
  if (proof?.kind === "device") {
    const r = await walletFromDeviceProof(env as any, proof, uploadProofMessage);
    return "error" in r ? null : r.wallet;
  }
  return null;
}

/** Cron: total the bucket and set/clear the "full" flag uploads check. */
export async function refreshMediaUsage(env: WebMediaEnv): Promise<number | null> {
  if (!env.MEDIA) return null;
  let total = 0, cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const page = await env.MEDIA.list({ cursor, limit: 1000 });
    for (const o of page.objects) total += o.size;
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  if (total >= MEDIA_MAX_BYTES) await env.FRAME_ALERTS.put(MEDIA_FULL_KEY, String(total), { expirationTtl: 6 * 3600 });
  else if (await env.FRAME_ALERTS.get(MEDIA_FULL_KEY)) await env.FRAME_ALERTS.put(MEDIA_FULL_KEY, "", { expirationTtl: 60 });
  return total;
}

function allowedOrigin(request: Request, env: WebMediaEnv): string | null {
  // Browsers leave Origin off same-origin GETs (the GIF search from onlymonkes.app
  // itself); Sec-Fetch-Site is set by the browser and can't be changed by the page.
  const origin = request.headers.get("Origin")
    ?? (request.headers.get("Sec-Fetch-Site") === "same-origin" ? new URL(request.url).origin : null);
  if (!origin) return null;
  if (LOCAL_ORIGIN.test(origin)) return origin;
  const list = (env.WEB_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function reply(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin", ...extra };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

async function limited(env: WebMediaEnv, key: string): Promise<boolean> {
  if (!env.WEB_RPC_LIMITER) return false;
  return !(await env.WEB_RPC_LIMITER.limit({ key })).success;
}

export function isWebMediaPath(path: string): boolean {
  return GIPHY_PATH.test(path) || path === "/api/upload";
}

export async function handleWebMedia(path: string, request: Request, env: WebMediaEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const origin = allowedOrigin(request, env);
  // A browser always says where it is; no Origin and no Sec-Fetch-Site means the phone app.
  const browser = !!(request.headers.get("Origin") || request.headers.get("Sec-Fetch-Site"));
  if (!origin && browser) return reply({ error: "origin not allowed" }, 403, null);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  const giphy = path.match(GIPHY_PATH);
  if (giphy) {
    if (request.method !== "GET") return reply({ error: "GET only" }, 405, origin);
    if (!env.GIPHY_API_KEY) return reply({ error: "GIFs not configured" }, 503, origin);
    if (await limited(env, `giphy:${ip}`)) return reply({ error: "rate limited" }, 429, origin);
    const inParams = new URL(request.url).searchParams;
    const params = new URLSearchParams({ api_key: env.GIPHY_API_KEY, rating: "g" });
    const q = (inParams.get("q") ?? "").slice(0, 50);
    if (giphy[2] === "search") {
      if (!q.trim()) return reply({ error: "missing q" }, 400, origin);
      params.set("q", q);
    }
    const limit = Math.min(50, Math.max(1, parseInt(inParams.get("limit") ?? "25", 10) || 25));
    const offset = Math.min(4999, Math.max(0, parseInt(inParams.get("offset") ?? "0", 10) || 0));
    params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const username = inParams.get("username") ?? "";
    if (GIPHY_USERNAMES.has(username)) params.set("username", username);

    const upstream = `https://api.giphy.com/v1/${giphy[1]}/${giphy[2]}?${params.toString()}`;
    const cacheKey = new Request(`https://giphy-cache.internal/${giphy[1]}/${giphy[2]}?${params.toString().replace(/api_key=[^&]*&?/, "")}`);
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(cacheKey);
    if (hit) return reply(await hit.text(), 200, origin, { "Cache-Control": "public, max-age=300" });
    const res = await fetch(upstream);
    const text = await res.text();
    if (!res.ok) return reply({ error: `GIPHY ${res.status}` }, 502, origin);
    const put = cache.put(cacheKey, new Response(text, { headers: { "Cache-Control": "public, max-age=600" } }));
    if (ctx) ctx.waitUntil(put); else await put;
    return reply(text, 200, origin, { "Cache-Control": "public, max-age=300" });
  }

  // POST /api/upload
  if (request.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  if (!env.MEDIA) return reply({ error: "uploads not configured" }, 503, origin);
  const wallet = await uploaderWallet(request, env);
  if (!wallet) return reply({ error: "sign in again" }, 401, origin);
  if (await limited(env, `upload:${ip}`)) return reply({ error: "rate limited" }, 429, origin);
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > OTHER_MAX + 64 * 1024) return reply({ error: "File is over 25 MB" }, 413, origin);
  if (await env.FRAME_ALERTS.get(MEDIA_FULL_KEY)) return reply({ error: "Uploads are paused for now" }, 503, origin);

  const day = new Date().toISOString().slice(0, 10);
  const countKey = `upl:${wallet}:${day}`;
  const used = parseInt((await env.DEVICE_INTEGRITY.get(countKey)) ?? "0", 10) || 0;
  if (used >= UPLOADS_PER_DAY) return reply({ error: "Daily upload limit reached" }, 429, origin);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = (form as unknown as { get(name: string): unknown }).get("file");
    file = f && typeof f !== "string" ? (f as File) : null;
  } catch { /* handled below */ }
  if (!file) return reply({ error: "missing file" }, 400, origin);
  const kind = mediaKind(file.type || "", file.name || "");
  if (file.size > kind.max) return reply({ error: `File is over ${Math.round(kind.max / MB)} MB` }, 413, origin);

  const rand = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `u/${day.slice(0, 7)}/${rand}.${kind.ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: kind.contentType, cacheControl: "public, max-age=31536000, immutable", ...(kind.disposition ? { contentDisposition: kind.disposition } : {}) },
  });
  await env.DEVICE_INTEGRITY.put(countKey, String(used + 1), { expirationTtl: 2 * 86400 });
  return reply({ url: `${MEDIA_BASE}/${key}` }, 200, origin);
}
