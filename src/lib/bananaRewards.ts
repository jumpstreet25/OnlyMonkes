/**
 * bananaRewards.ts — Daily banana reward system.
 *
 * 7-day cycle: earn escalating bananas each day. Day 7 = bonus.
 * Streak does NOT reset on missed days — picks up where you left off.
 * After Day 7 bonus, cycle resets to Day 1.
 * "Day" = 24 hours since last claim.
 *
 * Bananas are in-app currency for UI customization only.
 * Not tradeable, not visible to others (except leaderboard).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_BANANAS = "banana_rewards_v1";

// Reward schedule: day number (1-7) → bananas earned
const DAILY_REWARDS: Record<number, number> = {
  1: 5,
  2: 5,
  3: 10,
  4: 10,
  5: 15,
  6: 15,
  7: 50, // Day 7 BONUS
};

export interface BananaState {
  balance: number;        // Total bananas accumulated
  streakDay: number;      // Current day in cycle (1-7)
  lastClaimTs: number;    // Timestamp of last claim (epoch ms)
  totalCycles: number;    // How many full 7-day cycles completed
  totalEarned: number;    // Lifetime bananas earned
}

const DEFAULT_STATE: BananaState = {
  balance: 0,
  streakDay: 0,
  lastClaimTs: 0,
  totalCycles: 0,
  totalEarned: 0,
};

export interface ClaimResult {
  claimed: boolean;        // true if bananas were claimed this session
  alreadyClaimed: boolean; // true if user already claimed today
  earned: number;          // bananas earned this claim (0 if already claimed)
  streakDay: number;       // current day in cycle (1-7)
  isBonus: boolean;        // true if this was Day 7 bonus
  daysUntilBonus: number;  // how many more days until Day 7
  balance: number;         // total banana balance after claim
  state: BananaState;      // full state for persistence
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/** Load banana state from AsyncStorage. */
export async function loadBananaState(): Promise<BananaState> {
  try {
    const raw = await AsyncStorage.getItem(AK_BANANAS);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Save banana state to AsyncStorage. */
export async function saveBananaState(state: BananaState): Promise<void> {
  await AsyncStorage.setItem(AK_BANANAS, JSON.stringify(state));
}

/**
 * Check and claim daily banana reward.
 * Call once on app open — handles the 24h cooldown and streak progression.
 */
export async function claimDailyBananas(): Promise<ClaimResult> {
  const state = await loadBananaState();
  const now = Date.now();

  // Already claimed within the last 24 hours
  if (state.lastClaimTs > 0 && (now - state.lastClaimTs) < TWENTY_FOUR_HOURS) {
    return {
      claimed: false,
      alreadyClaimed: true,
      earned: 0,
      streakDay: state.streakDay,
      isBonus: false,
      daysUntilBonus: 7 - state.streakDay,
      balance: state.balance,
      state,
    };
  }

  // Advance streak day (doesn't reset on missed days — just picks up)
  let nextDay = state.streakDay + 1;
  if (nextDay > 7) nextDay = 1; // Cycle complete, restart

  const earned = DAILY_REWARDS[nextDay] ?? 5;
  const isBonus = nextDay === 7;

  state.streakDay = nextDay;
  state.lastClaimTs = now;
  state.balance += earned;
  state.totalEarned += earned;
  if (isBonus) state.totalCycles += 1;

  await saveBananaState(state);

  return {
    claimed: true,
    alreadyClaimed: false,
    earned,
    streakDay: nextDay,
    isBonus,
    daysUntilBonus: isBonus ? 0 : 7 - nextDay,
    balance: state.balance,
    state,
  };
}

/** Add bananas to the balance (persists to AsyncStorage). Used for welcome bonus, loot wins, etc. */
export async function addBananas(amount: number): Promise<number> {
  const state = await loadBananaState();
  state.balance += amount;
  state.totalEarned += amount;
  await saveBananaState(state);
  return state.balance;
}

/** Get current balance without claiming. */
export async function getBananaBalance(): Promise<number> {
  const state = await loadBananaState();
  return state.balance;
}

/** Spend bananas (for UI purchases). Returns false if insufficient balance. */
export async function spendBananas(amount: number): Promise<boolean> {
  const state = await loadBananaState();
  if (state.balance < amount) return false;
  state.balance -= amount;
  await saveBananaState(state);
  return true;
}

/** Merge balance from another device (same wallet). Takes MAX to prevent loss. */
export async function mergeBananaBalance(remoteBalance: number): Promise<number> {
  const state = await loadBananaState();
  if (remoteBalance > state.balance) {
    const delta = remoteBalance - state.balance;
    state.balance = remoteBalance;
    state.totalEarned += delta;
    await saveBananaState(state);
  }
  return state.balance;
}
