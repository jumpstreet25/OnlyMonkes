/**
 * notifications.ts
 *
 * Expo Notifications → Android heads-up + FCM pipeline.
 *
 * Android channel structure (visible in Settings → App info → Notifications):
 *  ┌─ OnlyMonkes (group)
 *  │   ├─ All Notifications   [om_all_v8]      — every chat message
 *  │   ├─ @Mentions           [om_mentions_v8] — messages that @mention you
 *  │   └─ Bot Notifications   [om_bot_v8]      — AI Agent trade/sales alerts
 *  └─
 *
 * Legacy channels (om_all, om_bot, om_mentions, onlymonkes_chat*) are deleted
 * on startup — their importance was locked to LOW by users so v3 replaces them.
 */

import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform, NativeModules, AppState } from "react-native";

// Native module that bypasses expo-notifications' groupKey=silent pipeline
// and posts directly to the specified Android notification channel.
const DirectNotif: {
  show: (t: string, b: string, ch: string) => void;
  showDelayed: (t: string, b: string, ch: string, ms: number) => void;
  showWithReactions: (t: string, b: string, ch: string, messageId: string, conversationId: string) => void;
  showWithJoinAction: (t: string, b: string, ch: string, roomType: string, roomId: string) => void;
} | null =
  Platform.OS === "android" ? (NativeModules.DirectNotif ?? null) : null;

const SK_PUSH_TOKEN = "push_token";

// ── Channel IDs ───────────────────────────────────────────────────────────────
// v8 IDs: all channels at MAX importance (7) including bot alerts.
// v7 bot channel was DEFAULT (5) — no heads-up. v8 fixes this.
export const CH_ALL      = "om_all_v8";      // regular chat messages
export const CH_MENTIONS = "om_mentions_v8"; // @mention messages
export const CH_BOT      = "om_bot_v8";      // bot alerts (AI Agent #9385)
export const CH_LIVE     = "om_live_v1";     // live room / avatar room started
export const CH_MARKET   = "om_market_v1";   // marketplace bids & sales
export const CH_SOCIAL   = "om_social_v1";   // thread replies, badges, calendar reminders

const CHANNEL_GROUP_ID = "onlymonkes";

// ── Module-level reply callback ───────────────────────────────────────────────
let _replyHandler: ((text: string) => void) | null = null;

export function setNotificationReplyHandler(fn: (text: string) => void): void {
  _replyHandler = fn;
}

// ── BananaBet push → popup deep-link ────────────────────────────────────────
// 2026-07-18: tapping a BananaBet push previously just opened the app to its
// default screen — the data payload arrived (fcmRelay already sends it) but
// nothing read it. On a killed-app cold start, XMTP's initial sync
// deliberately does NOT trigger the popup (see useXmtp.ts — "only fires from
// the live stream, never on history replay"), so the push's own data payload
// is the ONLY way to reconstruct the popup on a cold tap; that's why the bot
// embeds the full bet fields in the push data rather than just a bare betId.
// FCM data values arrive as strings regardless of original type.
// 2026-07-23: types that already show their own in-app popup via the live
// XMTP stream (see useXmtp.ts) independent of this push. A user with the
// app open sees that popup directly — the push notification for the same
// event is redundant and gets dismissed on arrival if the app is
// foregrounded, in the receipt listener below.
const POPUP_BACKED_NOTIFICATION_TYPES = new Set([
  "banana_bet_open",
  "banana_bet_settled",
  "poll_result",
  "live_room_invite",
]);

async function handleBananaBetNotificationData(data: Record<string, unknown> | undefined): Promise<void> {
  if (!data || typeof data.type !== "string") return;
  const { useAppStore } = await import("@/store/appStore");
  if (data.type === "banana_bet_open") {
    const { betId, category, question, resolvesAt, shareCaption } = data as Record<string, string>;
    if (!betId || !question || !resolvesAt) return;
    useAppStore.getState().setActiveBananaBet({
      id: betId, category: category as any, question, resolvesAt: Number(resolvesAt),
      ...(shareCaption ? { shareCaption } : {}),
    });
  } else if (data.type === "banana_bet_settled") {
    const { betId, question, outcome, totalBets, totalBananasWon, myBetSide, myBetAmount, shareCaption } = data as Record<string, string>;
    if (!betId || !question || !outcome) return;
    useAppStore.getState().setActiveBananaBetResult({
      betId, question, outcome: outcome as "yes" | "no",
      totalBets: Number(totalBets ?? 0),
      totalBananasWon: Number(totalBananasWon ?? 0),
      myBet: myBetSide ? { side: myBetSide as "yes" | "no", amount: Number(myBetAmount ?? 0) } : null,
      ...(shareCaption ? { shareCaption } : {}),
    });
  } else if (data.type === "poll_result") {
    // 2026-07-20: same cold-start reconstruction pattern as banana_bet_settled
    // above. winningOption/tally arrive as JSON strings, not objects — FCM
    // data values are String()-coerced bot-side (see communityPoll push in
    // xmtpOnlyMonkes.ts), so a raw object would've arrived as "[object
    // Object]". Parse them back out here.
    const { pollId, question, winningOption, tally, myOptionId } = data as Record<string, string>;
    if (!pollId || !question || !winningOption || !tally) return;
    try {
      useAppStore.getState().setActivePollResult({
        pollId, question,
        winningOption: JSON.parse(winningOption),
        tally: JSON.parse(tally),
        myVote: myOptionId || null,
      });
    } catch { /* malformed payload — non-fatal */ }
  }
}

