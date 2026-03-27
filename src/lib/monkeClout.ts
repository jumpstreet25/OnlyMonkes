/**
 * monkeClout.ts — Community reputation scoring system.
 *
 * Tracks: streak length, trade accuracy, chat activity, banana balance.
 * Ranks users. Top 3 get "Alpha Ape" flair displayed in chat.
 * Hermes memory feeds accuracy data. Everything else from local state.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_CLOUT = "monke_clout_v1";

export interface CloutProfile {
  inboxId: string;
  username: string;
  // Scoring inputs
  streakDays: number;        // Current banana streak day (1-7)
  totalCycles: number;       // Completed 7-day cycles
  bananaBalance: number;
  messagesThisWeek: number;
  reactionsGiven: number;
  tradeAccuracyPct: number;  // From Hermes learning (0-100)
  tradesExecuted: number;
  // Computed
  cloutScore: number;        // 0-1000
  rank: number;              // 1 = top
  flair: string | null;      // "Alpha Ape" for top 3, null otherwise
}

export interface CloutLeaderboard {
  profiles: CloutProfile[];
  updatedAt: number;
}

/**
 * Calculate clout score from inputs.
 * Weighted: streaks 20%, trade accuracy 30%, activity 25%, bananas 25%
 */
function calculateScore(p: Omit<CloutProfile, "cloutScore" | "rank" | "flair">): number {
  // Streak score (0-200): cycles * 20 + current day * 5
  const streakScore = Math.min(200, p.totalCycles * 20 + p.streakDays * 5);

  // Trade accuracy score (0-300): accuracy% * 3, bonus for volume
  const tradeScore = Math.min(300,
    p.tradeAccuracyPct * 2 + Math.min(100, p.tradesExecuted * 10)
  );

  // Activity score (0-250): messages + reactions
  const activityScore = Math.min(250,
    Math.min(150, p.messagesThisWeek * 3) + Math.min(100, p.reactionsGiven * 5)
  );

  // Banana score (0-250): log scale so whales don't dominate
  const bananaScore = Math.min(250, Math.log2(Math.max(1, p.bananaBalance)) * 20);

  return Math.round(streakScore + tradeScore + activityScore + bananaScore);
}

/** Load the leaderboard from AsyncStorage. */
export async function loadLeaderboard(): Promise<CloutLeaderboard> {
  try {
    const raw = await AsyncStorage.getItem(AK_CLOUT);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { profiles: [], updatedAt: 0 };
}

/** Save the leaderboard. */
async function saveLeaderboard(lb: CloutLeaderboard): Promise<void> {
  await AsyncStorage.setItem(AK_CLOUT, JSON.stringify(lb));
}

/**
 * Update a user's clout profile and recalculate rankings.
 * Call whenever relevant data changes (streak claim, message sent, trade outcome).
 */
export async function updateCloutProfile(
  inboxId: string,
  username: string,
  data: {
    streakDays?: number;
    totalCycles?: number;
    bananaBalance?: number;
    messagesThisWeek?: number;
    reactionsGiven?: number;
    tradeAccuracyPct?: number;
    tradesExecuted?: number;
  },
): Promise<CloutLeaderboard> {
  const lb = await loadLeaderboard();

  let profile = lb.profiles.find(p => p.inboxId === inboxId);
  if (!profile) {
    profile = {
      inboxId, username,
      streakDays: 0, totalCycles: 0, bananaBalance: 0,
      messagesThisWeek: 0, reactionsGiven: 0,
      tradeAccuracyPct: 0, tradesExecuted: 0,
      cloutScore: 0, rank: 0, flair: null,
    };
    lb.profiles.push(profile);
  }

  // Merge updates
  if (data.streakDays !== undefined) profile.streakDays = data.streakDays;
  if (data.totalCycles !== undefined) profile.totalCycles = data.totalCycles;
  if (data.bananaBalance !== undefined) profile.bananaBalance = data.bananaBalance;
  if (data.messagesThisWeek !== undefined) profile.messagesThisWeek = data.messagesThisWeek;
  if (data.reactionsGiven !== undefined) profile.reactionsGiven = data.reactionsGiven;
  if (data.tradeAccuracyPct !== undefined) profile.tradeAccuracyPct = data.tradeAccuracyPct;
  if (data.tradesExecuted !== undefined) profile.tradesExecuted = data.tradesExecuted;
  profile.username = username;

  // Recalculate all scores and rank
  for (const p of lb.profiles) {
    p.cloutScore = calculateScore(p);
  }
  lb.profiles.sort((a, b) => b.cloutScore - a.cloutScore);
  for (let i = 0; i < lb.profiles.length; i++) {
    lb.profiles[i].rank = i + 1;
    lb.profiles[i].flair = i < 3 ? "Alpha Ape" : null;
  }

  lb.updatedAt = Date.now();
  await saveLeaderboard(lb);
  return lb;
}

/** Get flair for a user (returns "Alpha Ape" for top 3, null otherwise). */
export async function getUserFlair(inboxId: string): Promise<string | null> {
  const lb = await loadLeaderboard();
  return lb.profiles.find(p => p.inboxId === inboxId)?.flair ?? null;
}

/** Get top N profiles for the leaderboard display. */
export async function getTopProfiles(n: number = 10): Promise<CloutProfile[]> {
  const lb = await loadLeaderboard();
  return lb.profiles.slice(0, n);
}

/** Rank medals for display. */
export function getRankDisplay(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}
