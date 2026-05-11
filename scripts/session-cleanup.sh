#!/bin/bash
# OnlyMonkes session-end disk cleanup — runs from the Claude Code Stop hook.
#
# Fast (<5s), idempotent, non-destructive. Never touches:
#   • .env files, keystores, .xmtp_bot_key, publisher keypair
#   • active bot logs (mtime < 1 day excludes them via find)
#   • node_modules source, dapp-store/assets
#   • android/app/build/outputs/apk (the actual APK)
#
# Safe to run mid-development — Gradle/Expo regenerate everything below.

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Stale sideload APK stash
rm -f /tmp/device-app.apk 2>/dev/null

# 2. Truncate /tmp *.log files that haven't been written in >24h (active bot
#    logs like /tmp/monke-bot.log and /tmp/hermes.log have fresh mtime → skipped)
find /tmp -maxdepth 1 -type f -name "*.log" -mtime +1 -exec sh -c ': > "$1"' _ {} \; 2>/dev/null

# 3. Project Android build intermediates — outputs/ (where the APK lives) preserved
rm -rf "$PROJECT_ROOT/android/app/build/intermediates" 2>/dev/null
rm -rf "$PROJECT_ROOT/android/app/build/tmp" 2>/dev/null
rm -rf "$PROJECT_ROOT/android/app/build/generated" 2>/dev/null

# 4. Gradle transforms cache (per scripts/post-build-cleanup.sh convention)
rm -rf "$HOME/.gradle/caches/transforms-4" 2>/dev/null

exit 0
