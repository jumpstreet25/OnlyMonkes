import Constants from 'expo-constants';

export const APP_NAME = 'OnlyMonkes';

// ─── SKR Token ────────────────────────────────────────────────────────────────
export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
// Jump.skr developer wallet — receives 5% of banana tips + direct tips
export const DEV_WALLET = '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J';
// Tip slider range (in whole SKR units)
export type TipAmount = number;
export const TIP_MIN = 1;
export const TIP_MAX = 500;
export const COLLECTION_NAME = 'Saga Monkes';
export const NFT_COLLECTION_ADDRESS = 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF';
export const HELIUS_API_KEY: string =
  (Constants.expoConfig?.extra?.heliusApiKey as string) || 'b651e3ee-fd5a-48bc-9972-da56cd3c3132';
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

// Bot XMTP inbox IDs — used to detect DM conversations with the bot
export const BOT_INBOX_IDS = [
  '998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363', // AI Agent #9385
  '5862dfd861978cd587c151ded8fd7fb1ccdbca45d420da99a2299e2a675707b2', // TA Savvy Monke
];

export const REACTIONS = ['🐒', '🔥', '🚀', '👍', '🍌'] as const;

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
