/**
 * giphy.ts
 *
 * GIPHY REST API helpers (no native SDK, no rebuild needed).
 * Uses the v1 REST API with a public API key.
 */

const API_KEY = "SbYTCZWCjGZAzCGfIzbUSYBoKBgHaHTI";
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

export async function searchGifs(query: string, limit = 20): Promise<GiphyItem[]> {
  const url = `${BASE_URL}/gifs/search?api_key=${API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  const json = await res.json();
  return parseItems(json.data ?? []);
}

export async function trendingGifs(limit = 20): Promise<GiphyItem[]> {
  const url = `${BASE_URL}/gifs/trending?api_key=${API_KEY}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  const json = await res.json();
  return parseItems(json.data ?? []);
}

export async function searchStickers(query: string, limit = 18): Promise<GiphyItem[]> {
  const url = `${BASE_URL}/stickers/search?api_key=${API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  const json = await res.json();
  return parseItems(json.data ?? []);
}
