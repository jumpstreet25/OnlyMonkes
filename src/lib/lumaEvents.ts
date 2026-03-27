/**
 * Lu.ma Solana Events — fetches public events from lu.ma calendar pages.
 *
 * Since the Lu.ma API requires a paid Luma Plus subscription, we scrape
 * public calendar listing pages to get upcoming Solana ecosystem events.
 * Results are cached in AsyncStorage with a 6-hour TTL.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_LUMA_CACHE = 'luma_events_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface LumaEvent {
  id: string;
  name: string;
  startAt: string;       // ISO 8601
  endAt?: string;        // ISO 8601
  location: string;
  lat?: number;
  lng?: number;
  coverUrl?: string;
  url: string;
  source: 'luma';
}

interface CachedLumaData {
  events: LumaEvent[];
  fetchedAt: number;
}

// Lu.ma calendar slugs for Solana ecosystem
const CALENDAR_SLUGS = [
  'solana',
  'solanamobile',
  'solflare',
  'sagamonkes',
];

// Undocumented Lu.ma public endpoint for calendar event listings
const LUMA_DISCOVER_URL = 'https://api.lu.ma/url';

/**
 * Fetch events from a single Lu.ma calendar page.
 * Uses the public page URL to extract event data from the __NEXT_DATA__ script tag.
 */
async function fetchCalendarEvents(slug: string): Promise<LumaEvent[]> {
  try {
    const res = await fetch(`https://luma.com/${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' },
    });
    if (!res.ok) return [];

    const html = await res.text();

    // Extract __NEXT_DATA__ JSON from the page
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match?.[1]) return [];

    const nextData = JSON.parse(match[1]);
    const pageProps = nextData?.props?.pageProps;
    if (!pageProps) return [];

    // Calendar pages have initialData.events or featured_items
    const rawEvents: any[] =
      pageProps?.initialData?.paginatedEvents?.data ??
      pageProps?.initialData?.events ??
      pageProps?.featured_items ??
      [];

    return rawEvents
      .filter((e: any) => e?.event || e?.name)
      .map((entry: any) => {
        const evt = entry.event ?? entry;
        return {
          id: evt.api_id ?? evt.id ?? `luma-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: evt.name ?? 'Solana Event',
          startAt: evt.start_at ?? evt.startAt ?? new Date().toISOString(),
          endAt: evt.end_at ?? evt.endAt,
          location: evt.geo_address_info?.city
            ? `${evt.geo_address_info.city}${evt.geo_address_info.country ? ', ' + evt.geo_address_info.country : ''}`
            : evt.location ?? evt.geo_address_json?.address ?? 'TBD',
          lat: evt.geo_latitude ?? evt.geo_address_info?.latitude,
          lng: evt.geo_longitude ?? evt.geo_address_info?.longitude,
          coverUrl: evt.cover_url ?? evt.coverUrl,
          url: evt.url ? `https://luma.com/${evt.url}` : `https://luma.com/${slug}`,
          source: 'luma' as const,
        };
      })
      .filter((e) => {
        // Only include future events (or events from the past week)
        const start = new Date(e.startAt).getTime();
        return start > Date.now() - 7 * 24 * 60 * 60 * 1000;
      });
  } catch (err) {
    console.warn(`[LumaEvents] Failed to fetch calendar "${slug}":`, err);
    return [];
  }
}

/**
 * Fetch all Solana ecosystem events from Lu.ma.
 * Uses a 6-hour cache to avoid hammering the site.
 */
export async function fetchSolanaEvents(): Promise<LumaEvent[]> {
  // Check cache first
  try {
    const raw = await AsyncStorage.getItem(AK_LUMA_CACHE);
    if (raw) {
      const cached: CachedLumaData = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.events;
      }
    }
  } catch { /* ignore */ }

  // Fetch from all calendars in parallel
  const allEvents: LumaEvent[] = [];
  const seen = new Set<string>();

  const results = await Promise.allSettled(
    CALENDAR_SLUGS.map(slug => fetchCalendarEvents(slug))
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const evt of result.value) {
        if (!seen.has(evt.id)) {
          seen.add(evt.id);
          allEvents.push(evt);
        }
      }
    }
  }

  // Sort by start date
  allEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  // Cache results
  try {
    const cacheData: CachedLumaData = { events: allEvents, fetchedAt: Date.now() };
    await AsyncStorage.setItem(AK_LUMA_CACHE, JSON.stringify(cacheData));
  } catch { /* ignore */ }

  return allEvents;
}

/** Force refresh the cache. */
export async function refreshSolanaEvents(): Promise<LumaEvent[]> {
  try { await AsyncStorage.removeItem(AK_LUMA_CACHE); } catch { /* ignore */ }
  return fetchSolanaEvents();
}
