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
 * 2026-07-18: primary path is now react-native-share's shareSingle(),
 * targeting the X app directly with BOTH the image and the caption in one
 * native share-sheet call — no more manual save-and-reattach. This needed
 * a native rebuild (new autolinked module + an AndroidManifest <queries>
 * entry for X's package, com.twitter.android), which is why it was
 * deferred when this file was first written. RN core `Share.share()` was
 * tried before that and rejected — reliably attaches `url` on iOS but
 * inconsistent on Android, frequently dropping the image entirely.
 *
 * Falls back to the ORIGINAL stopgap (gallery save + clipboard copy +
 * text-only tweet-intent URL) if shareSingle throws — most commonly
 * because the X app isn't installed on the device, which shareSingle
 * can't work around (unlike the web-intent fallback, which always works
 * via browser). Still saves to gallery first either way as a defensive
 * backup regardless of which path succeeds.
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
    // X app not installed, or any other native-share failure — fall back
    // to the text-only intent URL so the caption at least still prefills.
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

// ─── BananaBet share captions — cheeky, cycling, always tags @xOnlyMonkes ──
// 2026-07-18: static templates, picked at random each share so it "changes
// every time" without needing a persisted rotation index. Kept in Monke's
// established ball-busting/banana-obsessed persona (see ~/.hermes/SOUL.md /
// buildSystemPrompt() on the bot side) rather than generic marketing copy.

const BANANA_BET_OPEN_CAPTIONS = [
  (q: string) => `🍌 Just threw bananas at "${q}" on ${HANDLE}. Diamond hooves, baby.`,
  (q: string) => `Putting my bananas where my mouth is on "${q}" 🐒 ${HANDLE}`,
  (q: string) => `New BananaBet just dropped: "${q}" — I'm in. Are you? ${HANDLE}`,
  (q: string) => `🍌 Betting bananas, not rent money, on "${q}". Priorities. ${HANDLE}`,
  (q: string) => `The Monke has spoken on "${q}" 🐒🍌 ${HANDLE}`,
  (q: string) => `Wagering my entire banana stash on "${q}" like a responsible primate. ${HANDLE}`,
  (q: string) => `"${q}" — locked in my bananas, no take-backs. ${HANDLE}`,
  (q: string) => `🍌 This bet on "${q}" better hit or I'm rioting the treehouse. ${HANDLE}`,
  (q: string) => `Bananas on the line for "${q}" — send it. ${HANDLE}`,
  (q: string) => `🐒 Just went full ape on "${q}" over on ${HANDLE}. No regrets.`,
];

const BANANA_BET_WIN_CAPTIONS = [
  (q: string) => `🍌 WON on "${q}"! The Monke always eats. ${HANDLE}`,
  (q: string) => `Called it on "${q}" — bananas secured 🐒🍌 ${HANDLE}`,
  (q: string) => `🏆 Another BananaBet, another W on "${q}". ${HANDLE}`,
  (q: string) => `They doubted the Monke on "${q}". The Monke was right. ${HANDLE}`,
  (q: string) => `🍌 Stacking bananas after winning "${q}" on ${HANDLE}. Easy game.`,
  (q: string) => `WON. "${q}" paid out. Off to spend it on more bananas. ${HANDLE}`,
  (q: string) => `🐒 Diamond hooves paid off — "${q}" was a W. ${HANDLE}`,
  (q: string) => `Just banked a win on "${q}" — the treehouse eats good tonight 🍌 ${HANDLE}`,
  (q: string) => `🏆 "${q}" resolved exactly how I said it would. ${HANDLE}`,
  (q: string) => `Won my bananas back and then some on "${q}" 🍌🍌 ${HANDLE}`,
];

const BANANA_BET_LOSE_CAPTIONS = [
  (q: string) => `🍌 Lost the bananas on "${q}". The Monke will rise again. ${HANDLE}`,
  (q: string) => `"${q}" didn't go my way — back to grinding bananas. ${HANDLE}`,
  (q: string) => `L taken on "${q}" 🐒 still love the game though. ${HANDLE}`,
  (q: string) => `🍌 Donated my bananas to the winners on "${q}". Respect. ${HANDLE}`,
  (q: string) => `Lost "${q}" — humbled, not deterred. Next BananaBet incoming. ${HANDLE}`,
  (q: string) => `🐒 The Monke swung and missed on "${q}". It happens.`,
  (q: string) => `Bananas gone on "${q}" — but the vibes remain immaculate. ${HANDLE}`,
  (q: string) => `🍌 "${q}" said no. Rude, but I'll survive. ${HANDLE}`,
  (q: string) => `Took an L on "${q}" — already eyeing the next bet 🐒 ${HANDLE}`,
  (q: string) => `Lost this round of "${q}", still up on vibes 🍌 ${HANDLE}`,
];

const BANANA_BET_NEUTRAL_CAPTIONS = [
  (q: string) => `🍌 "${q}" just settled on ${HANDLE} — BananaBets never sleep.`,
  (q: string) => `Watched "${q}" resolve on ${HANDLE} 🐒 the bananas were flying.`,
  (q: string) => `Another BananaBet in the books: "${q}" 🍌 ${HANDLE}`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Cheeky caption for sharing a fresh (not-yet-resolved) BananaBet. */
export function pickBananaBetOpenCaption(question: string): string {
  return `${pick(BANANA_BET_OPEN_CAPTIONS)(question)}\n${HASHTAGS}`;
}

/** Cheeky, outcome-aware caption for sharing a settled BananaBet. `myBet`
 *  is this device's own bet (if any) — win/lose framing only applies when
 *  present; falls back to a neutral spectator caption otherwise, since the
 *  result popup is shown to every user, not just participants. */
export function pickBananaBetResultCaption(
  question: string,
  outcome: "yes" | "no",
  myBet: { side: "yes" | "no"; amount: number } | null,
): string {
  if (!myBet) return `${pick(BANANA_BET_NEUTRAL_CAPTIONS)(question)}\n${HASHTAGS}`;
  const won = myBet.side === outcome;
  const pool = won ? BANANA_BET_WIN_CAPTIONS : BANANA_BET_LOSE_CAPTIONS;
  return `${pick(pool)(question)}\n${HASHTAGS}`;
}