// ── Lazy-load native module ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");

  // iOS only: without this handler, iOS won't show local notifications in foreground.
  // On Android, setNotificationHandler intercepts ALL local notifications and
  // re-fires them on expo_notifications_fallback_notification_channel with
  // groupKey=silent — which suppresses heads-up regardless of channel importance.
  // Android local notifications go directly to the specified channelId when no
  // handler is registered, so we deliberately skip this on Android.
  if (Platform.OS !== "android") {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }

  if (Platform.OS === "android") {
    // ── Delete stale channels so they vanish from Android's list ─────────────
    // Android caches channel definitions forever; deleting them cleans the list.
    // om_all / om_bot / om_mentions had their importance locked to LOW by users;
    // the v3 channels replace them with MAX importance.
    (async () => {
      for (const old of [
        "onlymonkes_chat", "onlymonkes_chat_v2", "default",
        "om_all", "om_mentions", "om_bot",
        "om_all_v3", "om_mentions_v3", "om_bot_v3",
        "om_all_v4", "om_mentions_v4", "om_bot_v4",
        "om_all_v5", "om_mentions_v5", "om_bot_v5",
        "om_all_v6", "om_mentions_v6", "om_bot_v6",
        "om_all_v7", "om_mentions_v7", "om_bot_v7",
        "onlymonkes_default",
      ]) {
        try { await Notifications.deleteNotificationChannelAsync(old); } catch { /* ignore */ }
      }
    })();

    // ── Channel group — "OnlyMonkes" ──────────────────────────────────────────
    Notifications.setNotificationChannelGroupAsync(CHANNEL_GROUP_ID, {
      name: "OnlyMonkes",
    }).catch(() => {/* ignore */});

    // Shared settings for all channels.
    // In expo-notifications v0.28, AndroidImportance enum values are offset:
    //   HIGH=6 → IMPORTANCE_HIGH (4) on Android → triggers heads-up banners
    //   MAX=7  → IMPORTANCE_MAX (5)
    const BASE = {
      groupId:              CHANNEL_GROUP_ID,
      importance:           7,           // AndroidImportance.MAX — heads-up
      vibrationPattern:     [0, 200, 100, 200] as number[],
      lightColor:           "#FFD700",
      enableVibrate:        true,
      showBadge:            true,
      lockscreenVisibility: 1,           // AndroidNotificationVisibility.PUBLIC
    };

    Notifications.setNotificationChannelAsync(CH_ALL, {
      ...BASE,
      name: "All Notifications",
    }).then((ch: unknown) => console.log('[Notifications] CH_ALL created, importance:', (ch as any)?.importance))
      .catch((e: unknown) => console.warn('[Notifications] CH_ALL error:', e));

    Notifications.setNotificationChannelAsync(CH_MENTIONS, {
      ...BASE,
      name: "@Mentions",
    }).catch((e: unknown) => console.warn('[Notifications] CH_MENTIONS error:', e));

    Notifications.setNotificationChannelAsync(CH_BOT, {
      ...BASE,
      importance: 7,      // AndroidImportance.MAX — heads-up for bot alerts
      name: "Bot Notifications",
    }).catch((e: unknown) => console.warn('[Notifications] CH_BOT error:', e));

    Notifications.setNotificationChannelAsync(CH_LIVE, {
      ...BASE,
      name: "Live Rooms",
    }).catch(() => {});

    Notifications.setNotificationChannelAsync(CH_MARKET, {
      ...BASE,
      name: "MonkeMarkets",
    }).catch(() => {});

    Notifications.setNotificationChannelAsync(CH_SOCIAL, {
      ...BASE,
      importance: 6,      // HIGH — not MAX, less urgent than chat
      name: "Social (Threads, Badges)",
    }).catch(() => {});

    // ── Reply action (attached to chat channels only) ─────────────────────────
    Notifications.setNotificationCategoryAsync("chat_message", [
      {
        identifier: "reply",
        buttonTitle: "Reply",
        textInput: {
          submitButtonTitle: "Send",
          placeholder: "Type a reply…",
        },
        options: { opensAppToForeground: true },
      },
    ]).catch((e: unknown) => console.warn('[Notifications] category error:', e));

    // ── Receipt listener — foreground suppression for popup-backed pushes ────
    // Fires on arrival (unlike the response listener below, which only fires
    // on tap). Deliberately NOT using setNotificationHandler on Android (see
    // comment above — it breaks the DirectNotif local-notification pipeline);
    // this dismisses the just-shown notification immediately after the OS
    // displays it instead, which is a separate API and doesn't touch that
    // pipeline. A brief flash before dismissal is possible but not
    // noticeable in practice, and strictly better than a persistent
    // redundant notification sitting alongside a popup the user is already
    // looking at.
    Notifications.addNotificationReceivedListener((notification: any) => {
      const data = notification?.request?.content?.data;
      const id = notification?.request?.identifier;
      if (
        AppState.currentState === "active" &&
        data?.type &&
        POPUP_BACKED_NOTIFICATION_TYPES.has(data.type) &&
        id
      ) {
        Notifications.dismissNotificationAsync(id).catch(() => { /* non-fatal */ });
      }
    });

    // ── Response listener (module-level, registered once) ─────────────────────
    Notifications.addNotificationResponseReceivedListener((response: any) => {
      if (
        response.actionIdentifier === "reply" &&
        typeof response.userText === "string" &&
        response.userText.trim()
      ) {
        _replyHandler?.(response.userText.trim());
        return;
      }
      void handleBananaBetNotificationData(response?.notification?.request?.content?.data);
    });

    // Cold start: the app was fully killed and the user tapped a notification
    // to launch it — the live listener above won't have fired in time (or at
    // all, depending on timing), so check once for the response that actually
    // launched this session.
    Notifications.getLastNotificationResponseAsync?.()
      .then((response: any) => {
        void handleBananaBetNotificationData(response?.notification?.request?.content?.data);
      })
      .catch(() => {});
  }
} catch {
  // Native module not available — rebuild with: npx expo run:android
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (!Notifications) return false;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

// ─── Push Token Registration ──────────────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Notifications) return null;

    // Always check permissions first — triggers system dialog on first run
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Notifications] Permission denied:', status);
      // Clear any stale cached token if permission was revoked
      await SecureStore.deleteItemAsync(SK_PUSH_TOKEN).catch(() => {});
      return null;
    }

    // Return cached raw FCM token if we have one (FCM tokens are stable per install)
    const stored = await SecureStore.getItemAsync(SK_PUSH_TOKEN);
    if (stored && !stored.startsWith('ExponentPushToken')) {
      if (__DEV__) console.log('[Notifications] Cached FCM token:', stored.slice(0, 30) + '…');
      return stored;
    }
    // Stale Expo token or no token — clear and fetch a raw FCM token
    if (stored) await SecureStore.deleteItemAsync(SK_PUSH_TOKEN).catch(() => {});

    // getDevicePushTokenAsync returns the raw FCM registration token.
    // The bot sends push directly via FCM Legacy API — no Expo relay or credentials needed.
    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    const token: string = tokenResponse.data as string;

    await SecureStore.setItemAsync(SK_PUSH_TOKEN, token);
    if (__DEV__) console.log('[Notifications] FCM device token registered:', token.slice(0, 40) + '…');
    return token;
  } catch (err) {
    console.warn('[Notifications] registerForPushNotifications failed:', err);
    return null;
  }
}

