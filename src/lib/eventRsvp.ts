/**
 * eventRsvp.ts — Event RSVP tracking.
 *
 * Stores which events each user is attending.
 * RSVPs are broadcast via XMTP as RSVP:<eventId>:<going|not_going>:<inboxId>
 * and persisted locally in AsyncStorage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_RSVPS = "om_event_rsvps_v1";

/** Map of eventId → Set of inboxIds who are going. */
let _rsvps = new Map<string, Set<string>>();
let _loaded = false;

export async function loadRsvps(): Promise<void> {
  if (_loaded) return;
  try {
    const raw = await AsyncStorage.getItem(AK_RSVPS);
    if (raw) {
      const data: Record<string, string[]> = JSON.parse(raw);
      for (const [eventId, ids] of Object.entries(data)) {
        _rsvps.set(eventId, new Set(ids));
      }
    }
  } catch { /* ignore */ }
  _loaded = true;
}

async function save() {
  try {
    const data: Record<string, string[]> = {};
    for (const [eventId, ids] of _rsvps) {
      data[eventId] = [...ids];
    }
    await AsyncStorage.setItem(AK_RSVPS, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Mark a user as going to an event. */
export async function rsvpGoing(eventId: string, inboxId: string): Promise<void> {
  await loadRsvps();
  if (!_rsvps.has(eventId)) _rsvps.set(eventId, new Set());
  _rsvps.get(eventId)!.add(inboxId);
  await save();
}

/** Mark a user as not going to an event. */
export async function rsvpNotGoing(eventId: string, inboxId: string): Promise<void> {
  await loadRsvps();
  _rsvps.get(eventId)?.delete(inboxId);
  await save();
}

/** Check if a user is going to an event. */
export function isGoing(eventId: string, inboxId: string): boolean {
  return _rsvps.get(eventId)?.has(inboxId) ?? false;
}

/** Get number of attendees for an event. */
export function getAttendeeCount(eventId: string): number {
  return _rsvps.get(eventId)?.size ?? 0;
}

/** Get all attendee inboxIds for an event. */
export function getAttendees(eventId: string): string[] {
  return [...(_rsvps.get(eventId) ?? [])];
}

/** Process an RSVP message from XMTP stream. */
export async function processRsvpMessage(content: string): Promise<void> {
  if (!content.startsWith("RSVP:")) return;
  const parts = content.split(":");
  if (parts.length < 4) return;
  const eventId = parts[1];
  const status = parts[2]; // "going" or "not_going"
  const inboxId = parts[3];
  if (!eventId || !inboxId) return;

  await loadRsvps();
  if (status === "going") {
    if (!_rsvps.has(eventId)) _rsvps.set(eventId, new Set());
    _rsvps.get(eventId)!.add(inboxId);
  } else {
    _rsvps.get(eventId)?.delete(inboxId);
  }
  await save();
}

/** Build an RSVP message for XMTP broadcast. */
export function buildRsvpMessage(eventId: string, going: boolean, inboxId: string): string {
  return `RSVP:${eventId}:${going ? "going" : "not_going"}:${inboxId}`;
}
