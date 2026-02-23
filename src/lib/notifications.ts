/**
 * notifications.ts
 *
 * Graceful wrapper around expo-notifications.
 *
 * expo-notifications ships native code that requires the app to be rebuilt
 * (npx expo run:android) before the native module is available. Until then
 * every function here is a safe no-op — the app will never crash because of
 * a missing native module.
 *
 * Once the app is rebuilt all functionality activates automatically:
 *  - Foreground local notifications for new chat messages
 *  - @mention detection — notifies when your username is mentioned
 *  - Push token registration for future backend integration
 */

import * as SecureStore from "expo-secure-store";

const SK_PUSH_TOKEN = "push_token";

// ─── Lazy-load the native module ─────────────────────────────────────────────
// Using require() inside try-catch so a missing native module doesn't crash
// the JS bundle on devices where the app hasn't been rebuilt yet.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");

  // Configure how notifications appear when the app is in the foreground.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // Native module not available yet.
  // Rebuild with: npx expo run:android
}

// ─── Permissions & Token ──────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (!Notifications) return false;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Registers this device for push notifications and caches the Expo push token.
 * Pass this token to your backend to send remote push notifications.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Notifications) return null;

    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const stored = await SecureStore.getItemAsync(SK_PUSH_TOKEN);
    if (stored) return stored;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await SecureStore.setItemAsync(SK_PUSH_TOKEN, token);
    return token;
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
    // Silently ignore — e.g. permission denied or module not ready
  }
}

// ─── @mention Detection ───────────────────────────────────────────────────────

/**
 * Returns true if `content` contains "@username" (case-insensitive).
 */
export function detectMention(content: string, username: string): boolean {
  if (!username) return false;
  return content.toLowerCase().includes(`@${username.toLowerCase()}`);
}
