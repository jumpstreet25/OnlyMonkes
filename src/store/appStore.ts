/**
 * appStore.ts — Combined Zustand store (single source of truth)
 *
 * Organized into 4 logical slices:
 *   1. User Auth     — wallet, verification, XMTP client, MWA token
 *   2. User Profile  — display name, bio, theme, shop styles, streaks, bananas
 *   3. App Settings  — loading, errors, notifications, group admin, calendar, badges
 *   4. Live Features — live rooms, video calls, avatar rooms, NFT swaps
 *
 * For narrowly-scoped selectors in new code, import from the slice files:
 *   import { useUserAuthStore } from '@/store/userAuthStore';
 *   import { useUserProfileStore } from '@/store/userProfileStore';
 *   import { useAppSettingsStore } from '@/store/appSettingsStore';
 *   import { useLiveFeaturesStore } from '@/store/liveFeaturesStore';
 *
 * Existing code that imports `useAppStore` continues to work unchanged.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { WalletAccount, OwnedNFT } from '../types';
import type { LiveRoomData } from '../lib/livekit';
import type { VideoRoomData } from '../lib/liveVideo';
import type { AvatarRoomData } from '../lib/avatarRoom';
import type { BananaBetOpenData } from '../lib/bananaBet';
import type { NftSwapMessage } from '../lib/marketplace';

const AK_MUTED_SPORTS = 'om_muted_sports';
const AK_MUTED_CHANNELS = 'om_muted_channels';
const AK_MUTED_ALERT_SOURCES = 'om_muted_alert_sources';
const AK_NOTIF_PREFS = 'om_notif_prefs';
const SK_MWA_TOKEN = 'om_mwa_auth_token';

// Note (2026-05-01): the previous _botChannelCleared session-flag was removed
// — it was over-aggressive. The flag was set true on user clear and only
// released on a live-stream incrementBotChannelCount(). Android suspends the
// XMTP WebSocket in background; if the stream died and a new alert arrived
// while the user was away, the recompute on foreground would correctly count
// it but the flag forced the count back to 0, permanently hiding badges
// until cold launch. Trust lastRead (persisted to AsyncStorage) as the
// single source of truth — clearBotChannelCount now awaits the setItem so
// recompute can't race against stale data.

// ── Shared types (re-exported for slice files + consumers) ───────────────────

export interface LiveRoomState extends LiveRoomData {
  participantCount: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;      // "MM/DD/YYYY"
  time: string;      // "HH:MM"
  location: string;
  purpose: string;
  creatorInboxId: string;
  creatorUsername?: string;
}

export interface JoinRequest {
  inboxId: string;
  username?: string;
  nftMint?: string;
  requestedAt: Date;
}

// ══════════════════════════════════════════════════════════════════════════════
// SLICE 1: User Auth
// ══════════════════════════════════════════════════════════════════════════════

interface UserAuthState {
  wallet: WalletAccount | null;
  verified: boolean;
  verifiedNft: OwnedNFT | null;
  isGuest: boolean;
  allNfts: OwnedNFT[];
  xmtpClient: unknown;
  myInboxId: string | null;
  mwaAuthToken: string | null;
}

interface UserAuthActions {
  setWallet: (wallet: WalletAccount | null) => void;
  setVerified: (verified: boolean, nft?: OwnedNFT | null) => void;
  setIsGuest: (isGuest: boolean) => void;
  setAllNfts: (nfts: OwnedNFT[]) => void;
  setXmtpClient: (client: unknown) => void;
  setMyInboxId: (inboxId: string | null) => void;
  setMwaAuthToken: (token: string | null) => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// SLICE 2: User Profile
// ══════════════════════════════════════════════════════════════════════════════

interface UserProfileState {
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
  location: string | null;
  themeId: string;
  customBubbleColor: string | null;
  shopStyles: Record<string, string | number | boolean>;
  nftDominantColor: string | null;
  themeOverrides: Partial<typeof import('@/lib/constants').THEME> | null;
  textScale: number;
  loginStreak: number;
  bestStreak: number;
  isLegendary: boolean;
  bananaBalance: number;
}

interface UserProfileActions {
  setUsername: (username: string) => void;
  setBio: (bio: string) => void;
  setXAccount: (xAccount: string) => void;
  setTipWallet: (tipWallet: string) => void;
  setLocation: (location: string) => void;
  setThemeId: (id: string) => void;
  setCustomBubbleColor: (color: string | null) => void;
  setShopStyles: (styles: Record<string, string | number | boolean>) => void;
  setNftDominantColor: (color: string | null) => void;
  setThemeOverrides: (overrides: Partial<typeof import('@/lib/constants').THEME> | null) => void;
  setTextScale: (scale: number) => void;
  setLoginStreak: (streak: number, best: number, legendary: boolean) => void;
  setBananaBalance: (balance: number) => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// SLICE 3: App Settings
// ══════════════════════════════════════════════════════════════════════════════

interface AppSettingsState {
  isLoading: boolean;
  error: string | null;
  notificationsEnabled: boolean;
  mentionsOnly: boolean;
  botNotificationsEnabled: boolean;
  dmNotificationsEnabled: boolean;
  liveRoomNotificationsEnabled: boolean;
  mutedBotChannels: { bets: boolean; trades: boolean; sales: boolean; predictions: boolean };
  mutedSports: string[];
  /** Alert sources hidden from MonkeBets/MonkePredictions. Values: 'polymarket' | 'drift'. */
  mutedAlertSources: string[];
  isGroupMember: boolean;
  isGroupAdmin: boolean;
  joinRequests: JoinRequest[];
  remoteGroupId: string;
  botChannelIds: { bets: string; trades: string; sales: string; predictions: string };
  botChannelCounts: { bets: number; trades: number; sales: number; predictions: number };
  calendarEvents: CalendarEvent[];
  expoPushToken: string | null;
  communityBadges: { dms: number; events: number; links: number };
  dmUnreadCounts: Record<string, number>;
}

