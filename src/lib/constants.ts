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
  QUICKNODE_DAS_URL as ENV_QUICKNODE_DAS,
  ALCHEMY_API_KEY as ENV_ALCHEMY,
  GROQ_API_KEY as ENV_GROQ,
} from '@env';
import Constants from 'expo-constants';

export const APP_NAME = 'OnlyMonkes';

// ─── SKR Token ────────────────────────────────────────────────────────────────
export const SKR_MINT = ENV_SKR || 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
// OnlyMonkes publisher wallet — the same keypair that published the app to
// the Solana Mobile dApp Store (~/onlymonkes-publisher-keypair.json).
// Receives tips, Banana Shop purchases, trading fees, AND ad-skip $SKR
// payments — one wallet, matches worker-actions' treasury.ts PUBLISHER_WALLET
// and the bot's DEV_WALLET (Monke_Eliza/agents/monke-trader/.env). Fixed
// 2026-08-24: this app's own .env DEV_WALLET had drifted to a different,
// stale address (7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J) — tips/
// purchases/fees were landing there instead of the real publisher wallet
// while the bot and treasury Blinks were already correct.
export const DEV_WALLET = ENV_DEV || 'BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o';
// 2026-09-02: the dev's own personal wallet — for "is the person using the
// app right now the dev" identity checks (admin-gated UI, gift-shop-item
// picker, dev-self-purchase detection). Distinct from DEV_WALLET above
// (the publisher/treasury wallet money flows TO) — before the Aug 24 fix
// they were the same value by coincidence, so every isDevAdmin-style check
// silently broke the moment DEV_WALLET was corrected to the real publisher
// wallet. Found via a real report: dev lost the ability to gift Banana Shop
// items to a new member. Matches the AutonoMonke-enrolled wallet tied to
// the bot's admin inbox (ab90147fcca3…) — see Monke_Eliza's
// .automonke_wallets.json. Never repoint this at a payment-destination
// wallet again — it answers "who is logged in", not "where does money go".
export const DEV_ADMIN_WALLET = '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J';
// USDC mainnet mint (Circle)
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// SKR holders get a 10% discount on banana shop purchases
export const SKR_DISCOUNT_PCT = 0.10;

