# Expo SDK 53 → 54 Upgrade Plan (OnlyMonkes)

**Status:** Drafted 2026-06-22. NOT urgent — batch with the next native build you need anyway
(see memory `project_sdk54_batch_not_urgent`). This is a **native rebuild + new APK + Solana
dApp Store resubmit**, NOT an OTA. Bumps `runtimeVersion` off `3.3` → new OTA lineage.

## Why we'd run this
- Clears most of the 66 **moderate** Expo-owned advisories (`@expo/config`, `expo-updates`,
  `expo-splash-screen`, `@expo/prebuild-config`) — build/dev tooling, low real risk.
- Modern toolchain (RN 0.81, Android 16 / API 36).
- Unblocks the d3/wagmi-charts high fix (bump charts lib in the same window — see Phase 6).
- Does **NOT** fix the spl-token/bigint-buffer highs (upstream abandoned).

## Forcing functions (do it when one of these hits)
1. EAS Build drops SDK 53 support (can't produce a new APK otherwise).
2. A required native module needs RN 0.81+ (XMTP / LiveKit / vision-camera / Skia).
3. Android 16 / API-36 device compatibility problems on the current API-35 target.

## Target toolchain (verified vs SDK 54 changelog)
| | SDK 53 (now) | SDK 54 (target) |
|---|---|---|
| React Native | 0.79.6 | 0.81 |
| Gradle | 8.11.1 | 8.14.3 (hand-update `gradle-wrapper.jar`) |
| Kotlin | 2.0.21 | 2.1.20 |
| compile/target SDK | 35 | 36 |
| buildTools | (35) | 36.0.0 |
| NDK | 26.1.10909125 | re-verify against SDK 54 |

## Invariants that MUST survive (from CLAUDE.md — these cause Gradle/startup failures if dropped)
- **SoLoader** must keep `SoLoader.init(this, OpenSourceMergedSoMapping)` — verify the API is
  unchanged on RN 0.81 (else `libreact_featureflagsjni.so` startup crash).
- **R8/ProGuard stays disabled** for release (R8 strips JNI loaders new-arch needs). Re-confirm
  on 0.81; APK ~88MB.
- **BouncyCastle** `bcprov-jdk15on` exclusion stays in `build.gradle` (duplicate-class conflict).
- New Arch already enabled (`newArchEnabled=true`) — SDK 54 default, no change.
- Keystore: `android/app/onlymonkes-release.keystore`, creds in `android/gradle.properties`.
- **`adb install -r` only — NEVER uninstall** (wipes XMTP creds + wallet state).

---

## Phases

### Phase 0 — Branch + baseline (0.5h)
- Branch `sdk54-upgrade` off `main`. Do NOT touch `master`/production until APK validated.
- Record current `npm audit` (73 vulns / 7 high / 66 mod) + a clean SDK-53 APK build as rollback.
- Sweep the APK-pending changelog (memory `feedback_apk_pending_changes`) so it lands in this build.

### Phase 1 — Expo SDK + RN core (2-3h)
- `npx expo install expo@^54` then `npx expo install --fix` to pull SDK-matched versions.
- Bump RN 0.79.6 → 0.81; reconcile `react-native`, `@react-native/*`.
- Update `gradle-wrapper.properties` → 8.14.3 AND replace `gradle-wrapper.jar` (RN 0.81 needs the
  new jar — old one is incompatible).
- Bump Kotlin 2.1.20, compileSdk/targetSdk 36, buildTools 36.0.0 (in `android/build.gradle` ext or
  via expo-build-properties config plugin — prefer the plugin so prebuild stays authoritative).

### Phase 2 — Re-pin the Gradle invariants (1-2h)
- Re-apply SoLoader merged-mapping check, R8-disabled, BouncyCastle exclusion (see Invariants).
- `cd android && ./gradlew :app:dependencies` to surface duplicate-class / version conflicts early.

### Phase 3 — Native module revalidation (3-5h, highest risk)
Bump + rebuild each; XMTP and LiveKit are the riskiest (heavy native + MLS DB):
- `@xmtp/react-native-sdk@5.7.0` — check 0.81 compat; **MLS DB migration must preserve creds**.
- `@livekit/react-native@2.10.2` + `@livekit/react-native-krisp-noise-filter`.
- `react-native-vision-camera@4.7.3` + `-face-detector@1.8.9` + `react-native-worklets-core@1.6.3`.
- `@shopify/react-native-skia@2.6.2`, `@shopify/flash-list@2.3.1`, `freerasp-react-native@4.5.2`.
- `react-native-screens`, `-safe-area-context`, `-gesture-handler`, `expo-camera`, `expo-updates`.

### Phase 4 — Reanimated 3 → 4 (2-3h)
- RN 0.81 + New Arch wants Reanimated 4.x. v4 splits worklets into a **new** `react-native-worklets`
  package — must coexist/dedup with the existing `react-native-worklets-core` (vision-camera).
- Touches: Avatar Room face-tracking, ConfettiView, all animated UI. Smoke-test each.

### Phase 5 — Android edge-to-edge (2-4h, biggest UI risk)
- SDK 54 makes edge-to-edge **mandatory** — `expo.edgeToEdgeEnabled=false` opt-out is removed.
- Audit every screen for status/nav-bar overlap: ChatScreen header, DmScreen header, MenuDrawer,
  all modals (TipModal, ChartModal, UserProfileModal, VideoCameraModal), Avatar/Live room screens.
- Use `react-native-safe-area-context` insets; verify the custom per-world chrome bars still align.

### Phase 6 — Fold in the d3/wagmi-charts high fix (1h + chart test)
- In the same window, attempt: override `d3-color@^3.1.0`, `d3-interpolate@^3`, `d3-scale@^4`
  (or bump `react-native-wagmi-charts` if a newer release exists by then).
- **Runtime-verify candlestick charts** (tap a `$TOKEN` mention → ChartModal) — export alone does
  NOT catch chart breakage. This clears 4 of the 7 remaining highs. spl-token's 3 stay (abandoned).

### Phase 7 — Build, gate, ship (2-3h)
- `npx expo export --platform android` → confirm `EXPO_EXIT=0` + `.hbc` written (memory rule).
- `eas build` (or local Gradle) → signed APK. Run `scripts/post-build-cleanup.sh` (~3GB reclaim).
- Install via `adb install -r` on a real device. Smoke-test: XMTP login (creds intact), chat,
  DMs, charts, Avatar Room face-tracking, LiveKit audio, tips/swaps, RASP gate.
- Bump `runtimeVersion` (3.3 → e.g. 3.4 or 4.0). Resubmit to Solana dApp Store (`com.OnlyMonkes.app`).
- Update CLAUDE.md toolchain block + memory (`project_live_runtime_is_3_3`, APK version notes).

## Effort
~2-4 focused days end-to-end. Highest-risk phases: 3 (native modules / XMTP MLS), 5 (edge-to-edge),
4 (Reanimated 4). Keep the SDK-53 APK as rollback until the new one is device-validated.
