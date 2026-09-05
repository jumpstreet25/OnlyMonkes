/**
 * community.ts — backend for the public MonkeGlobe/MonkeEvents web repo
 * (github.com/jumpstreet25/monke-globe). Separate concern from the
 * OnlyMonkes app's own gated in-app globe (GlobeScreen.tsx) — this is the
 * public-facing mirror: a forkable static site reads these endpoints
 * directly, no OnlyMonkes app or XMTP client involved.
 *
 * Data model (all in COMMUNITY_DATA KV):
 *   "locations:latest"      — single aggregate JSON array of every holder's
 *                              public pin (same "single cached blob" pattern
 *                              index.ts already uses for "stats:latest" —
 *                              cheap reads at this scale, ~6k holders max).
 *   "events:latest"         — aggregate array of event SUMMARIES (list view).
 *   "event:<id>"            — one event's full record.
 *   "rsvp:<eventId>:<wallet>" — one RSVP. Existence = going; deleted on cancel.
 *
 * Writes require BOTH a valid ed25519 signature over a fixed message shape
 * (proves the caller controls the wallet — see verifyCommunityAuth) AND a
 * real on-chain Saga Monke check (verifySagaOnChain) — this mirrors "Saga
 * Monke holders" the same way the app's own gate does, not just "anyone with
 * a Solana wallet." Reads are fully public/unauthenticated by design — the
 * user explicitly chose "show everyone automatically" (2026-08-26) over an
 * opt-in flow for locations.
 *
 * 2026-08-26: PHASE 1 shipped — the app's src/lib/communitySync.ts now calls
 * the write side (location save, event create, RSVP) from ChatModals,
 * CalendarModal, and EventRsvpModal.
 *
 * 2026-09-05: PHASE 2 — that only covers locations set AFTER communitySync.ts
 * shipped. Every user who set their in-app location earlier (via the old
 * XMTP PROFILE_UPDATE/LOCATION_SYNC path the bot already aggregates into
 * userLocations) never had a reason to re-save it, so the public site read
 * back empty despite the in-app globe showing everyone correctly. Added
 * handleBulkSetLocations — a trusted bot→worker push (Bearer BOT_HTTP_SECRET,
 * same gate as /escrow and /api/signals) that upserts many holders' pins at
 * once, geocoded bot-side. No per-wallet signature or on-chain re-check here:
 * the bot already only aggregates locations from verified Main Chat members
 * (Saga Monke gate already enforced at group-join time), so this trusts that
 * existing boundary rather than re-deriving it per pin.
 */
import type { Env } from "./index";
import { CORS_HEADERS, checkBotAuth } from "./index";
import { verifyEd25519, base58ToBytes } from "./cryptoVerify";
import { verifySagaOnChain } from "./onchainHolder";
import { PublicKey } from "@solana/web3.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

const AUTH_MAX_AGE_MS = 5 * 60 * 1000; // signed message must be this fresh

interface CommunityLocation {
  wallet: string;
  username: string | null;
  lat: number;
  lng: number;
  label: string;
  nftImage: string | null;
  updatedAt: number;
}

interface CommunityEventSummary {
  id: string;
  title: string;
  lat: number;
  lng: number;
  label: string;
  startTime: number;
  endTime: number | null;
  rsvpCount: number;
  createdBy: string; // username, never wallet
}

interface CommunityEvent extends CommunityEventSummary {
  description: string;
  createdByWallet: string;
  createdAt: number;
}

// ─── Auth: wallet must sign a fixed-shape message proving control, then be
// verified on-chain as a real Saga Monke holder. Both checks required. ──────
async function verifyCommunityAuth(
  action: string,
  wallet: string,
  ts: number,
  signatureB64: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Signature expired — try again" };
  }
  let pubkeyBytes: Uint8Array;
  try {
    new PublicKey(wallet);
    pubkeyBytes = base58ToBytes(wallet) ?? new Uint8Array();
    if (pubkeyBytes.length !== 32) throw new Error("bad key length");
  } catch {
    return { ok: false, error: "Invalid wallet address" };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, error: "Invalid signature encoding" };
  }

  const message = new TextEncoder().encode(`OnlyMonkes Community\n${action}\n${wallet}\n${ts}`);
  const sigOk = await verifyEd25519(pubkeyBytes, message, sigBytes);
  if (!sigOk) return { ok: false, error: "Signature verification failed" };

  const holder = await verifySagaOnChain(wallet);
  if (!holder.verified) {
    return { ok: false, error: holder.inconclusive ? "Couldn't verify Saga Monke ownership right now — try again shortly" : "No Saga Monke found in that wallet" };
  }
  return { ok: true };
}

