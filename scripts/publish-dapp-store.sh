#!/bin/bash
#
# publish-dapp-store.sh — Solana dApp Store release pipeline for dapp-store-cli v0.16.1
#
# Hybrid upload flow:
#   1. This script uploads the APK + metadata via the portal-backed CLI on this Mac
#   2. The script SIGTERMs the CLI the instant it reaches the mint-signing step
#      (Mac never signs an on-chain transaction — the publisher keypair is read
#       only for the CLI's publisher-identity check, never for signing)
#   3. The script prints a QR code of the portal's release detail URL
#   4. You scan the QR with your Seeker camera → Chrome opens publish.solanamobile.com
#      → you tap "Mint Release NFT" → Solflare pops via MWA → sign → done
#
# Why not use the CLI end-to-end? Because --keypair on the CLI would sign the
# Release NFT mint directly from the Mac. We want that signature to happen on
# Seeker via MWA → Solflare, NEVER on this Mac.
#
# Why not use a Solana Pay payment QR? Because that requires forking/monkey-
# patching the CLI + a local HTTP server with public tunnel. Not worth the
# complexity for one Mint click per release.
#
# IMPORTANT — before every new release:
#   • Bump versionCode in android/app/build.gradle (CLI rejects duplicates)
#   • Bump version in app.config.ts
#   • Add v<version> notes to dapp-store/config.yaml → new_in_version field
#   • Rebuild APK in Android Studio (release variant)
#   • Ensure Solflare in-app browser is NOT used on Seeker — use Chrome
#
# Usage:
#   bash scripts/publish-dapp-store.sh              # real run
#   bash scripts/publish-dapp-store.sh --dry-run    # prechecks only, no upload

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

APK="android/app/build/outputs/apk/release/app-release.apk"
KEYPAIR="$HOME/onlymonkes-publisher-keypair.json"
EXPECTED_PUBLISHER="BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o"
EXPECTED_APP_NFT="EFfZv9iWGEtFijK3VBoJF3CnPxXJnayHjVGNMyZyoi6d"
CLI="@solana-mobile/dapp-store-cli"
LOG="/tmp/onlymonkes-publish-$(date +%Y%m%d-%H%M%S).log"
LAST_VC_FILE="$REPO_ROOT/.last_published_version_code"
LAST_REL_FILE="$REPO_ROOT/.last_release_id"

DRY_RUN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "→ Log: $LOG"
echo "→ Mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (prechecks only)' || echo 'PUBLISH')"
echo ""

# ─── Prechecks ────────────────────────────────────────────────────────────
echo "──────── PRECHECKS ────────"

# APK exists
[ -f "$APK" ] || { echo "❌ APK not found at $APK — build release APK in Android Studio first"; exit 1; }
APK_SIZE_MB=$(( $(stat -f %z "$APK") / 1048576 ))
APK_SHA=$(shasum -a 256 "$APK" | cut -c1-12)
APK_AGE_MIN=$(( ( $(date +%s) - $(stat -f %m "$APK") ) / 60 ))
echo "✅ APK: ${APK_SIZE_MB} MB, SHA256 ${APK_SHA}…, built ${APK_AGE_MIN} min ago"

# Keypair present + matches known publisher (CLI will validate too, but fail fast here)
[ -f "$KEYPAIR" ] || { echo "❌ Publisher keypair not found: $KEYPAIR"; exit 1; }
ACTUAL_PUB=$(node -e "
const {Keypair}=require('@solana/web3.js');
const fs=require('fs');
console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('$KEYPAIR')))).publicKey.toBase58())
" 2>/dev/null | tail -1)
[ "$ACTUAL_PUB" = "$EXPECTED_PUBLISHER" ] || {
  echo "❌ Publisher keypair mismatch — got $ACTUAL_PUB, expected $EXPECTED_PUBLISHER"
  exit 1
}
echo "✅ Publisher keypair verified: ${ACTUAL_PUB:0:8}…"

# App NFT address populated in config.yaml (empty would mint a DUPLICATE App NFT)
APP_ADDR=$(grep -E "^[[:space:]]+address:" dapp-store/config.yaml | head -1 | awk '{print $2}' | tr -d '"')
if [ "$APP_ADDR" != "$EXPECTED_APP_NFT" ]; then
  echo "❌ dapp-store/config.yaml line 9 app.address is \"$APP_ADDR\""
  echo "   Must be: $EXPECTED_APP_NFT (empty or wrong address mints a duplicate App NFT)"
  exit 1
