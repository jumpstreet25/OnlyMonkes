/**
 * activityBadges.ts — Soulbound cNFT achievement badges.
 *
 * Tracks user milestones. When a milestone is reached, the badge becomes
 * "claimable" — user can mint a compressed NFT (cNFT) on Solana.
 *
 * Badges are soulbound (non-transferable) and displayed on the user's profile.
 * Minting costs minimal SOL (cNFT = ~0.0001 SOL).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_BADGES = "activity_badges_v1";

export interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  requirement: string;         // Human-readable requirement
  category: "streak" | "trading" | "social" | "special";
  // Threshold checks
  checkFn: (stats: UserStats) => boolean;
}

export interface UserStats {
  totalDaysActive: number;
  currentStreak: number;
  longestStreak: number;
  totalCycles: number;
  tradesExecuted: number;
  tradeWinRate: number;        // 0-100
  messagesSent: number;
  reactionsGiven: number;
  tipsGiven: number;
  bananaBalance: number;
  firstSignalFound: boolean;   // Found a 100% confluence signal
  cratesOpened: number;
  legendaryWins: number;
}

export interface BadgeState {
  earned: string[];            // Badge IDs earned (displayed on profile)
  claimed: string[];           // Badge IDs minted as cNFT
  stats: UserStats;
}

// ─── Badge Catalog ───────────────────────────────────────────────────────────

export const BADGES: Badge[] = [
  // Streak badges
  {
    id: "og_jungle", name: "OG Jungle King", emoji: "🌴",
    description: "Active for 30+ days",
    requirement: "30 days active", category: "streak",
    checkFn: (s) => s.totalDaysActive >= 30,
  },
  {
    id: "streak_warrior", name: "Streak Warrior", emoji: "🔥",
    description: "Complete 4 full 7-day cycles",
    requirement: "4 completed cycles", category: "streak",
    checkFn: (s) => s.totalCycles >= 4,
  },
  {
    id: "iron_will", name: "Iron Will", emoji: "⛓️",
    description: "Longest streak of 14+ days",
    requirement: "14-day streak", category: "streak",
    checkFn: (s) => s.longestStreak >= 14,
  },
  {
    id: "banana_hoarder", name: "Banana Hoarder", emoji: "🍌",
    description: "Accumulate 1000+ bananas",
    requirement: "1000 bananas", category: "streak",
    checkFn: (s) => s.bananaBalance >= 1000,
  },

  // Trading badges
  {
    id: "diamond_hands", name: "Diamond Hands", emoji: "💎",
    description: "Execute 10+ trades",
    requirement: "10 trades", category: "trading",
    checkFn: (s) => s.tradesExecuted >= 10,
  },
  {
    id: "sharp_shooter", name: "Sharp Shooter", emoji: "🎯",
    description: "70%+ trade win rate (min 5 trades)",
    requirement: "70% win rate", category: "trading",
    checkFn: (s) => s.tradesExecuted >= 5 && s.tradeWinRate >= 70,
  },
  {
    id: "eagle_eye", name: "Eagle Eye", emoji: "🦅",
    description: "First to find a 100% confluence signal",
    requirement: "100% signal", category: "trading",
    checkFn: (s) => s.firstSignalFound,
  },
  {
    id: "whale_hunter", name: "Whale Hunter", emoji: "🐋",
    description: "Execute 50+ trades",
    requirement: "50 trades", category: "trading",
    checkFn: (s) => s.tradesExecuted >= 50,
  },

  // Social badges
  {
    id: "chatterbox", name: "Chatterbox", emoji: "💬",
    description: "Send 500+ messages",
    requirement: "500 messages", category: "social",
    checkFn: (s) => s.messagesSent >= 500,
  },
  {
    id: "generous_ape", name: "Generous Ape", emoji: "🎁",
    description: "Give 10+ tips to other monkes",
    requirement: "10 tips given", category: "social",
    checkFn: (s) => s.tipsGiven >= 10,
  },
  {
    id: "reaction_king", name: "Reaction King", emoji: "⚡",
    description: "React to 100+ messages",
    requirement: "100 reactions", category: "social",
    checkFn: (s) => s.reactionsGiven >= 100,
  },

  // Special badges
  {
    id: "lucky_monke", name: "Lucky Monke", emoji: "🍀",
    description: "Win a Legendary from a Loot Crate",
    requirement: "Legendary loot", category: "special",
    checkFn: (s) => s.legendaryWins >= 1,
  },
  {
    id: "crate_addict", name: "Crate Addict", emoji: "📦",
    description: "Open 50+ Loot Crates",
    requirement: "50 crates opened", category: "special",
    checkFn: (s) => s.cratesOpened >= 50,
  },
];

// ─── State Management ────────────────────────────────────────────────────────

const DEFAULT_STATS: UserStats = {
  totalDaysActive: 0, currentStreak: 0, longestStreak: 0, totalCycles: 0,
  tradesExecuted: 0, tradeWinRate: 0, messagesSent: 0, reactionsGiven: 0,
  tipsGiven: 0, bananaBalance: 0, firstSignalFound: false,
  cratesOpened: 0, legendaryWins: 0,
};

export async function loadBadgeState(): Promise<BadgeState> {
  try {
    const raw = await AsyncStorage.getItem(AK_BADGES);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { earned: [], claimed: [], stats: { ...DEFAULT_STATS }, ...parsed };
    }
  } catch { /* ignore */ }
  return { earned: [], claimed: [], stats: { ...DEFAULT_STATS } };
}

async function saveBadgeState(state: BadgeState): Promise<void> {
  await AsyncStorage.setItem(AK_BADGES, JSON.stringify(state));
}

/**
 * Update stats and check for newly earned badges.
 * Returns list of badges earned THIS update (for popup notification).
 */
export async function updateStats(
  patch: Partial<UserStats>,
): Promise<{ newBadges: Badge[]; state: BadgeState }> {
  const state = await loadBadgeState();
  Object.assign(state.stats, patch);

  const newBadges: Badge[] = [];
  for (const badge of BADGES) {
    if (state.earned.includes(badge.id)) continue;
    if (badge.checkFn(state.stats)) {
      state.earned.push(badge.id);
      newBadges.push(badge);
    }
  }

  await saveBadgeState(state);
  return { newBadges, state };
}

/** Mark a badge as claimed (minted as cNFT). */
export async function markBadgeClaimed(badgeId: string): Promise<void> {
  const state = await loadBadgeState();
  if (!state.claimed.includes(badgeId)) {
    state.claimed.push(badgeId);
    await saveBadgeState(state);
  }
}

/** Get all earned but unclaimed badges. */
export async function getClaimableBadges(): Promise<Badge[]> {
  const state = await loadBadgeState();
  return BADGES.filter(b => state.earned.includes(b.id) && !state.claimed.includes(b.id));
}

/** Get all earned badges for profile display. */
export async function getEarnedBadges(): Promise<Badge[]> {
  const state = await loadBadgeState();
  return BADGES.filter(b => state.earned.includes(b.id));
}

/** Get badge progress (how close to earning each unearned badge). */
export async function getBadgeProgress(): Promise<Array<{
  badge: Badge;
  earned: boolean;
  claimed: boolean;
}>> {
  const state = await loadBadgeState();
  return BADGES.map(b => ({
    badge: b,
    earned: state.earned.includes(b.id),
    claimed: state.claimed.includes(b.id),
  }));
}
