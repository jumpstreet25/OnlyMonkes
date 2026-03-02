/**
 * notifications.ts
 *
 * Expo Notifications → Android heads-up + FCM pipeline.
 *
 * Features:
 *  - MAX importance channel → guaranteed heads-up (peek) on Android
 *  - Inline "Reply" action → user replies without opening the app
 *  - ic_notification.png as small status-bar icon (configured in app.config.ts)
 *  - icon.png (adaptive icon) shown as the large notification icon by Android
 */

import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

const SK_PUSH_TOKEN = "push_token";

// Android notification channel — MAX importance = guaranteed heads-up pop-up
export const NOTIFICATION_CHANNEL_ID = "onlymonkes_chat";

// ── Module-level reply callback ───────────────────────────────────────────────
// Set by ChatScreen once XMTP is connected so inline replies go straight to chat.
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
    // ── Channel: MAX importance = heads-up on all Android versions ────────────
    Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: "OnlyMonkes",
      importance: 5,          // AndroidImportance.MAX
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#FFD700",
      enableVibrate: true,
      showBadge: true,
      sound: "default",
      lockscreenVisibility: 1, // AndroidNotificationVisibility.PUBLIC
    }).catch(() => {/* ignore if module not available */});

    // ── Reply action category ─────────────────────────────────────────────────
    // Adds a "Reply" button to every chat notification. Tapping it opens an
    // inline text field; submitting sends the text back to the JS layer via
    // addNotificationResponseReceivedListener below.
    Notifications.setNotificationCategoryAsync("chat_message", [
      {
        identifier: "reply",
        buttonTitle: "Reply",
        textInput: {
          submitButtonTitle: "Send",
          placeholder: "Type a reply…",
        },
        options: {
          opensAppToForeground: true,
        },
      },
    ]).catch(() => {/* ignore */});

    // ── Response listener (module-level, registered once) ─────────────────────
    // Fires when the user taps "Send" on an inline reply.
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

export async function showLocalNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: body.length > 100 ? `${body.slice(0, 97)}…` : body,
        sound: "default",
        // Route to MAX importance channel so Android shows heads-up
        ...(Platform.OS === "android" ? {
          channelId: NOTIFICATION_CHANNEL_ID,
          categoryIdentifier: "chat_message",  // attaches the Reply button
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
