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

function firstUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return "";
}

function parseItems(data: any[]): GiphyItem[] {
  return data
    .map((gif: any) => {
      const imgs = gif?.images ?? {};
      return {
        id: gif.id as string,
        previewUrl: firstUrl(
          imgs.fixed_width_still?.url,
          imgs.fixed_width_small_still?.url,
          imgs.original_still?.url,
          imgs.preview_gif?.url,
        ),
        displayUrl: firstUrl(
          imgs.downsized?.url,
          imgs.fixed_width?.url,
          imgs.original?.url,
          imgs.preview_gif?.url,
        ),
      };
    })
    .filter((g) => g.id && g.previewUrl && g.displayUrl);
}

const SAGA_GIPHY_USER = "sagamonkes";

function giphyUrl(kind: "gifs" | "stickers", path: "search" | "trending", extra: Record<string, string>): string {
  const params = new URLSearchParams({
    api_key: API_KEY,
    rating: "g",
    ...extra,
  });
  return `${BASE_URL}/${kind}/${path}?${params.toString()}`;
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
  const q = query.trim() || "monke";
  const extra: Record<string, string> = { q, limit: String(limit) };
  if (/saga\s*monke/i.test(q) || q.toLowerCase() === "sagamonkes") {
    extra.username = SAGA_GIPHY_USER;
    extra.q = extra.q.replace(/saga\s*monkes?/i, "monke").trim() || "monke";
  }
  return fetchGiphy(`searchGifs(${query})`, giphyUrl("gifs", "search", extra));
}

export async function trendingGifs(limit = 20): Promise<GiphyItem[]> {
  return fetchGiphy("trendingGifs", giphyUrl("gifs", "trending", { limit: String(limit) }));
}

export async function searchStickers(query: string, limit = 18): Promise<GiphyItem[]> {
  const q = query.trim() || "monke";
  const extra: Record<string, string> = { q, limit: String(limit) };
  // Official pack lives on Giphy user `sagamonkes`. A plain q=SagaMonkes
  // search mixed in unrelated results and returned empty when the channel
  // pack was the only thing the UI wanted.
  if (/saga\s*monke/i.test(q) || q.toLowerCase() === "sagamonkes") {
    extra.username = SAGA_GIPHY_USER;
    extra.q = "monke";
  }
  let items = await fetchGiphy(`searchStickers(${query})`, giphyUrl("stickers", "search", extra));
  if (items.length === 0 && extra.username) {
    items = await fetchGiphy(
      `searchStickers(${query})-nouser`,
      giphyUrl("stickers", "search", { q, limit: String(limit) }),
    );
  }
  return items;
}