// ─── GET /api/community/locations — public ──────────────────────────────────
export async function handleGetLocations(env: Env): Promise<Response> {
  const raw = await env.COMMUNITY_DATA.get("locations:latest");
  return jsonResponse({ locations: raw ? JSON.parse(raw) : [] });
}

// ─── POST /api/community/location — signed + holder-verified upsert ────────
export async function handleSetLocation(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const { wallet, lat, lng, label, username, nftImage, ts, signature } = body ?? {};
  if (!wallet || !signature || !ts) return errorResponse("Missing wallet/signature/ts");
  if (typeof lat !== "number" || typeof lng !== "number" || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return errorResponse("Invalid lat/lng");
  }
  if (!label || typeof label !== "string" || label.length > 120) return errorResponse("Invalid label");

  const auth = await verifyCommunityAuth("set-location", wallet, ts, signature);
  if (!auth.ok) return errorResponse(auth.error, 401);

  const raw = await env.COMMUNITY_DATA.get("locations:latest");
  const locations: CommunityLocation[] = raw ? JSON.parse(raw) : [];
  const next = locations.filter((l) => l.wallet !== wallet);
  next.push({
    wallet,
    username: typeof username === "string" ? username.slice(0, 40) : null,
    lat, lng,
    label: label.slice(0, 120),
    nftImage: typeof nftImage === "string" ? nftImage.slice(0, 500) : null,
    updatedAt: Date.now(),
  });
  await env.COMMUNITY_DATA.put("locations:latest", JSON.stringify(next));
  return jsonResponse({ ok: true });
}

