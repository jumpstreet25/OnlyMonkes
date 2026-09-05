/**
 * lumaEvents.ts — server-side proxy for the same Solana-ecosystem events the
 * app's src/lib/lumaEvents.ts fetches (Lu.ma public calendar API + a
 * solana.com/events scrape + a hardcoded fallback list).
 *
 * Exists because the public MonkeGlobe site is a static export running in
 * the browser — api.lu.ma and solana.com don't send CORS headers, so a
 * direct browser fetch is silently blocked (confirmed: neither sends
 * Access-Control-Allow-Origin). The app never hit this because React
 * Native's fetch isn't CORS-restricted. A Worker has no such restriction —
 * fetch here, cache in COMMUNITY_DATA KV, serve to the browser with the
 * worker's own permissive CORS headers.
 *
 * Kept logic-identical to the app's version (same calendar IDs, same
 * solana.com RSC-flight-data scrape, same hardcoded fallback) so both
 * surfaces show the same events — see that file if this ever needs
 * updating, and update both together.
 */
import type { Env } from "./index";
import { CORS_HEADERS } from "./index";

const CACHE_KEY = "luma-events:latest";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — matches the app's AsyncStorage TTL

export interface LumaEvent {
  id: string;
  name: string;
  startAt: string;
  endAt?: string;
  location: string;
  lat?: number;
  lng?: number;
  coverUrl?: string;
  url: string;
  source: "luma";
}

interface CachedLumaData {
  events: LumaEvent[];
  fetchedAt: number;
}

const CALENDARS = [
  { slug: "superteam", apiId: "cal-cl57AMcV2gdbbau" },
  { slug: "breakpoint", apiId: "evgrp-f8F1bDAHhBNDM1f" },
  { slug: "solana", apiId: "cal-GNxoseumqYXHPf1" },
  { slug: "helius", apiId: "cal-IYTHSBW8WfaoNrM" },
  { slug: "jupiter", apiId: "cal-lv75ZykIkdWEv14" },
];