interface AppSettingsActions {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setMentionsOnly: (mentionsOnly: boolean) => void;
  setBotNotificationsEnabled: (enabled: boolean) => void;
  setDmNotificationsEnabled: (enabled: boolean) => void;
  setLiveRoomNotificationsEnabled: (enabled: boolean) => void;
  toggleBotChannelMute: (channel: 'bets' | 'trades' | 'sales' | 'predictions') => void;
  toggleSportMute: (sport: string) => void;
  toggleAlertSourceMute: (source: string) => void;
  setIsGroupMember: (isMember: boolean) => void;
  setIsGroupAdmin: (isAdmin: boolean) => void;
  setJoinRequests: (requests: JoinRequest[]) => void;
  addJoinRequest: (req: JoinRequest) => void;
  removeJoinRequest: (inboxId: string) => void;
  setRemoteGroupId: (id: string) => void;
  setBotChannelIds: (ids: { bets: string; trades: string; sales: string; predictions: string }) => void;
  setBotChannelCounts: (counts: { bets: number; trades: number; sales: number; predictions: number }) => void;
  clearBotChannelCount: (channel: 'bets' | 'trades' | 'sales' | 'predictions') => void;
  incrementBotChannelCount: (channel: 'bets' | 'trades' | 'sales' | 'predictions') => void;
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

// ══════════════════════════════════════════════════════════════════════════════
// SLICE 4: Live Features
// ══════════════════════════════════════════════════════════════════════════════

interface LiveFeaturesState {
  activeLiveRoom: LiveRoomState | null;
  isInLiveRoom: boolean;
  liveRoomMuted: boolean;
  liveRoomToken: string | null;
  activeVideoRoom: VideoRoomData | null;
  isInVideoCall: boolean;
  activeAvatarRoom: AvatarRoomData | null;
  isInAvatarRoom: boolean;
  avatarRoomToken: string | null;
  pendingNftSwap: NftSwapMessage | null;
  activeBananaBet: BananaBetOpenData | null;
}

interface LiveFeaturesActions {
  setActiveLiveRoom: (room: LiveRoomState | null) => void;
  updateLiveRoomCount: (count: number) => void;
  setIsInLiveRoom: (val: boolean) => void;
  setLiveRoomMuted: (val: boolean) => void;
  setLiveRoomToken: (token: string | null) => void;
  setActiveVideoRoom: (room: VideoRoomData | null) => void;
  setIsInVideoCall: (val: boolean) => void;
  setActiveAvatarRoom: (room: AvatarRoomData | null) => void;
  setIsInAvatarRoom: (val: boolean) => void;
  setAvatarRoomToken: (token: string | null) => void;
  setPendingNftSwap: (swap: NftSwapMessage | null) => void;
  setActiveBananaBet: (bet: BananaBetOpenData | null) => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// Combined type + reset action
// ══════════════════════════════════════════════════════════════════════════════

type AppState = UserAuthState & UserProfileState & AppSettingsState & LiveFeaturesState;
type AppActions = UserAuthActions & UserProfileActions & AppSettingsActions & LiveFeaturesActions & {
  reset: () => void;
};

// ── Initial state ────────────────────────────────────────────────────────────

const initialState: AppState = {
  // Slice 1: User Auth
  wallet: null,
  verified: false,
  verifiedNft: null,
  isGuest: false,
  allNfts: [],
  xmtpClient: null,
  myInboxId: null,
  mwaAuthToken: null,

  // Slice 2: User Profile
  username: null,
  bio: null,
  xAccount: null,
  tipWallet: null,
  location: null,
  themeId: 'default',
  customBubbleColor: null,
  shopStyles: {},
  nftDominantColor: null,
  themeOverrides: null,
  textScale: 1.0,
  loginStreak: 0,
  bestStreak: 0,
  isLegendary: false,
  bananaBalance: 0,

  // Slice 3: App Settings
  isLoading: false,
  error: null,
  notificationsEnabled: true,
  mentionsOnly: false,
  botNotificationsEnabled: true,
  dmNotificationsEnabled: true,
  liveRoomNotificationsEnabled: true,
  mutedBotChannels: { bets: false, trades: false, sales: false, predictions: false },
  mutedSports: [],
  // Drift Prediction Markets UI (bet.drift.trade) is currently under
  // construction. Alerts still fire from the on-chain program but the link
  // would land users on a stay-tuned page, so we mute by default. Users can
  // unmute via the Source: Drift pill on Predictions/Bets channels. Bot's
  // driftUptimeMonitor will announce in-channel when the UI returns.
  mutedAlertSources: ['drift'],
  isGroupMember: false,
  isGroupAdmin: false,
  joinRequests: [],
  remoteGroupId: '',
  botChannelIds: { bets: '', trades: '', sales: '', predictions: '' },
  botChannelCounts: { bets: 0, trades: 0, sales: 0, predictions: 0 },
  calendarEvents: [],
  expoPushToken: null,
  communityBadges: { dms: 0, events: 0, links: 0 },
  dmUnreadCounts: {},

  // Slice 4: Live Features
  activeLiveRoom: null,
  isInLiveRoom: false,
  liveRoomMuted: false,
  liveRoomToken: null,
  activeVideoRoom: null,
  isInVideoCall: false,
  activeAvatarRoom: null,
  isInAvatarRoom: false,
  avatarRoomToken: null,
  pendingNftSwap: null,
  activeBananaBet: null,
};

// ══════════════════════════════════════════════════════════════════════════════
// Store
// ══════════════════════════════════════════════════════════════════════════════

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,

