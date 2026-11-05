/**
 * Rate limits for public routes that spend Helius credits or KV quota with no
 * sign-in (audit 2026-11-04). Each route gets a per-IP budget and a global
 * ceiling. Ratelimit bindings count per Cloudflare location and are approximate:
 * the per-IP budget stops one client, the global ceiling bounds a flood that
 * rotates IPs. A missing binding (local dev) never blocks.
 */

type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface PublicLimitEnv {
  /** 30 per minute per key (wrangler.toml). */
  PUBLIC_IP_LIMITER?: RateLimiter;
  /** 300 per minute per key (wrangler.toml). */
  PUBLIC_GLOBAL_LIMITER?: RateLimiter;
}

const ROUTES: [RegExp, string][] = [
  [/^\/api\/verify$/, "verify"], // up to 8 DAS/RPC calls per unknown wallet
  [/^\/api\/treasury\/status$/, "treasury"],
  [/^\/monke\/[^/]+(\/image)?$/, "monke"], // getAsset (+ image decode)
  [/^\/claim$/, "claim"], // KV write per request
  [/^\/api\/device-integrity\/challenge$/, "dichallenge"], // KV write per request
  [/^\/api\/monkememe\/generate$/, "meme"],
  [/^\/api\/community\/events\/[^/]+\/rsvps$/, "rsvps"], // KV list
  [/^\/api\/referral\/leaderboard$/, "refboard"], // KV list + N gets
];

export function publicLimitName(path: string): string | null {
  for (const [re, name] of ROUTES) if (re.test(path)) return name;
  return null;
}

/** True when this request should get a 429. */
export async function publicRateLimited(request: Request, path: string, env: PublicLimitEnv): Promise<boolean> {
  const name = publicLimitName(path);
  if (!name) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.PUBLIC_IP_LIMITER && !(await env.PUBLIC_IP_LIMITER.limit({ key: `${name}:${ip}` })).success) return true;
  if (env.PUBLIC_GLOBAL_LIMITER && !(await env.PUBLIC_GLOBAL_LIMITER.limit({ key: `g:${name}` })).success) {
    console.warn(`[limits] global ceiling hit: ${name}`);
    return true;
  }
  return false;
}
