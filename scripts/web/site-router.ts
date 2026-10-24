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
  // Export file names carry a content hash, so a browser can keep them for
  // good; the default (max-age=0, must-revalidate) re-checked ~10 MB of app
  // code on every visit. canvaskit.wasm has a fixed name: an hour.
  if (path.startsWith("/_expo/static/") || path.startsWith("/assets/")) {
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
    if (isSitePath(path)) return env.ACTIONS.fetch(request);
    return withSecurityHeaders(await env.ASSETS.fetch(request), path);
  },
};
