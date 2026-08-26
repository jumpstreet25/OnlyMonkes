/**
 * communitySync.ts — feeds real location/event/RSVP data from the app into
 * the public MonkeGlobe/MonkeEvents web site (github.com/jumpstreet25/monke-globe),
 * via the worker's /api/community/* endpoints (worker-actions/src/community.ts).
 *
 * This is a one-way, best-effort mirror: app → public worker. It never reads
 * from these endpoints back into the app, and a sync failure here must never
 * block or roll back the underlying in-app action (saving a location,
 * creating an event, RSVPing) — those already succeeded via their existing
 * XMTP/local-storage paths before this ever runs. Every export here swallows
 * its own errors internally for exactly that reason.
 *
 * Auth: same wallet-signature + on-chain-Saga-Monke scheme the web site's
 * own writes use (see monke-globe's lib/communityApi.ts) — the message
 * shape signed here MUST exactly match what community.ts's
 * verifyCommunityAuth reconstructs: `OnlyMonkes Community\n${action}\n${wallet}\n${ts}`.
 * Only ever called from an explicit user action (saving your location,
 * posting an event, tapping RSVP) — never from a background/automatic
 * profile resync — because it triggers a real MWA signing prompt each time.
 */
import { signBytesWithMwa } from "@/hooks/useMobileWallet";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { geocodeLocation } from "./geocode";
import { useAppStore } from "@/store/appStore";
import type { CalendarEvent } from "@/store/appStore";

const ACTIONS_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";

async function signAuth(action: string, wallet: string): Promise<{ ts: number; signature: string }> {
  const ts = Date.now();
  const message = new TextEncoder().encode(`OnlyMonkes Community\n${action}\n${wallet}\n${ts}`);
  const sigBytes = await signBytesWithMwa(wallet, message);
  const signature = Buffer.from(sigBytes).toString("base64");
  return { ts, signature };
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetchWithTimeout(`${ACTIONS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 15000,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? `Community sync failed (${res.status})`);
  }
}

/**
 * Call after a user explicitly saves a non-empty location (UsernameModal).
 * The app only ever stores a free-text place name — geocode it here since
 * the public backend needs coordinates to plot a globe marker.
 */
export async function syncLocationToCommunity(locationText: string): Promise<void> {
  try {
    const { wallet, username, verifiedNft } = useAppStore.getState();
    if (!wallet?.address || !locationText.trim()) return;

    const geo = await geocodeLocation(locationText.trim());
    if (!geo) return; // couldn't resolve to coordinates — silently skip, don't block the in-app save

    const { ts, signature } = await signAuth("set-location", wallet.address);
    await postJson("/api/community/location", {
      wallet: wallet.address,
      ts,
      signature,
      lat: geo.lat,
      lng: geo.lng,
      label: geo.displayName ?? locationText.trim(),
      username: username ?? undefined,
      nftImage: verifiedNft?.image ?? undefined,
    });
  } catch (err) {
    if (__DEV__) console.warn("[communitySync] location sync failed (non-fatal):", err);
  }
}

/**
 * Call after a user explicitly creates an event (CalendarModal), right
 * alongside the existing XMTP broadcastEvent() call. Passes the app's own
 * CalendarEvent.id through as the backend's event id (worker honors it if
 * unclaimed — see community.ts's handleCreateEvent) so a later RSVP from
 * either the app or the web site targets the same record.
 */
export async function syncEventToCommunity(event: CalendarEvent): Promise<void> {
  try {
    const { wallet } = useAppStore.getState();
    if (!wallet?.address || !event.location.trim()) return;

    const geo = await geocodeLocation(event.location.trim());
    if (!geo) return;

    const startTime = parseEventDateTime(event.date, event.time);
    if (!Number.isFinite(startTime)) return;

    const { ts, signature } = await signAuth("create-event", wallet.address);
    await postJson("/api/community/events", {
      id: event.id,
      wallet: wallet.address,
      ts,
      signature,
      title: event.title,
      description: event.purpose,
      lat: geo.lat,
      lng: geo.lng,
      label: geo.displayName ?? event.location.trim(),
      startTime,
      username: event.creatorUsername ?? undefined,
    });
  } catch (err) {
    if (__DEV__) console.warn("[communitySync] event sync failed (non-fatal):", err);
  }
}

/** Call after a user taps Going/Not Going in EventRsvpModal. eventId must be a CalendarEvent.id that was also passed to syncEventToCommunity. */
export async function syncRsvpToCommunity(eventId: string, going: boolean): Promise<void> {
  try {
    const { wallet, username } = useAppStore.getState();
    if (!wallet?.address) return;

    const { ts, signature } = await signAuth(`rsvp:${eventId}`, wallet.address);
    await postJson(`/api/community/events/${encodeURIComponent(eventId)}/rsvp`, {
      wallet: wallet.address,
      ts,
      signature,
      going,
      username: username ?? undefined,
    });
  } catch (err) {
    if (__DEV__) console.warn("[communitySync] RSVP sync failed (non-fatal):", err);
  }
}

/** "MM/DD/YYYY" + "HH:MM" (both free-text, per CalendarModal) → epoch ms, or NaN if unparseable. */
function parseEventDateTime(date: string, time: string): number {
  const dateMatch = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return NaN;
  const [, mm, dd, yyyy] = dateMatch;
  const timeMatch = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  const hh = timeMatch ? parseInt(timeMatch[1], 10) : 0;
  const min = timeMatch ? parseInt(timeMatch[2], 10) : 0;
  const d = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10), hh, min);
  return d.getTime();
}
