#!/bin/bash
# Put an APK on onlymonkes.app (R2 bucket onlymonkes-apks). Owner policy
# (2026-10-22): APKs never go on GitHub; only the dApp Store build is
# "published".
#
#   scripts/apk/upload-apk.sh test <file.apk>
#       → prints an unguessable link: https://onlymonkes.app/download/t/<token>/<name>.apk
#         (anyone with the link; expires after 30 days; at most 3 test builds kept)
#   scripts/apk/upload-apk.sh published <file.apk> --i-confirm-this-is-the-dapp-store-build
#       → https://onlymonkes.app/download/apk serves it from then on
#
# Never-charged guardrail: refuses if the bucket would pass 3 GB (R2 free tier is 10 GB).
set -euo pipefail
cd "$(dirname "$0")/../../worker-actions"

BUCKET="onlymonkes-apks"
KV_NS="ca7310b8736a44f4bb2fe8576e482ce7"   # FRAME_ALERTS (apk:published, apk:test-index)
MAX_BYTES=$((3 * 1024 * 1024 * 1024))
MAX_TESTS=3
SITE="https://onlymonkes.app"

kind="${1:-}"; file="${2:-}"; confirm="${3:-}"
[ "$kind" = "test" ] || [ "$kind" = "published" ] || { echo "usage: $0 test|published <file.apk>" >&2; exit 2; }
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
manifest=$(unzip -l "$file" 2>/dev/null | grep -c "AndroidManifest.xml" || true)
[ "$(head -c 2 "$file")" = "PK" ] && [ "${manifest:-0}" -gt 0 ] || { echo "not an APK: $file" >&2; exit 2; }
size=$(stat -c %s "$file")
[ "$size" -lt $((300 * 1024 * 1024)) ] || { echo "APK over 300 MB" >&2; exit 2; }
if [ "$kind" = "published" ] && [ "$confirm" != "--i-confirm-this-is-the-dapp-store-build" ]; then
  echo "published is only for the build that's live on the Solana dApp Store." >&2
  echo "re-run with --i-confirm-this-is-the-dapp-store-build" >&2; exit 2
fi

# Storage cap.
info=$(npx wrangler r2 bucket info "$BUCKET" 2>/dev/null)
used=$(echo "$info" | sed -n 's/^bucket_size: *//p' | awk '{v=$1; u=$2; m=1; if(u=="KB"||u=="KiB")m=1024; if(u=="MB"||u=="MiB")m=1024^2; if(u=="GB"||u=="GiB")m=1024^3; printf "%d", v*m}')
[ -n "$used" ] || { echo "could not read bucket size — refusing" >&2; exit 1; }
if [ $((used + size)) -gt $MAX_BYTES ]; then
  echo "refusing: bucket would pass 3 GB (now $((used / 1048576)) MB + $((size / 1048576)) MB)" >&2; exit 1
fi

name=$(basename "$file" | tr -c 'A-Za-z0-9._\n-' '-' | cut -c1-76)
case "$name" in *.apk) ;; *) name="$name.apk" ;; esac
sha=$(sha256sum "$file" | cut -c1-64)

if [ "$kind" = "test" ]; then
  token=$(openssl rand -hex 16)
  key="test/$token/$name"
  npx wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type application/vnd.android.package-archive --remote >/dev/null
  # Keep the newest $MAX_TESTS test builds; delete older ones.
  index=$(npx wrangler kv key get "apk:test-index" --namespace-id "$KV_NS" --remote 2>/dev/null || echo "[]")
  newindex=$(python3 -c '
import json,sys
try:
    l=json.loads(sys.argv[1]); l=l if isinstance(l,list) else []
except Exception:
    l=[]
l.append(sys.argv[2]); print(json.dumps(l))' "$index" "$key")
  for old in $(python3 -c 'import json,sys; l=json.loads(sys.argv[1]); print("\n".join(l[:-int(sys.argv[2])]))' "$newindex" "$MAX_TESTS"); do
    npx wrangler r2 object delete "$BUCKET/$old" --remote >/dev/null 2>&1 || true
  done
  python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])[-int(sys.argv[2]):]))' "$newindex" "$MAX_TESTS" > /tmp/apk-index.$$
  npx wrangler kv key put "apk:test-index" --path /tmp/apk-index.$$ --namespace-id "$KV_NS" --remote >/dev/null; rm -f /tmp/apk-index.$$
  echo "test build uploaded (sha256 $sha)"
  echo "$SITE/download/t/$token/$name"
else
  key="published/$name"
  npx wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type application/vnd.android.package-archive --remote >/dev/null
  printf '{"key":"%s","name":"%s","size":%s,"sha256":"%s","uploadedAt":"%s"}' "$key" "$name" "$size" "$sha" "$(date -u +%FT%TZ)" > /tmp/apk-pub.$$
  npx wrangler kv key put "apk:published" --path /tmp/apk-pub.$$ --namespace-id "$KV_NS" --remote >/dev/null; rm -f /tmp/apk-pub.$$
  echo "published build uploaded (sha256 $sha)"
  echo "$SITE/download/apk"
fi
