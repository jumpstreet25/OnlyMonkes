/**
 * notifications.ts
 *
 * Expo Notifications → Google FCM pipeline.
 *
 * Flow:
 *   1. App opens → registerForPushNotifications() called in ChatScreen
 *   2. Device requests Expo push token (Expo Push Service ↔ FCM)
 *   3. Token stored in SecureStore and optionally sent to your backend
 *   4. Backend uses sendExpoPushNotification() to deliver messages via Expo API
 *
 * Expo Push Service docs: https://docs.expo.dev/push-notifications/overview/
 *
 * To finish FCM setup:
 *   a. Create a Firebase project → download google-services.json → place in android/app/
 *   b. Run: npx eas build:configure  (adds EAS project ID to app.config.ts)
 *   c. Set extra.eas.projectId in app.config.ts
 */

import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const SK_PUSH_TOKEN = "push_token";

// ─── Lazy-load the native module ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
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

/**
 * Requests permissions, gets the Expo push token for this device,
 * and caches it in SecureStore. Returns null if unavailable.
 *
 * Pass the returned token to your backend so it can send push notifications
 * via sendExpoPushNotification() or Expo's REST API.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Notifications) return null;

    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    // Return cached token if we already registered this session
    const stored = await SecureStore.getItemAsync(SK_PUSH_TOKEN);
    if (stored) return stored;

    // Expo Push Service needs the EAS project ID for production tokens.
    // Configure via: app.config.ts extra.eas.projectId
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

/**
 * Returns the cached push token without re-registering.
 */
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
        sound: true,
      },
      trigger: null, // show immediately
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

/**
 * Send a push notification via Expo's Push Service.
 *
 * Call this from your backend / serverless function (Vercel, Cloudflare, etc.)
 * with the recipient's Expo push token.
 *
 * Example serverless usage:
 *   import { sendExpoPushNotification } from "@/lib/notifications";
 *   await sendExpoPushNotification(token, "New message", "Jump.skr: gm!");
 */
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
