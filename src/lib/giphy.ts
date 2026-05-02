/**
 * giphy.ts
 *
 * GIPHY REST API helpers (no native SDK, no rebuild needed).
 * Uses the v1 REST API with a public API key.
 */

import { GIPHY_API_KEY } from '@/lib/constants';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
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

// Last-call status — exposed so picker UIs can display the actual failure
// mode inline when the result is empty. Previous "silent return []" version
// gave no diagnostic without ADB; the on-device debug overlay reads this.
let _lastStatus: string = "idle";
export function getGiphyLastStatus(): string {
  return _lastStatus;
}
function setStatus(s: string): void {
  _lastStatus = s;
  console.warn(`[giphy] ${s}`);
}

/**
 * Centralized fetch + parse with real error surfacing. The previous version
 * silently swallowed non-OK responses (401 from missing API key, 429 from
 * rate limiting, etc.) by returning [], which manifested as empty pickers
 * with no diagnostic.
 */
async function fetchGiphy(label: string, url: string): Promise<GiphyItem[]> {
  if (!API_KEY) {
    setStatus(`${label}: API key MISSING in bundle`);
    return [];
  }
  try {
    // Use fetchWithTimeout — Hermes' bundled AbortSignal polyfill lacks the
    // static .timeout() helper, so calling it throws "undefined is not a
    // function" and silently kills every Giphy fetch.
    const res = await fetchWithTimeout(url, { timeoutMs: GIPHY_TIMEOUT_MS });
    if (!res.ok) {
      setStatus(`${label}: HTTP ${res.status} ${res.statusText || ""}`);
      return [];
    }
    const json = await res.json();
    const rawCount = json.data?.length ?? 0;
    const items = parseItems(json.data ?? []);
    if (items.length === 0 && rawCount > 0) {
      setStatus(`${label}: ${rawCount} raw → 0 after parseItems (Giphy schema change?)`);
    } else if (items.length === 0) {
      setStatus(`${label}: 0 results from Giphy`);
    } else {
      setStatus(`${label}: ${items.length} ok (key=${API_KEY.length}c)`);
    }
    return items;
  } catch (err) {
    setStatus(`${label}: fetch threw — ${(err as Error)?.message ?? "unknown"}`);
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
