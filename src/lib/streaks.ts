import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '@/store/appStore';

const AK_STREAK = 'login_streak_v1';

interface StreakData {
  streak: number;
  bestStreak: number;
  lastLoginDate: string; // 'YYYY-MM-DD'
  isLegendary: boolean;
}

function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Restore a user's streak to a known state (admin recovery).
 * Used when a streak is lost due to a bug (e.g., app update, timezone edge case).
 */
export async function restoreStreak(streak: number, bestStreak: number, isLegendary: boolean): Promise<void> {
  const data: StreakData = {
    streak,
    bestStreak: Math.max(streak, bestStreak),
    lastLoginDate: getTodayISO(),
    isLegendary,
  };
  await AsyncStorage.setItem(AK_STREAK, JSON.stringify(data));
  useAppStore.getState().setLoginStreak(data.streak, data.bestStreak, data.isLegendary);
}

export async function checkAndUpdateStreak(): Promise<{
  newStreak: number;
  justHitLegendary: boolean;
}> {
  try {
    const raw = await AsyncStorage.getItem(AK_STREAK);
    const today = getTodayISO();

    let data: StreakData = raw
      ? JSON.parse(raw)
      : { streak: 0, bestStreak: 0, lastLoginDate: '', isLegendary: false };

    // One-time fix: restore legendary if bestStreak proves it was earned
    if (!data.isLegendary && data.bestStreak >= 7) {
      data.isLegendary = true;
    }

    if (data.lastLoginDate === today) {
      // Already logged in today — no change
      useAppStore.getState().setLoginStreak(data.streak, data.bestStreak, data.isLegendary);
      return { newStreak: data.streak, justHitLegendary: false };
    }

    const wasLegendary = data.isLegendary;

    if (data.lastLoginDate === getYesterdayISO()) {
      data.streak += 1;
    } else {
      data.streak = 1;
    }

    data.bestStreak = Math.max(data.bestStreak, data.streak);
    // Legendary is permanent once earned — never revoked on streak reset
    if (data.streak >= 7) data.isLegendary = true;
    data.lastLoginDate = today;

    const justHitLegendary = data.isLegendary && !wasLegendary;

    await AsyncStorage.setItem(AK_STREAK, JSON.stringify(data));
    useAppStore.getState().setLoginStreak(data.streak, data.bestStreak, data.isLegendary);

    return { newStreak: data.streak, justHitLegendary };
  } catch {
    return { newStreak: 0, justHitLegendary: false };
  }
}
