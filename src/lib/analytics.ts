/**
 * Firebase Analytics — tracks usage patterns for chat retention,
 * feature adoption, and session duration.
 *
 * All events are anonymous (keyed by inboxId hash, not wallet address).
 */
import { getAnalytics, logAppOpen as fbLogAppOpen, logEvent, setUserProperty } from '@react-native-firebase/analytics';

// v26+ is modular-only (namespaced analytics() removed).
const analytics = () => getAnalytics();

// ── Core events ──────────────────────────────────────────────────────────────

/** User opened the app */
export async function logAppOpen() {
  await fbLogAppOpen(analytics());
}

/** User connected their wallet */
export async function logWalletConnect(walletType: string) {
  await logEvent(analytics(), 'wallet_connect', { wallet_type: walletType });
}

/** User verified NFT and entered the chat */
export async function logNftVerified(nftName: string) {
  await logEvent(analytics(), 'nft_verified', { nft_name: nftName });
}

/** User sent a chat message */
export async function logMessageSent(type: 'text' | 'image' | 'gif' | 'video' | 'sticker' | 'reply') {
  await logEvent(analytics(), 'message_sent', { message_type: type });
}

/** User opened a DM conversation */
export async function logDmOpened() {
  await logEvent(analytics(), 'dm_opened');
}

/** User joined a live audio room */
export async function logLiveRoomJoined(isHost: boolean) {
  await logEvent(analytics(), 'live_room_joined', { is_host: isHost });
}

/** User used a slash command */
export async function logSlashCommand(command: string) {
  await logEvent(analytics(), 'slash_command', { command });
}

/** User tipped another user */
export async function logTipSent(amount: number, currency: string) {
  await logEvent(analytics(), 'tip_sent', { amount, currency });
}

/** User executed a swap */
export async function logSwapExecuted(fromToken: string, toToken: string) {
  await logEvent(analytics(), 'swap_executed', { from_token: fromToken, to_token: toToken });
}

/** User opened a feature from the community drawer */
export async function logDrawerFeature(feature: string) {
  await logEvent(analytics(), 'drawer_feature', { feature });
}

// ── Retention tracking ───────────────────────────────────────────────────────

/** Log daily active session (call once per app foreground) */
export async function logDailySession(streakDays: number) {
  await logEvent(analytics(), 'daily_session', { streak_days: streakDays });
}

/** Track chat screen time (call when user leaves chat) */
export async function logChatDuration(durationSeconds: number) {
  await logEvent(analytics(), 'chat_duration', { duration_seconds: durationSeconds });
}

// ── User properties ──────────────────────────────────────────────────────────

/** Set user properties for segmentation (non-PII) */
export async function setUserProperties(props: {
  isAdmin?: boolean;
  nftCount?: number;
  hasLegendaryBadge?: boolean;
}) {
  if (props.isAdmin !== undefined) {
    await setUserProperty(analytics(), 'is_admin', String(props.isAdmin));
  }
  if (props.nftCount !== undefined) {
    await setUserProperty(analytics(), 'nft_count', String(props.nftCount));
  }
  if (props.hasLegendaryBadge !== undefined) {
    await setUserProperty(analytics(), 'has_legendary', String(props.hasLegendaryBadge));
  }
}
