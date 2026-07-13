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

/**
 * Share a locally-generated image (e.g. a captured share card) to X.
 *
 * React Native's core `Share.share({ url, message })` — used by the older
 * PnLCardModal flow — only reliably attaches `url` as content on iOS; on
 * Android it's inconsistent and frequently drops the image entirely,
 * leaving users to manually save + re-attach (the exact complaint this
 * exists to fix). A real fix needs expo-sharing or react-native-share, both
 * of which require a native rebuild + fresh dApp Store release — deferred.
 *
 * This is the OTA-safe stopgap: save the image to the gallery, copy the
 * caption to clipboard as a defensive backup, and open X's compose screen
 * with the caption already prefilled via the tweet-intent URL (this part
 * already works reliably — it's what every text-only share above uses).
 * The user's only remaining manual step is tapping X's own image-picker
 * icon and selecting the photo just saved (always the newest gallery item).
 */
export async function shareImageToX(
  imageUri: string,
  message: string,
): Promise<{ saved: boolean }> {
  let saved = false;
  try {
    const MediaLibrary = await import("expo-media-library");
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === "granted") {
      await MediaLibrary.saveToLibraryAsync(imageUri);
      saved = true;
    }
  } catch {
    // non-fatal — still proceed to open the compose screen with prefilled
    // text; worst case the user has no image to attach this one time.
  }

  try {
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(message);
  } catch {
    // non-fatal — the tweet-intent URL below still prefills the text.
  }

  openTweet(message);
  return { saved };
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