// Trading fees — paid to DEV_WALLET
export const NFT_SALE_FEE_PCT = 0.02;   // 2% on NFT sales
export const TOKEN_TRADE_FEE_PCT = 0.03; // 3% on token trades
export const AUTO_TRADE_FEE_PCT = 0.05;  // 5% on autonomous trades
// 2026-08-27: flat swap-notional fee via Jupiter's own platformFeeBps —
// separate dimension from TOKEN_TRADE_FEE_PCT/AUTO_TRADE_FEE_PCT above
// (those are realized-profit-only, charged at position close, never on a
// loss or an entry). This one is small and applies to every swap regardless
// of outcome — deliberate policy change, see project memory before touching.
// Only takes effect when one leg of the swap is SOL (Jupiter requires the
// feeAccount's mint to match an actual leg of the swap) — the fee account
// is DEV_WALLET's wrapped-SOL Associated Token Account, derived at each
// call site via getAssociatedTokenAddressSync(SOL_MINT, DEV_WALLET) rather
// than hardcoded here (deterministic, no risk of a copy-paste mismatch
// across the app/bot/worker call sites). That account MUST be created
// on-chain before this ships — unverified whether Jupiter degrades
// gracefully (ignores the fee) or rejects the whole /build request if it
// doesn't exist yet, so treat creation as a hard prerequisite, not a
// nice-to-have.
export const JUP_PLATFORM_FEE_BPS = 10; // 0.10%
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
// Dedicated key for wallet / Saga Monke ownership checks only.
// Isolated from HELIUS_API_KEY (scanner, swaps, sales, general RPC).
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
// 2026-08-04: nftFeatureDetection.ts and avatarEmotions.ts were reading
// `process.env.GROQ_API_KEY` directly — that's always undefined in a React
// Native runtime (no Node process env on-device) regardless of `.env` or
// build type, so the Groq fallback path in both never actually ran. Not
// currently set in this app's `.env` either; both call sites already guard
// on a missing key and degrade gracefully (return null → next fallback), so
// this was silent, not a crash. Routing through the same safe pattern as
// everything else here so it starts working the moment the key is added to
// `.env` + `app.config.ts`'s `extra.groqApiKey`.
export const GROQ_API_KEY: string = ENV_GROQ || _str(_extra.groqApiKey);
// QuickNode DAS endpoint — auth token is embedded in the URL path itself
// (QuickNode's convention), so this is used as a full URL, not a bare key.
// Added 2026-07-13 as a 30-day trial; see project memory for the expiry
// date and what to do when it runs out.
// 2026-08-04: missed the dual-fallback pattern above when this was added —
// `@env` alone silently produced '' in every shipped/OTA bundle (the exact
// class of bug the comment at the top of this section describes), so the
// QuickNode fallback in nftVerification.ts's Helius→QuickNode→on-chain
// chain has never actually run in production. Confirmed live: RugDoctor
// holds 10 Saga Monkes (verified directly against QuickNode's API), but
// with Helius quota-exhausted (429) and QuickNode dark, verification fell
// through to the on-chain check — unreliable for compressed NFTs — and
// falsely reported him as a non-holder.
export const QUICKNODE_DAS_URL: string = ENV_QUICKNODE_DAS || _str(_extra.quickNodeDasUrl);
// Alchemy DAS — added 2026-08-10 as a second, vendor-independent fallback
// tier ahead of QuickNode's 30-day trial expiring (~2026-08-12). Free tier:
// 30M CU/month, confirmed to support getAssetsByOwner for compressed NFTs.
// Unlike Helius/QuickNode, Alchemy's DAS methods take POSITIONAL array
// params, not a named object — see fetchAssetsViaAlchemy in
// nftVerification.ts. Same dual-fallback (`@env` + `extra`) pattern as
// above, to avoid repeating the QUICKNODE_DAS_URL silent-empty-string bug.
const _ALCHEMY_API_KEY: string = ENV_ALCHEMY || _str(_extra.alchemyApiKey);
export const ALCHEMY_DAS_URL: string = _ALCHEMY_API_KEY
  ? `https://solana-mainnet.g.alchemy.com/v2/${_ALCHEMY_API_KEY}`
  : '';
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

// "OnlyTreasury" — second, independent bot identity for the Dev/Treasury
// wallet (see Monke_Eliza's treasuryBot.ts). Never an interactive login,
// posts a weekly digest + $20-sweep alerts only. Mirrors the BOT_INBOX_IDS
// pattern above so message rendering, PFP fallback, and the MonkeGlobe pin
// all recognize it the same way. Its PFP is dynamically resolved from
// whatever Saga Monke DEV_WALLET holds (broadcast via PROFILE_UPDATE on
// every bot startup) — this constant is only the last-resort fallback for
// before that broadcast is received/cached, same role BOT_PFP_URL plays.
export const TREASURY_BOT_INBOX_IDS = [
  '05ba24130d6ca6ba5bc9314455dac5f67e16b3a198a02f00ed136b4ecf6a3e34', // OnlyTreasury
];
export const TREASURY_BOT_DISPLAY_NAME = 'OnlyTreasury';
export const TREASURY_BOT_PFP_URL = 'https://i.imgur.com/Igyhf3p.jpeg';

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

