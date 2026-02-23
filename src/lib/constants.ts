export const APP_NAME = 'OnlyMonkes';
export const COLLECTION_NAME = 'Saga Monkes';
export const NFT_COLLECTION_ADDRESS = 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF';
export const HELIUS_API_KEY = 'f222b023-3712-4ab5-9dd1-caff88d27c40';
export const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

// XMTP v5 global group chat ID — set this after the first user creates the group.
// Leave empty on first run; the app will create a new group and log its ID.
export const GLOBAL_GROUP_ID = '';

// ─── dApp Side Chats ─────────────────────────────────────────────────────────
// Each dApp has its own XMTP group. Set groupId after first run (logged to console).
// deepLink: URI scheme to check if the dApp is installed on device.
// storeUrl: Solana Mobile dApp Store / Play Store fallback URL.
export const DAPPS = [
  {
    id: 'alchemy-merch',
    name: 'Alchemy Merch',
    icon: '⚗️',
    description: 'Alchemy Merch community chat',
    deepLink: 'alchemymerch://',           // update with real scheme
    storeUrl: 'https://dappstore.solanamobile.com/', // Solana Mobile dApp Store
    groupId: '',                           // set after first run
  },
] as const;

export const MAX_MESSAGE_LENGTH = 1000;

export const REACTIONS = ['🍌'] as const;

export const THEME = {
  bg: '#0A0A0F',
  surface: '#12121A',
  surfaceHigh: '#1A1A28',
  border: '#1E1E2E',
  accent: '#7C3AED',
  accentSoft: 'rgba(124,58,237,0.15)',
  text: '#F8F8FF',
  textMuted: '#8B8B9E',
  textFaint: '#4A4A6A',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
};

export const COLORS = {
  background: THEME.bg,
  surface: THEME.surface,
  surfaceAlt: THEME.surfaceHigh,
  border: THEME.border,
  primary: THEME.accent,
  primaryLight: '#A78BFA',
  primaryDim: THEME.accentSoft,
  text: THEME.text,
  textSecondary: THEME.textMuted,
  textMuted: THEME.textFaint,
  success: THEME.success,
  error: THEME.error,
  warning: THEME.warning,
};

export const FONTS = {
  display: 'SpaceGrotesk-Bold',
  displayMed: 'SpaceGrotesk-Medium',
  body: 'Inter-Regular',
  bodyMed: 'Inter-Medium',
  bodySemi: 'Inter-SemiBold',
  mono: 'JetBrainsMono-Regular',
  // Aliases for backward compatibility
  heading: 'SpaceGrotesk-Bold',
  subheading: 'SpaceGrotesk-Medium',
  bodyMedium: 'Inter-Medium',
  bodySemiBold: 'Inter-SemiBold',
};
