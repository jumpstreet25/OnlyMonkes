/**
 * Streak, banana-cycle and badge-progress numbers in PROFILE_UPDATE (`pg`), so the bot keeps them
 * with the wallet record and /reclaim or a new phone restores them. Before this they lived only on
 * the phone, and every phone change or 3.1 upgrade reset Streak and Cycles to 1 (Saga test 2026-11-19).
 *
 * Merging always keeps the better number; a restore never lowers anything on this phone.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadBananaState, saveBananaState } from "@/lib/bananaRewards";
import { getProgress, restoreBadgeProgress } from "@/lib/badges";
import { mergeRemoteStreak, STREAK_STORAGE_KEY } from "@/lib/streaks";

export type ProgressSnapshot = {
  ls: number; // login streak
  bs: number; // best login streak
  ld: string; // last login day, YYYY-MM-DD
  lg: boolean; // legendary (7-day streak earned once)
  sd: number; // banana claim day in the 7-day cycle
  tc: number; // completed 7-day cycles
  lc: number; // last banana claim, epoch ms
  te: number; // lifetime bananas earned
  ms: number; // messages sent
  rg: number; // reactions given
  lw: number; // leaderboard wins
};

const MAX_COUNT = 10_000_000;
const int = (v: unknown, max = MAX_COUNT): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0;

/** Validate untrusted input (bot snapshot, PROFILE_UPDATE). Null when nothing usable. */
export function parseProgress(raw: unknown): ProgressSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ld = typeof r.ld === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.ld) ? r.ld : "";
  const lc = int(r.lc, Date.now() + 86_400_000);
  return {
    ls: int(r.ls, 100_000), bs: int(r.bs, 100_000), ld, lg: r.lg === true || r.lg === 1,
    sd: int(r.sd, 7), tc: int(r.tc, 100_000), lc, te: int(r.te),
    ms: int(r.ms), rg: int(r.rg), lw: int(r.lw, 100_000),
  };
}

/** This phone's numbers, for PROFILE_UPDATE. Never throws. */
export async function collectProgress(): Promise<ProgressSnapshot | null> {
  try {
    const [streakRaw, banana] = await Promise.all([AsyncStorage.getItem(STREAK_STORAGE_KEY), loadBananaState()]);
    const s = streakRaw ? JSON.parse(streakRaw) : {};
    const p = getProgress();
    return parseProgress({
      ls: s.streak, bs: s.bestStreak, ld: s.lastLoginDate, lg: s.isLegendary,
      sd: banana.streakDay, tc: banana.totalCycles, lc: banana.lastClaimTs, te: banana.totalEarned,
      ms: p.messages_sent, rg: p.reactions_given, lw: p.leaderboard_wins,
    });
  } catch {
    return null;
  }
}

/** Apply restored numbers on this phone (keeps the higher of each). */
export async function applyProgress(remote: ProgressSnapshot): Promise<void> {
  await mergeRemoteStreak({ streak: remote.ls, bestStreak: remote.bs, lastLoginDate: remote.ld, isLegendary: remote.lg });

  const b = await loadBananaState();
  const next = { ...b, totalCycles: Math.max(b.totalCycles, remote.tc), totalEarned: Math.max(b.totalEarned, remote.te) };
  // The more recent claim decides where the 7-day cycle stands; the claim logic handles a broken run.
  if (remote.lc > b.lastClaimTs) { next.lastClaimTs = remote.lc; next.streakDay = remote.sd; }
  if (next.totalCycles !== b.totalCycles || next.totalEarned !== b.totalEarned || next.lastClaimTs !== b.lastClaimTs) {
    await saveBananaState(next);
  }

  restoreBadgeProgress({ messages_sent: remote.ms, reactions_given: remote.rg, leaderboard_wins: remote.lw, best_streak: remote.bs });
}
