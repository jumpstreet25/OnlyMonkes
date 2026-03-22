/**
 * badges.ts — Compressed NFT milestone badges via Helius Mint API
 *
 * Badge Types:
 *   FIRST_MESSAGE    — Sent first message in group chat
 *   STREAK_7         — 7-day login streak (Legendary)
 *   STREAK_30        — 30-day login streak
 *   REACTIONS_100    — Gave 100 reactions
 *   MESSAGES_500     — Sent 500 messages
 *   MESSAGES_1000    — Sent 1000 messages
 *   OG_MONKE         — Joined in the first week
 *   TOP_MONKE        — #1 on weekly leaderboard
 *
 * Minting:
 *   Uses Helius Mint cNFT API (compressed NFTs on Solana).
 *   Each badge is a unique cNFT in the OnlyMonkes collection.
 *   Minting is free (Helius covers tree costs for cNFTs).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HELIUS_API_KEY } from './constants';

const AK_BADGES = 'om_badges_v1';
const AK_BADGE_PROGRESS = 'om_badge_progress_v1';

// ─── Badge definitions ───────────────────────────────────────────────────────

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  threshold: number;
  metric: 'messages_sent' | 'reactions_given' | 'login_streak' | 'best_streak' | 'leaderboard_wins' | 'special';
}

export const BADGE_DEFS: BadgeDef[] = [
  { id: 'first_message',   name: 'First Ooh',       description: 'Sent your first message',    emoji: '🐒', threshold: 1,    metric: 'messages_sent' },
  { id: 'messages_100',    name: 'Chatterbox',       description: 'Sent 100 messages',          emoji: '💬', threshold: 100,  metric: 'messages_sent' },
  { id: 'messages_500',    name: 'Banana Phone',     description: 'Sent 500 messages',          emoji: '🍌', threshold: 500,  metric: 'messages_sent' },
  { id: 'messages_1000',   name: 'Monke Legend',     description: 'Sent 1000 messages',         emoji: '👑', threshold: 1000, metric: 'messages_sent' },
  { id: 'reactions_50',    name: 'Reaction King',    description: 'Gave 50 reactions',          emoji: '🎉', threshold: 50,   metric: 'reactions_given' },
  { id: 'reactions_100',   name: 'Hype Monke',       description: 'Gave 100 reactions',         emoji: '🔥', threshold: 100,  metric: 'reactions_given' },
  { id: 'streak_7',        name: 'Legendary',        description: '7-day login streak',         emoji: '🌟', threshold: 7,    metric: 'best_streak' },
  { id: 'streak_30',       name: 'Diamond Hands',    description: '30-day login streak',        emoji: '💎', threshold: 30,   metric: 'best_streak' },
  { id: 'top_monke',       name: 'Top Monke',        description: '#1 on weekly leaderboard',   emoji: '🏆', threshold: 1,    metric: 'leaderboard_wins' },
];

// ─── Badge progress tracking ─────────────────────────────────────────────────

export interface BadgeProgress {
  messages_sent: number;
  reactions_given: number;
  login_streak: number;
  best_streak: number;
  leaderboard_wins: number;
}

let _progress: BadgeProgress = {
  messages_sent: 0,
  reactions_given: 0,
  login_streak: 0,
  best_streak: 0,
  leaderboard_wins: 0,
};

let _earnedBadges: Set<string> = new Set();
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(AK_BADGE_PROGRESS, JSON.stringify(_progress));
      await AsyncStorage.setItem(AK_BADGES, JSON.stringify([..._earnedBadges]));
    } catch { /* ignore */ }
  }, 1000);
}

/** Reset all in-memory badge state. Used by tests. */
export function resetBadgeState(): void {
  _progress = { messages_sent: 0, reactions_given: 0, login_streak: 0, best_streak: 0, leaderboard_wins: 0 };
  _earnedBadges = new Set();
}

export async function loadBadgeData(): Promise<void> {
  try {
    const [progressRaw, badgesRaw] = await Promise.all([
      AsyncStorage.getItem(AK_BADGE_PROGRESS),
      AsyncStorage.getItem(AK_BADGES),
    ]);
    if (progressRaw) {
      _progress = { ..._progress, ...JSON.parse(progressRaw) };
    }
    if (badgesRaw) {
      const arr = JSON.parse(badgesRaw);
      if (Array.isArray(arr)) _earnedBadges = new Set(arr);
    }
  } catch { /* ignore */ }
}

