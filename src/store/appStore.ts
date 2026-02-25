import { create } from 'zustand';
import type { WalletAccount, OwnedNFT } from '../types';

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
  // Group membership
  isGroupMember: boolean;
  // Admin
  isGroupAdmin: boolean;
  joinRequests: JoinRequest[];
  // Remote config — fetched on init so ChatScreen knows if a group exists
  remoteGroupId: string;
  // Chat theme
  themeId: string;
  customBubbleColor: string | null;
  // Calendar events
  calendarEvents: CalendarEvent[];
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
  setIsGroupMember: (isMember: boolean) => void;
  setIsGroupAdmin: (isAdmin: boolean) => void;
  setJoinRequests: (requests: JoinRequest[]) => void;
  addJoinRequest: (req: JoinRequest) => void;
  removeJoinRequest: (inboxId: string) => void;
  setRemoteGroupId: (id: string) => void;
  setThemeId: (id: string) => void;
  setCustomBubbleColor: (color: string | null) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  addCalendarEvent: (event: CalendarEvent) => void;
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
  isGroupMember: false,
  isGroupAdmin: false,
  joinRequests: [],
  remoteGroupId: '',
  themeId: 'default',
  customBubbleColor: null,
  calendarEvents: [],
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
  setThemeId: (themeId) => set({ themeId }),
  setCustomBubbleColor: (customBubbleColor) => set({ customBubbleColor }),
  setCalendarEvents: (calendarEvents) => set({ calendarEvents }),
  addCalendarEvent: (event) => set((s) => ({ calendarEvents: [...s.calendarEvents, event] })),
  reset: () => set(initialState),
}));
