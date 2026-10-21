/**
 * Phone → desktop login pairing for the OnlyMonkes web app ("scan with your
 * Seeker"). Solana Mobile's remote wallet QR isn't supported by any
 * production wallet yet, so the phone opens our own /pair page in its own
 * browser (where Seeker Connect works), signs there, and hands the desktop
 * an encrypted bundle through this relay.
 *
 *   POST /api/pair/start     { desktopKey }            → { id }
 *   POST /api/pair/complete  { id, phoneKey, iv, data } → { ok }
 *   POST /api/pair/poll      { id }                    → { status, bundle? }
 *
 * The bundle (wallet, access token, chat-identity signature) is encrypted on
 * the phone to the desktop's one-time X25519 key; this worker only ever holds
 * ciphertext, and hands it out once. Entries live 5 minutes.
 */

type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface WebPairEnv {
  DEVICE_INTEGRITY: KV;
  WEB_APP_ORIGINS?: string;
  WEB_RPC_LIMITER?: RateLimiter;
}

const PREFIX = "pair:";
const TTL_S = 300;
const KEY_B64URL = /^[A-Za-z0-9_-]{43}$/; // 32-byte X25519 public key
const ID = /^[0-9a-f]{32}$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

type Entry = { desktopKey: string; status: "pending" | "done"; phoneKey?: string; iv?: string; data?: string };

function allowedOrigin(origin: string | null, env: WebPairEnv): string | null {
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

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > 16384) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleWebPair(path: string, request: Request, env: WebPairEnv): Promise<Response> {
  const origin = allowedOrigin(request.headers.get("Origin"), env);
  if (!origin) return reply({ error: "origin not allowed" }, 403, null);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  if (env.WEB_RPC_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.WEB_RPC_LIMITER.limit({ key: `pair:${ip}` })).success) return reply({ error: "rate limited" }, 429, origin);
  }
  const body = await readJson(request);
  if (!body) return reply({ error: "invalid request" }, 400, origin);

  if (path === "/api/pair/start") {
    const desktopKey = typeof body.desktopKey === "string" && KEY_B64URL.test(body.desktopKey) ? body.desktopKey : "";
    if (!desktopKey) return reply({ error: "invalid key" }, 400, origin);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const entry: Entry = { desktopKey, status: "pending" };
    await env.DEVICE_INTEGRITY.put(PREFIX + id, JSON.stringify(entry), { expirationTtl: TTL_S });
    return reply({ id, expiresIn: TTL_S }, 200, origin);
  }

  const id = typeof body.id === "string" && ID.test(body.id) ? body.id : "";
  if (!id) return reply({ error: "invalid id" }, 400, origin);
  const raw = await env.DEVICE_INTEGRITY.get(PREFIX + id);
  if (!raw) return reply({ error: "pairing expired" }, 404, origin);
  const entry = JSON.parse(raw) as Entry;

  if (path === "/api/pair/complete") {
    if (entry.status !== "pending") return reply({ error: "already paired" }, 409, origin);
    const phoneKey = typeof body.phoneKey === "string" && KEY_B64URL.test(body.phoneKey) ? body.phoneKey : "";
    const iv = typeof body.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(body.iv) ? body.iv : "";
    const data = typeof body.data === "string" && /^[A-Za-z0-9_-]{16,12000}$/.test(body.data) ? body.data : "";
    if (!phoneKey || !iv || !data) return reply({ error: "invalid bundle" }, 400, origin);
    const done: Entry = { ...entry, status: "done", phoneKey, iv, data };
    await env.DEVICE_INTEGRITY.put(PREFIX + id, JSON.stringify(done), { expirationTtl: TTL_S });
    return reply({ ok: true }, 200, origin);
  }

  if (path === "/api/pair/poll") {
    if (entry.status !== "done") return reply({ status: "pending" }, 200, origin);
    await env.DEVICE_INTEGRITY.delete(PREFIX + id);
    return reply({ status: "done", bundle: { phoneKey: entry.phoneKey, iv: entry.iv, data: entry.data } }, 200, origin);
  }

  return reply({ error: "not found" }, 404, origin);
}
