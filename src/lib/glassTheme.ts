/**
 * glassTheme.ts — single source of truth for the app's glassmorphic "modal
 * chrome" system (GlassModal, GlassBottomSheet, and the components folded
 * into it: BananaShopModal's PreviewPopup, MenuDrawer). Previously these
 * constants were independently redeclared per-file and had drifted (e.g.
 * GlassBottomSheet's 0.95 vs GlassModal's 0.92 background opacity).
 *
 * 2026-08-23: real native BlurView (both expo-blur's Android path and
 * @sbaiahmed1/react-native-blur) is GONE app-wide — see LiquidGlass.tsx for
 * why (a crash class never fully closed across 3 prior "defer the mount"
 * attempts). getBlurProps()/getPanelBlurProps() are now vestigial: every
 * `<BlurView {...getBlurProps()} />` call site is aliased to LiquidGlass,
 * which ignores these props and renders a translucent gradient scrim
 * instead. Kept only so ~20 existing call sites don't need editing. The
 * fill opacities below were tuned assuming a real blur softened busy
 * content FIRST — bumped up here to compensate for that now being gone,
 * since a flat scrim alone doesn't obscure detail as effectively as blur.
 */

// 2026-07-24: 0.92 -> 0.55 -> 0.38 -> 0.30 (all tuned against real blur).
// GLASS_BG is the fill for the actual visible card/sheet/drawer/header/
// toolbar surface, layered on top of LiquidGlass's scrim (formerly a real
// BlurView). 2026-08-23: 0.30 -> 0.44 — with no more real blur softening
// content first, a lighter fill let too much of what's behind (world art,
// photos, GIFs, scrolling messages) show through un-softened. Needs a
// fresh on-device look once verified stable — this is a reasoned first
// pass, not a re-measured tuning.
export const GLASS_BG = "rgba(12, 12, 22, 0.44)";
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
// 2026-08-23: 0.20 → 0.30 — same no-more-real-blur compensation as GLASS_BG.
export const GLASS_CHROME_BG = "rgba(18, 18, 26, 0.30)";

/**
 * MainChat bubble fill — the light dark layer ON TOP of LiquidGlass that
 * TechNoirBubble / TradingFloorBubble use. Lighter than GLASS_BG so the
 * world plate still reads through; panels/menus/shop cards should match
 * this recipe, not the heavier modal GLASS_BG. 2026-08-23: 0.16 → 0.24,
 * same no-more-real-blur compensation as GLASS_BG/GLASS_CHROME_BG.
 */
export const BUBBLE_GLASS_FILL = "rgba(12, 12, 22, 0.24)";

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

// 2026-08-23: VESTIGIAL. These used to configure real native optical blur
// (Phase B, 2026-07-22 — see git history for the tuning trail if ever
// resurrecting real blur). Every `<BlurView {...getBlurProps()} />` call
// site now renders LiquidGlass instead (see LiquidGlass.tsx for why), which
// ignores these props entirely. Kept only so the ~20 existing call sites
// spreading this object don't need per-file edits.
export function getBlurProps() {
  return {
    intensity: 60,
    tint: "dark" as const,
    experimentalBlurMethod: "dimezisBlurView" as const,
  };
}

// 2026-08-23: VESTIGIAL — see getBlurProps() above.
export function getPanelBlurProps() {
  return {
    ...getBlurProps(),
    intensity: 32,
  };
}
