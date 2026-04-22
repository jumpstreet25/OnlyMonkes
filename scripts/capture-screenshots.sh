#!/bin/bash
#
# capture-screenshots.sh — Grab fresh Seeker screenshots for dApp Store submission.
#
# The screenshots in dapp-store/assets/screenshots/ are from v2.20 (Mar 14) — before
# Avatar Rooms, cNFT Badges, Banana Shop, Globe, AutonoMonke, and marketplace.
# This script walks you through capturing 6 up-to-date screens and saves them
# directly to the paths referenced by dapp-store/config.yaml.
#
# Usage (from repo root, with Seeker plugged in + USB debugging enabled):
#   bash scripts/capture-screenshots.sh
#
# Old screenshots are backed up to screenshots/v2.20-backup-<date>/ so nothing is lost.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/dapp-store/assets/screenshots"
BACKUP_DIR="$OUT_DIR/backup-$(date +%Y%m%d-%H%M)"

mkdir -p "$OUT_DIR"

# ── Verify device ──────────────────────────────────────────────────────────
if ! command -v adb >/dev/null; then
  echo "❌ adb not in PATH. Install Android platform-tools."
  exit 1
fi

DEVICES=$(adb devices | tail -n +2 | grep -v "^$" | grep "device$" | awk '{print $1}')
DEVICE_COUNT=$(echo "$DEVICES" | grep -c . || true)
if [ "$DEVICE_COUNT" -eq 0 ]; then
  echo "❌ No device connected via adb."
  echo "   Plug in Seeker, enable Developer options → USB debugging, and accept the host prompt."
  exit 1
fi
if [ "$DEVICE_COUNT" -gt 1 ]; then
  echo "❌ Multiple devices connected — disconnect all but the Seeker."
  echo "$DEVICES"
  exit 1
fi
DEVICE=$(echo "$DEVICES" | head -1)
echo "✅ Using device: $DEVICE"
echo ""

# ── Back up existing screenshots ───────────────────────────────────────────
shopt -s nullglob
old=("$OUT_DIR"/screenshot_*.png)
if [ ${#old[@]} -gt 0 ]; then
  mkdir -p "$BACKUP_DIR"
  mv "${old[@]}" "$BACKUP_DIR/"
  echo "✅ Backed up ${#old[@]} old screenshots → $BACKUP_DIR"
  echo ""
fi

# ── Screens to capture, in the order referenced by config.yaml ────────────
SCREENS=(
  "1|Main Chat — active group chat with messages + Monke avatars + emoji reactions visible"
  "2|Avatar Room — face-tracked LiveKit video call with NFT avatars"
  "3|MonkeTrades bot channel — a TA alert with Buy/Sell Blink button visible"
  "4|MonkeMarkets — NFT listings grid with Saga Monkes + prices"
  "5|Banana Shop — item grid with banana balance + equipped cosmetic highlighted"
  "6|Monke Globe — 3D world view with holder location pins clustered"
)

echo "Will capture 6 screenshots. For each screen:"
echo "  1. Navigate your Seeker to the described screen"
echo "  2. Make sure key features are visible (messages, alerts, etc.)"
echo "  3. Press Enter here to capture"
echo "  4. Type 's' + Enter to skip (keeps old backup in place)"
echo "  5. Type 'r' + Enter to retake the previous screen"
echo ""

prev_file=""
for entry in "${SCREENS[@]}"; do
  num="${entry%%|*}"
  desc="${entry#*|}"
  filename="screenshot_${num}.png"
  full_path="$OUT_DIR/$filename"

  while true; do
    echo "───── $filename ─────"
    echo "    $desc"
    read -p "    Ready to capture? [Enter=yes / s=skip / r=retake prev]: " ans
    case "${ans:-}" in
      s|S)
        echo "    ⏭  Skipped. $filename not updated."
        break
        ;;
      r|R)
        if [ -z "$prev_file" ]; then
          echo "    ⚠️  No previous screen to retake."
          continue
        fi
        echo "    ↻  Retaking $prev_file. Set up the screen and press Enter…"
        read -p "    "
        adb exec-out screencap -p > "$OUT_DIR/$prev_file"
        echo "    ✅ Overwrote $prev_file"
        continue
        ;;
      *)
        adb exec-out screencap -p > "$full_path"
        if [ ! -s "$full_path" ]; then
          echo "    ❌ Capture produced empty file. Try again? [y/N]"
          read ans2
          [ "${ans2:-n}" = "y" ] && continue
          rm -f "$full_path"
          break
        fi
        dims=$(sips -g pixelWidth -g pixelHeight "$full_path" 2>/dev/null | awk '/pixel/ {print $2}' | paste -s -d'x' -)
        size_kb=$(( $(stat -f %z "$full_path") / 1024 ))
        echo "    ✅ Saved $filename ($dims, ${size_kb} KB)"
        prev_file="$filename"
        break
        ;;
    esac
  done
  echo ""
done

echo ""
echo "═══════════════════════════════════════"
echo " Final screenshots in $OUT_DIR:"
echo "═══════════════════════════════════════"
ls -la "$OUT_DIR"/screenshot_*.png 2>/dev/null | awk '{printf "  %-22s %s\n", $9, $5" bytes"}'
echo ""
echo "Review each image (open the folder in Finder), then commit:"
echo "  git add dapp-store/assets/screenshots/"
echo "  git commit -m 'assets: fresh v2.36 dApp Store screenshots'"
echo ""
echo "If any look bad, re-run this script — it only updates screenshots you don't skip."
