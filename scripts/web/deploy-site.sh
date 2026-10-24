#!/bin/bash
# Builds and deploys the OnlyMonkes web app to Cloudflare (onlymonkes-web).
#  1. XMTP browser SDK bundle (7.1, production network) into public/xmtp/.
#  2. Expo web export into dist-web/.
#  3. wrangler deploy (scripts/web/wrangler.toml).
set -euo pipefail
cd "$(dirname "$0")/../.."
# The site is public: app.config.ts `extra` and @env would copy every key in a
# .env into the page. The web build only needs public values (below).
if [ -f .env ]; then echo "deploy-site: refusing to build with a .env present (keys would ship in the public site)" >&2; exit 1; fi
unset HELIUS_API_KEY HELIUS_NFT_API_KEY QUICKNODE_DAS_URL ALCHEMY_API_KEY GROQ_API_KEY GIPHY_API_KEY \
  CLOUDINARY_CLOUD_NAME CLOUDINARY_UPLOAD_PRESET JUP_API_KEY SENTRY_DSN LIVEKIT_TOKEN_URL
# Avatar Rooms: the LiveKit server address (a public wss:// URL every browser
# sees when it connects; EAS marks it sensitive, but it is not a secret).
if [ -z "${LIVEKIT_URL:-}" ]; then
  # A failed lookup (not logged in to EAS, offline) must not end the script
  # silently under set -e; it only means no Avatar Rooms on the web.
  LIVEKIT_URL=$(npx eas env:list --environment production --include-sensitive 2>/dev/null | sed -n 's/^LIVEKIT_URL=//p' | head -1) || LIVEKIT_URL=""
fi
echo "deploy-site: building $(git rev-parse --short HEAD)" >&2
case "$LIVEKIT_URL" in wss://*) export LIVEKIT_URL ;; *) echo "deploy-site: no LIVEKIT_URL — Avatar Rooms stay off on the web" >&2; unset LIVEKIT_URL ;; esac
node scripts/web/build-xmtp.mjs
# Skia on the web runs on CanvasKit; useSkiaReady.web.ts loads /canvaskit.wasm.
cp node_modules/canvaskit-wasm/bin/full/canvaskit.wasm public/canvaskit.wasm
# bun can leave a copy of @expo/cli without its ws dependency; call the complete one.
node node_modules/@expo/cli/build/bin/cli export -p web --output-dir dist-web --clear
npx wrangler deploy --config scripts/web/wrangler.toml