// MonkeBlue — the app's own default brand tint for chrome bars (header/
// toolbar/support-banner/BananaMenu drawer) whenever NO Chat World and NO
// Banana Shop theme (Tier 4 static theme or PFP Full Theme) is equipped.
// Built on the light-blue accent (#6CB4EE) already used app-wide for the
// globe pill and default chrome-icon color — not a new, disconnected color.
// 2026-08-23: replaces falling through to surfaceToBarTint(THEME.surface,
// ...) for the no-override case — THEME.surface is near-black (#12121A),
// so with no real blur behind it any more (see LiquidGlass.tsx) that path
// read as flat grey bars with zero brand identity, not "glass."
export const MONKE_BLUE = '#6CB4EE';
// 2026-08-23: 0.34 -> 0.62, and richened the navy itself (16,34,56 ->
// 20,52,92) — confirmed on-device (Seeker screenshot) that the original
// value was dominated by LiquidGlass's own neutral dark scrim underneath
// it and read as "slightly less black," not blue. This value needs to be
// strong enough to visibly win against LiquidGlass's ~0.5-opacity neutral
// gradient, not just tint it.
export const MONKE_BLUE_BAR_BG = 'rgba(20, 52, 92, 0.62)';

/**
 * Resolves the translucent tint for a chrome bar (header, toolbar, support
 * banner, chat/DM headers, BananaMenu drawer): World tint wins when a Chat
 * World is equipped; an equipped Banana Shop theme's own surface color wins
 * next (a user's explicit customization); MonkeBlue is the default brand
 * fallback when neither is set — never a hardcoded neutral dark tint.
 */
export function resolveBarTint(
  worldId: string | undefined | null,
  hasThemeOverride: boolean,
  themeSurface: string,
  alpha: number,
): string {
  if (worldId) return getWorldBarTint(worldId);
  if (hasThemeOverride) return surfaceToBarTint(themeSurface, alpha);
  return MONKE_BLUE_BAR_BG;
}

/**
 * Per-world ACCENT color for tappable chrome elements (toolbar labels:
 * CAM/LIVE/GIF, $SKR price button, Saga Monkes Floor, Help Support
 * OnlyMonkes link). Returns a vibrant color matching the world's mood
 * so tappable chrome reads as part of the same theme.
 *
 * Falls back to OnlyMonkes light blue ('#6CB4EE') for default / unknown.
 */
/**
 * Relative luminance 0–1 (sRGB). Used so PFP-full-theme NFT colors that
 * are nearly black can't paint CAM/LIVE/GIF/channel icons invisible on
 * dark world chrome bars (Tech Noir etc.).
 */
