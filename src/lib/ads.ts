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
  /** App Open — shown automatically (no tap-to-start) on the first cold
   *  start after a force-close, rate-limited by APP_OPEN_MIN_INTERVAL_MS.
   *  See useAppOpenAdGate.ts. Both point at Google's public test constant
   *  for now — AdMob doesn't let this app force a creative duration on a
   *  given ad unit, so "shorter for Monke holders, longer for Genesis"
   *  becomes real once two actual AdMob App Open units exist and one is
   *  configured with a shorter-duration creative pool than the other; the
   *  app-side tier selection below is already correct either way. */
  appOpenMain: TestIds.APP_OPEN,
  appOpenGenesis: TestIds.APP_OPEN,
} as const;

export const AD_REWARD_BANANAS = {
  main: 15,
  genesis: 25,
} as const;

/** Minimum gap between automatic App Open ad displays, even across repeated
 *  cold starts — "every couple hours," not every single force-close+reopen. */
export const APP_OPEN_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