  // ── Slice 1: User Auth actions ─────────────────────────────────────────────

  setWallet: (wallet) => set({ wallet }),
  setVerified: (verified, nft) => set({ verified, verifiedNft: nft ?? null }),
  setIsGuest: (isGuest) => set({ isGuest }),
  setAllNfts: (allNfts) => set({ allNfts }),
  setXmtpClient: (client) => set({ xmtpClient: client }),
  setMyInboxId: (myInboxId) => set({ myInboxId }),
  setMwaAuthToken: (mwaAuthToken) => {
    set({ mwaAuthToken });
    if (mwaAuthToken) {
      void SecureStore.setItemAsync(SK_MWA_TOKEN, mwaAuthToken).catch(() => {});
    } else {
      void SecureStore.deleteItemAsync(SK_MWA_TOKEN).catch(() => {});
    }
  },

  // ── Slice 2: User Profile actions ──────────────────────────────────────────

  setUsername: (username) => set({ username }),
  setBio: (bio) => set({ bio }),
  setXAccount: (xAccount) => set({ xAccount }),
  setTipWallet: (tipWallet) => set({ tipWallet }),
  setLocation: (location) => set({ location }),
  setThemeId: (themeId) => set({ themeId }),
  setCustomBubbleColor: (customBubbleColor) => set({ customBubbleColor }),
  setShopStyles: (shopStyles) => set({ shopStyles }),
  setNftDominantColor: (nftDominantColor) => set({ nftDominantColor }),
  setThemeOverrides: (themeOverrides) => set({ themeOverrides }),
  setTextScale: (textScale: number) => {
    set({ textScale });
    AsyncStorage.setItem("om_text_scale", String(textScale)).catch(() => {});
  },
  setLoginStreak: (loginStreak, bestStreak, isLegendary) => set({ loginStreak, bestStreak, isLegendary }),
  setBananaBalance: (bananaBalance) => set({ bananaBalance }),

