#!/bin/bash
#
# publish-dapp-store.sh — Solana dApp Store release pipeline
#
# Runs all 4 CLI steps that must succeed for a release to appear live on
# publish.solanamobile.com:
#   1. validate config
#   2. create Release NFT on-chain
#   3. submit for Solana Mobile review   ← the step easily forgotten
#   4. reminder to watch email + portal for approval
#
# Why this script exists:
#   Releases v2.23 / v2.25 / v2.29 / v2.30 / v2.35 all had config.yaml updates
#   but never went live on the dApp Store site. Running only "create release"
#   without "publish submit" just mints an on-chain NFT — Solana Mobile never
#   reviews it. This script forces every step to run in order.
#
# Usage:
#   bash scripts/publish-dapp-store.sh
#
# Preconditions:
#   - APK built in Android Studio at android/app/build/outputs/apk/release/app-release.apk
#   - dapp-store/config.yaml `new_in_version` updated with release notes for current version
#   - Publisher keypair at ~/onlymonkes-publisher-keypair.json (chmod 600)
#   - Internet access for mainnet RPC + CLI npm download

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

KEYPAIR="$HOME/onlymonkes-publisher-keypair.json"
APK="android/app/build/outputs/apk/release/app-release.apk"
EXPECTED_PUBLISHER="BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o"
# App NFT address — stable, from 2026-03-10 initial `create app` run.
# If this ever changes we've mis-minted a second App NFT — DO NOT CHANGE CASUALLY.
EXPECTED_APP_NFT="EFfZv9iWGEtFijK3VBoJF3CnPxXJnayHjVGNMyZyoi6d"
RPC="${RPC_URL:-https://api.mainnet-beta.solana.com}"
LOG="/tmp/onlymonkes-publish-$(date +%Y%m%d-%H%M%S).log"
CLI="@solana-mobile/dapp-store-cli"

exec > >(tee -a "$LOG") 2>&1
echo "→ Log: $LOG"
echo "→ RPC: $RPC"
echo ""

# ─── PRECHECKS ────────────────────────────────────────────────────────────────
echo "──────── PRECHECKS ────────"

[ -f "$KEYPAIR" ] || { echo "❌ Keypair not found: $KEYPAIR"; exit 1; }

# Verify the keypair matches the known publisher address — prevents accidental
# use of a different keypair that would mint a second App NFT and split the listing.
ACTUAL_PUB=$(node -e "
const {Keypair}=require('@solana/web3.js');
const fs=require('fs');
console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('$KEYPAIR')))).publicKey.toBase58())
" 2>/dev/null | tail -1)
if [ "$ACTUAL_PUB" != "$EXPECTED_PUBLISHER" ]; then
  echo "❌ Publisher keypair mismatch!"
  echo "   Expected: $EXPECTED_PUBLISHER"
  echo "   Got:      $ACTUAL_PUB"
  exit 1
fi
echo "✅ Publisher keypair verified: ${ACTUAL_PUB:0:8}…"

[ -f "$APK" ] || { echo "❌ APK not found at $APK — build first in Android Studio"; exit 1; }
APK_AGE_MIN=$(( ( $(date +%s) - $(stat -f %m "$APK") ) / 60 ))
APK_SIZE_MB=$(( $(stat -f %z "$APK") / 1048576 ))
echo "✅ APK: $APK (${APK_SIZE_MB} MB, built ${APK_AGE_MIN} min ago)"
if [ "$APK_AGE_MIN" -gt 180 ]; then
  read -p "⚠️  APK is $APK_AGE_MIN min old. Continue anyway? [y/N] " ans
  [ "${ans:-n}" = "y" ] || exit 1
fi

# config.yaml must mention the current app.config.ts version in `new_in_version`
APP_VERSION=$(grep -E "^[[:space:]]+version:" app.config.ts | sed "s/.*'\(.*\)'.*/\1/" | head -1)
if [ -z "$APP_VERSION" ]; then
  echo "❌ Could not parse version from app.config.ts"
  exit 1
fi
# Strip trailing .0 for semver match (2.36.0 → 2.36, 2.36.1 stays 2.36.1)
SHORT_VERSION="${APP_VERSION%.0}"
if ! grep -qE "v($APP_VERSION|$SHORT_VERSION)" dapp-store/config.yaml; then
  echo "❌ dapp-store/config.yaml does not mention v$APP_VERSION or v$SHORT_VERSION"
  echo "   Update the 'new_in_version' field (line ~81) with release notes."
  exit 1
fi
echo "✅ config.yaml mentions v$APP_VERSION (or v$SHORT_VERSION)"

# App NFT address sanity — if ever wiped, warn but don't block (user may have
# this backed up separately and not stored in the committed config).
APP_ADDR=$(grep -E "^[[:space:]]+address:" dapp-store/config.yaml | head -1 | awk '{print $2}' | tr -d '"')
if [ -z "$APP_ADDR" ] || [ "$APP_ADDR" = '""' ]; then
  echo "⚠️  dapp-store/config.yaml line 9 (app.address) is empty."
  echo "    If you already have an App NFT on-chain, populate this first or"
  echo "    'create release' will not know which app to attach the release to."
  read -p "    Continue anyway? [y/N] " ans
  [ "${ans:-n}" = "y" ] || exit 1
fi

# ─── 1/3 VALIDATE ──────────────────────────────────────────────────────────
echo ""
echo "──────── 1/3 VALIDATE ────────"
npx "$CLI" validate

# ─── 2/3 CREATE RELEASE NFT ────────────────────────────────────────────────
echo ""
echo "──────── 2/3 CREATE RELEASE NFT ────────"
echo "Mints a new Release NFT on-chain (~0.01 SOL in fees)."
read -p "Proceed? [y/N] " ans
[ "${ans:-n}" = "y" ] || { echo "Aborted."; exit 1; }
npx "$CLI" create release -k "$KEYPAIR" -u "$RPC"

# ─── 3/3 SUBMIT FOR REVIEW ─────────────────────────────────────────────────
echo ""
echo "──────── 3/3 SUBMIT FOR REVIEW ────────"
echo "This is the step historically forgotten. Without it, publish.solanamobile.com"
echo "will NOT update — the Release NFT just sits on-chain unnoticed."
read -p "Submit v$APP_VERSION for Solana Mobile review? [y/N] " ans
if [ "${ans:-n}" != "y" ]; then
  echo ""
  echo "⚠️  Release NFT created but NOT submitted."
  echo "    To submit later, re-run this script or manually:"
  echo "    npx $CLI publish submit -k $KEYPAIR -u $RPC \\"
  echo "      --complies-with-solana-dapp-store-policies --requestor-is-authorized"
  exit 1
fi
npx "$CLI" publish submit \
  -k "$KEYPAIR" \
  -u "$RPC" \
  --complies-with-solana-dapp-store-policies \
  --requestor-is-authorized

# ─── DONE ──────────────────────────────────────────────────────────────────
echo ""
echo "──────── ✅ SUBMITTED ────────"
echo "• Watch Jumpstreet25@icloud.com (inbox + spam) for review response within 24-72h."
echo "• Portal: https://publish.solanamobile.com"
echo "• If approved: v$APP_VERSION appears live on the dApp Store site."
echo "• If rejected: portal + email will list reasons; fix + rerun this script."
echo "• Full log: $LOG"
echo ""
echo "Commit the updated dapp-store/config.yaml (CLI may have filled release.address):"
echo "    git diff dapp-store/config.yaml"
