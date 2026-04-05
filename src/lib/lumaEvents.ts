/**
 * Lu.ma Solana Events — fetches public events via Lu.ma API.
 *
 * Uses the public calendar API (no auth required) to fetch upcoming
 * Solana ecosystem events. Results cached in AsyncStorage with a 6-hour TTL.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_LUMA_CACHE = 'luma_events_v2'; // v2: switched to active calendars (superteam, breakpoint)
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
  { slug: 'superteam',    apiId: 'cal-cl57AMcV2gdbbau' }, // Superteam global (19+ Solana events)
  { slug: 'breakpoint',   apiId: 'evgrp-f8F1bDAHhBNDM1f' }, // Solana Breakpoint 2026
  { slug: 'solana',       apiId: 'cal-GNxoseumqYXHPf1' }, // Solana community (low activity)
  { slug: 'helius',       apiId: 'cal-IYTHSBW8WfaoNrM' }, // Helius events
  { slug: 'jupiter',      apiId: 'cal-lv75ZykIkdWEv14' }, // Jupiter events
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
 * Fetch events from solana.com/events (primary source — 80+ events).
 * Parses React Server Component flight data from the HTML.
 */
async function fetchSolanaComEvents(): Promise<LumaEvent[]> {
  try {
    const res = await fetch("https://solana.com/en/events", {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // RSC flight data is in self.__next_f.push chunks
    // Find the chunk containing "events":[{...}]
    const chunkRegex = /self\.__next_f\.push\(\[\d+,"(.*?)"\]\)/gs;
    let match: RegExpExecArray | null;
    const events: LumaEvent[] = [];

    while ((match = chunkRegex.exec(html)) !== null) {
      const raw = match[1];
      if (!raw.includes('"events":[{')) continue;

      // Unescape the RSC string
      let unesc: string;
      try { unesc = JSON.parse('"' + raw + '"'); } catch { continue; }

      // Extract individual event objects
      const evtRegex = /\{"key":"([^"]+)","title":"([^"]*)","description":"([^"]*)","platform":"([^"]*)","rsvp":"([^"]*)","schedule":\{"from":"([^"]*)","to":"([^"]*)","timezone":"([^"]*)"\},"img":\{[^}]*\},"venue":\{"city":([^,]*),"region":([^,]*),"city_state":([^,]*),"country":([^,]*),"address":([^}]*)\}\}/g;
      let evtMatch: RegExpExecArray | null;
      while ((evtMatch = evtRegex.exec(unesc)) !== null) {
        const city = evtMatch[9]?.replace(/^"|"$/g, '') || '';
        const country = evtMatch[12]?.replace(/^"|"$/g, '') || '';
        const loc = city && city !== 'null'
          ? `${city}${country && country !== 'null' ? ', ' + country : ''}`
          : 'Online';

        events.push({
          id: `solcom-${evtMatch[1]}`,
          name: evtMatch[2],
          startAt: evtMatch[6],
          endAt: evtMatch[7] || undefined,
          location: loc,
          url: evtMatch[5] || `https://solana.com/events`,
          source: 'luma' as const, // compatible type
        });
      }
    }

    // Filter to future events only
    const now = Date.now() - 7 * 24 * 3600000;
    return events.filter(e => new Date(e.startAt).getTime() > now);
  } catch (err) {
    console.warn("[SolanaEvents] Failed to fetch solana.com events:", err);
    return [];
  }
}

/**
 * Fetch all Solana ecosystem events from solana.com + Lu.ma calendars.
 * Uses a 6-hour cache to avoid hammering the sites.
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

  // Fetch from all sources in parallel
  const allEvents: LumaEvent[] = [];
  const seen = new Set<string>();

  const results = await Promise.allSettled([
    fetchSolanaComEvents(),
    ...CALENDARS.map(cal => fetchCalendarEvents(cal)),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const evt of result.value) {
        // Dedup by name+date (solana.com and Lu.ma may list same event)
        const dedupKey = `${evt.name.toLowerCase().trim()}|${evt.startAt.slice(0, 10)}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
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
