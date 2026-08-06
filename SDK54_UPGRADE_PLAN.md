# Expo SDK 53 → 54 Upgrade Plan (OnlyMonkes)

**Status:** In progress, branch `sdk54-upgrade`. Supersedes the 2026-06-22 draft — that
draft assumed native-module revalidation (vision-camera/Skia/worklets) and the
Reanimated 3→4 migration were still ahead of us; commit `2852479` (2026-07-09) already
shipped both, pinned to versions that work on RN 0.79.6. This build folds in the
remaining SDK54-specific work instead of deferring again. This is a **native rebuild +
new APK + Solana dApp Store resubmit**, NOT an OTA. Bumps `runtimeVersion` off `3.3` →
new OTA lineage.

## Why we'd run this now
- Clears most of the moderate Expo-owned advisories (`@expo/config`, `expo-updates`,
  `expo-splash-screen`, `@expo/prebuild-config`) — build/dev tooling, low real risk.
  Baseline as of 2026-07-09 (branch cut): **45 vulnerabilities (7 high, 38 moderate)**.
- Modern toolchain (RN 0.81, Android 16 / API 36).
- Unblocks the d3/wagmi-charts high fix (Phase 5).
- Does **NOT** fix the spl-token/bigint-buffer highs (upstream abandoned).
- We already paid the two costliest migration risks (native module bumps, Reanimated
  3→4) in `2852479` — doing SDK54 now avoids touching Gradle/native config twice.
- The `canary` product flavor (`8d514fe`) exists specifically to validate this build
  on-device without risking the production app's wallet/XMTP state.

## Target toolchain
| | SDK 53 (before) | SDK 54 (target) |
|---|---|---|
| React Native | 0.79.6 | 0.81 |
| Gradle | 8.11.1 | 8.14.3 (hand-replace `gradle-wrapper.jar`, not just the properties file) |
| Kotlin | 2.0.21 | 2.1.20 |
| compile/target SDK | 35 | 36 |
| buildTools | 35.0.0 | 36.0.0 |
| NDK | 27.1.12297006, pinned via `rootProject.ext.ndkVersion` in `android/build.gradle` (`9b7e8f1`) | unchanged — re-verify Nitro Modules still only needs 27+ |

## Invariants that MUST survive (from CLAUDE.md — these cause Gradle/startup failures if dropped)
- **SoLoader** must keep `SoLoader.init(this, OpenSourceMergedSoMapping)` — verify the API is
  unchanged on RN 0.81 (else `libreact_featureflagsjni.so` startup crash).
- **R8/ProGuard stays disabled** for release (R8 strips JNI loaders new-arch needs). Re-confirm
  on 0.81; APK ~88MB.
- **BouncyCastle** `bcprov-jdk15on` exclusion stays in `build.gradle` (duplicate-class conflict).
- New Arch already enabled (`newArchEnabled=true`) — SDK 54 default, no change.
- Keystore: `android/app/onlymonkes-release.keystore`, creds in `android/gradle.properties`.
- **`adb install -r` only — NEVER uninstall** (wipes XMTP creds + wallet state).
- **NDK pin** (`android/build.gradle`, `9b7e8f1`) must survive — `app.config.ts`'s
  `expo-build-properties` `ndkVersion` field does nothing for Android; don't remove the
  explicit `rootProject.ext.ndkVersion` line thinking it's redundant.

---

## Phases

### Phase 0 — Branch + baseline ✅ done
- Branched `sdk54-upgrade` off `master`.
- npm audit baseline captured: 45 vulns (7 high, 38 moderate).
- This doc rewritten to match current reality.

### Phase 1 — Expo SDK + RN core (2-3h)
- `npx expo install expo@^54` then `npx expo install --fix` to pull SDK-matched versions.
- Bump RN 0.79.6 → 0.81; reconcile `react-native`, `@react-native/*`.
- Update `gradle-wrapper.properties` → 8.14.3 AND replace `gradle-wrapper.jar` (RN 0.81 needs the
  new jar — old one is incompatible).
- Bump Kotlin 2.1.20, compileSdk/targetSdk 36, buildTools 36.0.0 — set in **both**
  `app.config.ts` (expo-build-properties) and `android/gradle.properties` directly (prebuild
  regenerates gradle.properties from app.config.ts for these 5 keys specifically).
- Add a `.nvmrc` — repo currently has zero Node-version pinning anywhere (no `.nvmrc`,
  `.node-version`, or `engines` field) and SDK54 requires Node ≥18.

