/**
 * firstLoginBonus.ts — One-time wallet-keyed welcome bonus on first successful
 * NFT verification, paired with the onboarding carousel's "claim your welcome
 * bonus" CTA.
 *
 * Mirrors grants.ts's one-time-flag pattern: fail closed on read errors,
 * don't burn the flag if the banana write fails (better to risk a rare
 * double-grant than lose the bonus entirely on a transient storage error).
 *
 * Distinct from OnboardingOverlay.tsx's separate 25🍌 post-login tutorial
 * bonus — that's a different code path (device-scoped, shown after landing
 * in chat). Two separate "welcome" moments currently exist; see the
 * gamification plan notes for the product-copy decision on differentiating
 * them.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addBananas } from "@/lib/bananaRewards";
import { useAppStore } from "@/store/appStore";

const AK_FIRST_LOGIN_BASE = "first_login_bonus_v1";
export const FIRST_LOGIN_BONUS_AMOUNT = 15; // 🍌 — tunable, not final

export async function grantFirstLoginBonusIfEligible(
  walletAddress: string,
): Promise<{ granted: boolean; amount: number }> {
  const addr = walletAddress.trim();
  if (!addr) return { granted: false, amount: 0 };

  const flagKey = `${AK_FIRST_LOGIN_BASE}:${addr}`;
  try {
    const already = await AsyncStorage.getItem(flagKey);
    if (already) return { granted: false, amount: 0 };
  } catch {
    return { granted: false, amount: 0 };
  }

  try {
    const newBalance = await addBananas(FIRST_LOGIN_BONUS_AMOUNT);
    useAppStore.getState().setBananaBalance(newBalance);
  } catch {
    // don't burn the flag if the write failed — retry next login attempt
    return { granted: false, amount: 0 };
  }

  await AsyncStorage.setItem(flagKey, String(Date.now())).catch(() => {});
  return { granted: true, amount: FIRST_LOGIN_BONUS_AMOUNT };
}
