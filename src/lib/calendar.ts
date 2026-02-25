import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CalendarEvent } from "@/store/appStore";

const AK_EVENTS = "om_calendar_events";

export async function loadEvents(): Promise<CalendarEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(AK_EVENTS);
    if (!raw) return [];
    return JSON.parse(raw) as CalendarEvent[];
  } catch {
    return [];
  }
}

export async function saveEvent(event: CalendarEvent): Promise<void> {
  const events = await loadEvents();
  const existing = events.findIndex((e) => e.id === event.id);
  if (existing >= 0) {
    events[existing] = event;
  } else {
    events.push(event);
  }
  await AsyncStorage.setItem(AK_EVENTS, JSON.stringify(events));
}

export async function deleteEvent(id: string): Promise<void> {
  const events = await loadEvents();
  const filtered = events.filter((e) => e.id !== id);
  await AsyncStorage.setItem(AK_EVENTS, JSON.stringify(filtered));
}

export function parseEventMessage(content: string): CalendarEvent | null {
  if (!content.startsWith("EVENT:")) return null;
  try {
    return JSON.parse(content.slice("EVENT:".length)) as CalendarEvent;
  } catch {
    return null;
  }
}

export function buildEventMessage(event: CalendarEvent): string {
  return `EVENT:${JSON.stringify(event)}`;
}