  // ── Slice 3: App Settings actions ──────────────────────────────────────────

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setNotificationsEnabled: (notificationsEnabled) => {
    set({ notificationsEnabled });
    _persistNotifPrefs();
  },
  setMentionsOnly: (mentionsOnly) => {
    set({ mentionsOnly });
    _persistNotifPrefs();
  },
  setBotNotificationsEnabled: (botNotificationsEnabled) => {
    set({ botNotificationsEnabled });
    _persistNotifPrefs();
  },
  setDmNotificationsEnabled: (dmNotificationsEnabled) => {
    set({ dmNotificationsEnabled });
    _persistNotifPrefs();
  },
  setLiveRoomNotificationsEnabled: (liveRoomNotificationsEnabled) => {
    set({ liveRoomNotificationsEnabled });
    _persistNotifPrefs();
  },
  toggleBotChannelMute: (channel) => {
    set((s) => {
      const next = { ...s.mutedBotChannels, [channel]: !s.mutedBotChannels[channel] };
      AsyncStorage.setItem(AK_MUTED_CHANNELS, JSON.stringify(next)).catch(() => {});
      return { mutedBotChannels: next };
    });
  },
  toggleSportMute: (sport) => {
    set((s) => {
      const next = s.mutedSports.includes(sport)
        ? s.mutedSports.filter(sp => sp !== sport)
        : [...s.mutedSports, sport];
      AsyncStorage.setItem(AK_MUTED_SPORTS, JSON.stringify(next)).catch(() => {});
      return { mutedSports: next };
    });
  },
  toggleAlertSourceMute: (source) => {
    set((s) => {
      const key = source.toLowerCase();
      const next = s.mutedAlertSources.includes(key)
        ? s.mutedAlertSources.filter((x) => x !== key)
        : [...s.mutedAlertSources, key];
      AsyncStorage.setItem(AK_MUTED_ALERT_SOURCES, JSON.stringify(next)).catch(() => {});
      return { mutedAlertSources: next };
    });
  },
  setIsGroupMember: (isGroupMember) => set({ isGroupMember }),
  setIsGroupAdmin: (isGroupAdmin) => set({ isGroupAdmin }),
  setJoinRequests: (joinRequests) => set({ joinRequests }),
  addJoinRequest: (req) => {
    const existing = get().joinRequests;
    if (existing.some((r) => r.inboxId === req.inboxId)) return;
    set({ joinRequests: [...existing, req] });
  },
  removeJoinRequest: (inboxId) =>
    set({ joinRequests: get().joinRequests.filter((r) => r.inboxId !== inboxId) }),
  setRemoteGroupId: (remoteGroupId) => set({ remoteGroupId }),
  setBotChannelIds: (botChannelIds) => set({ botChannelIds }),
  setBotChannelCounts: (botChannelCounts) => {
    // Authoritative recompute (driven by lastRead timestamps in syncMessages).
    // No session-flag filtering anymore — see comment block above on why the
    // old _botChannelCleared guard was removed.
    set({ botChannelCounts });
  },
  clearBotChannelCount: (channel) => {
    // Persist lastRead synchronously (await the setItem) so a concurrent
    // recompute cannot read a stale timestamp and resurrect the badge.
    // Set local count to 0 in the same microtask so the UI updates instantly.
    set((s) => ({
      botChannelCounts: { ...s.botChannelCounts, [channel]: 0 },
    }));
    void (async () => {
      try {
        await AsyncStorage.setItem(`msg_last_read_v1_${channel}`, String(Date.now()));
      } catch { /* non-critical — recompute will catch up next cycle */ }
    })();
  },
  incrementBotChannelCount: (channel) => {
    set((s) => ({
      botChannelCounts: { ...s.botChannelCounts, [channel]: s.botChannelCounts[channel] + 1 },
    }));
  },
  setCalendarEvents: (calendarEvents) => set({ calendarEvents }),
  addCalendarEvent: (event) => set((s) => ({ calendarEvents: [...s.calendarEvents, event] })),
  setExpoPushToken: (expoPushToken) => set({ expoPushToken }),
  setCommunityBadge: (key, count) => set((s) => ({
    communityBadges: { ...s.communityBadges, [key]: count },
  })),
  incrementCommunityBadge: (key) => set((s) => ({
    communityBadges: { ...s.communityBadges, [key]: s.communityBadges[key] + 1 },
  })),
  clearCommunityBadge: (key) => set((s) => ({
    communityBadges: { ...s.communityBadges, [key]: 0 },
  })),
  setDmUnreadCounts: (dmUnreadCounts) => set({ dmUnreadCounts }),
  incrementDmUnread: (peerInboxId) => set((s) => ({
    dmUnreadCounts: { ...s.dmUnreadCounts, [peerInboxId]: (s.dmUnreadCounts[peerInboxId] ?? 0) + 1 },
  })),
  clearDmUnread: (peerInboxId) => set((s) => {
    const next = { ...s.dmUnreadCounts };
    delete next[peerInboxId];
    return { dmUnreadCounts: next };
  }),

