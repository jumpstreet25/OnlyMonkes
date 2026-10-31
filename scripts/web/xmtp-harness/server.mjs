import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const H = dirname(fileURLToPath(import.meta.url)), W = join(H, "..", "..", "..");
const cred = readFileSync(process.env.XMTP_TEST_CREDENTIAL_FILE ?? "", "utf8").trim();
const types = { js: "text/javascript", wasm: "application/wasm", html: "text/html" };
export const brHits = { n: 0 };
export function start(port) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const p = new URL(req.url, "http://x").pathname;
      if (p === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><script>globalThis.__OM_XMTP_TEST_CREDENTIAL=${JSON.stringify(cred)}</script><script type="module" src="/harness.js"></script>`); }
      if (p === "/harness.js") { res.writeHead(200, { "Content-Type": types.js }); return res.end(readFileSync(H + "/out/harness.js")); }
      if (p === "/xmtp/worker/xmtp_sdk.wasm") { brHits.n++; res.writeHead(200, { "Content-Type": types.wasm, "Content-Encoding": "br" }); return res.end(readFileSync(W + "/public/xmtp/worker/xmtp_sdk.wasm.br")); }
      const f = W + "/public" + p;
      if (p.startsWith("/xmtp/") && existsSync(f)) { res.writeHead(200, { "Content-Type": types[p.split(".").pop()] ?? "application/octet-stream" }); return res.end(readFileSync(f)); }
      res.writeHead(404); res.end();
    });
    s.listen(port, "127.0.0.1", () => ok(s));
  });
}
