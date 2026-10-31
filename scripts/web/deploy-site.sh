#!/bin/bash
# Builds and deploys the OnlyMonkes web app to Cloudflare (onlymonkes-web).
#  1. XMTP browser SDK 8 bundle (self-hosted backend, src/lib/xmtpBackend.ts) into
#     public/xmtp/ — the client wasm ships brotli-only (site-router.ts serves it).
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
# The app loads a versioned copy (cached immutable by site-router.ts); the
# plain name above stays for clients still on an older build.
CK_VER=$(node -p "require('canvaskit-wasm/package.json').version")
cp node_modules/canvaskit-wasm/bin/full/canvaskit.wasm "public/canvaskit-${CK_VER}.wasm"
# bun can leave a copy of @expo/cli without its ws dependency; call the complete one.
node node_modules/@expo/cli/build/bin/cli export -p web --output-dir dist-web --clear
# Every deploy serves its JS from its own folder (_expo/static/js/<build>/). Expo keeps chunk
# file names (entry-, chat-, dms-…) across builds while their contents and module ids change, and
# browsers held them for a year (old immutable header): a returning browser mixed two builds →
# "Requiring unknown module". A ?v= tag on the page's own <script> links wasn't enough — route
# chunks load later by plain path. A new folder per deploy means no URL is ever reused.
BUILD_ID="$(git rev-parse --short HEAD)-$(date +%s)"
mv dist-web/_expo/static/js/web "dist-web/_expo/static/js/${BUILD_ID}"
find dist-web -type f \( -name '*.html' -o -name '*.js' \) -print0 | xargs -0 sed -i "s#_expo/static/js/web/#_expo/static/js/${BUILD_ID}/#g"
if grep -rlq "_expo/static/js/web/" dist-web --include='*.html' --include='*.js'; then
  echo "deploy-site: some JS paths still point at _expo/static/js/web/" >&2; exit 1
fi
grep -q "_expo/static/js/${BUILD_ID}/" dist-web/index.html || { echo "deploy-site: index.html not moved to the build folder" >&2; exit 1; }
# The raw client wasm is over Cloudflare's 25 MiB asset limit; only the .br copy ships.
rm -f dist-web/xmtp/worker/xmtp_sdk.wasm
[ -f dist-web/xmtp/worker/xmtp_sdk.wasm.br ] || { echo "deploy-site: dist-web/xmtp/worker/xmtp_sdk.wasm.br missing" >&2; exit 1; }
if find dist-web -type f -size +25M | grep -q .; then echo "deploy-site: a file over 25 MiB would be rejected:" >&2; find dist-web -type f -size +25M >&2; exit 1; fi
npx wrangler deploy --config scripts/web/wrangler.toml
