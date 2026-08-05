import * as Updates from 'expo-updates';

/**
 * True on any native shell built with edge-to-edge enabled (see
 * android/gradle.properties `expo.edgeToEdgeEnabled`) — false only on an
 * older shell without it.
 *
 * 2026-07-30: every `<StatusBar>` mount in the app (react-native's own or
 * expo-status-bar's) defaults `hidden` to false. On a non-edge-to-edge shell
 * that's a no-op (status bar was never hidden there). On an edge-to-edge
 * shell it actively RE-SHOWS the status bar via the same
 * WindowInsetsController API MainActivity.kt used to hide it at launch —
 * undoing immersive mode shortly after boot. This JS is shared verbatim
 * between shells via OTA, so the fix has to detect which shell it's running
 * on rather than unconditionally setting `hidden`, which would incorrectly
 * hide the status bar on a shell that doesn't support it.
 *
 * `Updates.channel` is the chosen signal because it's a native-embedded
 * expo-updates value (already linked for OTA) that doesn't change when JS
 * ships over-the-air, unlike anything read from the shared app.config.ts.
 *
 * 2026-08-05: `production` promoted to carry the same edge-to-edge native
 * stack canary (`preview` channel) was field-testing — both are now
 * edge-to-edge shells, so both belong in the allowlist. Originally only
 * "preview" — this is deliberately still an allowlist (not a denylist) so
 * an unknown/dev channel keeps today's default (visible) behavior rather
 * than surprising anyone.
 */
export const IS_IMMERSIVE_SHELL = Updates.channel === 'preview' || Updates.channel === 'production';
