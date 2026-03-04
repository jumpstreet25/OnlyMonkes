/**
 * notifications.ts
 *
 * Expo Notifications → Android heads-up + FCM pipeline.
 *
 * Android channel structure (visible in Settings → App info → Notifications):
 *  ┌─ OnlyMonkes (group)
 *  │   ├─ All Notifications   [om_all]      — every chat message
 *  │   ├─ @Mentions           [om_mentions] — messages that @mention you
 *  │   └─ Bot Notifications   [om_bot]      — AI Agent trade/sales alerts
 *  └─
 *
 * Legacy channels (onlymonkes_chat, onlymonkes_chat_v2) are deleted on startup
 * so they no longer appear in the settings list.
 */

import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

const SK_PUSH_TOKEN = "push_token";

// ── Channel IDs ───────────────────────────────────────────────────────────────
export const CH_ALL      = "om_all";       // regular chat messages
export const CH_MENTIONS = "om_mentions";  // @mention messages
export const CH_BOT      = "om_bot";       // bot alerts (AI Agent #9385)

const CHANNEL_GROUP_ID = "onlymonkes";

// ── Module-level reply callback ───────────────────────────────────────────────
let _replyHandler: ((text: string) => void) | null = null;

export function setNotificationReplyHandler(fn: (text: string) => void): void {
  _replyHandler = fn;
}

// ── Lazy-load native module ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");

  // Show notification even when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === "android") {
    // ── Delete old channels so they vanish from Android's list ────────────────
    // Android caches channel definitions forever; deleting them cleans the list.
    (async () => {
      for (const old of ["onlymonkes_chat", "onlymonkes_chat_v2", "default"]) {
        try { await Notifications.deleteNotificationChannelAsync(old); } catch { /* ignore */ }
      }
    })();

    // ── Channel group — "OnlyMonkes" ──────────────────────────────────────────
    Notifications.setNotificationChannelGroupAsync(CHANNEL_GROUP_ID, {
      name: "OnlyMonkes",
    }).catch(() => {/* ignore */});

    // Shared settings for all channels
    const BASE = {
      groupId:              CHANNEL_GROUP_ID,
      importance:           5,           // AndroidImportance.MAX — heads-up
      vibrationPattern:     [0, 200, 100, 200] as number[],
      lightColor:           "#FFD700",
      enableVibrate:        true,
      showBadge:            true,
      sound:                "default",
      lockscreenVisibility: 1,           // AndroidNotificationVisibility.PUBLIC
    };

    Notifications.setNotificationChannelAsync(CH_ALL, {
      ...BASE,
      name: "All Notifications",
    }).catch(() => {});

    Notifications.setNotificationChannelAsync(CH_MENTIONS, {
      ...BASE,
      name: "@Mentions",
    }).catch(() => {});

    Notifications.setNotificationChannelAsync(CH_BOT, {
      ...BASE,
      importance: 4,      // HIGH — still heads-up but one step below MAX
      name: "Bot Notifications",
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
    ]).catch(() => {});

    // ── Response listener (module-level, registered once) ─────────────────────
    Notifications.addNotificationResponseReceivedListener((response: any) => {
      if (
        response.actionIdentifier === "reply" &&
        typeof response.userText === "string" &&
        response.userText.trim()
      ) {
        _replyHandler?.(response.userText.trim());
      }
    });
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

    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const stored = await SecureStore.getItemAsync(SK_PUSH_TOKEN);
    if (stored) return stored;

    const projectId: string | undefined =
      (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas?.projectId as string | undefined ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token: string = tokenResponse.data;

    await SecureStore.setItemAsync(SK_PUSH_TOKEN, token);
    console.log("[Notifications] Expo push token:", token);
    return token;
  } catch (err) {
    console.warn("[Notifications] registerForPushNotifications failed:", err);
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
 * Show an immediate local notification.
 * Pass one of CH_ALL, CH_MENTIONS, or CH_BOT as `channelId`.
 * Defaults to CH_ALL.
 */
export async function showLocalNotification(
  title: string,
  body: string,
  channelId: string = CH_ALL,
): Promise<void> {
  try {
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: body.length > 100 ? `${body.slice(0, 97)}…` : body,
        sound: "default",
        ...(Platform.OS === "android" ? {
          channelId,
          // Attach Reply action only on chat channels (not bot)
          ...(channelId !== CH_BOT ? { categoryIdentifier: "chat_message" } : {}),
        } : {}),
      },
      trigger: null, // immediate
    });
  } catch {
    // Silently ignore — permission denied or module not ready
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