  // ── Slice 4: Live Features actions ─────────────────────────────────────────

  setActiveLiveRoom: (activeLiveRoom) => set({ activeLiveRoom }),
  updateLiveRoomCount: (count) =>
    set((s) => s.activeLiveRoom ? { activeLiveRoom: { ...s.activeLiveRoom, participantCount: count } } : {}),
  setIsInLiveRoom: (isInLiveRoom) => set({ isInLiveRoom }),
  setLiveRoomMuted: (liveRoomMuted) => set({ liveRoomMuted }),
  setLiveRoomToken: (liveRoomToken) => set({ liveRoomToken }),
  setActiveVideoRoom: (activeVideoRoom) => set({ activeVideoRoom }),
  setIsInVideoCall: (isInVideoCall) => set({ isInVideoCall }),
  setActiveAvatarRoom: (activeAvatarRoom) => set({ activeAvatarRoom }),
  setIsInAvatarRoom: (isInAvatarRoom) => set({ isInAvatarRoom }),
  setAvatarRoomToken: (avatarRoomToken) => set({ avatarRoomToken }),
  setPendingNftSwap: (pendingNftSwap) => set({ pendingNftSwap }),
  setActiveBananaBet: (activeBananaBet) => set({ activeBananaBet }),

  // ── Reset (all slices) ─────────────────────────────────────────────────────