fi
echo "✅ app.address = $EXPECTED_APP_NFT"

# App version mentioned in new_in_version
APP_VERSION=$(grep -E "^[[:space:]]+version:" app.config.ts | sed "s/.*'\(.*\)'.*/\1/" | head -1)
[ -n "$APP_VERSION" ] || { echo "❌ Could not parse version from app.config.ts"; exit 1; }
SHORT_VERSION="${APP_VERSION%.0}"
if ! grep -qE "v($APP_VERSION|$SHORT_VERSION)" dapp-store/config.yaml; then
  echo "❌ dapp-store/config.yaml new_in_version does not mention v$APP_VERSION or v$SHORT_VERSION"
  echo "   Update the 'new_in_version' field with this release's notes before publishing."
  exit 1
fi
echo "✅ config.yaml mentions v$APP_VERSION"

# versionCode duplicate check (soft warning)
VERSION_CODE=$(grep versionCode android/app/build.gradle | head -1 | awk '{print $2}')
echo "✅ Android versionCode: $VERSION_CODE"
if [ -f "$LAST_VC_FILE" ] && [ "$(cat "$LAST_VC_FILE")" = "$VERSION_CODE" ]; then
  echo "⚠️  This versionCode matches the last published run. The portal rejects duplicates."
  echo "   If the prior attempt failed before mint, you may proceed; otherwise bump versionCode."
  if [ "$DRY_RUN" != true ]; then
    read -p "   Continue anyway? [y/N] " ans
    [ "${ans:-n}" = "y" ] || exit 1
  fi
fi

# DAPP_STORE_API_KEY present (prompt if not)
if [ -z "${DAPP_STORE_API_KEY:-}" ]; then
  if [ -t 0 ] && [ "$DRY_RUN" != true ]; then
    echo "⚠️  DAPP_STORE_API_KEY not in environment."
    read -rsp "   Paste portal API key (input hidden): " DAPP_STORE_API_KEY
    echo ""
    export DAPP_STORE_API_KEY
  elif [ "$DRY_RUN" != true ]; then
    echo "❌ DAPP_STORE_API_KEY not set and no TTY to prompt."
    echo "   Run with: DAPP_STORE_API_KEY='dpk_...' bash scripts/publish-dapp-store.sh"
    exit 1
  fi
fi
if [ -n "${DAPP_STORE_API_KEY:-}" ]; then
  echo "✅ DAPP_STORE_API_KEY present (${#DAPP_STORE_API_KEY} chars)"
fi

