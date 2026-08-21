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
import type { BananaBetOpenData, BananaBetSettledData, MyBetRecord } from '../lib/bananaBet';
import type { PollOpenData, PollResultData } from '../lib/poll';

/** Settlement popup state, enriched client-side with this device's own bet
 *  (if any) so the popup + its Share-to-X caption can be personalized —
 *  see getMyBet() in bananaBet.ts for why this is derived locally rather
 *  than sent over the wire (the group broadcast is intentionally anonymous). */
export type BananaBetResultDisplay = BananaBetSettledData & { myBet: MyBetRecord | null };
/** Same reasoning as BananaBetResultDisplay — enriched client-side with this device's own vote. */
export type PollResultDisplay = PollResultData & { myVote: string | null };
import type { NftSwapMessage } from '../lib/marketplace';

const AK_MUTED_SPORTS = 'om_muted_sports';
const AK_HIDDEN_BANANA_BETS = 'om_hidden_banana_bets';
const AK_MUTED_CHANNELS = 'om_muted_channels';
const AK_MUTED_ALERT_SOURCES = 'om_muted_alert_sources';
const AK_NOTIF_PREFS = 'om_notif_prefs';
const SK_MWA_TOKEN = 'om_mwa_auth_token';
const AK_SENTIMENT_OPT_IN = 'om_sentiment_oracle_opt_in';
const AK_COPY_TRADE_SLOTS = 'om_copy_trade_slots';

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
  walletAddress?: string;
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
  /** Timestamp of the last entitlement re-check (any outcome, not just success) — see
   *  useEntitlementSync.ts. Was one-shot-at-login before Data Oracle Phase 1; now re-run
   *  periodically so entitlement is live derived state, not a stored permanent grant. */
  verifiedAt: number | null;
  /** Holds a Saga Genesis Token or Seeker Genesis Token — Genesis Chat tier. A wallet
   *  can be both `verified` (Saga Monke) AND `isGenesisHolder` — see genesis-chat plan. */
  isGenesisHolder: boolean;
  genesisTokenKind: "saga" | "seeker" | null;
  verifiedGenesisAt: number | null;
  /** Genesis Chat's XMTP group ID, from remote config — mirrors how the Trades bot
   *  channel's group ID lives in botChannelIds, but Genesis is its own group, not a
   *  bot channel (Genesis holders must never be auto-joined to Main Chat/Trades). */
  genesisGroupId: string | null;
}

interface UserAuthActions {
  setWallet: (wallet: WalletAccount | null) => void;
  setVerified: (verified: boolean, nft?: OwnedNFT | null) => void;
  setIsGuest: (isGuest: boolean) => void;
  setAllNfts: (nfts: OwnedNFT[]) => void;
  setXmtpClient: (client: unknown) => void;
  setMyInboxId: (inboxId: string | null) => void;
  setMwaAuthToken: (token: string | null) => void;
  setVerifiedAt: (verifiedAt: number | null) => void;
  setIsGenesisHolder: (isGenesisHolder: boolean, kind?: "saga" | "seeker" | null) => void;
  setVerifiedGenesisAt: (verifiedGenesisAt: number | null) => void;
  setGenesisGroupId: (genesisGroupId: string | null) => void;
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
  mutedBotChannels: { trades: boolean };
  mutedSports: string[];
  /** Orphaned 2026-08-13 (MonkeBets/MonkePredictions removed) — no live UI
   *  writes this anymore; kept only so old persisted values don't crash
   *  hydration. Values: 'polymarket' | 'drift'. */
  mutedAlertSources: string[];
  /** BananaBet ids the user dismissed — local-only, per-device. Dismissing
   *  never places a wager (distinct from betting NO) and never affects
   *  other users' view of the same card. */
  hiddenBananaBetIds: string[];
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
  /** Ground truth from the bot's AUTOMONKE_STATUS: DM, sent after every
   *  /autonomonke command. Corrects BotChannelScreen's AsyncStorage-only
   *  enrollment flag, which has no link back to real bot state and can
   *  read as OFF on a fresh app install/build even when the bot never
   *  stopped trading. Null until the first status DM arrives this session. */
  automonkeStatus: { enrolled: boolean; active: boolean; limitOrdersEnabled: boolean } | null;
  /** Data Oracle Phase 1 — opted into contributing app-usage/attention signal (which
   *  tokens viewed, dwell time) toward the sentiment oracle. Off by default; toggling off
   *  immediately stops local collection and cancels the periodic upload — see
   *  useSentimentOptIn.ts. No payout logic exists yet (Phase 4, pending legal review). */
  sentimentOracleOptIn: boolean;
  sentimentOracleOptInAt: number | null;
  /** Slot-keyed copy-trade follow state (Monke Trader #1/#3), reconciled by the
   *  bot's COPY_TRADE_STATUS: DM. Slot number only — the app never learns the
   *  followed wallet address, per the bot's privacy invariant. */
  copyTradeSlots: Partial<Record<1 | 3, { enabled: boolean; perTradeSOL: number; boundAt: number | null }>>;
}

