/**
 * User Profile Slice — display name, bio, theme, shop styles, streaks, bananas
 *
 * Logical slice of the main appStore. Use in new code for narrow subscriptions.
 */
import { useAppStore } from './appStore';

// ── State ────────────────────────────────────────────────────────────────────

export interface UserProfileState {
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
  location: string | null;
  themeId: string;
  customBubbleColor: string | null;
  shopStyles: Record<string, string | number | boolean>;
  nftDominantColor: string | null;
  themeOverrides: Partial<Record<string, unknown>> | null;
  textScale: number;
  loginStreak: number;
  bestStreak: number;
  isLegendary: boolean;
  bananaBalance: number;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface UserProfileActions {
  setUsername: (username: string) => void;
  setBio: (bio: string) => void;
  setXAccount: (xAccount: string) => void;
  setTipWallet: (tipWallet: string) => void;
  setLocation: (location: string) => void;
  setThemeId: (id: string) => void;
  setCustomBubbleColor: (color: string | null) => void;
  setShopStyles: (styles: Record<string, string | number | boolean>) => void;
  setNftDominantColor: (color: string | null) => void;
  setThemeOverrides: (overrides: Partial<Record<string, unknown>> | null) => void;
  setTextScale: (scale: number) => void;
  setLoginStreak: (streak: number, best: number, legendary: boolean) => void;
  setBananaBalance: (balance: number) => void;
}

// ── Focused hook ─────────────────────────────────────────────────────────────

const profileKeys: (keyof (UserProfileState & UserProfileActions))[] = [
  'username', 'bio', 'xAccount', 'tipWallet', 'location',
  'themeId', 'customBubbleColor', 'shopStyles', 'nftDominantColor',
  'themeOverrides', 'textScale', 'loginStreak', 'bestStreak',
  'isLegendary', 'bananaBalance',
  'setUsername', 'setBio', 'setXAccount', 'setTipWallet', 'setLocation',
  'setThemeId', 'setCustomBubbleColor', 'setShopStyles', 'setNftDominantColor',
  'setThemeOverrides', 'setTextScale', 'setLoginStreak', 'setBananaBalance',
];

/** Narrowly-scoped hook — only subscribes to profile-related state. */
export function useUserProfileStore<T>(selector: (s: UserProfileState & UserProfileActions) => T): T {
  return useAppStore((state) => selector(state as unknown as UserProfileState & UserProfileActions));
}

/** Non-React access. */
useUserProfileStore.getState = (): UserProfileState & UserProfileActions => {
  const full = useAppStore.getState();
  const slice: any = {};
  for (const k of profileKeys) slice[k] = (full as any)[k];
  return slice;
};
