/**
 * onlymonkes.app front door (owner, 2026-10-22: the web app lives on the apex).
 * The web app's static build is served for every path except the public-site
 * paths the actions worker answers (worker-actions/src/site.ts isSitePath —
 * keep this list in step): those go to onlymonkes-actions over the ACTIONS
 * service binding, request unchanged (host stays onlymonkes.app).
 */
interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  ACTIONS: { fetch: (req: Request) => Promise<Response> };
  LEDGER: { fetch: (req: Request) => Promise<Response> };
  LIVEKIT_TOKEN: { fetch: (req: Request) => Promise<Response> };
}

// /svc/* — services the web app would otherwise call on other hosts, answered
// here so the site only needs onlymonkes.app (company filters often block
// *.workers.dev and raw.githubusercontent.com). Workers on our account are
// reached over service bindings (a fetch to another *.workers.dev of the same
// account is refused); GitHub files are fetched and briefly cached.
const CONFIG_FILES = new Set(["app-config.json", "bot-commands.json", "saga-monkes-index.json", "monkememe.json"]);

async function serviceRoute(path: string, request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (path.startsWith("/svc/ledger/")) {
    const target = `https://monkeledger.jumpstreet25.workers.dev${path.slice("/svc/ledger".length)}${url.search}`;
    return env.LEDGER.fetch(new Request(target, request));
  }
  if (path === "/svc/livekit-token") {
    return env.LIVEKIT_TOKEN.fetch(new Request("https://onlymonkes-livekit-token.jumpstreet25.workers.dev/", request));
  }
  if (path.startsWith("/svc/config/")) {
    const file = path.slice("/svc/config/".length);
    if (!CONFIG_FILES.has(file) || request.method !== "GET") return new Response("Not found", { status: 404 });
    const res = await fetch(`https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/${file}`, {
      cf: { cacheTtl: 60, cacheEverything: true },
    } as RequestInit);
    const out = new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" } });
    return out;
  }
  return null;
}

function isSitePath(path: string): boolean {
  return (
    path === "/welcome" || path === "/get" || path === "/bot" || path === "/health" || path === "/actions.json" || path === "/claim" || path === "/escrow" ||
    path === "/robots.txt" || path === "/sitemap.xml" ||
    path === "/referrals" || path === "/referrals/" || /^\/r\/[^/]+(\/card\.png)?\/?$/.test(path) ||
    /^\/(legal|terms|privacy|copyright)(\/|\.html)?$/.test(path) ||
    /^\/(open|monke|api|frames|download|site|\.well-known)\//.test(path) ||
    /^\/helius-(webhook|events)$/.test(path)
  );
}

// public/_headers isn't applied once this worker runs first, so the app's
// responses get the same security headers here. The 3D viewer may be framed
// by our own pages only.
function withSecurityHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
  // App code is re-checked on every visit (ETag → 304, cheap). It was cached
  // immutable for a year, but the export's entry-<hash>.js keeps its name
  // across builds while its contents (the chunk names it loads) change: a
  // returning browser ran last build's entry against this build's chunks →
  // "Requiring unknown module" and a black page (three times, 2026-10-29).
  // Images/fonts under /assets/ and canvaskit-<version>.wasm really are
  // versioned by name and stay immutable; the legacy canvaskit.wasm keeps an hour.
  if (path.startsWith("/_expo/static/")) {
    out.headers.set("Cache-Control", "no-cache");
  } else if (path.startsWith("/assets/") || /^\/canvaskit-[0-9][\w.-]*\.wasm$/.test(path)) {
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (path === "/canvaskit.wasm") {
    out.headers.set("Cache-Control", "public, max-age=3600");
  }
  if (path.startsWith("/viewer/")) {
    out.headers.delete("X-Frame-Options");
    out.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  } else {
    out.headers.set("X-Frame-Options", "DENY");
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/svc/")) {
      const res = await serviceRoute(path, request, env);
      if (res) return res;
    }
    if (isSitePath(path)) return env.ACTIONS.fetch(request);
    return withSecurityHeaders(await env.ASSETS.fetch(request), path);
  },
};
