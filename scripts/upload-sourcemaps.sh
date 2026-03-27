#!/bin/bash
# Upload source maps to Sentry after a release build.
#
# Usage:
#   ./scripts/upload-sourcemaps.sh
#
# Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT in .env
# Reads version from app.config.ts (runtimeVersion field)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Validate required env vars
: "${SENTRY_AUTH_TOKEN:?Missing SENTRY_AUTH_TOKEN in .env}"
: "${SENTRY_ORG:?Missing SENTRY_ORG in .env}"
: "${SENTRY_PROJECT:?Missing SENTRY_PROJECT in .env}"

# Extract version from app.config.ts
VERSION=$(grep "version:" "$PROJECT_ROOT/app.config.ts" | head -1 | sed "s/.*'\(.*\)'.*/\1/")
VERSION_CODE=$(grep "versionCode" "$PROJECT_ROOT/android/app/build.gradle" | head -1 | sed 's/[^0-9]//g')
RELEASE="com.onlymonkes.app@${VERSION}+${VERSION_CODE}"

BUNDLE="$PROJECT_ROOT/android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle"
SOURCEMAP="$PROJECT_ROOT/android/app/build/generated/sourcemaps/react/release/index.android.bundle.map"

if [ ! -f "$BUNDLE" ] || [ ! -f "$SOURCEMAP" ]; then
  echo "❌ Bundle or source map not found. Run the release build first."
  echo "   Bundle:    $BUNDLE"
  echo "   Sourcemap: $SOURCEMAP"
  exit 1
fi

echo "📤 Uploading source maps to Sentry..."
echo "   Release: $RELEASE"
echo "   Org:     $SENTRY_ORG"
echo "   Project: $SENTRY_PROJECT"

npx @sentry/cli sourcemaps upload \
  --auth-token "$SENTRY_AUTH_TOKEN" \
  --org "$SENTRY_ORG" \
  --project "$SENTRY_PROJECT" \
  --release "$RELEASE" \
  --dist "$VERSION_CODE" \
  --strip-prefix "$PROJECT_ROOT" \
  "$BUNDLE" "$SOURCEMAP"

echo "✅ Source maps uploaded for $RELEASE"
