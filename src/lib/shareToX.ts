/**
 * shareToX.ts — Auto-prompt "Share to X?" on milestone moments.
 *
 * Pre-built tweets with app branding for:
 *  - Badge earned
 *  - Day 7 banana bonus
 *  - Loot crate win (rare+)
 *  - Leaderboard top 3
 *  - Monke of the Week
 */

import { Linking } from "react-native";

const HANDLE = "@xOnlyMonkes";
const HASHTAGS = "#OnlyMonkes #SagaMonkes #SolanaMobile";

function openTweet(text: string): void {
  const encoded = encodeURIComponent(text);
  Linking.openURL(`https://x.com/intent/tweet?text=${encoded}`).catch(() => {});
}

/** Share a badge earned. */
export function shareBadgeEarned(badgeName: string, badgeEmoji: string): void {
  openTweet(
    `${badgeEmoji} I just earned the "${badgeName}" badge on ${HANDLE}!\n\n` +
    `Saga Monkes holders only. The Future is Monke! 🐒🍌\n\n${HASHTAGS}`
  );
}

/** Share Day 7 banana bonus. */
export function shareDay7Bonus(totalBananas: number, cyclesCompleted: number): void {
  openTweet(
    `🍌 BANANA BONUS! 7-day streak complete on ${HANDLE}!\n\n` +
    `${totalBananas} bananas earned · ${cyclesCompleted} cycles deep\n` +
    `The grind never stops 🐒\n\n${HASHTAGS}`
  );
}

/** Share a rare+ loot crate win. */
export function shareLootWin(rarity: string, itemName: string): void {
  const rarityUpper = rarity.toUpperCase();
  openTweet(
    `🎰 ${rarityUpper} PULL from the Banana Loot Crate on ${HANDLE}!\n\n` +
    `Won: ${itemName}\n` +
    `Fortune favors the Monke 🍌🔥\n\n${HASHTAGS}`
  );
}

/** Share leaderboard achievement (top 3). */
export function shareLeaderboardRank(rank: number, cloutScore: number): void {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  openTweet(
    `${medal} Ranked #${rank} on the MonkeClout Leaderboard!\n\n` +
    `Clout Score: ${cloutScore} · Alpha Ape status on ${HANDLE}\n` +
    `Come dethrone me 🐒👑\n\n${HASHTAGS}`
  );
}

/** Share Monke of the Week. */
export function shareMonkeOfTheWeek(username: string): void {
  openTweet(
    `🏆 I'm the MONKE OF THE WEEK on ${HANDLE}!\n\n` +
    `${username} recognized by AI Agent #9385 for top performance.\n` +
    `The Future is Monke! 🐒🍌\n\n${HASHTAGS}`
  );
}

/** Generic milestone share. */
export function shareMilestone(text: string): void {
  openTweet(`${text}\n\n${HANDLE} — Saga Monkes holders only 🐒\n${HASHTAGS}`);
}
