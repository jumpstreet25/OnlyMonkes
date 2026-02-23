import { create } from 'zustand';
import type { WalletAccount, OwnedNFT } from '../types';

interface AppState {
  wallet: WalletAccount | null;
  verified: boolean;
  verifiedNft: OwnedNFT | null;
  allNfts: OwnedNFT[];              // all collection NFTs in the wallet
  xmtpClient: unknown;
  myInboxId: string | null;
  username: string | null;
  bio: string | null;
  isLoading: boolean;
  error: string | null;
  // Notification preferences
  notificationsEnabled: boolean;
  mentionsOnly: boolean;
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
};

export const useAppStore = create<AppState & AppActions>((set) => ({
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
  reset: () => set(initialState),
}));
