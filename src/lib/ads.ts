/**
 * Ad configuration (rewarded pill + automatic App Open, see
 * useAppOpenAdGate.ts) for the SKR treasury pipeline. Real fund flow,
 * confirmed 2026-08-24: **AdMob cannot pay out to a crypto wallet** —
 * Google settles ad revenue to the publisher account's linked bank account
 * via Google Payments (fiat, monthly, threshold-based), full stop, no API
 * or setting changes that. The bridge from there to the OnlyMonkes
 * publisher wallet is a manual step (withdraw from Google Payments, buy
 * SOL/USDC, send to the wallet) — once it lands there, THAT'S when the
 * treasury Blinks (worker-actions/src/treasury.ts) pick it up: swapped to
 * $SKR, staked, used to pay OnlyMonkes' server/API costs, and the rest
 * builds a standing $SKR Vault. Eventually: community giveaways + buying
 * Saga Monkes to add to the Vault. See AdDisclosureModal.tsx for the
 * user-facing version of this — keep both in sync if the policy changes.
 *
 * AD_UNIT_IDS.rewardedMain/rewardedGenesis/appOpenMain/appOpenGenesis all
 * currently point at Google's public TEST ad unit IDs — safe to ship,
 * serve only test creatives, never real ones, never earn real revenue.
 * Swap for real AdMob unit IDs (under publisher account
 * pub-5684183956469893) once they exist; nothing else in the integration
 * needs to change.
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

// 2026-08-27: real ad unit IDs still don't exist (AdMob account verification
// needs real payout activity — a chicken-and-egg problem, already deferred).
// A "Test Ad" watermark visible in a Solana dApp Store submission would be
// grounds for rejection. Rather than hold the whole submission on the AdMob
// account, gate ad DISPLAY off entirely while still using Google's test IDs
// under the hood (still safe/required for the SDK itself) — every ad
// call site should resolve its unit ID through this and treat null as "no
// ad, ever" (the same inert contract useAppOpenAdGate already had for an
// unverified user). Flip TEST_ADS_LIVE back on (or just delete this gate)
// once real AdMob unit IDs land in the constants above.
const TEST_ADS_LIVE = false;

/** Resolves an AD_UNIT_IDS.* value to itself, or null if ads are gated off
 *  (see TEST_ADS_LIVE above). Every ad-consuming hook call site should pass
 *  its adUnitId through this rather than using AD_UNIT_IDS directly. */
export function resolveAdUnitId(id: string): string | null {
  return TEST_ADS_LIVE ? id : null;
}

/** Minimum gap between automatic App Open ad displays, even across repeated
 *  cold starts — "every couple hours," not every single force-close+reopen. */
export const APP_OPEN_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
