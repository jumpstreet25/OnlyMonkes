/**
 * User Auth Slice — wallet, verification, XMTP client, MWA token
 *
 * This is a logical slice of the main appStore. Import from here for
 * type-safe, narrowly-scoped selectors in new code.
 * Existing code that uses `useAppStore` continues to work unchanged.
 */
import { useAppStore } from './appStore';
import type { WalletAccount, OwnedNFT } from '../types';

// ── State ────────────────────────────────────────────────────────────────────

export interface UserAuthState {
  wallet: WalletAccount | null;
  verified: boolean;
  verifiedNft: OwnedNFT | null;
  isGuest: boolean;
  allNfts: OwnedNFT[];
  xmtpClient: unknown;
  myInboxId: string | null;
  mwaAuthToken: string | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface UserAuthActions {
  setWallet: (wallet: WalletAccount | null) => void;
  setVerified: (verified: boolean, nft?: OwnedNFT | null) => void;
  setIsGuest: (isGuest: boolean) => void;
  setAllNfts: (nfts: OwnedNFT[]) => void;
  setXmtpClient: (client: unknown) => void;
  setMyInboxId: (inboxId: string | null) => void;
  setMwaAuthToken: (token: string | null) => void;
}

// ── Focused hook ─────────────────────────────────────────────────────────────

const authKeys: (keyof (UserAuthState & UserAuthActions))[] = [
  'wallet', 'verified', 'verifiedNft', 'isGuest', 'allNfts',
  'xmtpClient', 'myInboxId', 'mwaAuthToken',
  'setWallet', 'setVerified', 'setIsGuest', 'setAllNfts',
  'setXmtpClient', 'setMyInboxId', 'setMwaAuthToken',
];

/** Narrowly-scoped hook — only subscribes to auth-related state. */
export function useUserAuthStore<T>(selector: (s: UserAuthState & UserAuthActions) => T): T {
  return useAppStore((state) => selector(state as unknown as UserAuthState & UserAuthActions));
}

/** Non-React access. */
useUserAuthStore.getState = (): UserAuthState & UserAuthActions => {
  const full = useAppStore.getState();
  const slice: any = {};
  for (const k of authKeys) slice[k] = (full as any)[k];
  return slice;
};
