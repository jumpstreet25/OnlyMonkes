import * as Updates from 'expo-updates';

/**
 * True on the 3.0/canary native shell (edge-to-edge enabled natively —
 * see android/gradle.properties `expo.edgeToEdgeEnabled`), false on the
 * legacy OTA/production shell (edge-to-edge off).
 *
 * 2026-07-30: every `<StatusBar>` mount in the app (react-native's own or
 * expo-status-bar's) defaults `hidden` to false. On the legacy shell that's
 * a no-op (status bar was never hidden there). On the 3.0/canary shell it
 * actively RE-SHOWS the status bar via the same WindowInsetsController API
 * MainActivity.kt used to hide it at launch — undoing immersive mode
 * shortly after boot. This JS is shared verbatim between both shells via
 * OTA, so the fix has to detect which shell it's running on rather than
 * unconditionally setting `hidden`, which would incorrectly hide the
 * status bar on the legacy shell too.
 *
 * `Updates.channel` is the chosen signal because it's a native-embedded
 * expo-updates value (already linked in both shells for OTA) that doesn't
 * change when JS ships over-the-air, unlike anything read from the shared
 * app.config.ts. Deliberately an allowlist (only "preview" forces hidden)
 * rather than a denylist, so unknown/dev channels keep today's default
 * (visible) behavior rather than surprising anyone.
 */
export const IS_IMMERSIVE_SHELL = Updates.channel === 'preview';