export function getProgress(): BadgeProgress {
  return { ..._progress };
}

export function getEarnedBadges(): string[] {
  return [..._earnedBadges];
}

export function getBadgeDef(id: string): BadgeDef | undefined {
  return BADGE_DEFS.find(b => b.id === id);
}

// ─── Progress increment + badge check ─────────────────────────────────────────

type BadgeCallback = (badge: BadgeDef) => void;
let _onBadgeEarned: BadgeCallback | null = null;

export function setOnBadgeEarned(cb: BadgeCallback | null): void {
  _onBadgeEarned = cb;
}

function _checkNewBadges(): BadgeDef[] {
  const newBadges: BadgeDef[] = [];
  for (const def of BADGE_DEFS) {
    if (_earnedBadges.has(def.id)) continue;
    if (def.metric === 'special') continue;
    const current = _progress[def.metric];
    if (current >= def.threshold) {
      _earnedBadges.add(def.id);
      newBadges.push(def);
    }
  }
  return newBadges;
}

export function incrementProgress(
  metric: keyof BadgeProgress,
  amount = 1,
): BadgeDef[] {
  _progress[metric] += amount;
  const newBadges = _checkNewBadges();
  if (newBadges.length > 0) {
    for (const b of newBadges) {
      _onBadgeEarned?.(b);
    }
  }
  _scheduleSave();
  return newBadges;
}

export function updateStreak(streak: number, bestStreak: number): BadgeDef[] {
  _progress.login_streak = streak;
  _progress.best_streak = Math.max(_progress.best_streak, bestStreak);
  const newBadges = _checkNewBadges();
  if (newBadges.length > 0) {
    for (const b of newBadges) {
      _onBadgeEarned?.(b);
    }
  }
  _scheduleSave();
  return newBadges;
}

export function recordLeaderboardWin(): BadgeDef[] {
  return incrementProgress('leaderboard_wins', 1);
}

// ─── Helius cNFT minting ─────────────────────────────────────────────────────

const HELIUS_MINT_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export interface MintResult {
  signature: string;
  assetId: string;
}

/**
 * Mint a compressed NFT badge to the user's wallet via Helius Mint API.
 * Uses DAS `mintCompressedNft` method.
 *
 * @param recipientWallet - Solana wallet address to receive the badge
 * @param badge - Badge definition to mint
 * @returns Mint result with signature and asset ID, or null on failure
 */
export async function mintBadgeCNFT(
  recipientWallet: string,
  badge: BadgeDef,
): Promise<MintResult | null> {
  if (!HELIUS_API_KEY) {
    console.warn('[badges] No HELIUS_API_KEY — cannot mint cNFT');
    return null;
  }

  try {
    const res = await fetch(HELIUS_MINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `badge-${badge.id}-${Date.now()}`,
        method: 'mintCompressedNft',
        params: {
          name: `OnlyMonkes: ${badge.name}`,
          symbol: 'OMBADGE',
          owner: recipientWallet,
          description: badge.description,
          attributes: [
            { trait_type: 'Badge ID', value: badge.id },
            { trait_type: 'Badge Type', value: badge.metric },
            { trait_type: 'Threshold', value: String(badge.threshold) },
            { trait_type: 'Earned At', value: new Date().toISOString() },
          ],
          imageUrl: `https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/assets/badges/${badge.id}.png`,
          externalUrl: 'https://onlymonkes.com',
          sellerFeeBasisPoints: 0,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[badges] Helius mint failed:', res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json() as {
      result?: { signature?: string; assetId?: string };
    };

    if (data.result?.signature && data.result?.assetId) {
      console.log(`[badges] Minted cNFT badge "${badge.name}" → ${recipientWallet.slice(0, 8)}… asset=${data.result.assetId}`);
      return {
        signature: data.result.signature,
        assetId: data.result.assetId,
      };
    }

    console.warn('[badges] Mint response missing signature/assetId:', JSON.stringify(data).slice(0, 200));
    return null;
  } catch (err) {
    console.warn('[badges] Mint error:', (err as Error).message);
    return null;
  }
}
