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
    path === "/welcome" || path === "/get" || path === "/health" || path === "/actions.json" || path === "/claim" || path === "/escrow" ||
    path === "/robots.txt" || path === "/sitemap.xml" ||
    /^\/(legal|terms|privacy|copyright)(\/|\.html)?$/.test(path) ||
    /^\/(open|monke|api|frames|download|site|\.well-known)\//.test(path) ||
    /^\/helius-(webhook|events)$/.test(path)
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    return isSitePath(path) ? env.ACTIONS.fetch(request) : env.ASSETS.fetch(request);
  },
};
