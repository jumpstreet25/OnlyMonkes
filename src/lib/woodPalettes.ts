/**
 * Natural wood species palettes for Banana Grove world bubbles.
 *
 * Each species defines its own 4-stop palette: light (top of vertical
 * gradient), mid, dark (bottom), deep (back face / carve-interior color).
 * No artificial PFP-color tinting in the wood itself — wood reads as wood.
 *
 * Picker uses HSL lightness + hue: lightness picks the BAND (very-dark →
 * light), hue picks the species WITHIN the band (warm → cool → neutral).
 *
 * Shared between BananaGroveSignBubble (the wood plaque) and
 * BananaGroveCarvedText (the carve-fill color uses the same species so
 * letters appear cut INTO the same wood as the surface).
 */

export interface WoodPalette {
  name: string;
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

export const WOOD_MAPLE: WoodPalette       = { name: "maple",       light: "#F0DBB0", mid: "#C9A87C", dark: "#997A52", deep: "#5C4828" };
export const WOOD_BIRCH: WoodPalette       = { name: "birch",       light: "#ECD9B0", mid: "#C2A47A", dark: "#8C7548", deep: "#4F3D22" };
export const WOOD_ASH: WoodPalette         = { name: "ash",         light: "#DCC9A8", mid: "#A89576", dark: "#756547", deep: "#423626" };
export const WOOD_PINE: WoodPalette        = { name: "pine",        light: "#DEB887", mid: "#B8895A", dark: "#835E2E", deep: "#4F3815" };
export const WOOD_CEDAR: WoodPalette       = { name: "cedar",       light: "#C99878", mid: "#9E6B4A", dark: "#704528", deep: "#432712" };
export const WOOD_TEAK: WoodPalette        = { name: "teak",        light: "#B89970", mid: "#8B6F4A", dark: "#5F4A2C", deep: "#382B15" };
export const WOOD_OAK: WoodPalette         = { name: "oak",         light: "#7A4A26", mid: "#5A3318", dark: "#3A2110", deep: "#1F1206" };
export const WOOD_CHERRY: WoodPalette      = { name: "cherry",      light: "#A55B3D", mid: "#7B3F26", dark: "#5C2A15", deep: "#3A1808" };
export const WOOD_MAHOGANY: WoodPalette    = { name: "mahogany",    light: "#6B3520", mid: "#4F2415", dark: "#38180A", deep: "#210D04" };
export const WOOD_WALNUT: WoodPalette      = { name: "walnut",      light: "#5A3822", mid: "#3D2514", dark: "#28190B", deep: "#180E06" };
export const WOOD_BLACK_MAPLE: WoodPalette = { name: "black_maple", light: "#3F3025", mid: "#2A1E15", dark: "#19110A", deep: "#0C0805" };
export const WOOD_ROSEWOOD: WoodPalette    = { name: "rosewood",    light: "#5C2D2A", mid: "#3F1D1B", dark: "#2A1311", deep: "#170A09" };
export const WOOD_WENGE: WoodPalette       = { name: "wenge",       light: "#382820", mid: "#221813", dark: "#14100A", deep: "#080606" };
export const WOOD_EBONY: WoodPalette       = { name: "ebony",       light: "#261E18", mid: "#14100C", dark: "#080604", deep: "#030201" };

/** Convert hex (#RRGGBB) to HSL { h, s, l } each in 0..1. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  if (!hex.startsWith("#") || hex.length !== 7) return { h: 0, s: 0, l: 0.5 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
    else if (max === g) h = ((b - r) / d) + 2;
    else h = ((r - g) / d) + 4;
    h /= 6;
  }
  return { h, s, l };
}

/** hex (#RRGGBB) → rgba(...,alpha) string. Pass-through if not 7-char hex. */
export function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) return hex;
  let r: number, g: number, b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Pick a natural wood species based on the sender's PFP color.
 * Lightness chooses the BAND. Hue refines WITHIN the band.
 */
export function pickWoodPalette(pfpColor: string): WoodPalette {
  const { h, s, l } = hexToHsl(pfpColor);

  // Low-sat grays → neutral species ladder by lightness only
  if (s < 0.18) {
    if (l < 0.10) return WOOD_EBONY;
    if (l < 0.22) return WOOD_WENGE;
    if (l < 0.40) return WOOD_BLACK_MAPLE;
    if (l < 0.58) return WOOD_TEAK;
    if (l < 0.78) return WOOD_ASH;
    return WOOD_BIRCH;
  }

  const isWarm   = h < 0.07 || h >= 0.85;
  const isYellow = h >= 0.07 && h < 0.18;
  const isCool   = h >= 0.18 && h < 0.85;

  if (l < 0.18) {
    if (isWarm)   return WOOD_ROSEWOOD;
    if (isYellow) return WOOD_BLACK_MAPLE;
    if (isCool)   return WOOD_WENGE;
  }
  if (l < 0.35) {
    if (isWarm)   return WOOD_MAHOGANY;
    if (isYellow) return WOOD_BLACK_MAPLE;
    if (isCool)   return WOOD_WALNUT;
  }
  if (l < 0.55) {
    if (isWarm)   return WOOD_CHERRY;
    if (isYellow) return WOOD_TEAK;
    if (isCool)   return WOOD_OAK;
  }
  if (l < 0.72) {
    if (isWarm)   return WOOD_CEDAR;
    if (isYellow) return WOOD_PINE;
    if (isCool)   return WOOD_TEAK;
  }
  if (isWarm)   return WOOD_BIRCH;
  if (isYellow) return WOOD_MAPLE;
  if (isCool)   return WOOD_ASH;
  return WOOD_OAK;
}
