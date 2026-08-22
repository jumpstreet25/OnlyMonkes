/**
 * Rewarded-ad configuration for the SKR treasury pipeline (see the SKR
 * Rewards Pool memo). Ad payouts from AdMob land in the OnlyMonkes
 * publisher wallet and get converted to staked SKR via the treasury Blinks
 * — see worker-actions/src/treasury.ts. This file is purely the client-side
 * ad-unit config, unrelated to that server-side piece.
 *
 * AD_UNIT_IDS.rewardedMain/rewardedGenesis currently point at Google's
 * public TEST ad unit IDs — safe to ship, serve only test creatives, never
 * real ones, never earn real revenue. Swap for real AdMob unit IDs (under
 * publisher account pub-5684183956469893) once they exist; nothing else in
 * the integration needs to change.
 */
import { TestIds } from "react-native-google-mobile-ads";

export const AD_UNIT_IDS = {
  /** Main Chat — 15s rewarded unit, all holders. */
  rewardedMain: TestIds.REWARDED,
  /** Genesis Chat — longer/higher-paying slot. Same test unit for now;
   *  AdMob doesn't let you force a minimum creative duration per unit, so
   *  the "30s+" distinction from the memo is more naturally a CPX Research
   *  longer-form survey than a stretched video ad — revisit once that's wired up. */
  rewardedGenesis: TestIds.REWARDED,
} as const;

export const AD_REWARD_BANANAS = {
  main: 15,
  genesis: 25,
} as const;
