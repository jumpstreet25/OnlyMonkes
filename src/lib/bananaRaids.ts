/**
 * bananaRaids.ts — "Banana Raid" bonus rewards for Avatar Room participation.
 *
 * Two bonuses, each on its own 24h cooldown (separate from the daily-claim
 * streak in bananaRewards.ts — this is a different reward, not a bonus lap
 * on the same cooldown):
 *  - Host bonus: start a room that reaches a minimum headcount.
 *  - Join bonus: stay in a room for at least a minimum duration.
 *
 * Client-authoritative, same trust tier as the rest of the banana economy
 * (no server validation) — this is a cosmetic currency, not real money.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addBananas } from "@/lib/bananaRewards";
import { useAppStore } from "@/store/appStore";
import type { AvatarSessionStats } from "@/lib/avatarRoom";

const AK_RAIDS_BASE = "banana_raids_v1";

// Wallet-scoped, matching setBananaWalletContext/setShopWalletContext in walletIdentity.ts.
let _walletCtx: string | null = null;
export function setRaidsWalletContext(addr: string | null): void { _walletCtx = addr; }
function raidsKey(): string {
  return _walletCtx ? `${AK_RAIDS_BASE}:${_walletCtx}` : AK_RAIDS_BASE;
}

// Tunable — product decision, not final.
export const RAID_MIN_PARTICIPANTS = 3; // host bonus: room must reach this many total (incl. host)
export const RAID_MIN_JOIN_MINUTES = 5; // joiner bonus: must stay at least this long
export const RAID_HOST_BONUS = 20; // 🍌
export const RAID_JOIN_BONUS = 10; // 🍌

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

interface RaidCooldownState {
  lastHostClaimTs: number;
  lastJoinClaimTs: number;
}

const DEFAULT_STATE: RaidCooldownState = { lastHostClaimTs: 0, lastJoinClaimTs: 0 };

async function loadState(): Promise<RaidCooldownState> {
  try {
    const raw = await AsyncStorage.getItem(raidsKey());
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: RaidCooldownState): Promise<void> {
  await AsyncStorage.setItem(raidsKey(), JSON.stringify(state)).catch(() => {});
}

export interface RaidResult {
  granted: boolean;
  amount: number;
  reason: "host" | "join";
}

/**
 * Settle a completed Avatar Room session against raid eligibility + cooldowns.
 * Returns null if no bonus was earned (ineligible or on cooldown) — callers
 * should treat null as "nothing to show," not an error.
 */
export async function settleAvatarRoomSession(
  stats: AvatarSessionStats,
): Promise<RaidResult | null> {
  const state = await loadState();
  const now = Date.now();

  if (stats.wasHost) {
    if (stats.maxParticipants < RAID_MIN_PARTICIPANTS) return null;
    if (now - state.lastHostClaimTs < TWENTY_FOUR_HOURS) return null;
    state.lastHostClaimTs = now;
    await saveState(state);
    const newBalance = await addBananas(RAID_HOST_BONUS);
    useAppStore.getState().setBananaBalance(newBalance);
    return { granted: true, amount: RAID_HOST_BONUS, reason: "host" };
  }

  const minMs = RAID_MIN_JOIN_MINUTES * 60 * 1000;
  if (stats.durationMs < minMs) return null;
  if (now - state.lastJoinClaimTs < TWENTY_FOUR_HOURS) return null;
  state.lastJoinClaimTs = now;
  await saveState(state);
  const newBalance = await addBananas(RAID_JOIN_BONUS);
  useAppStore.getState().setBananaBalance(newBalance);
  return { granted: true, amount: RAID_JOIN_BONUS, reason: "join" };
}
