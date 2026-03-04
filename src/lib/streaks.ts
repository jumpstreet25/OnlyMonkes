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
    data.isLegendary = data.streak >= 7;
    data.lastLoginDate = today;

    const justHitLegendary = data.isLegendary && !wasLegendary;

    await AsyncStorage.setItem(AK_STREAK, JSON.stringify(data));
    useAppStore.getState().setLoginStreak(data.streak, data.bestStreak, data.isLegendary);

    return { newStreak: data.streak, justHitLegendary };
  } catch {
    return { newStreak: 0, justHitLegendary: false };
  }
}
