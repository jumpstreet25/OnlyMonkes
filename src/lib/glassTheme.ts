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

export function getBlurProps() {
  return {
    intensity: 40,
    tint: "dark" as const,
    // Phase B (OnlyMonkes 3.0 native build): add
    // experimentalBlurMethod: "dimezisBlurView" + a tuned blurReductionFactor
    // here to activate real optical blur. Held back for now — see
    // ExpoBlurView.kt: BlurMethod.NONE (the current default) just paints a
    // flat tinted View, it never samples content behind it.
  };
}
