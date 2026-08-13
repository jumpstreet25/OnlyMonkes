/**
 * App Settings Slice — loading, errors, notifications, group admin, calendar, badges
 *
 * Logical slice of the main appStore. Use in new code for narrow subscriptions.
 */
import { useAppStore, type CalendarEvent, type JoinRequest } from './appStore';

// ── State ────────────────────────────────────────────────────────────────────

export interface AppSettingsState {
  isLoading: boolean;
  error: string | null;
  notificationsEnabled: boolean;
  mentionsOnly: boolean;
  botNotificationsEnabled: boolean;
  dmNotificationsEnabled: boolean;
  liveRoomNotificationsEnabled: boolean;
  mutedBotChannels: { trades: boolean };
  mutedSports: string[];
  isGroupMember: boolean;
  isGroupAdmin: boolean;
  joinRequests: JoinRequest[];
  remoteGroupId: string;
  botChannelIds: { trades: string };
  botChannelCounts: { trades: number };
  calendarEvents: CalendarEvent[];
  expoPushToken: string | null;
  communityBadges: { dms: number; events: number; links: number };
  dmUnreadCounts: Record<string, number>;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface AppSettingsActions {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setMentionsOnly: (mentionsOnly: boolean) => void;
  setBotNotificationsEnabled: (enabled: boolean) => void;
  setDmNotificationsEnabled: (enabled: boolean) => void;
  setLiveRoomNotificationsEnabled: (enabled: boolean) => void;
  toggleBotChannelMute: (channel: 'trades') => void;
  toggleSportMute: (sport: string) => void;
  setIsGroupMember: (isMember: boolean) => void;
  setIsGroupAdmin: (isAdmin: boolean) => void;
  setJoinRequests: (requests: JoinRequest[]) => void;
  addJoinRequest: (req: JoinRequest) => void;
  removeJoinRequest: (inboxId: string) => void;
  setRemoteGroupId: (id: string) => void;
  setBotChannelIds: (ids: { trades: string }) => void;
  setBotChannelCounts: (counts: { trades: number }) => void;
  clearBotChannelCount: (channel: 'trades') => void;
  incrementBotChannelCount: (channel: 'trades') => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  addCalendarEvent: (event: CalendarEvent) => void;
  setExpoPushToken: (token: string | null) => void;
  setCommunityBadge: (key: 'dms' | 'events' | 'links', count: number) => void;
  incrementCommunityBadge: (key: 'dms' | 'events' | 'links') => void;
  clearCommunityBadge: (key: 'dms' | 'events' | 'links') => void;
  setDmUnreadCounts: (counts: Record<string, number>) => void;
  incrementDmUnread: (peerInboxId: string) => void;
  clearDmUnread: (peerInboxId: string) => void;
}

// ── Focused hook ─────────────────────────────────────────────────────────────

/** Narrowly-scoped hook — only subscribes to app-settings-related state. */
export function useAppSettingsStore<T>(selector: (s: AppSettingsState & AppSettingsActions) => T): T {
  return useAppStore((state) => selector(state as unknown as AppSettingsState & AppSettingsActions));
}

/** Non-React access. */
useAppSettingsStore.getState = (): AppSettingsState & AppSettingsActions => {
  return useAppStore.getState() as unknown as AppSettingsState & AppSettingsActions;
};
