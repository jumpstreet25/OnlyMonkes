import {
  HELIUS_API_KEY as ENV_HELIUS,
  HELIUS_NFT_API_KEY as ENV_HELIUS_NFT,
  GIPHY_API_KEY as ENV_GIPHY,
  CLOUDINARY_CLOUD_NAME as ENV_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET as ENV_CLOUD_PRESET,
  LIVEKIT_URL as ENV_LK_URL,
  LIVEKIT_TOKEN_URL as ENV_LK_TOKEN,
  JUP_API_KEY as ENV_JUP,
  SKR_MINT as ENV_SKR,
  DEV_WALLET as ENV_DEV,
  SENTRY_DSN as ENV_SENTRY,
  SHYFT_API_KEY as ENV_SHYFT,
} from '@env';
import Constants from 'expo-constants';

export const APP_NAME = 'OnlyMonkes';

// ─── SKR Token ────────────────────────────────────────────────────────────────
export const SKR_MINT = ENV_SKR || 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
// Jump.skr developer wallet — receives tips + trading fees
export const DEV_WALLET = ENV_DEV || '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J';
// USDC mainnet mint (Circle)
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// SKR holders get a 10% discount on banana shop purchases
export const SKR_DISCOUNT_PCT = 0.10;

// Trading fees — paid to DEV_WALLET
export const NFT_SALE_FEE_PCT = 0.02;   // 2% on NFT sales
export const TOKEN_TRADE_FEE_PCT = 0.03; // 3% on token trades
export const AUTO_TRADE_FEE_PCT = 0.05;  // 5% on autonomous trades
// Tip slider range (in whole SKR units)
export type TipAmount = number;
export const TIP_MIN = 1;
export const TIP_MAX = 500;
export const COLLECTION_NAME = 'Saga Monkes';
export const NFT_COLLECTION_ADDRESS = 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF';

// ── API key resolution with runtime fallback ────────────────────────────────
// Two paths put env vars into the bundle:
//   1. react-native-dotenv (babel time) → `@env` imports above
//   2. app.config.ts `extra` block → Constants.expoConfig.extra at runtime
// On 2026-05-02 we hit a bug where path 1 silently produced empty strings in
// OTA bundles (Giphy + GIF picker dark on device while .env was intact and
// the API itself returned data). Belt-and-suspenders: prefer the inlined
// `@env` value, fall back to the `extras` value from the runtime manifest,
// then to a hard default. Either path being healthy keeps the feature alive.
const _extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const _str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const HELIUS_API_KEY: string = ENV_HELIUS || _str(_extra.heliusApiKey);
// Wallet / Saga Monke ownership only — not used for swaps or general RPC.
const _HELIUS_NFT_API_KEY_RAW: string = ENV_HELIUS_NFT || _str(_extra.heliusNftApiKey);
export const HELIUS_NFT_API_KEY: string = _HELIUS_NFT_API_KEY_RAW || HELIUS_API_KEY;
export const HELIUS_NFT_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_NFT_API_KEY}`;
export const GIPHY_API_KEY: string = ENV_GIPHY || _str(_extra.giphyApiKey);
export const CLOUDINARY_CLOUD_NAME: string = ENV_CLOUD_NAME || _str(_extra.cloudinaryCloudName);
export const CLOUDINARY_UPLOAD_PRESET: string = ENV_CLOUD_PRESET || _str(_extra.cloudinaryUploadPreset);
export const LIVEKIT_URL_ENV: string = ENV_LK_URL || _str(_extra.livekitUrl);
export const LIVEKIT_TOKEN_URL_ENV: string = ENV_LK_TOKEN || _str(_extra.livekitTokenUrl);
export const JUP_API_KEY: string = ENV_JUP || _str(_extra.jupApiKey);
export const SENTRY_DSN_ENV: string = ENV_SENTRY || _str(_extra.sentryDsn);
export const SHYFT_API_KEY: string = ENV_SHYFT || '';
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
];

// Bot display name + PFP. Mirrored from Monke_Eliza xmtpOnlyMonkes.ts:1643
// (the bot's PROFILE_UPDATE broadcast on startup). Hardcoded here so the
// MonkeGlobe pin and any other UI surface that needs the bot's avatar can
// render it without waiting for the bot's profile broadcast to be received
// AND processed AND cached. If the bot ever rotates its PFP, update both
// here and in the bot's xmtpOnlyMonkes.ts pfpPayload simultaneously.
export const BOT_DISPLAY_NAME = 'AI Agent #9385';
export const BOT_PFP_URL = 'https://i.imgur.com/Igyhf3p.jpeg';

export const REACTIONS = ['👍', '❤️', '😂', '🔥', '🍌', '🐒', '💎', '🚀'] as const;

export const THEME = {
  bg: '#0A0A0F',
  surface: '#12121A',
  surfaceHigh: '#1A1A28',
  border: '#1E1E2E',
  accent: '#7C3AED',
  accentSoft: 'rgba(124,58,237,0.15)',
  text: '#F8F8FF',
  textMuted: '#8B8B9E',
  textDim: '#6A6A8A',
  textFaint: '#4A4A6A',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  gold: '#FFD700',
};

// Translucent chrome-bar background applied to header / input bar /
// support banner / bot-channel chrome whenever a Chat World is equipped,
// so the world layer reads through. Tightened from 0.32 → 0.22 on
// 2026-05-07 per user feedback that the bars felt too solid against
// the world.
export const WORLD_BAR_BG = 'rgba(10,10,20,0.22)';

/**
 * Per-world ACCENT color for tappable chrome elements (toolbar labels:
 * CAM/LIVE/GIF, $SKR price button, Saga Monkes Floor, Help Support
 * OnlyMonkes link). Returns a vibrant color matching the world's mood
 * so tappable chrome reads as part of the same theme.
 *
 * Falls back to OnlyMonkes light blue ('#6CB4EE') for default / unknown.
 */
export function getWorldAccent(worldId: string | undefined | null): string {
  switch (worldId) {
    // Banana Grove — warm honey gold, fits dusk/wood palette
    case 'world_banana_grove':
      return '#E6B870';
    // Cyberpunk — neon magenta-pink (matches the bot's pink glitch color)
    case 'world_solana_cyberpunk':
      return '#FF6CB4';
    // Trading Floor — bright gold (financial/ticker feel)
    case 'world_trading_floor':
      return '#FFD24A';
    default:
      return '#6CB4EE';
  }
}

/**
 * Per-world tint for chrome bars (header, input, bot channel, support
 * banner). Returns a low-alpha rgba color matching the world's dominant
 * background palette, so the bars visually integrate with the world's
 * mood instead of being a flat dark band on top of it. All bars stay
 * mostly translucent (alpha ~0.28) so the world layer bleeds through.
 *
 * Falls back to WORLD_BAR_BG (default neutral dark) for unknown worlds.
 */
export function getWorldBarTint(worldId: string | undefined | null): string {
  switch (worldId) {
    // Banana Grove — warm dusk gradient (#3A2418 → #7A4A20 → #0D2818).
    // Bar tint = dark warm brown matching the upper twilight stop.
    case 'world_banana_grove':
      return 'rgba(40, 22, 12, 0.32)';
    // Solana Cyberpunk — purple/black neon. Dark cool purple tint.
    case 'world_solana_cyberpunk':
      return 'rgba(22, 12, 40, 0.30)';
    // Trading Floor — financial dark. Dark navy tint.
    case 'world_trading_floor':
      return 'rgba(10, 18, 32, 0.30)';
    default:
      return WORLD_BAR_BG;
  }
}

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
