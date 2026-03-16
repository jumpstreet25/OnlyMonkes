/**
 * Firebase Analytics — tracks usage patterns for chat retention,
 * feature adoption, and session duration.
 *
 * All events are anonymous (keyed by inboxId hash, not wallet address).
 */
import analytics from '@react-native-firebase/analytics';

// ── Core events ──────────────────────────────────────────────────────────────

/** User opened the app */
export async function logAppOpen() {
  await analytics().logAppOpen();
}

/** User connected their wallet */
export async function logWalletConnect(walletType: string) {
  await analytics().logEvent('wallet_connect', { wallet_type: walletType });
}

/** User verified NFT and entered the chat */
export async function logNftVerified(nftName: string) {
  await analytics().logEvent('nft_verified', { nft_name: nftName });
}

/** User sent a chat message */
export async function logMessageSent(type: 'text' | 'image' | 'gif' | 'video' | 'sticker' | 'reply') {
  await analytics().logEvent('message_sent', { message_type: type });
}

/** User opened a DM conversation */
export async function logDmOpened() {
  await analytics().logEvent('dm_opened');
}

/** User joined a live audio room */
export async function logLiveRoomJoined(isHost: boolean) {
  await analytics().logEvent('live_room_joined', { is_host: isHost });
}

/** User used a slash command */
export async function logSlashCommand(command: string) {
  await analytics().logEvent('slash_command', { command });
}

/** User tipped another user */
export async function logTipSent(amount: number, currency: string) {
  await analytics().logEvent('tip_sent', { amount, currency });
}

/** User executed a swap */
export async function logSwapExecuted(fromToken: string, toToken: string) {
  await analytics().logEvent('swap_executed', { from_token: fromToken, to_token: toToken });
}

/** User opened a feature from the community drawer */
export async function logDrawerFeature(feature: string) {
  await analytics().logEvent('drawer_feature', { feature });
}

// ── Retention tracking ───────────────────────────────────────────────────────

/** Log daily active session (call once per app foreground) */
export async function logDailySession(streakDays: number) {
  await analytics().logEvent('daily_session', { streak_days: streakDays });
}

/** Track chat screen time (call when user leaves chat) */
export async function logChatDuration(durationSeconds: number) {
  await analytics().logEvent('chat_duration', { duration_seconds: durationSeconds });
}

// ── User properties ──────────────────────────────────────────────────────────

/** Set user properties for segmentation (non-PII) */
export async function setUserProperties(props: {
  isAdmin?: boolean;
  nftCount?: number;
  hasLegendaryBadge?: boolean;
}) {
  if (props.isAdmin !== undefined) {
    await analytics().setUserProperty('is_admin', String(props.isAdmin));
  }
  if (props.nftCount !== undefined) {
    await analytics().setUserProperty('nft_count', String(props.nftCount));
  }
  if (props.hasLegendaryBadge !== undefined) {
    await analytics().setUserProperty('has_legendary', String(props.hasLegendaryBadge));
  }
}