/** Force-clear cached token so next call to registerForPushNotifications fetches a fresh one. */
export async function clearPushToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SK_PUSH_TOKEN).catch(() => {});
}

/**
 * Register for an Expo push token (ExponentPushToken[...]) for client-side push relay.
 * This is separate from the raw FCM token used by the bot's server-side FCM v1 API.
 * Requires the EAS projectId from app.config.ts.
 */
export async function registerForExpoPushToken(): Promise<string | null> {
  try {
    if (!Notifications) return null;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[Notifications] No EAS projectId — cannot get Expo push token');
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token: string = tokenResponse.data as string;
    if (__DEV__) console.log('[Notifications] Expo push token:', token.slice(0, 40) + '…');
    return token;
  } catch (err) {
    console.warn('[Notifications] registerForExpoPushToken failed:', err);
    return null;
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SK_PUSH_TOKEN);
  } catch {
    return null;
  }
}

// ─── Local Notification ───────────────────────────────────────────────────────

/**
 * Schedule a test heads-up notification 6 seconds from now.
 * On Android uses the DirectNotif native module (Handler.postDelayed) so it
 * bypasses expo's groupKey=silent pipeline. Works as long as the app process
 * is alive (backgrounded). For a true test, swipe home — don't force-kill.
 */
export async function scheduleTestNotification(): Promise<void> {
  if (DirectNotif) {
    DirectNotif.showDelayed("MonkeyFace Test 🐒", "Heads-up banner working!", CH_ALL, 6000);
    return;
  }
  // iOS fallback
  try {
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "MonkeyFace Test 🐒",
        body: "Heads-up banner working!",
        sound: "default",
      },
      trigger: { seconds: 6 },
    });
  } catch (e) {
    console.warn("[Notifications] scheduleTestNotification failed:", e);
  }
}