  reset: () => {
    set(initialState);
    void SecureStore.deleteItemAsync(SK_MWA_TOKEN).catch(() => {});
    // Clear wallet-scoped storage context so the next connect starts fresh.
    // Lazy require avoids a circular import (walletIdentity → appStore).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { clearActiveWallet } = require('@/lib/walletIdentity');
      clearActiveWallet();
    } catch { /* non-critical */ }
  },
}));

// ══════════════════════════════════════════════════════════════════════════════
// Startup helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Load MWA auth token from SecureStore into Zustand (call on app startup). */
export async function loadMwaAuthToken(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(SK_MWA_TOKEN);
    if (token) useAppStore.getState().setMwaAuthToken(token);
  } catch { /* SecureStore unavailable */ }
}

// ── Persist notification prefs to AsyncStorage ──────────────────────────────

function _persistNotifPrefs() {
  const { notificationsEnabled, mentionsOnly, botNotificationsEnabled,
    dmNotificationsEnabled, liveRoomNotificationsEnabled } = useAppStore.getState();
  AsyncStorage.setItem(AK_NOTIF_PREFS, JSON.stringify({
    all: notificationsEnabled,
    mentions: mentionsOnly,
    bot: botNotificationsEnabled,
    dm: dmNotificationsEnabled,
    live: liveRoomNotificationsEnabled,
  })).catch(() => {});
}

/**
 * Load persisted notification prefs, muted sports, and muted channels from AsyncStorage.
 * Call once at app startup (e.g. in _layout.tsx or ChatScreen mount).
 */
export async function loadPersistedPrefs(): Promise<void> {
  try {
    const [sportsRaw, channelsRaw, notifRaw, sourcesRaw] = await Promise.all([
      AsyncStorage.getItem(AK_MUTED_SPORTS),
      AsyncStorage.getItem(AK_MUTED_CHANNELS),
      AsyncStorage.getItem(AK_NOTIF_PREFS),
      AsyncStorage.getItem(AK_MUTED_ALERT_SOURCES),
    ]);
    const state: Record<string, unknown> = {};
    if (sportsRaw) {
      const parsed = JSON.parse(sportsRaw);
      if (Array.isArray(parsed)) state.mutedSports = parsed;
    }
    if (channelsRaw) {
      const parsed = JSON.parse(channelsRaw);
      if (parsed && typeof parsed === 'object') state.mutedBotChannels = parsed;
    }
    if (sourcesRaw) {
      const parsed = JSON.parse(sourcesRaw);
      if (Array.isArray(parsed)) state.mutedAlertSources = parsed;
    }
    if (notifRaw) {
      const parsed = JSON.parse(notifRaw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.all === 'boolean') state.notificationsEnabled = parsed.all;
        if (typeof parsed.mentions === 'boolean') state.mentionsOnly = parsed.mentions;
        if (typeof parsed.bot === 'boolean') state.botNotificationsEnabled = parsed.bot;
        if (typeof parsed.dm === 'boolean') state.dmNotificationsEnabled = parsed.dm;
        if (typeof parsed.live === 'boolean') state.liveRoomNotificationsEnabled = parsed.live;
      }
    }
    // Load text scale
    const scaleRaw = await AsyncStorage.getItem("om_text_scale");
    if (scaleRaw) {
      const s = parseFloat(scaleRaw);
      if (s >= 0.85 && s <= 1.3) state.textScale = s;
    }

    if (Object.keys(state).length > 0) {
      useAppStore.setState(state);
    }
  } catch { /* non-critical */ }
}