export function colorLuminance(hex: string): number {
  const raw = hex.replace('#', '').trim();
  if (raw.length < 6) return 0;
  const n = parseInt(raw.slice(0, 6), 16);
  if (!Number.isFinite(n)) return 0;
  const srgb = [n >> 16, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * Translucent chrome-bar tint derived from the currently effective THEME
 * surface color — Tier 4 Banana Shop app themes (static hex like
 * "#0a1225") and PFP Full Theme (rgb(...) from shopTheme.ts's
 * buildPfpTheme) both flow through useThemeColor('surface'), same as the
 * rest of the app's background. Chrome bars (header/toolbar) previously
 * ignored that override entirely and stayed hardcoded to the *default*
 * surface color forever, even when a theme was equipped — this is the
 * general-purpose fix, applied everywhere the World-tint/neutral-tint
 * chrome-bar pattern appears. World tint (Tier 5) still wins when equipped;
 * this only fills the "no world" fallback slot.
 */
export function surfaceToBarTint(surfaceColor: string, alpha: number): string {
  const rgbMatch = surfaceColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const hex = surfaceColor.replace('#', '').trim();
  if (hex.length >= 6) {
    const n = parseInt(hex.slice(0, 6), 16);
    if (Number.isFinite(n)) {
      const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return `rgba(18, 18, 26, ${alpha})`;
}

/**
 * Chrome accent for CAM/LIVE/GIF, channel icons, support banner, etc.
 *
 * Priority (2026-08-06):
 *   1) **Chat World always owns full-bleed chrome** when equipped — so two
 *      monkes both on Tech Noir both get cyan bars, regardless of whether
 *      either also has PFP Full Theme. PFP Full Theme recolors bubbles /
 *      general UI, not World chrome (user: "My full theme shouldn't affect
 *      [World] theme").
 *   2) No world + PFP Full Theme → NFT color only if bright enough to read
 *      on dark glass (dark Saga Monke palettes used to black out the bar).
 *   3) Default OnlyMonkes light blue.
 */
export function chromeAccentColor(
  pfpFullTheme: boolean | undefined,
  nftDominantColor: string | null | undefined,
  worldId: string | undefined | null,
  minLuma = 0.42,
): string {
  if (worldId) return getWorldAccent(worldId);
  if (pfpFullTheme && nftDominantColor && colorLuminance(nftDominantColor) >= minLuma) {
    return nftDominantColor;
  }
  return getWorldAccent(null);
}

export function getWorldAccent(worldId: string | undefined | null): string {
  switch (worldId) {
    // Banana Grove — warm honey gold, fits dusk/wood palette
    case 'world_banana_grove':
      return '#E6B870';
    // Cyberpunk — Solana green, matching the grid-line color the real
    // world already renders (SolanaCyberpunkWorld.tsx uses rgba(20,241,
    // 149,...) for its neon grid) and the actual purple-to-teal background
    // gradient (#1a0533→#0f7a85) — neither has any pink in it at all.
    // 2026-08-06: was #FF6CB4 hot pink, picked to match the bot's own
    // glitch-message color rather than this world's actual palette —
    // clashed badly against every top/bottom bar once WorldLayer started
    // rendering behind them (chrome pills, icons, CAM/LIVE/GIF all went
    // stark pink over a background with zero pink in it).
    case 'world_solana_cyberpunk':
      return '#14F195';
    // Trading Floor — dirty jade (jungle Monke Core candles plate).
    // 2026-08-07: gold → mint → jade to match stationary candle world.
    case 'world_trading_floor':
      return '#2F8F6A';
    // Tech Noir — bright electric cyan-blue. 2026-08-06: was #8BAFC8, a
    // muted grayish-blue with too little contrast against this world's
    // near-black gradient (#010308→#0A1428) — every icon/pill/chrome-bar
    // read as barely-visible washed-out gray once WorldLayer started
    // rendering behind them. Same token drives TechNoirBubble chrome and
    // TechNoirWorld's NOIR_ACCENT (rain edge / billboard frame) so the
    // whole surface stays one palette.
    case 'world_tech_noir':
      return '#4FD8FF';
    // Deep Space — nebula purple
    case 'world_deep_space':
      return '#9B70FF';
    // Frost Grove — icy cyan-blue, cold moonlight accent
    case 'world_frost_grove':
      return '#8FD8FF';
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
    // 2026-08-07: alphas nudged down ~0.08 so chrome bars are a bit more
    // transparent (user: "more transparent, not much") without losing text.
    // Banana Grove — warm dusk gradient (#3A2418 → #7A4A20 → #0D2818).
    case 'world_banana_grove':
      return 'rgba(40, 22, 12, 0.24)';
    // Solana Cyberpunk — purple/black neon. Dark cool purple tint.
    case 'world_solana_cyberpunk':
      return 'rgba(22, 12, 40, 0.22)';
    // Trading Floor — deep canopy / mud cast (matches jungle plate).
    case 'world_trading_floor':
      return 'rgba(8, 16, 12, 0.26)';
    // Tech Noir — cold noir black, very dark with blue cast.
    case 'world_tech_noir':
      return 'rgba(4, 8, 18, 0.28)';
    // Deep Space — deep purple-black void.
    case 'world_deep_space':
      return 'rgba(6, 3, 18, 0.26)';
    // Frost Grove — dark cold-blue tint matching the midnight-navy gradient's upper stop.
    case 'world_frost_grove':
      return 'rgba(8, 18, 30, 0.24)';
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