/**
 * Show an immediate local notification.
 * Pass one of CH_ALL, CH_MENTIONS, or CH_BOT as `channelId`.
 * Defaults to CH_ALL.
 *
 * On Android: uses DirectNotif native module to post directly to the channel,
 * bypassing expo-notifications' groupKey=silent interception.
 * On iOS: uses expo-notifications (required for foreground display).
 */
export async function showLocalNotification(
  title: string,
  body: string,
  channelId: string = CH_ALL,
): Promise<void> {
  const truncated = body.length > 100 ? `${body.slice(0, 97)}…` : body;
  if (DirectNotif) {
    DirectNotif.show(title, truncated, channelId);
    return;
  }
  // iOS
  try {
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body: truncated, sound: "default" },
      trigger: null,
    });
  } catch {
    // Silently ignore — permission denied or module not ready
  }
}

/**
 * Chat-message local notification with quick-reaction action buttons that
 * send a real reaction WITHOUT opening the app — see ReactionActionReceiver
 * + ReactionHeadlessTaskService (native) and src/lib/headlessReaction.ts
 * (the actual send). Android only; falls back to a plain notification
 * (no reaction buttons) on iOS/if the native module isn't available, same
 * as showLocalNotification.
 */
export async function showLocalNotificationWithReactions(
  title: string,
  body: string,
  channelId: string,
  messageId: string,
  conversationId: string,
): Promise<void> {
  const truncated = body.length > 100 ? `${body.slice(0, 97)}…` : body;
  if (DirectNotif) {
    DirectNotif.showWithReactions(title, truncated, channelId, messageId, conversationId);
    return;
  }
  await showLocalNotification(title, body, channelId);
}

/**
 * Live/Avatar room invite notification with a "Join" action button.
 * Android only; falls back to a plain notification on iOS.
 */
export async function showLocalNotificationWithJoinAction(
  title: string,
  body: string,
  channelId: string,
  roomType: string,
  roomId: string,
): Promise<void> {
  const truncated = body.length > 100 ? `${body.slice(0, 97)}…` : body;
  if (DirectNotif) {
    DirectNotif.showWithJoinAction(title, truncated, channelId, roomType, roomId);
    return;
  }
  await showLocalNotification(title, body, channelId);
}

/**
 * Schedule a local notification for a specific future timestamp via
 * expo-notifications' OS-level scheduler (AlarmManager on Android,
 * UNNotificationRequest on iOS) — NOT the DirectNotif native module used by
 * showLocalNotification()/scheduleTestNotification() above. DirectNotif's
 * showDelayed() is an in-process Handler.postDelayed that does not survive
 * app/process death, so it can't be used for anything hours out.
 *
 * Returns the notification's identifier (for cancelLocalNotification), or
 * null if scheduling failed/unavailable.
 */
export async function scheduleLocalNotificationAt(
  title: string,
  body: string,
  fireAt: number,
  channelId: string = CH_SOCIAL,
): Promise<string | null> {
  try {
    if (!Notifications || fireAt <= Date.now()) return null;
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelLocalNotification(id: string): Promise<void> {
  try {
    await Notifications?.cancelScheduledNotificationAsync(id);
  } catch {
    /* ignore */
  }
}

// ─── @mention Detection ───────────────────────────────────────────────────────

export function detectMention(content: string, username: string): boolean {
  if (!username) return false;
  return content.toLowerCase().includes(`@${username.toLowerCase()}`);
}

// ─── Serverless Push Sender ───────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export async function sendExpoPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const message: ExpoPushMessage = {
    to: expoPushToken,
    sound: "default",
    title,
    body,
    data,
  };

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo push failed (${response.status}): ${text}`);
  }
}
