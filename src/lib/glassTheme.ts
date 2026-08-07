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
// 2026-08-07: 0.19 -> 0.30. Blur alone (intensity 45) still let busy/bright
// content (world art, photos, GIFs) show enough structure through to fight
// with foreground text — bumped fill darker AND raised blur intensity
// (see getBlurProps below) together so panels read as legible glass, not
// a faint tint over live detail.
export const GLASS_BG = "rgba(12, 12, 22, 0.30)";
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
// 2026-08-07: 0.30 → 0.20 — header/input chrome slightly more see-through
// (user: "more transparent, not much") so world art reads under the bar.
export const GLASS_CHROME_BG = "rgba(18, 18, 26, 0.20)";

/**
 * MainChat bubble fill — the light dark layer ON TOP of BlurView that
 * TechNoirBubble / TradingFloorBubble use. Lighter than GLASS_BG so the
 * world plate still reads through; panels/menus/shop cards should match
 * this recipe, not the heavier modal GLASS_BG.
 */
export const BUBBLE_GLASS_FILL = "rgba(12, 12, 22, 0.16)";

/** Soft world-accent wash layered over BUBBLE_GLASS_FILL (matches per-world bubbles). */
export function getWorldGlassWash(worldId: string | undefined | null): string | null {
  switch (worldId) {
    case "world_tech_noir":
      return "rgba(79, 216, 255, 0.05)";
    case "world_trading_floor":
      return "rgba(47, 143, 106, 0.06)";
    case "world_banana_grove":
      return "rgba(230, 184, 112, 0.05)";
    case "world_solana_cyberpunk":
      return "rgba(20, 241, 149, 0.05)";
    case "world_deep_space":
      return "rgba(136, 96, 255, 0.05)";
    case "world_frost_grove":
      return "rgba(140, 200, 255, 0.05)";
    default:
      return null;
  }
}

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
    intensity: 60,
    tint: "dark" as const,
    experimentalBlurMethod: "dimezisBlurView" as const,
  };
}

// 2026-08-07: shared per-panel blur for small MonkeGlass surfaces that sit
// directly on top of a World's own art (MenuDrawer tiles/search bar/banana
// section, BananaShopModal item cards, ProfileScorecard) — as opposed to
// getBlurProps() which is for the one big backdrop/card blur per modal.
// The world background itself must stay SHARP (blurring the whole
// background flattens the art into mush and was reported as wrong — glass
// belongs on the individual panels, not smeared across the whole scene).
// Lower intensity than getBlurProps() for the same reason TechNoirBubble
// originally tuned its own copy down to 32: many small panels tiled over
// busy/colorful art read as a muddy wash at full intensity; this keeps
// enough frost for text contrast while still letting the art's color and
// shape read through each panel.
export function getPanelBlurProps() {
  return {
    ...getBlurProps(),
    intensity: 32,
  };
}