### Phase 2 — Re-pin the Gradle invariants (1-2h)
- Re-apply SoLoader merged-mapping check, R8-disabled, BouncyCastle exclusion (see Invariants).
- `cd android && ./gradlew :app:dependencies` on **both** `production` and `canary` flavors to
  surface duplicate-class / version conflicts early.

### Phase 3 — Native module revalidation (smaller than originally scoped — most already shipped)
Already at target version, just needs RN-0.81-compat verification, not re-bumping:
- `@xmtp/react-native-sdk@5.7.0` — **MLS DB migration must preserve creds.** Test on the
  `canary` package first, never production.
- `@livekit/react-native@2.10.2` + `@livekit/react-native-krisp-noise-filter`.
- `react-native-reanimated@4.0.3` + `react-native-worklets@0.4.2`, `react-native-vision-camera@5.1.0`
  + `-face-detector@2.0.6`, `@shopify/react-native-skia@2.6.9` — already bumped in `2852479`.

Not in the original plan, added since `2852479`:
- `react-native-nitro-modules` + `react-native-nitro-image` — verify against RN 0.81 + NDK 27.

Still needs a compat pass:
- `react-native-screens`, `-safe-area-context`, `-gesture-handler`, `expo-camera`, `expo-updates`,
  `freerasp-react-native`, `@shopify/flash-list`.

### Phase 4 — Android edge-to-edge (biggest UI risk — concrete file list, not a blind audit)
SDK 54 makes edge-to-edge **mandatory** — `expo.edgeToEdgeEnabled=false` opt-out is removed.
Reference pattern: `src/components/ChatHeader.tsx` (safe-area padding baked into the header bg).

**High risk (no insets at all):**
- `src/screens/VerifyScreen.tsx` — first screen after wallet connect, top priority.
- `src/screens/GlobeScreen.tsx`
- `src/components/VideoCameraModal.tsx` — full-bleed camera, hardcoded control offsets.
- `src/components/BadgeNotificationBanner.tsx` — global top toast.
- `src/components/MenuDrawer.tsx`
- `app/about.tsx`, `app/settings.tsx`, `app/portfolio.tsx`

**Medium risk (fragile translucent + magic-number combos):**
- `src/components/WebViewModal.tsx`, `src/components/BananaShopModal.tsx`
- `src/components/CalendarModal.tsx`, `src/components/GlassModal.tsx`
- `src/screens/DmScreen.tsx` / `GroupDmScreen.tsx` empty states, `app/video-room.tsx` loading state

**Low risk (already insets-aware, spot-check only):**
`AvatarRoomScreen.tsx` / `VideoRoomScreen.tsx` (re-check fixed control-bar height constants),
`ChatScreen`, `BotChannelScreen`, `ConnectScreen`, `DAppChatScreen`, `DmInboxScreen`,
`MarketplaceScreen`, `ThreadScreen`, `WatchlistScreen`, `TradingFloorWorld.tsx`,
`BananaGroveWorld.tsx` (confirm `insets.bottom` still wired, not just commented).

Global config point: `app/_layout.tsx:192` (`<StatusBar style="light"/>` inside `SafeAreaProvider`).

### Phase 5 — Fold in the d3/wagmi-charts high fix (1h + chart test)
- In the same window, attempt: override `d3-color@^3.1.0`, `d3-interpolate@^3`, `d3-scale@^4`
  (or bump `react-native-wagmi-charts` if a newer release exists by then).
- **Runtime-verify candlestick charts** (tap a `$TOKEN` mention → ChartModal) — export alone does
  NOT catch chart breakage.

### Phase 6 — Build, gate, ship (2-3h)
- `npx expo export --platform android` → confirm `EXPO_EXIT=0` + `.hbc` written.
- Build **`canary` flavor first** → `adb install -r` on a real device → smoke-test: XMTP login
  (creds intact), chat, DMs, charts, Avatar Room face-tracking, LiveKit audio, tips/swaps, RASP
  gate, edge-to-edge on the Phase-4 file list.
- Only once canary is clean, build `production`. Run `scripts/post-build-cleanup.sh`.
- Bump `runtimeVersion` (3.3 → next). Resubmit to Solana dApp Store (`com.OnlyMonkes.app`).
- Update CLAUDE.md toolchain block + memory (`project_live_runtime_is_3_3`,
  `feedback_apk_pending_changes`, `project_sdk54_batch_not_urgent` → mark done).

## Effort
Originally ~2-4 focused days; now smaller since Phases 3's riskiest items (native module bumps,
Reanimated 4) are already shipped. Highest remaining risk: Phase 4 (edge-to-edge, now scoped to
~13 known files) and the XMTP MLS credential-preservation check in Phase 3. Keep the SDK-53 APK
as rollback until the new one is device-validated via canary.
