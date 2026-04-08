/**
 * Geocoding via Nominatim (OpenStreetMap) — free, no API key.
 * Results are cached in AsyncStorage to respect the 1 req/s rate limit.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithTimeout } from './fetchWithTimeout';

const AK_GEO_CACHE = 'geocode_cache_v1';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export interface GeoCoords {
  lat: number;
  lng: number;
  displayName: string;
}

let _cache: Record<string, GeoCoords> = {};
let _loaded = false;
let _lastRequest = 0;

async function ensureCache(): Promise<void> {
  if (_loaded) return;
  try {
    const raw = await AsyncStorage.getItem(AK_GEO_CACHE);
    if (raw) _cache = JSON.parse(raw);
  } catch { /* ignore */ }
  _loaded = true;
}

async function persistCache(): Promise<void> {
  try {
    await AsyncStorage.setItem(AK_GEO_CACHE, JSON.stringify(_cache));
  } catch { /* ignore */ }
}

/**
 * Convert a location string (e.g. "Miami", "Tokyo, Japan") to lat/lng.
 * Returns cached result if available. Respects Nominatim 1 req/s limit.
 */
export async function geocodeLocation(location: string): Promise<GeoCoords | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;

  await ensureCache();
  if (_cache[key]) return _cache[key];

  // Rate limit: 1 request per second
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - _lastRequest));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastRequest = Date.now();

  try {
    const params = new URLSearchParams({
      q: location.trim(),
      format: 'jsonv2',
      limit: '1',
    });
    const res = await fetchWithTimeout(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'OnlyMonkes/2.36' },
      timeoutMs: 5000,
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const result: GeoCoords = {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name ?? location.trim(),
    };

    _cache[key] = result;
    persistCache();
    return result;
  } catch (err) {
    console.warn('[Geocode] Failed:', err);
    return null;
  }
}

/** Batch geocode multiple locations (sequential, respects rate limit). */
export async function geocodeBatch(locations: string[]): Promise<Map<string, GeoCoords>> {
  const results = new Map<string, GeoCoords>();
  for (const loc of locations) {
    const coords = await geocodeLocation(loc);
    if (coords) results.set(loc, coords);
  }
  return results;
}

/** Get all cached geocode results (for instant globe rendering). */
export async function getCachedGeodata(): Promise<Record<string, GeoCoords>> {
  await ensureCache();
  return { ..._cache };
}
