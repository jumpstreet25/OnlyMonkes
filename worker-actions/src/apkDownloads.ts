/**
 * APK downloads from onlymonkes.app, stored in R2 (owner, 2026-10-22: APKs
 * live on onlymonkes.app, never GitHub; only the dApp Store build is
 * "published").
 *
 *   GET /download/apk                  the published dApp Store build
 *   GET /download/t/<token>/<name>.apk a test build (unlisted: anyone with the
 *                                      link; the token is 32 random hex chars)
 *
 * Uploads: scripts/apk/upload-apk.sh (published pointer in FRAME_ALERTS KV
 * `apk:published`). Test builds expire after 30 days (R2 lifecycle rule).
 *
 * Never-charged guardrails (R2 free tier: 10 GB stored, 1M writes and 10M
 * reads a month, egress free):
 *  - downloads are served from Cloudflare's edge cache when possible, so most
 *    never read R2;
 *  - per-IP rate limit (APK_LIMITER);
 *  - monthly circuit breaker: after R2_READS_MONTHLY_CAP R2 reads (10% of the
 *    free allowance) the published link falls back to the GitHub v3.0 copy and
 *    test links pause until the next month;
 *  - storage is capped by the upload script (≤3 GB, ≤3 test builds).
 */

type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
type R2Body = { body: ReadableStream; size: number; httpEtag: string; range?: { offset?: number; length?: number } };
type R2Bucket = {
  get(key: string, opts?: { range?: { offset: number; length?: number } }): Promise<R2Body | null>;
  head(key: string): Promise<{ size: number; httpEtag: string } | null>;
};
type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface ApkEnv {
  APKS?: R2Bucket;
  FRAME_ALERTS: KV;
  APK_LIMITER?: RateLimiter;
}

const R2_READS_MONTHLY_CAP = 1_000_000;
const COUNT_SAMPLE = 10;
const TEST_PATH = /^\/download\/t\/([0-9a-f]{32})\/([A-Za-z0-9._-]{1,80}\.apk)$/;
const APK_TYPE = "application/vnd.android.package-archive";

export function isApkDownloadPath(path: string): boolean {
  return path === "/download/apk" || TEST_PATH.test(path);
}

function monthKey(): string {
  return `apk:r2reads:${new Date().toISOString().slice(0, 7)}`;
}

/**
 * Counts an R2 read; false once this month's cap is reached. Writes 1 in
 * COUNT_SAMPLE reads (adding COUNT_SAMPLE) so download managers' many Range
 * requests stay well inside KV's daily write allowance.
 */
async function underMonthlyCap(env: ApkEnv): Promise<boolean> {
  try {
    const key = monthKey();
    const n = parseInt((await env.FRAME_ALERTS.get(key)) ?? "0", 10) || 0;
    if (n >= R2_READS_MONTHLY_CAP) return false;
    if (Math.random() < 1 / COUNT_SAMPLE) {
      await env.FRAME_ALERTS.put(key, String(n + COUNT_SAMPLE), { expirationTtl: 40 * 86400 });
    }
    return true;
  } catch {
    return true; // KV hiccup: the edge cache + rate limit still bound reads
  }
}

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : NaN;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (isNaN(start)) { start = Math.max(0, size - (parseInt(m[2], 10) || 0)); end = size - 1; }
  if (start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}

let _testKeys: { at: number; keys: Set<string> } | null = null;

/** Current test builds (FRAME_ALERTS `apk:test-index`, written by the upload script). */
async function testKeys(env: ApkEnv): Promise<Set<string>> {
  if (_testKeys && Date.now() - _testKeys.at < 60_000) return _testKeys.keys;
  let keys = new Set<string>();
  try {
    const list = JSON.parse((await env.FRAME_ALERTS.get("apk:test-index")) ?? "[]");
    if (Array.isArray(list)) keys = new Set(list.filter((k) => typeof k === "string"));
  } catch { /* empty */ }
  _testKeys = { at: Date.now(), keys };
  return keys;
}

export async function handleApkDownload(
  path: string,
  request: Request,
  env: ApkEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  githubFallback: () => Promise<string>,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.APK_LIMITER && !(await env.APK_LIMITER.limit({ key: `apk:${ip}` })).success) {
    return new Response("Too many downloads — try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
  }

  let key = "";
  let filename = "OnlyMonkes.apk";
  let maxAge = 3600;
  if (path === "/download/apk") {
    const raw = await env.FRAME_ALERTS.get("apk:published");
    const pub = raw ? (JSON.parse(raw) as { key?: string; name?: string }) : null;
    if (!env.APKS || !pub?.key) return Response.redirect(await githubFallback(), 302);
    key = pub.key;
    filename = pub.name ?? filename;
  } else {
    const m = path.match(TEST_PATH)!;
    if (!env.APKS) return new Response("Test downloads are unavailable", { status: 503 });
    key = `test/${m[1]}/${m[2]}`;
    // Only links the upload script issued reach R2; guessed tokens cost nothing.
    if (!(await testKeys(env)).has(key)) return new Response("This test build has expired or doesn't exist", { status: 404 });
    filename = m[2];
    maxAge = 600;
  }

  const ranged = request.headers.has("Range");
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(`/__apk/${key}`, request.url).toString(), { method: "GET" });
  if (!ranged) {
    const hit = await cache.match(cacheKey);
    if (hit) return request.method === "HEAD" ? new Response(null, { headers: hit.headers }) : hit;
  }

  if (!(await underMonthlyCap(env))) {
    if (path === "/download/apk") return Response.redirect(await githubFallback(), 302);
    return new Response("Test downloads are paused until next month", { status: 503 });
  }

  // Size/ETag only (cheap) for HEAD and ranged requests; the full object otherwise.
  const full = !ranged && request.method === "GET" ? await env.APKS.get(key) : null;
  const head = full ?? (await env.APKS.head(key));
  if (!head) {
    if (path === "/download/apk") return Response.redirect(await githubFallback(), 302);
    return new Response("This test build has expired or doesn't exist", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": APK_TYPE,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": `public, max-age=${maxAge}`,
    "Accept-Ranges": "bytes",
    ETag: head.httpEtag,
    "X-Content-Type-Options": "nosniff",
  };

  if (ranged) {
    const r = parseRange(request.headers.get("Range"), head.size);
    if (!r) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}` } });
    const part = await env.APKS.get(key, { range: r });
    if (!part) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : part.body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${r.offset}-${r.offset + r.length - 1}/${head.size}`, "Content-Length": String(r.length) },
    });
  }

  headers["Content-Length"] = String(head.size);
  if (!full) return new Response(null, { headers });
  const res = new Response(full.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
}
