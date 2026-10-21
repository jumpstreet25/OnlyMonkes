#!/bin/bash
# Builds and deploys the OnlyMonkes web app to Cloudflare (onlymonkes-web).
#  1. XMTP browser SDK bundle, pointing the 40 MB client wasm at the VPS copy
#     (upload a new version to /srv/onlymonkes-assets when the SDK changes).
#  2. Expo web export into dist-web/.
#  3. wrangler deploy (scripts/web/wrangler.toml).
set -euo pipefail
cd "$(dirname "$0")/../.."
XMTP_VERSION=$(node -p "require('@xmtp/browser-sdk/package.json').version")
export XMTP_CLIENT_WASM_URL="https://157-173-192-39.sslip.io/assets/xmtp_sdk-${XMTP_VERSION}.wasm"
curl -sfI "$XMTP_CLIENT_WASM_URL" >/dev/null || { echo "missing on VPS: $XMTP_CLIENT_WASM_URL" >&2; exit 1; }
node scripts/web/build-xmtp.mjs
# bun can leave a copy of @expo/cli without its ws dependency; call the complete one.
node node_modules/@expo/cli/build/bin/cli export -p web --output-dir dist-web --clear
npx wrangler deploy --config scripts/web/wrangler.toml
