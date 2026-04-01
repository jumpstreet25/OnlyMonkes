#!/bin/bash
# Post-build cleanup script for OnlyMonkes
# Removes temporary build caches to keep disk space free on low-storage Macs.
# Safe to run after every successful build — Gradle regenerates what it needs.

set -e

echo "🧹 Post-build cleanup..."

SAVED=0

# 1. Gradle build cache (transforms, jars, file hashes — rebuilt each build)
if [ -d "$HOME/.gradle/caches/transforms-4" ]; then
  SIZE=$(du -sm "$HOME/.gradle/caches/transforms-4" 2>/dev/null | cut -f1)
  rm -rf "$HOME/.gradle/caches/transforms-4"
  SAVED=$((SAVED + SIZE))
  echo "  ✅ Gradle transforms cache ($SIZE MB)"
fi

# 2. Gradle file-changes + configuration-cache (stale between builds)
rm -rf "$HOME/.gradle/caches/8.*/fileChanges" 2>/dev/null
rm -rf "$HOME/.gradle/caches/8.*/executionHistory" 2>/dev/null
rm -rf "$HOME/.gradle/caches/journal-*" 2>/dev/null

# 3. Local project .gradle cache (task history, file hashes)
PROJECT_GRADLE="$(dirname "$0")/../android/.gradle"
if [ -d "$PROJECT_GRADLE" ]; then
  SIZE=$(du -sm "$PROJECT_GRADLE" 2>/dev/null | cut -f1)
  rm -rf "$PROJECT_GRADLE"
  SAVED=$((SAVED + SIZE))
  echo "  ✅ Project .gradle cache ($SIZE MB)"
fi

# 4. Native build intermediates (C++ .o files, cmake cache — huge for Skia/worklets/mediapipe)
NATIVE_DIRS=(
  "node_modules/@shopify/react-native-skia/android/.cxx"
  "node_modules/@shopify/react-native-skia/android/build"
  "node_modules/react-native-worklets-core/android/.cxx"
  "node_modules/react-native-worklets-core/android/build"
  "node_modules/react-native-mediapipe/android/.cxx"
  "node_modules/react-native-mediapipe/android/build"
  "node_modules/react-native-vision-camera/android/.cxx"
  "node_modules/react-native-vision-camera/android/build"
  "node_modules/react-native-reanimated/android/.cxx"
  "node_modules/react-native-reanimated/android/build"
)

PROJECT_ROOT="$(dirname "$0")/.."
for DIR in "${NATIVE_DIRS[@]}"; do
  FULL="$PROJECT_ROOT/$DIR"
  if [ -d "$FULL" ]; then
    SIZE=$(du -sm "$FULL" 2>/dev/null | cut -f1)
    rm -rf "$FULL"
    SAVED=$((SAVED + SIZE))
    echo "  ✅ $(basename "$(dirname "$(dirname "$DIR")")")/$(basename "$(dirname "$DIR")") native cache ($SIZE MB)"
  fi
done

# 5. Gradle daemon logs
rm -rf "$HOME/.gradle/daemon" 2>/dev/null

# 6. Android build intermediates (keep the APK output)
APP_BUILD="$PROJECT_ROOT/android/app/build"
if [ -d "$APP_BUILD/intermediates" ]; then
  SIZE=$(du -sm "$APP_BUILD/intermediates" 2>/dev/null | cut -f1)
  rm -rf "$APP_BUILD/intermediates"
  rm -rf "$APP_BUILD/tmp"
  rm -rf "$APP_BUILD/generated"
  SAVED=$((SAVED + SIZE))
  echo "  ✅ App build intermediates ($SIZE MB)"
fi

echo ""
echo "🎯 Freed ~${SAVED} MB of disk space"
echo "💾 Free: $(df -h / | tail -1 | awk '{print $4}')"
