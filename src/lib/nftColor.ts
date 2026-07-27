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

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Returns a hex string of the dominant color for the given image URL.
 * Falls back to `fallback` if extraction fails or image has no URL.
 *
 * @param imageUrl  Remote URL of the NFT image
 * @param cacheKey  Unique key (inboxId or mint) to cache the result
 * @param fallback  Hex color to return if extraction fails
 * @param prefer    Which Palette API color to prefer:
 *                    - "dominant" (default) — most-frequent pixel color;
 *                      best for theme/aura where you want the overall hue.
 *                    - "vibrant" — POP color; the saturated identity hue
 *                      humans associate with the image. Best for borders
 *                      and bubble accents (matches what users perceive
 *                      as "their PFP color"). Falls back to dominant if
 *                      vibrant is unavailable.
 *                  Cache is keyed separately per preference so the two
 *                  modes don't collide.
 */
export async function getOrExtractNftColor(
  imageUrl: string | null | undefined,
  cacheKey: string,
  fallback = "#7C3AED",
  prefer: "dominant" | "vibrant" = "dominant"
): Promise<string> {
  if (!imageUrl) return fallback;

  await ensureCacheLoaded();

  // Cache key must track the image itself, not just the caller's identity
  // key (NFT mint / inboxId) — a custom-picked PFP image keeps the same
  // mint as whatever NFT was verified before it (setUserChosenNftImage()
  // carries `base?.mint` forward), so keying on mint/inboxId alone served
  // up the PREVIOUS image's color after switching to a new custom image.
  // Folding in a hash of the URL means a changed image always misses.
  const memKey = `${cacheKey}:${hashString(imageUrl)}${prefer === "vibrant" ? "::vibrant" : ""}`;
  if (_mem[memKey]) return _mem[memKey];

  try {
    const result = await ImageColors.getColors(imageUrl, {
      fallback,
      cache: true,
      key: memKey,
      quality: "low",       // faster extraction
      pixelSpacing: 5,      // Android: sample every 5th pixel
    });

    let color = fallback;
    if (result.platform === "android") {
      if (prefer === "vibrant") {
        // POP color first — better identity match than dominant which
        // often returns a shadow/background tone.
        color =
          result.vibrant ??
          result.lightVibrant ??
          result.darkVibrant ??
          result.dominant ??
          result.muted ??
          fallback;
      } else {
        color =
          result.dominant ??
          result.vibrant ??
          result.darkVibrant ??
          result.muted ??
          fallback;
      }
    }

    _mem[memKey] = color;
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
