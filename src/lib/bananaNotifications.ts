/**
 * bananaNotifications.ts — Push notification hooks for the banana reward system.
 *
 * Sends local notifications for:
 *  - Streak at risk (haven't opened app in 20+ hours)
 *  - Loot crate available (when balance hits 50+)
 *  - Leaderboard change (passed by another user)
 *  - New limited drop / auction
 *  - Monke of the Week announcement
 */

import { showLocalNotification, CH_ALL } from "@/lib/notifications";
import { loadBananaState } from "@/lib/bananaRewards";

const TWENTY_HOURS = 20 * 60 * 60 * 1000;

/**
 * Check banana system state and fire relevant notifications.
 * Called from background sync or app resume.
 */
export async function checkBananaNotifications(): Promise<void> {
  const state = await loadBananaState();
  const now = Date.now();

  // Streak at risk — logged in 20+ hours ago but less than 24
  if (state.lastClaimTs > 0) {
    const timeSince = now - state.lastClaimTs;
    if (timeSince >= TWENTY_HOURS && timeSince < 24 * 60 * 60 * 1000) {
      await showLocalNotification(
        "Your streak is at risk! 🔥",
        `Day ${state.streakDay}/7 — log in before midnight to keep your banana streak going!`,
        CH_ALL,
      );
    }
  }

  // Loot crate reminder — balance >= 50 and hasn't spun recently
  if (state.balance >= 50) {
    // Only remind once per day
    const lastReminder = await getLastNotifTime("loot_reminder");
    if (now - lastReminder > 24 * 60 * 60 * 1000) {
      await showLocalNotification(
        "Loot Crate ready! 🎰",
        `You have ${state.balance} 🍌 — spin the Banana Loot Crate for a chance at rare items!`,
        CH_ALL,
      );
      await setLastNotifTime("loot_reminder", now);
    }
  }
}

/** Notify when user is passed on the leaderboard. */
export async function notifyLeaderboardChange(
  oldRank: number,
  newRank: number,
  passedByUsername: string,
): Promise<void> {
  if (newRank > oldRank) {
    await showLocalNotification(
      "You've been passed! 📉",
      `${passedByUsername} just took your #${oldRank} spot on the MonkeClout leaderboard. Fight back!`,
      CH_ALL,
    );
  }
}

/** Notify about a new limited drop / auction. */
export async function notifyNewAuction(auctionName: string, endsIn: string): Promise<void> {
  await showLocalNotification(
    "Limited Drop! 🔥",
    `${auctionName} — bidding ends in ${endsIn}. Don't miss out!`,
    CH_ALL,
  );
}

/** Notify Monke of the Week. */
export async function notifyMonkeOfTheWeek(username: string): Promise<void> {
  await showLocalNotification(
    "🏆 Monke of the Week!",
    `${username} has been crowned this week's top Monke by AI Agent #9385!`,
    CH_ALL,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_NOTIF_TIMES = "banana_notif_times_v1";

async function getLastNotifTime(key: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(AK_NOTIF_TIMES);
    const data = raw ? JSON.parse(raw) : {};
    return data[key] ?? 0;
  } catch { return 0; }
}

async function setLastNotifTime(key: string, ts: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_NOTIF_TIMES);
    const data = raw ? JSON.parse(raw) : {};
    data[key] = ts;
    await AsyncStorage.setItem(AK_NOTIF_TIMES, JSON.stringify(data));
  } catch { /* ignore */ }
}
