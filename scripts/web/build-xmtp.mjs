// Builds @xmtp/browser-sdk (7.1, XMTP production network) + its workers + wasm
// into public/xmtp/ for the web build. Metro can't bundle Web Workers or
// resolve the SDK's `new URL(..., import.meta.url)` assets, so the SDK is
// loaded as a native ES module at runtime by src/web/xmtpCompat.ts, outside
// the Metro bundle. Output is gitignored.
//
// Layout (absolute paths, so the main thread and the workers all load the
// same files):
//   /xmtp/sdk.js                 main-thread SDK
//   /xmtp/workers/client.js      client worker
//   /xmtp/workers/opfs.js        OPFS worker
//   /xmtp/bindings_wasm_bg.wasm  libxmtp (~13 MB, under Cloudflare's 25 MiB limit)
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "xmtp");
const sdkDir = join(root, "node_modules", "@xmtp", "browser-sdk");
const wasmDir = join(root, "node_modules", "@xmtp", "wasm-bindings", "dist");

const rewrites = [
  { file: /browser-sdk[\\/]dist[\\/]index\.js$/, from: /new URL\("\.\/workers\/client",import\.meta\.url\)/g, to: 'new URL("/xmtp/workers/client.js",import.meta.url)' },
  { file: /browser-sdk[\\/]dist[\\/]index\.js$/, from: /new URL\("\.\/workers\/opfs",import\.meta\.url\)/g, to: 'new URL("/xmtp/workers/opfs.js",import.meta.url)' },
  { file: /wasm-bindings[\\/]dist[\\/]bindings_wasm\.js$/, from: /new URL\('bindings_wasm_bg\.wasm', import\.meta\.url\)/g, to: 'new URL("/xmtp/bindings_wasm_bg.wasm", import.meta.url)' },
];

const assetUrls = {
  name: "asset-urls",
  setup(b) {
    b.onLoad({ filter: /@xmtp[\\/](browser-sdk|wasm-bindings)[\\/].*\.js$/ }, async (args) => {
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

// viem only backs the SDK's createEOASigner/createSCWSigner test helpers;
// the app signs with its own wallet-derived key (src/lib/xmtpIdentity.ts).
const viemStub = {
  name: "viem-stub",
  setup(b) {
    b.onResolve({ filter: /^viem(\/accounts)?$/ }, (args) => ({ path: args.path, namespace: "viem-stub" }));
    b.onLoad({ filter: /.*/, namespace: "viem-stub" }, () => ({
      contents: "const no = () => { throw new Error('viem is not bundled'); }; export const toBytes = no, privateKeyToAccount = no, generatePrivateKey = no;",
      loader: "js",
    }));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "workers"), { recursive: true });

const common = { bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none", logLevel: "warning", plugins: [assetUrls, viemStub] };

await build({
  ...common,
  stdin: {
    contents: 'import * as sdk from "@xmtp/browser-sdk"; globalThis.__OM_XMTP_SDK = sdk;',
    resolveDir: root,
    sourcefile: "xmtp-entry.js",
  },
  outfile: join(out, "sdk.js"),
});
for (const w of ["client", "opfs"]) {
  await build({ ...common, entryPoints: [join(sdkDir, "dist", "workers", `${w}.js`)], outfile: join(out, "workers", `${w}.js`) });
}
copyFileSync(join(wasmDir, "bindings_wasm_bg.wasm"), join(out, "bindings_wasm_bg.wasm"));
console.log("xmtp web sdk (7.1, production) ->", out);
