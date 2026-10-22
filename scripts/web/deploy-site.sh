#!/bin/bash
# Builds and deploys the OnlyMonkes web app to Cloudflare (onlymonkes-web).
#  1. XMTP browser SDK bundle (7.1, production network) into public/xmtp/.
#  2. Expo web export into dist-web/.
#  3. wrangler deploy (scripts/web/wrangler.toml).
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/web/build-xmtp.mjs
# Skia on the web runs on CanvasKit; useSkiaReady.web.ts loads /canvaskit.wasm.
cp node_modules/canvaskit-wasm/bin/full/canvaskit.wasm public/canvaskit.wasm
# bun can leave a copy of @expo/cli without its ws dependency; call the complete one.
node node_modules/@expo/cli/build/bin/cli export -p web --output-dir dist-web --clear
npx wrangler deploy --config scripts/web/wrangler.toml
