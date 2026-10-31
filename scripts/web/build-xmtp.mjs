// Builds @xmtp/browser-sdk (v8, self-hosted backend) + its worker + wasm into
// public/xmtp/ for the web build. Metro can't bundle Web Workers or resolve
// the SDK's `new URL(..., import.meta.url)` assets, so the SDK is loaded as a
// native ES module at runtime by src/web/xmtpCompat.ts, outside the Metro
// bundle. Output is gitignored.
//
// Layout (absolute paths, so main thread and worker never resolve the wrong
// .wasm — both SDK halves name theirs `xmtp_sdk.wasm`):
//   /xmtp/sdk.js                     main-thread SDK + pure codecs
//   /xmtp/xmtp_sdk_pure.wasm         pure codecs wasm (~3 MB)
//   /xmtp/worker/worker-entry.js     client worker
//   /xmtp/worker/xmtp_sdk.wasm       client wasm (~39 MiB; local dev only — over
//                                    Cloudflare's 25 MiB per-file limit)
//   /xmtp/worker/xmtp_sdk.wasm.br    the same, brotli (~4 MiB); deploy-site.sh ships
//                                    only this and site-router.ts serves it at
//                                    /xmtp/worker/xmtp_sdk.wasm with Content-Encoding: br
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "xmtp");
const sdkDir = join(root, "node_modules", "@xmtp", "browser-sdk");

const PURE_WASM_URL = "/xmtp/xmtp_sdk_pure.wasm";
const CLIENT_WASM_URL = "/xmtp/worker/xmtp_sdk.wasm";
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
const clientWasm = readFileSync(join(sdkDir, "typescript-wasm", "xmtp_sdk.wasm"));
writeFileSync(join(out, "worker", "xmtp_sdk.wasm"), clientWasm);
const br = brotliCompressSync(clientWasm, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_LGWIN]: 24, [zlib.BROTLI_PARAM_SIZE_HINT]: clientWasm.length } });
if (br.length > 24 * 1024 * 1024) throw new Error(`build-xmtp: brotli client wasm is ${br.length} bytes — over Cloudflare's 25 MiB file limit`);
writeFileSync(join(out, "worker", "xmtp_sdk.wasm.br"), br);
console.log(`xmtp web sdk (v8) -> ${out} (client wasm ${(clientWasm.length / 1048576).toFixed(1)} MiB, brotli ${(br.length / 1048576).toFixed(1)} MiB)`);