interface AppSettingsActions {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setMentionsOnly: (mentionsOnly: boolean) => void;
  setBotNotificationsEnabled: (enabled: boolean) => void;
  setDmNotificationsEnabled: (enabled: boolean) => void;
  setLiveRoomNotificationsEnabled: (enabled: boolean) => void;
  toggleBotChannelMute: (channel: 'trades') => void;
  toggleSportMute: (sport: string) => void;
  toggleAlertSourceMute: (source: string) => void;
  hideBananaBet: (id: string) => void;
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
  setAutomonkeStatus: (status: { enrolled: boolean; active: boolean; limitOrdersEnabled: boolean }) => void;
  setSentimentOracleOptIn: (optIn: boolean) => void;
  setCopyTradeSlot: (slot: 1 | 3, patch: Partial<{ enabled: boolean; perTradeSOL: number; boundAt: number | null }>) => void;
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
  activeBananaBetResult: BananaBetResultDisplay | null;
  activePoll: PollOpenData | null;
  activePollResult: PollResultDisplay | null;
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
  setActiveBananaBetResult: (result: BananaBetResultDisplay | null) => void;
  setActivePoll: (poll: PollOpenData | null) => void;
  setActivePollResult: (result: PollResultDisplay | null) => void;
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
  verifiedAt: null,
  isGenesisHolder: false,
  genesisTokenKind: null,
  verifiedGenesisAt: null,
  genesisGroupId: null,

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
  mutedBotChannels: { trades: false },
  mutedSports: [],
  hiddenBananaBetIds: [],
  mutedAlertSources: ['drift'],
  isGroupMember: false,
  isGroupAdmin: false,
  joinRequests: [],
  remoteGroupId: '',
  botChannelIds: { trades: '' },
  botChannelCounts: { trades: 0 },
  calendarEvents: [],
  expoPushToken: null,
  communityBadges: { dms: 0, events: 0, links: 0 },
  dmUnreadCounts: {},
  automonkeStatus: null,
  sentimentOracleOptIn: false,
  sentimentOracleOptInAt: null,
  copyTradeSlots: {},

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
  activeBananaBetResult: null,
  activePoll: null,
  activePollResult: null,
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
  setVerifiedAt: (verifiedAt) => set({ verifiedAt }),
  setIsGenesisHolder: (isGenesisHolder, kind = null) => set({ isGenesisHolder, genesisTokenKind: isGenesisHolder ? kind : null }),
  setVerifiedGenesisAt: (verifiedGenesisAt) => set({ verifiedGenesisAt }),
  setGenesisGroupId: (genesisGroupId) => set({ genesisGroupId }),
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
  // One-way (no un-hide) — "clear the message," not a togglable mute.
  hideBananaBet: (id) => {
    set((s) => {
      if (s.hiddenBananaBetIds.includes(id)) return s;
      const next = [...s.hiddenBananaBetIds, id];
      AsyncStorage.setItem(AK_HIDDEN_BANANA_BETS, JSON.stringify(next)).catch(() => {});
      return { hiddenBananaBetIds: next };
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
  setAutomonkeStatus: (automonkeStatus) => set({ automonkeStatus }),
  setSentimentOracleOptIn: (sentimentOracleOptIn) => {
    set({ sentimentOracleOptIn, sentimentOracleOptInAt: sentimentOracleOptIn ? Date.now() : null });
    AsyncStorage.setItem(AK_SENTIMENT_OPT_IN, JSON.stringify({
      optIn: sentimentOracleOptIn,
      optInAt: sentimentOracleOptIn ? Date.now() : null,
    })).catch(() => {});
  },
  setCopyTradeSlot: (slot, patch) => {
    const next = {
      ...get().copyTradeSlots,
      [slot]: { enabled: false, perTradeSOL: 0, boundAt: null, ...get().copyTradeSlots[slot], ...patch },
    };
    set({ copyTradeSlots: next });
    AsyncStorage.setItem(AK_COPY_TRADE_SLOTS, JSON.stringify(next)).catch(() => {});
  },

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
  setActiveBananaBetResult: (activeBananaBetResult) => set({ activeBananaBetResult }),
  setActivePoll: (activePoll) => set({ activePoll }),
  setActivePollResult: (activePollResult) => set({ activePollResult }),

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
    const [sportsRaw, channelsRaw, notifRaw, sourcesRaw, hiddenBetsRaw, sentimentOptInRaw, copyTradeSlotsRaw] = await Promise.all([
      AsyncStorage.getItem(AK_MUTED_SPORTS),
      AsyncStorage.getItem(AK_MUTED_CHANNELS),
      AsyncStorage.getItem(AK_NOTIF_PREFS),
      AsyncStorage.getItem(AK_MUTED_ALERT_SOURCES),
      AsyncStorage.getItem(AK_HIDDEN_BANANA_BETS),
      AsyncStorage.getItem(AK_SENTIMENT_OPT_IN),
      AsyncStorage.getItem(AK_COPY_TRADE_SLOTS),
    ]);
    const state: Record<string, unknown> = {};
    if (sportsRaw) {
      const parsed = JSON.parse(sportsRaw);
      if (Array.isArray(parsed)) state.mutedSports = parsed;
    }
    if (hiddenBetsRaw) {
      const parsed = JSON.parse(hiddenBetsRaw);
      if (Array.isArray(parsed)) state.hiddenBananaBetIds = parsed;
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
    if (sentimentOptInRaw) {
      const parsed = JSON.parse(sentimentOptInRaw);
      if (parsed && typeof parsed.optIn === 'boolean') {
        state.sentimentOracleOptIn = parsed.optIn;
        state.sentimentOracleOptInAt = typeof parsed.optInAt === 'number' ? parsed.optInAt : null;
      }
    }
    if (copyTradeSlotsRaw) {
      const parsed = JSON.parse(copyTradeSlotsRaw);
      if (parsed && typeof parsed === 'object') state.copyTradeSlots = parsed;
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
