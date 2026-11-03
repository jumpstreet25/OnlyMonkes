#!/usr/bin/env bash
# Publish a production OTA with the branch ↔ runtime check. Both store builds listen to
# channel "production"; only the runtime keeps them apart: master = 3.4 (the 3.0 app),
# native-3.1 = 3.5 (the 3.1 app). Refuses anything else, a dirty tree, or unpushed commits.
#   scripts/ota-publish.sh "message"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
msg=${1:?usage: scripts/ota-publish.sh "update message"}
branch=$(git rev-parse --abbrev-ref HEAD)
runtime=$(grep -oE "runtimeVersion: *'[^']+'" app.config.ts | grep -oE "[0-9]+\.[0-9]+")
case "$branch:$runtime" in
  master:3.4|native-3.1:3.5) ;;
  *) echo "refusing: branch $branch has runtimeVersion '$runtime' (expected master:3.4 or native-3.1:3.5)"; exit 1 ;;
esac
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "refusing: uncommitted changes"; exit 1; }
git fetch -q origin "$branch"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ] || { echo "refusing: HEAD is not origin/$branch (push or pull first)"; exit 1; }
echo "publishing $branch @ $(git rev-parse --short HEAD) → channel production, runtime $runtime"
exec npx eas update --branch production --environment production --platform android --message "$msg" --non-interactive
