import { create } from 'zustand';
import type { WalletAccount, OwnedNFT } from '../types';
import type { LiveRoomData } from '../lib/livekit';

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

interface AppState {
  wallet: WalletAccount | null;
  verified: boolean;
  verifiedNft: OwnedNFT | null;
  allNfts: OwnedNFT[];
  xmtpClient: unknown;
  myInboxId: string | null;
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
  isLoading: boolean;
  error: string | null;
  // Notification preferences
  notificationsEnabled: boolean;
  mentionsOnly: boolean;
  botNotificationsEnabled: boolean;
  dmNotificationsEnabled: boolean;
  liveRoomNotificationsEnabled: boolean;
  // Per-bot-channel mute toggles
  mutedBotChannels: { bets: boolean; trades: boolean; sales: boolean; predictions: boolean };
  // MonkeBets sports filter — sports the user has opted OUT of
  mutedSports: string[];
  // Group membership
  isGroupMember: boolean;
  // Admin
  isGroupAdmin: boolean;
  joinRequests: JoinRequest[];
  // Remote config — fetched on init so ChatScreen knows if a group exists
  remoteGroupId: string;
  botChannelIds: { bets: string; trades: string; sales: string; predictions: string };
  botChannelCounts: { bets: number; trades: number; sales: number; predictions: number };
  // Chat theme
  themeId: string;
  customBubbleColor: string | null;
  // Calendar events
  calendarEvents: CalendarEvent[];
  // Login streaks
  loginStreak: number;
  bestStreak: number;
  isLegendary: boolean;
  // Push notifications
  expoPushToken: string | null;
  // Live audio room
  activeLiveRoom: LiveRoomState | null;
  isInLiveRoom: boolean;
  liveRoomMuted: boolean;
  liveRoomToken: string | null;
  // MWA reauthorize token — allows silent biometric re-auth without opening wallet app
  mwaAuthToken: string | null;
}

interface AppActions {
  setWallet: (wallet: WalletAccount | null) => void;
  setVerified: (verified: boolean, nft?: OwnedNFT | null) => void;
  setAllNfts: (nfts: OwnedNFT[]) => void;
  setXmtpClient: (client: unknown) => void;
  setMyInboxId: (inboxId: string | null) => void;
  setUsername: (username: string) => void;
  setBio: (bio: string) => void;
  setXAccount: (xAccount: string) => void;
  setTipWallet: (tipWallet: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setMentionsOnly: (mentionsOnly: boolean) => void;
  setBotNotificationsEnabled: (enabled: boolean) => void;
  setDmNotificationsEnabled: (enabled: boolean) => void;
  setLiveRoomNotificationsEnabled: (enabled: boolean) => void;
  toggleBotChannelMute: (channel: 'bets' | 'trades' | 'sales' | 'predictions') => void;
  toggleSportMute: (sport: string) => void;
  setIsGroupMember: (isMember: boolean) => void;
  setIsGroupAdmin: (isAdmin: boolean) => void;
  setJoinRequests: (requests: JoinRequest[]) => void;
  addJoinRequest: (req: JoinRequest) => void;
  removeJoinRequest: (inboxId: string) => void;
  setRemoteGroupId: (id: string) => void;
  setBotChannelIds: (ids: { bets: string; trades: string; sales: string; predictions: string }) => void;
  setBotChannelCounts: (counts: { bets: number; trades: number; sales: number; predictions: number }) => void;
  clearBotChannelCount: (channel: 'bets' | 'trades' | 'sales' | 'predictions') => void;
  setThemeId: (id: string) => void;
  setCustomBubbleColor: (color: string | null) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  addCalendarEvent: (event: CalendarEvent) => void;
  setLoginStreak: (streak: number, best: number, legendary: boolean) => void;
  setExpoPushToken: (token: string | null) => void;
  setActiveLiveRoom: (room: LiveRoomState | null) => void;
  updateLiveRoomCount: (count: number) => void;
  setIsInLiveRoom: (val: boolean) => void;
  setLiveRoomMuted: (val: boolean) => void;
  setLiveRoomToken: (token: string | null) => void;
  setMwaAuthToken: (token: string | null) => void;
  reset: () => void;
}

const initialState: AppState = {
  wallet: null,
  verified: false,
  verifiedNft: null,
  allNfts: [],
  xmtpClient: null,
  myInboxId: null,
  username: null,
  bio: null,
  xAccount: null,
  tipWallet: null,
  isLoading: false,
  error: null,
  notificationsEnabled: true,
  mentionsOnly: false,
  botNotificationsEnabled: true,
  dmNotificationsEnabled: true,
  liveRoomNotificationsEnabled: true,
  mutedBotChannels: { bets: false, trades: false, sales: false, predictions: false },
  mutedSports: [],
  isGroupMember: false,
  isGroupAdmin: false,
  joinRequests: [],
  remoteGroupId: '',
  botChannelIds: { bets: '', trades: '', sales: '', predictions: '' },
  botChannelCounts: { bets: 0, trades: 0, sales: 0, predictions: 0 },
  themeId: 'default',
  customBubbleColor: null,
  calendarEvents: [],
  loginStreak: 0,
  bestStreak: 0,
  isLegendary: false,
  expoPushToken: null,
  activeLiveRoom: null,
  isInLiveRoom: false,
  liveRoomMuted: false,
  liveRoomToken: null,
  mwaAuthToken: null,
};

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,