async function fetchCalendarEvents(calendar: { slug: string; apiId: string }): Promise<LumaEvent[]> {
  try {
    const res = await fetch(
      `https://api.lu.ma/calendar/get-items?calendar_api_id=${calendar.apiId}&pagination_limit=20`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const entries: any[] = data?.entries ?? [];
    return entries
      .filter((e) => e?.event)
      .map((entry): LumaEvent => {
        const evt = entry.event;
        const geo = evt.geo_address_json ?? evt.geo_address_info ?? {};
        return {
          id: evt.api_id ?? entry.api_id ?? `luma-${Date.now()}`,
          name: evt.name ?? "Solana Event",
          startAt: evt.start_at ?? new Date().toISOString(),
          endAt: evt.end_at,
          location: geo.full_address ?? (geo.city ? `${geo.city}${geo.country ? ", " + geo.country : ""}` : (evt.location ?? "TBD")),
          lat: evt.coordinate?.latitude ?? evt.geo_latitude,
          lng: evt.coordinate?.longitude ?? evt.geo_longitude,
          coverUrl: evt.cover_url,
          url: evt.url ? (evt.url.startsWith("http") ? evt.url : `https://lu.ma/${evt.url}`) : `https://lu.ma/${calendar.slug}`,
          source: "luma",
        };
      })
      .filter((e) => new Date(e.startAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000);
  } catch {
    return [];
  }
}

async function fetchSolanaComEvents(): Promise<LumaEvent[]> {
  try {
    const res = await fetch("https://solana.com/events", {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const events: LumaEvent[] = [];
    const CITY_COORDS: Record<string, [number, number]> = {
      "miami": [25.7617, -80.1918], "miami beach": [25.7907, -80.1300],
      "new york": [40.7128, -74.0060], "san francisco": [37.7749, -122.4194],
      "los angeles": [34.0522, -118.2437], "austin": [30.2672, -97.7431],
      "denver": [39.7392, -104.9903], "chicago": [41.8781, -87.6298],
      "seattle": [47.6062, -122.3321], "boston": [42.3601, -71.0589],
      "washington": [38.9072, -77.0369], "atlanta": [33.7490, -84.3880],
      "nashville": [36.1627, -86.7816], "dallas": [32.7767, -96.7970],
      "london": [51.5074, -0.1278], "paris": [48.8566, 2.3522],
      "berlin": [52.5200, 13.4050], "amsterdam": [52.3676, 4.9041],
      "lisbon": [38.7223, -9.1393], "barcelona": [41.3874, 2.1686],
      "dubai": [25.2048, 55.2708], "singapore": [1.3521, 103.8198],
      "hong kong": [22.3193, 114.1694], "tokyo": [35.6762, 139.6503],
      "seoul": [37.5665, 126.9780], "bangkok": [13.7563, 100.5018],
      "mumbai": [19.0760, 72.8777], "bangalore": [12.9716, 77.5946],
      "buenos aires": [-34.6037, -58.3816], "são paulo": [-23.5505, -46.6333],
      "mexico city": [19.4326, -99.1332], "bogota": [4.7110, -74.0721],
      "lagos": [6.5244, 3.3792], "nairobi": [-1.2921, 36.8219],
      "cape town": [-33.9249, 18.4241], "istanbul": [41.0082, 28.9784],
      "zurich": [47.3769, 8.5417], "taipei": [25.0330, 121.5654],
      "hanoi": [21.0285, 105.8542], "ho chi minh city": [10.8231, 106.6297],
      "kuala lumpur": [3.1390, 101.6869], "jakarta": [-6.2088, 106.8456],
      "manila": [14.5995, 120.9842], "sydney": [-33.8688, 151.2093],
      "melbourne": [-37.8136, 144.9631], "toronto": [43.6532, -79.3832],
      "vancouver": [49.2827, -123.1207], "dublin": [53.3498, -6.2603],
    };
    function lookupCoords(city: string | null): [number, number] | null {
      if (!city) return null;
      const key = city.trim().toLowerCase();
      if (CITY_COORDS[key]) return CITY_COORDS[key];
      for (const [k, v] of Object.entries(CITY_COORDS)) {
        if (key.includes(k) || k.includes(key)) return v;
      }
      return null;
    }

    const keyPattern = /\\"key\\":\\"([^\\]+)\\"/g;
    let keyMatch: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((keyMatch = keyPattern.exec(html)) !== null) {
      const key = keyMatch[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const start = html.lastIndexOf("{", keyMatch.index);
      if (start === -1) continue;
      let depth = 0;
      let end = start;
      for (let i = start; i < Math.min(start + 3000, html.length); i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end <= start) continue;
      const unesc = html.slice(start, end + 1).replace(/\\"/g, '"');
      try {
        const obj = JSON.parse(unesc);
        if (!obj.key || !obj.title) continue;
        const city = obj.venue?.city;
        const country = obj.venue?.country;
        const loc = city && city !== null ? `${city}${country && country !== null ? ", " + country : ""}` : "Online";
        const coords = lookupCoords(city);
        events.push({
          id: `solcom-${obj.key}`,
          name: obj.title,
          startAt: obj.schedule?.from ?? obj.from ?? "",
          endAt: obj.schedule?.to ?? obj.to ?? undefined,
          location: loc,
          lat: coords?.[0],
          lng: coords?.[1],
          url: obj.rsvp || `https://solana.com/events/${obj.key}`,
          source: "luma",
        });
      } catch { /* skip unparseable block */ }
    }

    const now = Date.now() - 7 * 24 * 3600000;
    return events.filter((e) => e.startAt && new Date(e.startAt).getTime() > now);
  } catch {
    return [];
  }
}

function getHardcodedEvents(): LumaEvent[] {
  const now = Date.now();
  return ([
    { id: "solcom-accelerate-miami", name: "Solana Accelerate", startAt: "2026-05-19T09:00:00.000Z", endAt: "2026-05-21T18:00:00.000Z", location: "Miami Beach, United States", lat: 25.7907, lng: -80.1300, url: "https://lu.ma/accelerate-miami", source: "luma" },
    { id: "solcom-hacker-house-nyc", name: "Solana Hacker House NYC", startAt: "2026-06-10T10:00:00.000Z", endAt: "2026-06-12T18:00:00.000Z", location: "New York, United States", lat: 40.7128, lng: -74.0060, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-superteam-london", name: "Superteam London Meetup", startAt: "2026-04-22T18:00:00.000Z", location: "London, United Kingdom", lat: 51.5074, lng: -0.1278, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-solana-singapore", name: "Solana Singapore", startAt: "2026-05-05T09:00:00.000Z", endAt: "2026-05-06T18:00:00.000Z", location: "Singapore", lat: 1.3521, lng: 103.8198, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-superteam-berlin", name: "Superteam Berlin", startAt: "2026-04-28T18:00:00.000Z", location: "Berlin, Germany", lat: 52.5200, lng: 13.4050, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-solana-dubai", name: "Solana Dubai Meetup", startAt: "2026-04-15T17:00:00.000Z", location: "Dubai, UAE", lat: 25.2048, lng: 55.2708, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-monke-dao-sf", name: "MonkeDAO SF Hangout", startAt: "2026-04-20T19:00:00.000Z", location: "San Francisco, United States", lat: 37.7749, lng: -122.4194, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-solana-tokyo", name: "Solana Tokyo Community", startAt: "2026-05-12T18:00:00.000Z", location: "Tokyo, Japan", lat: 35.6762, lng: 139.6503, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-depin-austin", name: "DePIN Day Austin", startAt: "2026-04-25T10:00:00.000Z", location: "Austin, United States", lat: 30.2672, lng: -97.7431, url: "https://solana.com/events", source: "luma" },
    { id: "solcom-solana-seoul", name: "Solana Seoul Meetup", startAt: "2026-05-08T18:00:00.000Z", location: "Seoul, South Korea", lat: 37.5665, lng: 126.9780, url: "https://solana.com/events", source: "luma" },
  ] as LumaEvent[]).filter((e) => new Date(e.endAt ?? e.startAt).getTime() > now - 7 * 86400000);
}

async function fetchFreshLumaEvents(): Promise<LumaEvent[]> {
  const allEvents: LumaEvent[] = [];
  const seen = new Set<string>();
  const results = await Promise.allSettled([
    fetchSolanaComEvents(),
    ...CALENDARS.map((cal) => fetchCalendarEvents(cal)),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const evt of result.value) {
        const dedupKey = `${evt.name.toLowerCase().trim()}|${evt.startAt.slice(0, 10)}`;
        if (!seen.has(dedupKey)) { seen.add(dedupKey); allEvents.push(evt); }
      }
    }
  }
  for (const evt of getHardcodedEvents()) {
    const dedupKey = `${evt.name.toLowerCase().trim()}|${evt.startAt.slice(0, 10)}`;
    if (!seen.has(dedupKey)) { seen.add(dedupKey); allEvents.push(evt); }
  }
  allEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return allEvents;
}

// ─── GET /api/community/luma-events — public, KV-cached 6h ──────────────────
export async function handleGetLumaEvents(env: Env): Promise<Response> {
  try {
    const raw = await env.COMMUNITY_DATA.get(CACHE_KEY);
    if (raw) {
      const cached: CachedLumaData = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.events.length > 0) {
        return new Response(JSON.stringify({ events: cached.events }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }
  } catch { /* fall through to fresh fetch */ }

  const events = await fetchFreshLumaEvents();
  const finalEvents = events.length > 0 ? events : getHardcodedEvents();
  try {
    await env.COMMUNITY_DATA.put(CACHE_KEY, JSON.stringify({ events: finalEvents, fetchedAt: Date.now() } satisfies CachedLumaData));
  } catch { /* non-fatal — serve fresh even if caching fails */ }

  return new Response(JSON.stringify({ events: finalEvents }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
