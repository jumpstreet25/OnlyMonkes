/**
 * nftColor.ts
 *
 * Extracts the dominant color from an NFT PFP image using Android's Palette API
 * via react-native-image-colors. Results are cached in-memory + AsyncStorage
 * so each image is only processed once per install.
 */

import ImageColors from "react-native-image-colors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_COLOR_CACHE = "nft_color_cache_v1";

// In-memory cache so repeated calls within a session are instant
const _mem: Record<string, string> = {};
let _cacheLoaded = false;

async function ensureCacheLoaded() {
  if (_cacheLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(AK_COLOR_CACHE);
    if (raw) Object.assign(_mem, JSON.parse(raw));
  } catch { /* ignore */ }
  _cacheLoaded = true;
}

async function persistCache() {
  try {
    await AsyncStorage.setItem(AK_COLOR_CACHE, JSON.stringify(_mem));
  } catch { /* ignore */ }
}

/**
 * Returns a hex string of the dominant color for the given image URL.
 * Falls back to `fallback` if extraction fails or image has no URL.
 *
 * @param imageUrl  Remote URL of the NFT image
 * @param cacheKey  Unique key (inboxId or mint) to cache the result
 * @param fallback  Hex color to return if extraction fails
 */
export async function getOrExtractNftColor(
  imageUrl: string | null | undefined,
  cacheKey: string,
  fallback = "#7C3AED"
): Promise<string> {
  if (!imageUrl) return fallback;

  await ensureCacheLoaded();

  if (_mem[cacheKey]) return _mem[cacheKey];

  try {
    const result = await ImageColors.getColors(imageUrl, {
      fallback,
      cache: true,
      key: cacheKey,
      quality: "low",       // faster extraction
      pixelSpacing: 5,      // Android: sample every 5th pixel
    });

    let color = fallback;
    if (result.platform === "android") {
      // Prefer dominant → vibrant → muted
      color =
        result.dominant ??
        result.vibrant ??
        result.darkVibrant ??
        result.muted ??
        fallback;
    }

    _mem[cacheKey] = color;
    persistCache(); // fire-and-forget
    return color;
  } catch {
    return fallback;
  }
}

/**
 * Returns white (#fff) or black (#000) for readable text on the given bg hex.
 */
export function readableTextColor(hexBg: string): string {
  try {
    const hex = hexBg.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    // Relative luminance (WCAG)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 0.55 ? "#111111" : "#FFFFFF";
  } catch {
    return "#FFFFFF";
  }
}
