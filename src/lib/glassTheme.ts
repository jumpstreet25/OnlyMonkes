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

// 2026-07-24: 0.92 -> 0.55 -> 0.38. GLASS_BG is the fill for the actual
// visible card/sheet/drawer/header/toolbar surface, layered on TOP of a
// BlurView. At 0.92 it fully hid the blur (confirmed on-device: zero visible
// effect). 0.55 made blur measurable via pixel sampling but still read as
// "basically the same as before" at a glance. Pushed further down so the
// blur is unmistakable, not just numerically present — retune up if text
// legibility suffers against very busy/bright content behind it.
export const GLASS_BG = "rgba(12, 12, 22, 0.19)";
export const GLASS_BORDER = "rgba(248, 248, 255, 0.10)";
export const HIGHLIGHT = "rgba(255, 255, 255, 0.12)";
export const GLASS_GRADIENT_COLORS: [string, string] = [
  "rgba(248, 248, 255, 0.06)",
  "rgba(0, 0, 0, 0.12)",
];
export const GLASS_RADIUS = 24;

// 2026-08-03: persistent chrome bars (ChatHeader, ChatInput) — NOT modals/
// sheets, so the cross-window blur risk documented on getBlurProps() below
// doesn't apply (they render in the Activity's own window, same as
// GlassBottomSheet's backdrop, not inside an RN <Modal>). Deliberately kept
// no heavier than modal GLASS_BG — these bars sit over live content the
// whole time content is on screen, not just while a transient sheet is
// open, so a heavier tint would read as flattening the app rather than
// glass over it.
// 2026-08-05: was 0.5, set when GLASS_BG was still 0.92 (so 0.5 really was
// lighter). GLASS_BG has since been retuned down to 0.19 (see the tuning
// note below) without this constant following — chrome bars were quietly
// LEFT HEAVIER than modals, the opposite of this comment's own intent.
// Matched to GLASS_BG's current value so the "always-on glass" look is
// consistent everywhere it's used, not just in modals.
export const GLASS_CHROME_BG = "rgba(18, 18, 26, 0.19)";

// Phase B (2026-07-22) — activates real optical blur. Previously
// BlurMethod.NONE (expo-blur's default) just painted a flat tinted View,
// never sampling content behind it — confirmed by reading ExpoBlurView.kt.
//
// Real optical blur, confirmed working on-device (API 36 / RenderEffectBlur
// path) 2026-07-24 — verified via pixel sampling AND direct visual
// inspection. Tuning trend against a dark test scene (sparse white text on
// navy bg), same region, std of local contrast: intensity 40/opacity 0.55
// -> 3.39, intensity 55/opacity 0.38 -> 2.34, intensity 85/opacity 0.38 ->
// 1.32. Higher intensity monotonically WASHES OUT structure against dark
// content — more radius dilutes the few bright pixels into a flatter dark
// wash. 45 splits toward the best-measured point. This still needs
// judgment against real colorful content (photos/GIFs/World backgrounds),
// not just a dark test scene — that's the actual gap, not the number
// itself. Every BlurView usage spreads this object, so retuning is a
// one-line change here.
//
// Known gap: GlassModal/GlassBottomSheet/MenuDrawer's BACKDROP BlurView
// (the dismiss-tap area, separate from the card's own BlurView fixed
// 2026-07-24) still only blurs whatever's directly behind the popup, same
// props as the card. ChatHeader/ChatInput (top/bottom toolbar) also use
// this — for those, "content behind" is the scrolling message list, no
// Modal-window boundary concern since they're not modals.
export function getBlurProps() {
  return {
    intensity: 45,
    tint: "dark" as const,
    experimentalBlurMethod: "dimezisBlurView" as const,
  };
}
