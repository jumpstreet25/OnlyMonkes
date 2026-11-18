/**
 * Jupiter Swap v2 for the app, with our Jupiter key added here so it isn't in the app:
 *   GET  /api/jup/build    (swap built for the taker's wallet)
 *   GET  /api/jup/quote    (price check)
 *   GET  /api/jup/order    (Ultra: unsigned tx for the taker)
 *   POST /api/jup/execute  (Ultra: { signedTransaction, requestId })
 * Only Jupiter's own parameters pass, each checked; replies are Jupiter's JSON
 * unchanged. Users still sign every transaction in their own wallet.
 */

const JUP = "https://api.jup.ag/swap/v2";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PATHS = new Set(["build", "quote", "order", "execute"]);

export const isJupProxyPath = (path: string) => path.startsWith("/api/jup/") && PATHS.has(path.slice(9));

/** Upstream query string, or the reason the request is refused. */
export function jupBuildParams(input: URLSearchParams, kind: "build" | "quote" | "order" = "build"): URLSearchParams | string {
  const out = new URLSearchParams();
  for (const k of kind === "quote" ? ["inputMint", "outputMint"] : ["inputMint", "outputMint", "taker"]) {
    const v = input.get(k) ?? "";
    if (!B58.test(v)) return `bad ${k}`;
    out.set(k, v);
  }
  const amount = input.get("amount") ?? "";
  if (!/^[1-9][0-9]{0,19}$/.test(amount)) return "bad amount";
  out.set("amount", amount);
  if (kind === "order") return out;
  const slip = Number(input.get("slippageBps") ?? "50");
  if (!Number.isInteger(slip) || slip < 1 || slip > 5000) return "bad slippageBps";
  out.set("slippageBps", String(slip));
  const wrap = input.get("wrapAndUnwrapSol");
  if (wrap === "true" || wrap === "false") out.set("wrapAndUnwrapSol", wrap);
  const prio = input.get("prioritizationFeeLamports");
  if (prio === "auto" || (prio && /^[0-9]{1,10}$/.test(prio))) out.set("prioritizationFeeLamports", prio);
  const fee = input.get("platformFeeBps");
  const feeAccount = input.get("feeAccount");
  if (fee && feeAccount) {
    const bps = Number(fee);
    if (!Number.isInteger(bps) || bps < 0 || bps > 100 || !B58.test(feeAccount)) return "bad platform fee";
    out.set("platformFeeBps", String(bps));
    out.set("feeAccount", feeAccount);
  }
  return out;
}

/** Ultra execute body, or the reason it's refused. */
export function jupExecuteBody(body: any): string {
  const tx = body?.signedTransaction, id = body?.requestId;
  if (typeof tx !== "string" || tx.length > 4096 || !/^[A-Za-z0-9+/=]+$/.test(tx)) return "";
  if (typeof id !== "string" || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  return JSON.stringify({ signedTransaction: tx, requestId: id });
}

type Limiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
export interface JupProxyEnv { JUP_API_KEY?: string; WEB_RPC_LIMITER?: Limiter; RPC_GLOBAL_LIMITER?: Limiter }

export async function handleJupProxy(request: Request, env: JupProxyEnv, cors: Record<string, string>, path: string): Promise<Response> {
  const json = (body: unknown, status: number) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  // 120/min per IP (the portfolio quotes every holding at once), 600/min overall.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.WEB_RPC_LIMITER && !(await env.WEB_RPC_LIMITER.limit({ key: `jup:${ip}` })).success) return json({ error: "rate limited" }, 429);
  if (env.RPC_GLOBAL_LIMITER && !(await env.RPC_GLOBAL_LIMITER.limit({ key: "jup" })).success) return json({ error: "busy, try again" }, 429);
  const kind = path.slice(9);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.JUP_API_KEY) headers["x-api-key"] = env.JUP_API_KEY;
  if (kind === "execute") {
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    const body = jupExecuteBody(await request.json().catch(() => null));
    if (!body) return json({ error: "bad execute body" }, 400);
    const res = await fetch(`${JUP}/execute`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body });
    return json(await res.text(), res.status);
  }
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  const params = jupBuildParams(new URL(request.url).searchParams, kind as "build" | "quote" | "order");
  if (typeof params === "string") return json({ error: params }, 400);
  const res = await fetch(`${JUP}/${kind}?${params}`, { headers });
  return json(await res.text(), res.status);
}
