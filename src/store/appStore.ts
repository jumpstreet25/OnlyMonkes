import { create } from 'zustand';
import type { WalletAccount, OwnedNFT } from '../types';

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
}

interface AppActions {
  setWallet: (wallet: WalletAccount | null) => void;
  setVerified: (verified: boolean, nft?: OwnedNFT | null) => void;
  setAllNfts: (nfts: OwnedNFT[]) => void;
  setXmtpClient: (client: unknown) => void;
  setMyInboxId: (inboxId: string | null) => void;
  setUsername: (username: string) => void;
  setBio: (bio: string) => void;
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
  isLoading: false,
  error: null,
  notificationsEnabled: true,
  mentionsOnly: false,
  isGroupMember: false,
  isGroupAdmin: false,
  joinRequests: [],
  remoteGroupId: '',
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
  reset: () => set(initialState),
}));