# Extract whats-new block via awk
WHATS_NEW=$(awk '
  /^      new_in_version: >-/ {f=1; next}
  f && /^      [a-z_]+:/ {exit}
  f {sub(/^ +/,""); printf "%s ", $0}
' dapp-store/config.yaml)
if [ -z "$WHATS_NEW" ]; then
  echo "❌ Failed to extract new_in_version from config.yaml"
  exit 1
fi
WHATS_NEW_CHARS=${#WHATS_NEW}
echo "✅ Extracted new_in_version ($WHATS_NEW_CHARS chars)"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "──────── DRY RUN — stopping here ────────"
  exit 0
fi

# ─── Launch CLI with stream-parsing ───────────────────────────────────────
echo ""
echo "──────── UPLOADING via $CLI ────────"
echo "Script will SIGTERM the CLI the moment it reaches the mint-signing step."
echo ""

FIFO=$(mktemp -u)
mkfifo "$FIFO"
trap 'rm -f "$FIFO"' EXIT

# Start CLI as background subprocess writing to FIFO
{
  printf '%s' "$DAPP_STORE_API_KEY" | npx "$CLI" \
    --apk-file "$APK" \
    --whats-new "$WHATS_NEW" \
    --api-key-stdin \
    --keypair "$KEYPAIR" \
    --verbose 2>&1
  echo "__CLI_EXIT__=$?"
} >"$FIFO" &
CLI_PID=$!

# Stream-parse CLI output, capture identifiers, kill on step-4 detection
SESSION_ID=""
RELEASE_ID=""
KILLED_EARLY=false
CLI_EXIT="?"

while IFS= read -r line; do
  echo "$line"
  echo "$line" >> "$LOG"

  # Capture ingestion session ID (step 2)
  if [[ -z "$SESSION_ID" ]] && [[ "$line" =~ [Ii]ngestion[[:space:]]+[Ss]ession[[:space:]]+[Ii][Dd]:?[[:space:]]+([a-f0-9-]{36}) ]]; then
    SESSION_ID="${BASH_REMATCH[1]}"
  fi

  # Capture release ID (step 3 in verbose)
  if [[ -z "$RELEASE_ID" ]] && [[ "$line" =~ [Rr]elease[[:space:]]*[Ii][Dd][[:space:]]*:?[[:space:]]*([a-f0-9-]{36}) ]]; then
    RELEASE_ID="${BASH_REMATCH[1]}"
  fi

  # CLI exit sentinel (subshell echoed it)
  if [[ "$line" =~ __CLI_EXIT__=([0-9]+) ]]; then
    CLI_EXIT="${BASH_REMATCH[1]}"
    break
  fi

  # Trigger: start of step 4 (mint release NFT — signing happens here)
  if [[ "$line" == *"4/7"* ]] || [[ "$line" == *"Mint release NFT: Preparing"* ]] || [[ "$line" == *"Mint release NFT: Signing"* ]]; then
    echo ""
    echo "→ Reached mint step. SIGTERM CLI to prevent Mac-side signing…"
    kill -TERM "$CLI_PID" 2>/dev/null || true
    # Wait up to 3 seconds for graceful, then SIGKILL
    for _ in 1 2 3; do
      sleep 1
      kill -0 "$CLI_PID" 2>/dev/null || break
    done
    kill -KILL "$CLI_PID" 2>/dev/null || true
    KILLED_EARLY=true
    CLI_EXIT="killed"
    break
  fi
done < "$FIFO"

# Reap the background process (in case it ended naturally)
wait "$CLI_PID" 2>/dev/null || true

# ─── Decide next step ─────────────────────────────────────────────────────
echo ""
echo "──────── RESULT ────────"
echo "  Session ID:  ${SESSION_ID:-<not captured>}"
echo "  Release ID:  ${RELEASE_ID:-<not captured>}"
echo "  CLI exit:    $CLI_EXIT (killed=$KILLED_EARLY)"
echo ""

if [ "$KILLED_EARLY" != true ] && [ "$CLI_EXIT" != "0" ]; then
  echo "❌ CLI exited before reaching the mint step with status $CLI_EXIT."
  echo "   Common causes:"
  echo "   • Duplicate versionCode — bump android/app/build.gradle versionCode and rebuild"
  echo "   • Invalid API key — regenerate at publish.solanamobile.com"
  echo "   • APK validation failure — check the full log: $LOG"
  exit 1
fi

# Save last versionCode for duplicate warning next time
echo "$VERSION_CODE" > "$LAST_VC_FILE"
[ -n "$RELEASE_ID" ] && echo "$RELEASE_ID" > "$LAST_REL_FILE"

# ─── Build portal URL + QR code ───────────────────────────────────────────
PORTAL_ROOT="https://publish.solanamobile.com"
if [ -n "$RELEASE_ID" ]; then
  DEEP_URL="$PORTAL_ROOT/apps/$EXPECTED_APP_NFT/releases/$RELEASE_ID"
else
  DEEP_URL="$PORTAL_ROOT"
fi

echo "──────── NEXT: MINT ON SEEKER ────────"
echo ""
echo "Scan the QR below with your Seeker camera (NOT Solflare's in-app"
echo "browser — Chrome must handle MWA delegation to Solflare for the Mint)."
echo ""
echo "URL: $DEEP_URL"
echo ""

if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "$DEEP_URL"
else
  # Fallback: qrcode-terminal via npx — no install needed
  npx -y qrcode-terminal "$DEEP_URL" 2>/dev/null || {
    echo "(Install a QR tool for inline display: brew install qrencode)"
    echo "For now, open the URL above manually on Seeker."
  }
fi

echo ""
echo "On Seeker after scan:"
echo "  1. Chrome opens the portal release page"
echo "  2. Tap \"Mint Release NFT\""
echo "  3. Solflare pops over via MWA — review + approve the signature"
echo "  4. Portal status flips to In Review within seconds"
echo ""
echo "Review typically lands within 24–72h at $EXPECTED_PUBLISHER"
echo "Portal + review emails → Jumpstreet25@icloud.com (check spam folder)"
echo ""
echo "Full log: $LOG"
