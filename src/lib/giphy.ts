/**
 * giphy.ts
 *
 * GIPHY REST API helpers (no native SDK, no rebuild needed).
 * Uses the v1 REST API with a public API key.
 */

import { GIPHY_API_KEY } from '@/lib/constants';
const API_KEY: string = GIPHY_API_KEY;
const BASE_URL = "https://api.giphy.com/v1";

export interface GiphyItem {
  id: string;
  /** Static thumbnail — used in picker grid */
  previewUrl: string;
  /** Smaller animated GIF — used in chat bubble */
  displayUrl: string;
}

function parseItems(data: any[]): GiphyItem[] {
  return data
    .map((gif: any) => ({
      id: gif.id as string,
      previewUrl: (gif.images?.fixed_width_still?.url ?? "") as string,
      displayUrl: (gif.images?.downsized?.url ?? "") as string,
    }))
    .filter((g) => g.previewUrl && g.displayUrl);
}

const GIPHY_TIMEOUT_MS = 8_000;

/**
 * Centralized fetch + parse with real error surfacing. The previous version
 * silently swallowed non-OK responses (401 from missing API key, 429 from
 * rate limiting, etc.) by returning [], which manifested as empty pickers
 * with no diagnostic. Now logs once per failure mode so the cause shows
 * up in dev/Sentry without requiring a debugger.
 */
async function fetchGiphy(label: string, url: string): Promise<GiphyItem[]> {
  if (!API_KEY) {
    console.warn(`[giphy:${label}] GIPHY_API_KEY is empty in this build — picker will be blank. Check react-native-dotenv .env loading + Constants.expoConfig.extra.giphyApiKey.`);
    return [];
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(GIPHY_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[giphy:${label}] HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    const json = await res.json();
    const items = parseItems(json.data ?? []);
    if (items.length === 0 && (json.data?.length ?? 0) > 0) {
      console.warn(`[giphy:${label}] Got ${json.data.length} results but parseItems filtered all out (response shape change?)`);
    }
    return items;
  } catch (err) {
    console.warn(`[giphy:${label}] Fetch failed:`, (err as Error)?.message);
    return [];
  }
}

export async function searchGifs(query: string, limit = 20): Promise<GiphyItem[]> {
  return fetchGiphy(
    `searchGifs(${query})`,
    `${BASE_URL}/gifs/search?api_key=${API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`,
  );
}

export async function trendingGifs(limit = 20): Promise<GiphyItem[]> {
  return fetchGiphy(
    `trendingGifs`,
    `${BASE_URL}/gifs/trending?api_key=${API_KEY}&limit=${limit}&rating=g`,
  );
}

export async function searchStickers(query: string, limit = 18): Promise<GiphyItem[]> {
  return fetchGiphy(
    `searchStickers(${query})`,
    `${BASE_URL}/stickers/search?api_key=${API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`,
  );
}
