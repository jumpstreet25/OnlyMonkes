// Builds @xmtp/browser-sdk (v8, self-hosted backend) + its worker + wasm into
// public/xmtp/ for the web build. Metro can't bundle Web Workers or resolve
// the SDK's `new URL(..., import.meta.url)` assets, so the SDK is loaded as a
// native ES module at runtime by src/web/xmtpCompat.ts, outside the Metro
// bundle. Output is gitignored.
//
// Layout (absolute paths, so main thread and worker never resolve the wrong
// .wasm — both SDK halves name theirs `xmtp_sdk.wasm`):
//   /xmtp/sdk.js                  main-thread SDK + pure codecs
//   /xmtp/xmtp_sdk_pure.wasm      pure codecs wasm (~3 MB)
//   /xmtp/worker/worker-entry.js  client worker
//   /xmtp/worker/xmtp_sdk.wasm    client wasm (~40 MB; local dev only — a
//                                 deployed site loads it from the VPS)
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "xmtp");
const sdkDir = join(root, "node_modules", "@xmtp", "browser-sdk");

const PURE_WASM_URL = "/xmtp/xmtp_sdk_pure.wasm";
// The client wasm is over Cloudflare's 25 MiB per-file limit, so a deployed
// site points this at the VPS copy (XMTP_CLIENT_WASM_URL, see
// scripts/web/deploy-site.sh); local dev serves it from public/.
const CLIENT_WASM_URL = process.env.XMTP_CLIENT_WASM_URL || "/xmtp/worker/xmtp_sdk.wasm";
const WORKER_URL = "/xmtp/worker/worker-entry.js";

const rewrites = [
  { file: /typescript-pure[\\/]binding\.js$/, from: /new URL\((["'])\.\/xmtp_sdk\.wasm\1, import\.meta\.url\)/g, to: `new URL("${PURE_WASM_URL}", import.meta.url)` },
  { file: /typescript-wasm[\\/](binding|worker\.gen)\.js$/, from: /new URL\((["'])\.\/xmtp_sdk\.wasm\1, import\.meta\.url\)/g, to: `new URL("${CLIENT_WASM_URL}", import.meta.url)` },
  { file: /typescript-wasm[\\/]package-session\.gen\.js$/, from: /new URL\("\.\/worker-entry\.gen\.js", import\.meta\.url\)/g, to: `new URL("${WORKER_URL}", import.meta.url)` },
];

const assetUrls = {
  name: "asset-urls",
  setup(b) {
    b.onLoad({ filter: /@xmtp[\\/]browser-sdk[\\/].*\.js$/ }, async (args) => {
      let src = await readFile(args.path, "utf8");
      for (const r of rewrites) {
        if (!r.file.test(args.path)) continue;
        const next = src.replace(r.from, r.to);
        if (next === src) throw new Error(`build-xmtp: asset URL pattern changed in ${args.path} — update scripts/web/build-xmtp.mjs`);
        src = next;
      }
      return { contents: src, loader: "js" };
    });
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "worker"), { recursive: true });

const common = { bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none", logLevel: "warning", plugins: [assetUrls] };

await build({
  ...common,
  stdin: {
    contents: 'import * as sdk from "@xmtp/browser-sdk"; import * as pure from "@xmtp/browser-sdk/pure"; globalThis.__OM_XMTP_SDK = { ...sdk, pure };',
    resolveDir: root,
    sourcefile: "xmtp-entry.js",
  },
  outfile: join(out, "sdk.js"),
});
await build({ ...common, entryPoints: [join(sdkDir, "typescript-wasm", "worker-entry.gen.js")], outfile: join(out, "worker", "worker-entry.js") });
copyFileSync(join(sdkDir, "typescript-pure", "xmtp_sdk.wasm"), join(out, "xmtp_sdk_pure.wasm"));
if (!process.env.XMTP_CLIENT_WASM_URL) {
  copyFileSync(join(sdkDir, "typescript-wasm", "xmtp_sdk.wasm"), join(out, "worker", "xmtp_sdk.wasm"));
}
console.log("xmtp web sdk (v8) ->", out);
