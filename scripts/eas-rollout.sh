#!/usr/bin/env bash
# eas-rollout.sh — publish an OTA at a staged rollout percentage.
#
# Default: 10% rollout to the production branch. Bumps blast-radius from
# "everyone immediately" to "1 in 10 users for the first 24h, then ramp."
#
# Usage:
#   ./scripts/eas-rollout.sh "v2.38 chat-flash hotfix"           # 10% default
#   ./scripts/eas-rollout.sh "v2.38 chat-flash hotfix" 25         # 25%
#   ./scripts/eas-rollout.sh "v2.38 chat-flash hotfix" 25 preview # 25% to preview branch
#
# After publishing, watch Sentry + crash reports for ~24h, then ramp with:
#   ./scripts/eas-promote.sh [percentage]
#
# Per CLAUDE.md / feedback memory: ALWAYS pre-export android before
# `eas update --platform android` — `eas update` reports "Published!" even
# when the bundle silently fails.

set -euo pipefail

MESSAGE="${1:?Usage: eas-rollout.sh \"changelog message\" [percentage=10] [branch=production]}"
PERCENT="${2:-10}"
BRANCH="${3:-production}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▸ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✘ $1${NC}"; exit 1; }

# Sanity-check rollout percentage
if ! [[ "$PERCENT" =~ ^[0-9]+$ ]] || (( PERCENT < 1 || PERCENT > 100 )); then
  fail "Rollout percentage must be 1-100 (got: $PERCENT)"
fi

# ── Pre-flight ──────────────────────────────────────────────────────────────
step "Pre-flight checks"
command -v npx >/dev/null || fail "npx not in PATH"
command -v eas >/dev/null || command -v npx >/dev/null || fail "eas CLI not installed"

if [[ -n $(git status --porcelain) ]]; then
  warn "Working tree has uncommitted changes. Continuing anyway — OTAs bundle from the working tree, not HEAD."
fi

# ── Export android bundle (catches silent bundle failures eas update misses) ──
step "Exporting Android bundle"
npx expo export --platform android || fail "Bundle export failed — aborting"

# ── Publish OTA at staged rollout percentage ───────────────────────────────
step "Publishing OTA → branch '$BRANCH' at ${PERCENT}% rollout"
echo "  Message: $MESSAGE"
echo ""

npx eas update \
  --platform android \
  --branch "$BRANCH" \
  --message "$MESSAGE" \
  --rollout-percentage "$PERCENT" \
  --non-interactive

# ── Done — show next steps ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✔ OTA published at ${PERCENT}% rollout on '$BRANCH'${NC}"
echo ""
echo "Next steps:"
echo "  1. Watch Sentry, crash reports, and user feedback for the next ~24h"
echo "     https://expo.dev/accounts/jumpstreet25/projects/OnlyMonkes/updates"
echo "  2. Ramp to 100% with: ./scripts/eas-promote.sh"
echo "  3. Or roll back: ./scripts/eas-rollout.sh \"revert: <reason>\" 0  (sets new update to 0%)"
echo ""
