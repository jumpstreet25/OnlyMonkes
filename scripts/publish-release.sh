#!/bin/bash
# publish-release.sh — Build, sign, install, push to GitHub + dApp Store
#
# Usage: ./scripts/publish-release.sh "v2.36: changelog here"
#
# Prerequisites:
#   - DAPP_STORE_API_KEY env var set
#   - Solana keypair at ~/.config/solana/id.json
#   - Seeker connected via USB (optional — skips install if not connected)
#   - gh CLI authenticated
#   - dapp-store CLI installed

set -euo pipefail

WHATS_NEW="${1:?Usage: publish-release.sh \"changelog text\"}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK_PATH="$PROJECT_ROOT/android/app/build/outputs/apk/release/app-release.apk"
KEYPAIR="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"
PASSPORT="/Volumes/MyPassport/OnlyMonkes-cache"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▸ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✘ $1${NC}"; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────────────
step "Pre-flight checks"

[[ -z "${DAPP_STORE_API_KEY:-}" ]] && fail "DAPP_STORE_API_KEY not set"
[[ ! -f "$KEYPAIR" ]] && fail "Solana keypair not found at $KEYPAIR"
command -v dapp-store >/dev/null || fail "dapp-store CLI not installed"
command -v gh >/dev/null || fail "gh CLI not installed"

# Check disk space (need ~8 GB free)
FREE_GB=$(df -g / | awk 'NR==2{print $4}')
if (( FREE_GB < 5 )); then
  warn "Only ${FREE_GB}GB free. Cleaning gradle caches..."
  rm -rf ~/.gradle/caches /tmp/hermes.log /tmp/monke-bot.log
  FREE_GB=$(df -g / | awk 'NR==2{print $4}')
  echo "  Now ${FREE_GB}GB free"
fi

# Read version from build.gradle
VERSION_NAME=$(grep 'versionName' "$PROJECT_ROOT/android/app/build.gradle" | head -1 | grep -o '"[^"]*"' | tr -d '"')
VERSION_CODE=$(grep 'versionCode' "$PROJECT_ROOT/android/app/build.gradle" | head -1 | awk '{print $2}')
echo "  Version: $VERSION_NAME (code $VERSION_CODE)"

# ── Build ─────────────────────────────────────────────────────────────────────
step "Building release APK"
cd "$PROJECT_ROOT/android"
rm -rf app/build/outputs/apk
./gradlew assembleRelease --no-daemon
[[ ! -f "$APK_PATH" ]] && fail "APK not found at $APK_PATH"
APK_SIZE=$(du -h "$APK_PATH" | awk '{print $1}')
echo "  APK: $APK_SIZE"

# ── Install on Seeker (if connected) ─────────────────────────────────────────
if adb devices 2>/dev/null | grep -q "device$"; then
  step "Installing on Seeker"
  adb install -r "$APK_PATH"
else
  warn "No device connected — skipping install"
fi

# ── Git commit + push ─────────────────────────────────────────────────────────
step "Committing + pushing to GitHub"
cd "$PROJECT_ROOT"
if [[ -n $(git status --porcelain) ]]; then
  git add -A
  git commit -m "release: v${VERSION_NAME} — ${WHATS_NEW}"
  git push origin master
else
  echo "  No uncommitted changes"
fi

# ── GitHub Release ────────────────────────────────────────────────────────────
step "Updating GitHub release v${VERSION_NAME}"
TAG="v${VERSION_NAME}"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release delete-asset "$TAG" app-release.apk --yes 2>/dev/null || true
  gh release upload "$TAG" "$APK_PATH" --clobber
  echo "  Replaced APK on existing release $TAG"
else
  gh release create "$TAG" "$APK_PATH" --title "OnlyMonkes $TAG" --notes "$WHATS_NEW"
  echo "  Created new release $TAG"
fi

# ── dApp Store ────────────────────────────────────────────────────────────────
step "Publishing to Solana dApp Store"
dapp-store \
  --apk-file "$APK_PATH" \
  --whats-new "$WHATS_NEW" \
  --keypair "$KEYPAIR" \
  --verbose

# ── Backup to My Passport ────────────────────────────────────────────────────
if [[ -d "$PASSPORT" ]]; then
  step "Backing up to My Passport"
  cp "$APK_PATH" "$PASSPORT/OnlyMonkes-v${VERSION_NAME}-release.apk"
  echo "  Saved to $PASSPORT/"
else
  warn "My Passport not mounted — skipping backup"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✔ Release v${VERSION_NAME} published everywhere${NC}"
echo "  GitHub: https://github.com/jumpstreet25/OnlyMonkes/releases/tag/$TAG"
echo "  dApp Store: submitted for Guardian review"
