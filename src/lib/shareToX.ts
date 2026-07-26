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
 * Primary path is react-native-share's shareSingle(), targeting the X app
 * directly with BOTH the image and the caption in one native share-sheet
 * call. Falls back to the original stopgap (gallery save + clipboard copy
 * + text-only tweet-intent URL) if shareSingle throws — most commonly
 * because the X app isn't installed, or (on this OTA specifically) because
 * this app binary doesn't have the react-native-share native module
 * compiled in yet (added in a later native build) — either way this
 * degrades gracefully rather than crashing. Still saves to gallery first
 * either way as a defensive backup regardless of which path succeeds.
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
    // non-fatal — still proceed; worst case the user has no gallery backup.
  }

  try {
    const { default: Share, Social } = await import("react-native-share");
    await Share.shareSingle({
      message,
      url: imageUri,
      social: Social.Twitter,
      type: "image/*",
    });
    return { saved };
  } catch {
    // X app not installed, native module unavailable, or any other
    // native-share failure — fall back to the text-only intent URL so the
    // caption at least still prefills.
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

/** Share Day 7 banana bonus. Falls back to the static template below when
 *  no AI-generated caption is passed (e.g. the bot didn't respond in time —
 *  see requestStreakCaption/getAndClearStreakCaption in imageCaption.ts). */
export function shareDay7Bonus(totalBananas: number, cyclesCompleted: number, aiCaption?: string | null): void {
  if (aiCaption) {
    openTweet(`${aiCaption}\n\n${HASHTAGS}`);
    return;
  }
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
