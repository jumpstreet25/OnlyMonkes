/**
 * glassTheme.ts — single source of truth for the app's glassmorphic "modal
 * chrome" system (GlassModal, GlassBottomSheet, and the components folded
 * into it: BananaShopModal's PreviewPopup, MenuDrawer). Previously these
 * constants were independently redeclared per-file and had drifted (e.g.
 * GlassBottomSheet's 0.95 vs GlassModal's 0.92 background opacity).
 *
 * getBlurProps() is the single future touch point for enabling real native
 * blur (expo-blur's `experimentalBlurMethod`) once that ships in the 3.0
 * native build — every BlurView usage spreads this object, so activating it
 * is a one-line change here instead of a grep-and-replace.
 */

export const GLASS_BG = "rgba(12, 12, 22, 0.92)";
export const GLASS_BORDER = "rgba(248, 248, 255, 0.10)";
export const HIGHLIGHT = "rgba(255, 255, 255, 0.12)";
export const GLASS_GRADIENT_COLORS: [string, string] = [
  "rgba(248, 248, 255, 0.06)",
  "rgba(0, 0, 0, 0.12)",
];
export const GLASS_RADIUS = 24;

// Phase B (2026-07-22) — activates real optical blur. Previously
// BlurMethod.NONE (expo-blur's default) just painted a flat tinted View,
// never sampling content behind it — confirmed by reading ExpoBlurView.kt.
//
// UNVERIFIED — this is the on-device spike itself, not a proven fix. No
// device/emulator was available to test against when this was written.
// Two real risks to check first, in order of likelihood:
//
// 1. Cross-window blur may not work at all for GlassModal.tsx/
//    MenuDrawer.tsx specifically. ExpoBlurView.kt's configureBlurView()
//    walks up ITS OWN view hierarchy looking for a react-native-screens
//    Screen ancestor, falling back to the Activity's decorView root if none
//    is found. But both of those components render their BlurView inside
//    RN's <Modal>, which Android implements as a SEPARATE native Window
//    (a Dialog) layered on top of the Activity — not part of the Activity's
//    own view tree. The content meant to be blurred (chat/app UI behind the
//    popup) lives in the ACTIVITY's window, not the Dialog's. RenderEffectBlur
//    (API 31+, OS-compositor-level) may still see across that boundary;
//    RenderScriptBlur (API 26-30 fallback, historically a view-bitmap-capture
//    approach) may not — if blur looks visually broken (transparent, black,
//    or simply absent) specifically pre-API-31, this is the first thing to
//    check, not a mystery to re-debug from scratch.
//    GlassBottomSheet.tsx is NOT at this risk — its BlurView sits inside
//    @gorhom/bottom-sheet's backdrop, which renders in the same window as
//    the rest of the screen (no Modal), so it's the safer one to validate
//    first if only one device pass is available.
// 2. blurReductionFactor deliberately left at the library's own default (4,
//    set natively in ExpoBlurView.kt) rather than guessing a "tuned" value
//    without any visual feedback to tune it against.
//
// Test on an API 26-30 device (RenderScriptBlur path) AND an API 31+ device
// (RenderEffectBlur path) per minSdkVersion=26 in android/gradle.properties
// before trusting this anywhere. Full dim-overlay retune (currently 0.38,
// a conservative placeholder set against fake blur) to ~0.30-0.35 still
// needs to happen once real blur is confirmed working and there's something
// actually worth seeing through it.
export function getBlurProps() {
  return {
    intensity: 40,
    tint: "dark" as const,
    experimentalBlurMethod: "dimezisBlurView" as const,
  };
}
