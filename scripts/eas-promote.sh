#!/usr/bin/env bash
# eas-promote.sh — ramp the most recent OTA from staged rollout to full.
#
# Looks up the latest update on the target branch and republishes it at the
# target rollout percentage. Default target = 100% (full ramp).
#
# Usage:
#   ./scripts/eas-promote.sh                  # promote latest to 100% on production
#   ./scripts/eas-promote.sh 50                # promote latest to 50%
#   ./scripts/eas-promote.sh 100 preview       # promote latest preview to 100%
#
# Typical workflow:
#   1. ./scripts/eas-rollout.sh "fix: ..."     → publishes at 10%
#   2. wait ~24h, watch Sentry / crash rates
#   3. ./scripts/eas-promote.sh 50             → bump to 50%
#   4. wait ~12h
#   5. ./scripts/eas-promote.sh                → finish to 100%

set -euo pipefail

PERCENT="${1:-100}"
BRANCH="${2:-production}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▸ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✘ $1${NC}"; exit 1; }

if ! [[ "$PERCENT" =~ ^[0-9]+$ ]] || (( PERCENT < 0 || PERCENT > 100 )); then
  fail "Rollout percentage must be 0-100 (got: $PERCENT)"
fi

# ── Look up the most recent update group on this branch ────────────────────
step "Looking up latest update on '$BRANCH'"
LATEST_JSON=$(npx eas update:list --branch "$BRANCH" --limit 1 --json --non-interactive 2>/dev/null || true)
if [[ -z "$LATEST_JSON" || "$LATEST_JSON" == "[]" ]]; then
  fail "No updates found on branch '$BRANCH'. Publish first with ./scripts/eas-rollout.sh"
fi

GROUP_ID=$(echo "$LATEST_JSON" | grep -o '"group":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
CURRENT_PCT=$(echo "$LATEST_JSON" | grep -o '"rolloutPercentage":[0-9]*' | head -1 | cut -d':' -f2 || true)
LATEST_MSG=$(echo "$LATEST_JSON" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [[ -z "$GROUP_ID" ]]; then
  warn "Could not parse update group ID from eas output. Run manually:"
  echo "  npx eas update:republish --branch $BRANCH --rollout-percentage $PERCENT"
  exit 1
fi

echo "  Group:   $GROUP_ID"
echo "  Message: $LATEST_MSG"
echo "  Current: ${CURRENT_PCT:-unknown}% → target: ${PERCENT}%"

# ── Republish at new rollout percentage ────────────────────────────────────
step "Promoting → ${PERCENT}%"
npx eas update:republish \
  --branch "$BRANCH" \
  --group "$GROUP_ID" \
  --rollout-percentage "$PERCENT" \
  --non-interactive

echo ""
echo -e "${GREEN}✔ Update '$GROUP_ID' now at ${PERCENT}% on '$BRANCH'${NC}"
echo ""
if (( PERCENT < 100 )); then
  echo "Next: watch metrics, then run \`./scripts/eas-promote.sh\` again to ramp further."
elif (( PERCENT == 0 )); then
  echo "Update is now disabled. To re-enable, run \`./scripts/eas-promote.sh 100\` again."
else
  echo "Rollout complete."
fi
echo ""
