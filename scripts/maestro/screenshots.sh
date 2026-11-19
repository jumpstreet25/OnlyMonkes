#!/usr/bin/env bash
# Store screenshots with Maestro on a real, logged-in phone (owner 2026-11-19).
#
#   scripts/maestro/screenshots.sh [package] [device]
#     package  com.onlymonkes.app (3.0 store app, real chat — best for the listing)
#              or com.onlymonkes.app.next (3.1 test app, staging, mostly empty chats)
#     device   adb serial, default: the only connected device
#
# Each screen is opened with the app's own onlymonkes:// link, sent to that package
# (both apps own the scheme), then shot.yaml waits for it to settle and saves a PNG
# to scripts/maestro/out/<package>/. The status bar is put in Android demo mode
# (9:41, full battery and signal, no notification icons) and restored at the end.
# Needs: maestro on PATH (~/.local/opt/maestro/bin) and JAVA_HOME (JDK 17+).
set -euo pipefail
PKG="${1:-com.onlymonkes.app}"
DEV="${2:-$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')}"
[ -n "$DEV" ] || { echo "no adb device"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out/$PKG"
mkdir -p "$OUT"
A=(adb -s "$DEV")

# name  route  extra-seconds (3D / WebView screens need longer to draw)
SCREENS=(
  "01-main-chat     chat                 4"
  "02-monkecaves    monkecaves           12"
  "03-monkekart     racer                12"
  "04-monke3d       monke3d              10"
  "05-globe         globe                10"
  "06-trades        open/trades          5"
  "07-marketplace   marketplace          5"
  "08-genesis       genesis-chat         5"
  "09-live-poll     live-poll            5"
)

demo() { "${A[@]}" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
restore() { demo exit || true; }
trap restore EXIT
"${A[@]}" shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile show -e datatype none -e level 4
demo notifications -e visible false

for row in "${SCREENS[@]}"; do
  read -r name route wait <<<"$row"
  echo "→ $name ($route)"
  "${A[@]}" shell am start -W -a android.intent.action.VIEW -d "onlymonkes://$route" "$PKG" >/dev/null
  sleep "$wait"
  # Maestro 2.x only writes screenshots under its own dated output folder: shoot into a
  # scratch folder, then move the PNG up to out/<package>/<name>.png.
  RUN="$OUT/.run"; rm -rf "$RUN"
  maestro --device "$DEV" test --test-output-dir "$RUN" -e APP_ID="$PKG" -e NAME="$name" "$HERE/shot.yaml" >/dev/null \
    || { echo "  maestro failed on $name (debug: ~/.maestro/tests)"; exit 1; }
  find "$RUN" -name "$name.png" -exec mv -f {} "$OUT/$name.png" \;
  rm -rf "$RUN"
done
echo "saved to $OUT"; ls -1 "$OUT"
