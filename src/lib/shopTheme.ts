/**
 * shopTheme.ts — Maps Banana Shop Tier 4 theme styles to global THEME overrides.
 *
 * Called on app startup and when items are equipped/unequipped.
 * Stores overrides in appStore.themeOverrides for UI components to read.
 */

import { useAppStore } from "@/store/appStore";
import { THEME } from "@/lib/constants";
import { getOrExtractNftColor } from "@/lib/nftColor";

/**
 * Apply theme overrides based on equipped shop styles.
 * Called after getEquippedStyles() resolves.
 */
export function applyThemeFromShop(styles: Record<string, string | number | boolean>): void {
  // No theme equipped — clear overrides
  if (!styles.themeBg && !styles.pfpFullTheme) {
    useAppStore.getState().setThemeOverrides(null);
    return;
  }

  // Static theme (Midnight Blue, Solana Purple, Banana Yellow, Matrix Green)
  if (styles.themeBg && typeof styles.themeBg === "string") {
    const overrides: Record<string, string> = {
      bg: styles.themeBg as string,
    };
    if (styles.themeSurface) overrides.surface = styles.themeSurface as string;
    if (styles.themeAccent) {
      overrides.accent = styles.themeAccent as string;
      overrides.accentSoft = hexToRgba(styles.themeAccent as string, 0.15);
    }
    // Derive surfaceHigh and border from surface
    if (styles.themeSurface) {
      overrides.surfaceHigh = lighten(styles.themeSurface as string, 15);
      overrides.border = lighten(styles.themeSurface as string, 8);
    }
    useAppStore.getState().setThemeOverrides(overrides as any);
    return;
  }

  // PFP Full Theme — extract NFT color palette and build theme
  if (styles.pfpFullTheme) {
    const nft = useAppStore.getState().verifiedNft;
    if (nft?.image) {
      getOrExtractNftColor(nft.image, nft.mint ?? "nft").then(dominant => {
        const overrides = buildPfpTheme(dominant);
        useAppStore.getState().setThemeOverrides(overrides as any);
        useAppStore.getState().setNftDominantColor(dominant);
      }).catch(() => {});
    }
  }
}

/**
 * Build a full theme from an NFT's dominant color.
 * Creates dark variants for bg/surface, uses the color as accent.
 */
function buildPfpTheme(dominantHex: string): Record<string, string> {
  const { r, g, b } = hexToRgb(dominantHex);
  return {
    bg: `rgb(${Math.floor(r * 0.04)}, ${Math.floor(g * 0.04)}, ${Math.floor(b * 0.04)})`,
    surface: `rgb(${Math.floor(r * 0.08)}, ${Math.floor(g * 0.08)}, ${Math.floor(b * 0.08)})`,
    surfaceHigh: `rgb(${Math.floor(r * 0.12)}, ${Math.floor(g * 0.12)}, ${Math.floor(b * 0.12)})`,
    border: `rgba(${r}, ${g}, ${b}, 0.12)`,
    accent: dominantHex,
    accentSoft: `rgba(${r}, ${g}, ${b}, 0.15)`,
  };
}

/**
 * Get effective theme color — checks overrides first, falls back to THEME constant.
 */
export function getThemeColor(key: keyof typeof THEME): string {
  const overrides = useAppStore.getState().themeOverrides;
  if (overrides && (overrides as any)[key]) return (overrides as any)[key];
  return THEME[key];
}

/**
 * React hook for theme-aware rendering — subscribes to override changes.
 */
export function useThemeColor(key: keyof typeof THEME): string {
  const override = useAppStore(s => s.themeOverrides ? (s.themeOverrides as any)[key] : undefined);
  return override ?? THEME[key];
}

// ─── Color helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex: string, amount: number): string {
  try {
    const { r, g, b } = hexToRgb(hex.replace("#", "").replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, "$1$2$3"));
    return `rgb(${Math.min(255, r + amount)}, ${Math.min(255, g + amount)}, ${Math.min(255, b + amount)})`;
  } catch {
    return hex;
  }
}
