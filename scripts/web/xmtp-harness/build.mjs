import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const H = dirname(fileURLToPath(import.meta.url));
const W = join(H, "..", "..", "..");
await build({
  entryPoints: [join(H, "entry.ts")], bundle: true, format: "esm", platform: "browser", target: "es2022", outfile: join(H, "out", "harness.js"),
  nodePaths: [W + "/node_modules"], logLevel: "warning",
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/(web\/webAuth|lib\/xmtpBackend)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onResolve({ filter: /^\.\/webAuth$/ }, () => ({ path: "webAuth", namespace: "stub" }));
    b.onResolve({ filter: /^@\// }, (a) => ({ path: W + "/src/" + a.path.slice(2) + ".ts" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ loader: "js", contents: a.path.includes("xmtpBackend")
      ? 'export const XMTP_STAGING_URL="https://157-173-192-39.sslip.io"; export const XMTP_BACKEND_URL=XMTP_STAGING_URL; export const XMTP_ON_STAGING=true;'
      : 'export async function getXmtpCredential(){ throw new Error("harness uses __OM_XMTP_TEST_CREDENTIAL"); }' }));
  } }],
});
console.log("bundled");
