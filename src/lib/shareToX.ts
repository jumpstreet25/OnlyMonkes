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
import { addShareLink } from "@/lib/shareLink";

const HANDLE = "@xOnlyMonkes";
const HASHTAGS = "#OnlyMonkes #SagaMonkes #SolanaMobile";

/** Every tweet carries the sharer's invite link (lib/shareLink.ts). */
function openTweet(text: string): void {
  void addShareLink(text).then((withLink) => {
    Linking.openURL(`https://x.com/intent/tweet?text=${encodeURIComponent(withLink)}`).catch(() => {});
  });
}

/** `data:` URIs (camera photos) → a real cache file: the gallery save needs
 *  one, and a data URI never reaches X's web composer. */
async function toLocalFile(imageUri: string): Promise<string> {
  const m = /^data:image\/(\w+);base64,/.exec(imageUri);
  if (!m) return imageUri;
  const FS = await import("expo-file-system/legacy");
  const path = `${FS.cacheDirectory}x-share-${Date.now()}.${m[1] === "png" ? "png" : "jpg"}`;
  await FS.writeAsStringAsync(path, imageUri.slice(m[0].length), { encoding: FS.EncodingType.Base64 });
  return path;
}

/**
 * Share a locally-generated image (share card, camera photo) to X.
 *
 * X app installed → react-native-share's shareSingle() hands X the image
 * and the caption in one intent. No X app → shareSingle doesn't throw, it
 * opens X's web composer with the image as `&url=`, which X drops and shows
 * the caption's invite-link card (the sharer's QR) instead of the photo
 * (RugDoctor, 2026-11-11). So check for the app first; without it the image
 * goes to the gallery and the web composer opens text-only.
 *
 * `saved` is true only when the user has to attach the saved image by hand.
 */
export async function shareImageToX(
  imageUri: string,
  caption: string,
): Promise<{ saved: boolean }> {
  const message = await addShareLink(caption);
  const fileUri = await toLocalFile(imageUri).catch(() => imageUri);

  try {
    const { default: Share, Social } = await import("react-native-share");
    const { isInstalled } = await Share.isPackageInstalled("com.twitter.android");
    if (isInstalled) {
      await Share.shareSingle({
        message,
        url: fileUri,
        social: Social.Twitter,
        type: "image/*",
      });
      return { saved: false };
    }
  } catch {
    // native-share failure — fall back to gallery + text-only composer.
  }

  let saved = false;
  try {
    const MediaLibrary = await import("expo-media-library");
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === "granted") {
      await MediaLibrary.saveToLibraryAsync(fileUri);
      saved = true;
    }
  } catch {
    // non-fatal — the composer still opens with the caption.
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
 *  see requestStreakCaption/getCachedStreakCaption in imageCaption.ts). */
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
