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

import {
  showLocalNotification,
  scheduleLocalNotificationAt,
  cancelLocalNotification,
  CH_SOCIAL,
} from "@/lib/notifications";
import { loadBananaState } from "@/lib/bananaRewards";
import { CLOUT_TIERS, cloutTierIndex } from "@/lib/monkeClout";

const TWENTY_HOURS = 20 * 60 * 60 * 1000;

/**
 * Check banana system state and fire relevant notifications.
 * Called from background sync or app resume.
 */
export async function checkBananaNotifications(): Promise<void> {
  const state = await loadBananaState();
  const now = Date.now();

  // Streak at risk — only notify if app is NOT currently being opened
  // (This function is called on app open, so the user IS here — don't nag them)
  // The notification is for background/push scenarios only
  // Skip the at-risk check when called from foreground

  // Loot crate reminder — balance >= 50 and hasn't spun recently
  if (state.balance >= 50) {
    // Only remind once per day
    const lastReminder = await getLastNotifTime("loot_reminder");
    if (now - lastReminder > 24 * 60 * 60 * 1000) {
      await showLocalNotification(
        "Loot Crate ready! 🎰",
        `You have ${state.balance} 🍌 — spin the Banana Loot Crate for a chance at rare items!`,
        CH_SOCIAL,
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
      CH_SOCIAL,
    );
  }
}

/** Notify about a new limited drop / auction. */
export async function notifyNewAuction(auctionName: string, endsIn: string): Promise<void> {
  await showLocalNotification(
    "Limited Drop! 🔥",
    `${auctionName} — bidding ends in ${endsIn}. Don't miss out!`,
    CH_SOCIAL,
  );
}

/** Notify Monke of the Week. */
export async function notifyMonkeOfTheWeek(username: string): Promise<void> {
  await showLocalNotification(
    "🏆 Monke of the Week!",
    `${username} has been crowned this week's top Monke by AI Agent #9385!`,
    CH_SOCIAL,
  );
}

// ─── Streak-about-to-expire (scheduled, on-device) ─────────────────────────────

const AK_STREAK_NOTIF_ID = "banana_streak_notif_id_v1";

/**
 * Schedule a local notification ~20h after `lastClaimTs` warning the user
 * their streak is about to lapse. Cancels/replaces any prior pending one —
 * safe to call after every claim, only the newest scheduled fire matters.
 */
export async function scheduleStreakExpiryWarning(lastClaimTs: number): Promise<void> {
  await cancelStreakExpiryWarning();
  const fireAt = lastClaimTs + TWENTY_HOURS;
  const id = await scheduleLocalNotificationAt(
    "Your streak is slipping! 🍌",
    "Claim today's bananas before your streak resets.",
    fireAt,
  );
  if (id) await AsyncStorage.setItem(AK_STREAK_NOTIF_ID, id).catch(() => {});
}

export async function cancelStreakExpiryWarning(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_STREAK_NOTIF_ID);
    if (raw) {
      await cancelLocalNotification(raw);
      await AsyncStorage.removeItem(AK_STREAK_NOTIF_ID);
    }
  } catch {
    /* ignore */
  }
}

// ─── Clout tier rank-up (immediate) ────────────────────────────────────────────

const AK_CLOUT_LAST_TIER = "monke_clout_last_tier_v1"; // Record<inboxId, tierIndex>

async function readTierMap(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(AK_CLOUT_LAST_TIER);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeTierMap(map: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(AK_CLOUT_LAST_TIER, JSON.stringify(map)).catch(() => {});
}

/**
 * Fire a local notification when the caller's own Clout score crosses into a
 * new (higher) tier. Persists the tier on every change (up or down) so
 * dropping back to a previously-seen tier doesn't re-fire.
 */
export async function notifyCloutTierUp(inboxId: string, newScore: number): Promise<void> {
  const newTierIdx = cloutTierIndex(newScore);
  const map = await readTierMap();
  const prevIdx = map[inboxId] ?? 0;
  if (newTierIdx === prevIdx) return;

  map[inboxId] = newTierIdx;
  await writeTierMap(map);

  if (newTierIdx > prevIdx) {
    await showLocalNotification(
      "🐒 Your Monke ranked up!",
      `You're now a ${CLOUT_TIERS[newTierIdx].name} in Monke Clout — keep grinding!`,
      CH_SOCIAL,
    );
  }
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
