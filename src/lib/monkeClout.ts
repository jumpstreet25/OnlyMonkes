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
  predictionAccuracyPct: number; // MonkePredictions win rate (0-100)
  predictionsTotal: number;
  betAccuracyPct: number;    // MonkeBets win rate (0-100)
  betsTotal: number;
  communityAlphaWins: number; // CONFIRM commands that preceded winners
  communityAlphaTotal: number;
  // Computed
  cloutScore: number;        // 0-1200 (expanded from 1000)
  rank: number;              // 1 = top
  flair: string | null;      // "Alpha Ape" for top 3, null otherwise
}

export interface CloutLeaderboard {
  profiles: CloutProfile[];
  updatedAt: number;
}

/**
 * Calculate clout score from inputs.
 * Weighted: streaks 15%, trades 20%, predictions 10%, bets 10%,
 *           community alpha 10%, activity 15%, bananas 20%
 */
function calculateScore(p: Omit<CloutProfile, "cloutScore" | "rank" | "flair">): number {
  // Streak score (0-180): cycles * 20 + current day * 5
  const streakScore = Math.min(180, p.totalCycles * 20 + p.streakDays * 5);

  // Trade accuracy score (0-240): accuracy% * 2 + volume bonus
  const tradeScore = Math.min(240,
    p.tradeAccuracyPct * 1.5 + Math.min(90, p.tradesExecuted * 10)
  );

  // Prediction accuracy (0-120): WR * 1 + volume bonus (min 3 predictions)
  const predScore = p.predictionsTotal >= 3
    ? Math.min(120, p.predictionAccuracyPct * 0.8 + Math.min(40, p.predictionsTotal * 5))
    : 0;

  // Bet accuracy (0-120): WR * 1 + volume bonus (min 3 bets)
  const betScore = p.betsTotal >= 3
    ? Math.min(120, p.betAccuracyPct * 0.8 + Math.min(40, p.betsTotal * 5))
    : 0;

  // Community Alpha (0-120): early CONFIRM wins
  const alphaScore = p.communityAlphaTotal >= 3
    ? Math.min(120, (p.communityAlphaWins / Math.max(1, p.communityAlphaTotal)) * 100 + p.communityAlphaWins * 5)
    : 0;

  // Activity score (0-180): messages + reactions
  const activityScore = Math.min(180,
    Math.min(120, p.messagesThisWeek * 3) + Math.min(60, p.reactionsGiven * 4)
  );

  // Banana score (0-240): log scale
  const bananaScore = Math.min(240, Math.log2(Math.max(1, p.bananaBalance)) * 20);

  return Math.round(streakScore + tradeScore + predScore + betScore + alphaScore + activityScore + bananaScore);
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
    predictionAccuracyPct?: number;
    predictionsTotal?: number;
    betAccuracyPct?: number;
    betsTotal?: number;
    communityAlphaWins?: number;
    communityAlphaTotal?: number;
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
      predictionAccuracyPct: 0, predictionsTotal: 0,
      betAccuracyPct: 0, betsTotal: 0,
      communityAlphaWins: 0, communityAlphaTotal: 0,
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
  if (data.predictionAccuracyPct !== undefined) profile.predictionAccuracyPct = data.predictionAccuracyPct;
  if (data.predictionsTotal !== undefined) profile.predictionsTotal = data.predictionsTotal;
  if (data.betAccuracyPct !== undefined) profile.betAccuracyPct = data.betAccuracyPct;
  if (data.betsTotal !== undefined) profile.betsTotal = data.betsTotal;
  if (data.communityAlphaWins !== undefined) profile.communityAlphaWins = data.communityAlphaWins;
  if (data.communityAlphaTotal !== undefined) profile.communityAlphaTotal = data.communityAlphaTotal;
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
  // Update in-memory flair cache
  _flairCache = new Map();
  for (const p of lb.profiles) {
    if (p.flair) _flairCache.set(p.inboxId, p.flair);
  }
  return lb;
}

/** Get flair for a user (returns "Alpha Ape" for top 3, null otherwise). */
export async function getUserFlair(inboxId: string): Promise<string | null> {
  const lb = await loadLeaderboard();
  return lb.profiles.find(p => p.inboxId === inboxId)?.flair ?? null;
}

// ─── In-memory flair cache for synchronous access (MessageBubble) ────────────

let _flairCache: Map<string, string> = new Map();

/** Load flair cache from AsyncStorage. Call once at startup. */
export async function loadFlairCache(): Promise<void> {
  const lb = await loadLeaderboard();
  _flairCache = new Map();
  for (const p of lb.profiles) {
    if (p.flair) _flairCache.set(p.inboxId, p.flair);
  }
}

/** Synchronous flair lookup for use in render. */
export function getFlairSync(inboxId: string): string | null {
  return _flairCache.get(inboxId) ?? null;
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

// ─── Clout tiers ───────────────────────────────────────────────────────────────
// Thresholds are rough placeholders, not data-derived — updateCloutProfile()
// currently has exactly one call site in the whole app, so realistic scores
// are well below the theoretical 1200 max. Calibrate once real usage data exists.
export const CLOUT_TIERS: { min: number; name: string }[] = [
  { min: 0, name: "Newcomer" },
  { min: 50, name: "Regular" },
  { min: 120, name: "Trusted Monke" },
  { min: 220, name: "Respected Monke" },
  { min: 350, name: "Elite Monke" },
  { min: 500, name: "Alpha Monke" },
];

/** Index into CLOUT_TIERS for a given score — higher index = higher tier. */
export function cloutTierIndex(score: number): number {
  let idx = 0;
  for (let i = 0; i < CLOUT_TIERS.length; i++) {
    if (score >= CLOUT_TIERS[i].min) idx = i;
  }
  return idx;
}

/** Tier name for a given score. */
export function getCloutTier(score: number): string {
  return CLOUT_TIERS[cloutTierIndex(score)].name;
}