// ─── POST /api/community/bulk-locations — trusted bot push, many at once ───
// See the 2026-09-05 doc note at the top of this file for why this exists
// alongside the per-user signed path above: this is for the bot backfilling/
// keeping in sync every Main Chat member's location, not a single user
// acting on their own behalf.
export async function handleBulkSetLocations(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) return errorResponse("Unauthorized", 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const incoming = body?.locations;
  if (!Array.isArray(incoming)) return errorResponse("Missing locations array");

  const raw = await env.COMMUNITY_DATA.get("locations:latest");
  const existing: CommunityLocation[] = raw ? JSON.parse(raw) : [];
  const byWallet = new Map(existing.map((l) => [l.wallet, l]));

  let accepted = 0;
  for (const entry of incoming) {
    const { wallet, lat, lng, label, username, nftImage } = entry ?? {};
    if (typeof wallet !== "string" || !wallet) continue;
    if (typeof lat !== "number" || typeof lng !== "number" || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (typeof label !== "string" || !label || label.length > 120) continue;
    byWallet.set(wallet, {
      wallet,
      username: typeof username === "string" ? username.slice(0, 40) : null,
      lat, lng,
      label: label.slice(0, 120),
      nftImage: typeof nftImage === "string" ? nftImage.slice(0, 500) : null,
      updatedAt: Date.now(),
    });
    accepted++;
  }

  await env.COMMUNITY_DATA.put("locations:latest", JSON.stringify(Array.from(byWallet.values())));
  return jsonResponse({ ok: true, accepted, total: byWallet.size });
}

// ─── GET /api/community/events — public list ────────────────────────────────
export async function handleGetEvents(env: Env): Promise<Response> {
  const raw = await env.COMMUNITY_DATA.get("events:latest");
  const events: CommunityEventSummary[] = raw ? JSON.parse(raw) : [];
  // Soonest-first; drop anything more than 1 day past its end/start so the
  // public list doesn't accumulate stale events forever.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const upcoming = events
    .filter((e) => (e.endTime ?? e.startTime) > cutoff)
    .sort((a, b) => a.startTime - b.startTime);
  return jsonResponse({ events: upcoming });
}

// ─── GET /api/community/events/:id — public detail ──────────────────────────
export async function handleGetEvent(id: string, env: Env): Promise<Response> {
  const raw = await env.COMMUNITY_DATA.get(`event:${id}`);
  if (!raw) return errorResponse("Event not found", 404);
  return jsonResponse({ event: JSON.parse(raw) as CommunityEvent });
}

// ─── POST /api/community/events — signed + holder-verified create ──────────
export async function handleCreateEvent(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const { wallet, title, description, lat, lng, label, startTime, endTime, username, ts, signature, id: clientId } = body ?? {};
  if (!wallet || !signature || !ts) return errorResponse("Missing wallet/signature/ts");
  if (!title || typeof title !== "string" || title.length > 120) return errorResponse("Invalid title");
  if (typeof lat !== "number" || typeof lng !== "number" || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return errorResponse("Invalid lat/lng");
  }
  if (!Number.isFinite(startTime)) return errorResponse("Invalid startTime");

  const auth = await verifyCommunityAuth("create-event", wallet, ts, signature);
  if (!auth.ok) return errorResponse(auth.error, 401);

  // The OnlyMonkes app already generates its own event id (evt-<ts>-<rand>)
  // when a user creates an event in-app — accepting it here (instead of
  // always minting a fresh crypto.randomUUID()) keeps the app's local
  // CalendarEvent.id and this backend's event:<id> the same record, so a
  // later RSVP from either the app or the web site targets the same event
  // without needing a separate id-mapping table. Guard against hijacking an
  // existing event by only honoring a client id that isn't already taken.
  let id: string = crypto.randomUUID();
  if (typeof clientId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(clientId)) {
    const existing = await env.COMMUNITY_DATA.get(`event:${clientId}`);
    if (!existing) id = clientId;
  }
  const createdByName = typeof username === "string" ? username.slice(0, 40) : wallet.slice(0, 8);
  const event: CommunityEvent = {
    id,
    title: title.slice(0, 120),
    description: typeof description === "string" ? description.slice(0, 2000) : "",
    lat, lng,
    label: typeof label === "string" ? label.slice(0, 120) : "",
    startTime,
    endTime: Number.isFinite(endTime) ? endTime : null,
    rsvpCount: 0,
    createdBy: createdByName,
    createdByWallet: wallet,
    createdAt: Date.now(),
  };
  await env.COMMUNITY_DATA.put(`event:${id}`, JSON.stringify(event));

  const rawList = await env.COMMUNITY_DATA.get("events:latest");
  const list: CommunityEventSummary[] = rawList ? JSON.parse(rawList) : [];
  const { description: _d, createdByWallet: _w, createdAt: _c, ...summary } = event;
  list.push(summary);
  await env.COMMUNITY_DATA.put("events:latest", JSON.stringify(list));

  return jsonResponse({ id });
}

// ─── POST /api/community/bulk-events — trusted bot backfill, many at once ──
// Same rationale as handleBulkSetLocations above: the bot scans Main Chat
// history for old EVENT: broadcasts nothing centrally aggregated before
// communitySync.ts shipped, and backfills them here. Idempotent — skips any
// id that already exists (e.g. already created live via the signed path
// above) rather than overwriting it, so it's safe to re-run.
export async function handleBulkCreateEvents(request: Request, env: Env): Promise<Response> {
  if (!checkBotAuth(request, env)) return errorResponse("Unauthorized", 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const incoming = body?.events;
  if (!Array.isArray(incoming)) return errorResponse("Missing events array");

  const rawList = await env.COMMUNITY_DATA.get("events:latest");
  const list: CommunityEventSummary[] = rawList ? JSON.parse(rawList) : [];
  const byId = new Map(list.map((e) => [e.id, e]));

  let created = 0;
  for (const entry of incoming) {
    const { id, title, description, lat, lng, label, startTime, endTime, createdBy, createdByWallet } = entry ?? {};
    if (typeof id !== "string" || !id) continue;
    if (typeof title !== "string" || !title || title.length > 120) continue;
    if (typeof lat !== "number" || typeof lng !== "number" || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (!Number.isFinite(startTime)) continue;
    if (await env.COMMUNITY_DATA.get(`event:${id}`)) continue; // never overwrite a real record

    const event: CommunityEvent = {
      id,
      title: title.slice(0, 120),
      description: typeof description === "string" ? description.slice(0, 2000) : "",
      lat, lng,
      label: typeof label === "string" ? label.slice(0, 120) : "",
      startTime,
      endTime: Number.isFinite(endTime) ? endTime : null,
      rsvpCount: 0,
      createdBy: typeof createdBy === "string" && createdBy ? createdBy.slice(0, 40) : "Monke",
      createdByWallet: typeof createdByWallet === "string" ? createdByWallet : "",
      createdAt: Date.now(),
    };
    await env.COMMUNITY_DATA.put(`event:${id}`, JSON.stringify(event));
    const { description: _d, createdByWallet: _w, createdAt: _c, ...summary } = event;
    byId.set(id, summary);
    created++;
  }

  await env.COMMUNITY_DATA.put("events:latest", JSON.stringify(Array.from(byId.values())));
  return jsonResponse({ ok: true, created, total: byId.size });
}

// ─── POST /api/community/events/:id/rsvp — signed + holder-verified ────────
export async function handleRsvp(id: string, request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body"); }
  const { wallet, going, username, ts, signature } = body ?? {};
  if (!wallet || !signature || !ts) return errorResponse("Missing wallet/signature/ts");
  if (typeof going !== "boolean") return errorResponse("Missing going (boolean)");

  const eventRaw = await env.COMMUNITY_DATA.get(`event:${id}`);
  if (!eventRaw) return errorResponse("Event not found", 404);

  const auth = await verifyCommunityAuth(`rsvp:${id}`, wallet, ts, signature);
  if (!auth.ok) return errorResponse(auth.error, 401);

  const rsvpKey = `rsvp:${id}:${wallet}`;
  const hadRsvp = !!(await env.COMMUNITY_DATA.get(rsvpKey));
  if (going && !hadRsvp) {
    await env.COMMUNITY_DATA.put(rsvpKey, JSON.stringify({
      wallet, username: typeof username === "string" ? username.slice(0, 40) : wallet.slice(0, 8), ts: Date.now(),
    }));
  } else if (!going && hadRsvp) {
    await env.COMMUNITY_DATA.delete(rsvpKey);
  }

  if (going !== hadRsvp) {
    const event: CommunityEvent = JSON.parse(eventRaw);
    event.rsvpCount = Math.max(0, event.rsvpCount + (going ? 1 : -1));
    await env.COMMUNITY_DATA.put(`event:${id}`, JSON.stringify(event));

    const rawList = await env.COMMUNITY_DATA.get("events:latest");
    if (rawList) {
      const list: CommunityEventSummary[] = JSON.parse(rawList);
      const idx = list.findIndex((e) => e.id === id);
      if (idx !== -1) {
        list[idx].rsvpCount = event.rsvpCount;
        await env.COMMUNITY_DATA.put("events:latest", JSON.stringify(list));
      }
    }
  }

  return jsonResponse({ ok: true, going });
}

// ─── GET /api/community/events/:id/rsvp-status?wallet= — is THIS wallet going? ──
// Separate from handleGetRsvps (which only ever returns usernames, never
// wallets, to the public) — the caller already knows their own wallet, so
// there's no exposure here, just a yes/no for their own RSVP state.
export async function handleGetRsvpStatus(id: string, wallet: string, env: Env): Promise<Response> {
  try {
    new PublicKey(wallet);
  } catch {
    return errorResponse("Invalid wallet address");
  }
  const raw = await env.COMMUNITY_DATA.get(`rsvp:${id}:${wallet}`);
  return jsonResponse({ going: !!raw });
}

// ─── GET /api/community/events/:id/rsvps — public attendee list (usernames only) ──
export async function handleGetRsvps(id: string, env: Env): Promise<Response> {
  const list = await env.COMMUNITY_DATA.list({ prefix: `rsvp:${id}:` });
  const attendees = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.COMMUNITY_DATA.get(k.name);
      if (!raw) return null;
      const { username } = JSON.parse(raw) as { username: string };
      return username;
    }),
  );
  return jsonResponse({ attendees: attendees.filter((a): a is string => !!a) });
}
