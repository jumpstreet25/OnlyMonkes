/**
 * Lu.ma Solana Events — fetches public events via Lu.ma API.
 *
 * Uses the public calendar API (no auth required) to fetch upcoming
 * Solana ecosystem events. Results cached in AsyncStorage with a 6-hour TTL.
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

// Lu.ma calendar API IDs for Solana ecosystem calendars
// Found via: curl "https://api.lu.ma/url?url=<slug>" → data.calendar.api_id
const CALENDARS = [
  { slug: 'solana',       apiId: 'cal-GNxoseumqYXHPf1' },
  { slug: 'solanamobile', apiId: '' }, // will resolve on first use
  { slug: 'solflare',     apiId: '' },
  { slug: 'sagamonkes',   apiId: '' },
];

/** Resolve a calendar slug to its API ID. */
async function resolveCalendarId(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.lu.ma/url?url=${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.calendar?.api_id ?? null;
  } catch {
    return null;
  }
}

/** Fetch events from a single Lu.ma calendar via API. */
async function fetchCalendarEvents(calendar: typeof CALENDARS[0]): Promise<LumaEvent[]> {
  try {
    let apiId = calendar.apiId;
    if (!apiId) {
      apiId = await resolveCalendarId(calendar.slug) ?? '';
      if (!apiId) return [];
      calendar.apiId = apiId; // cache for next call
    }

    const res = await fetch(
      `https://api.lu.ma/calendar/get-items?calendar_api_id=${apiId}&pagination_limit=20`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const entries: any[] = data?.entries ?? [];

    return entries
      .filter((e: any) => e?.event)
      .map((entry: any) => {
        const evt = entry.event;
        const geo = evt.geo_address_json ?? evt.geo_address_info ?? {};
        return {
          id: evt.api_id ?? entry.api_id ?? `luma-${Date.now()}`,
          name: evt.name ?? 'Solana Event',
          startAt: evt.start_at ?? new Date().toISOString(),
          endAt: evt.end_at,
          location: geo.full_address ?? geo.city
            ? `${geo.city ?? ''}${geo.country ? ', ' + geo.country : ''}`
            : evt.location ?? 'TBD',
          lat: evt.coordinate?.latitude ?? evt.geo_latitude,
          lng: evt.coordinate?.longitude ?? evt.geo_longitude,
          coverUrl: evt.cover_url,
          url: evt.url ? (evt.url.startsWith('http') ? evt.url : `https://lu.ma/${evt.url}`) : `https://lu.ma/${calendar.slug}`,
          source: 'luma' as const,
        };
      })
      .filter((e) => {
        // Only include future events (or events from the past week for the globe)
        const start = new Date(e.startAt).getTime();
        return start > Date.now() - 7 * 24 * 60 * 60 * 1000;
      });
  } catch (err) {
    console.warn(`[LumaEvents] Failed to fetch calendar "${calendar.slug}":`, err);
    return [];
  }
}

/**
 * Fetch all Solana ecosystem events from Lu.ma.
 * Uses a 6-hour cache to avoid hammering the API.
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
    CALENDARS.map(cal => fetchCalendarEvents(cal))
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