  setWallet: (wallet) => set({ wallet }),
  setVerified: (verified, nft) => set({ verified, verifiedNft: nft ?? null }),
  setAllNfts: (allNfts) => set({ allNfts }),
  setXmtpClient: (client) => set({ xmtpClient: client }),
  setMyInboxId: (myInboxId) => set({ myInboxId }),
  setUsername: (username) => set({ username }),
  setBio: (bio) => set({ bio }),
  setXAccount: (xAccount) => set({ xAccount }),
  setTipWallet: (tipWallet) => set({ tipWallet }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
  setMentionsOnly: (mentionsOnly) => set({ mentionsOnly }),
  setBotNotificationsEnabled: (botNotificationsEnabled) => set({ botNotificationsEnabled }),
  setDmNotificationsEnabled: (dmNotificationsEnabled) => set({ dmNotificationsEnabled }),
  setLiveRoomNotificationsEnabled: (liveRoomNotificationsEnabled) => set({ liveRoomNotificationsEnabled }),
  toggleBotChannelMute: (channel) => set((s) => ({
    mutedBotChannels: { ...s.mutedBotChannels, [channel]: !s.mutedBotChannels[channel] },
  })),
  toggleSportMute: (sport) => set((s) => ({
    mutedSports: s.mutedSports.includes(sport)
      ? s.mutedSports.filter(sp => sp !== sport)
      : [...s.mutedSports, sport],
  })),
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
  setBotChannelCounts: (botChannelCounts) => set({ botChannelCounts }),
  clearBotChannelCount: (channel) => set((s) => ({
    botChannelCounts: { ...s.botChannelCounts, [channel]: 0 },
  })),
  setThemeId: (themeId) => set({ themeId }),
  setCustomBubbleColor: (customBubbleColor) => set({ customBubbleColor }),
  setCalendarEvents: (calendarEvents) => set({ calendarEvents }),
  addCalendarEvent: (event) => set((s) => ({ calendarEvents: [...s.calendarEvents, event] })),
  setLoginStreak: (loginStreak, bestStreak, isLegendary) => set({ loginStreak, bestStreak, isLegendary }),
  setExpoPushToken: (expoPushToken) => set({ expoPushToken }),
  setActiveLiveRoom: (activeLiveRoom) => set({ activeLiveRoom }),
  updateLiveRoomCount: (count) =>
    set((s) => s.activeLiveRoom ? { activeLiveRoom: { ...s.activeLiveRoom, participantCount: count } } : {}),
  setIsInLiveRoom: (isInLiveRoom) => set({ isInLiveRoom }),
  setLiveRoomMuted: (liveRoomMuted) => set({ liveRoomMuted }),
  setLiveRoomToken: (liveRoomToken) => set({ liveRoomToken }),
  setMwaAuthToken: (mwaAuthToken) => set({ mwaAuthToken }),
  reset: () => set(initialState),
}));
