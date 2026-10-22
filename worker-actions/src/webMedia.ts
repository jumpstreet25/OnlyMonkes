/**
 * Media for the OnlyMonkes web app. The phone app carries the GIPHY key and
 * the image host's upload preset; a public website can't, so:
 *
 *   GET  /api/giphy/(gifs|stickers)/(search|trending)?q=&limit=&offset=&username=
 *        → GIPHY's JSON, with the key added here. Cached 10 min.
 *   POST /api/upload  multipart `file`, Authorization: Bearer <holder token>
 *        → { url }. Images, PDFs and short videos up to 10 MB, 60 per wallet
 *        per day, forwarded to Cloudinary with the server-side preset.
 *
 * Browser origin must be in WEB_APP_ORIGINS (or localhost while developing).
 */

import { holderWalletFromRequest, type WebAuthEnv } from "./webAuth";

type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

export interface WebMediaEnv extends WebAuthEnv {
  DEVICE_INTEGRITY: KV & WebAuthEnv["DEVICE_INTEGRITY"];
  GIPHY_API_KEY?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_UPLOAD_PRESET?: string;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const GIPHY_PATH = /^\/api\/giphy\/(gifs|stickers)\/(search|trending)$/;
const GIPHY_USERNAMES = new Set(["sagamonkes"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOADS_PER_DAY = 60;

function allowedOrigin(origin: string | null, env: WebMediaEnv): string | null {
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
  const origin = allowedOrigin(request.headers.get("Origin"), env);
  if (!origin) return reply({ error: "origin not allowed" }, 403, null);
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
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_UPLOAD_PRESET) return reply({ error: "uploads not configured" }, 503, origin);
  const wallet = await holderWalletFromRequest(request, env);
  if (!wallet) return reply({ error: "sign in again" }, 401, origin);
  if (await limited(env, `upload:${ip}`)) return reply({ error: "rate limited" }, 429, origin);
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return reply({ error: "File is over 10 MB" }, 413, origin);

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
  if (file.size > MAX_UPLOAD_BYTES) return reply({ error: "File is over 10 MB" }, 413, origin);
  const type = file.type || "application/octet-stream";
  const resource = type.startsWith("image/") ? "image" : type === "video/mp4" || type === "video/webm" ? "video" : type === "application/pdf" ? "raw" : "";
  if (!resource) return reply({ error: "Only images, PDFs and MP4/WebM videos" }, 415, origin);

  const out = new FormData();
  out.append("file", file, file.name || "upload");
  out.append("upload_preset", env.CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resource}/upload`, { method: "POST", body: out });
  const data = (await res.json().catch(() => ({}))) as { secure_url?: string };
  if (!res.ok || !data.secure_url) return reply({ error: "Upload failed" }, 502, origin);
  await env.DEVICE_INTEGRITY.put(countKey, String(used + 1), { expirationTtl: 2 * 86400 });
  return reply({ url: data.secure_url }, 200, origin);
}
