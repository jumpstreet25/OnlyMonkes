/**
 * useAppOpenAdGate — automatic (no tap-to-start) full-screen ad, shown once
 * per cold start (force-close + reopen), rate-limited to once per
 * APP_OPEN_MIN_INTERVAL_MS even across repeated cold starts. Mount once at
 * the app root (`app/_layout.tsx`), alongside <AdDisclosureModal> wired to
 * this hook's returned state.
 *
 * "Once per cold start" falls out of this being a plain mount-time effect
 * rather than an AppState listener — it runs exactly once per JS process
 * lifetime, so a simple background→foreground resume (the app was never
 * actually killed) never re-triggers it.
 *
 * Tier: Saga Monke holders (verified) get the shorter Main slot even if
 * they also hold a Genesis Token (a dual holder is a Monke holder first);
 * Genesis-only holders get the longer Genesis slot. Neither → adUnitId is
 * null → the ad hook is inert (per its own docs) → no ad, ever, for an
 * unverified user. `verified`/`isGenesisHolder` are NOT persisted to
 * AsyncStorage (appStore.ts has no `persist` middleware and never writes
 * these two keys) — they're always false at cold start and only flip true
 * once this session's own verification flow (ConnectScreen/VerifyScreen)
 * actually confirms on-chain ownership, so this can never fire before a
 * user has proven they own a Saga Monke or Genesis Token.
 *
 * Disclosure: the very first time (ever, across the app's lifetime — an
 * AsyncStorage flag, not per-session) an automatic ad would show, this
 * hook holds it and sets `pendingDisclosure: true` instead of calling
 * `show()` directly. The root layout renders <AdDisclosureModal> gated on
 * that; only once the user acknowledges it does `acknowledgeDisclosure()`
 * persist the flag and actually show the ad. Every subsequent cold start
 * skips straight to showing the ad, same as before.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppOpenAd } from "react-native-google-mobile-ads";
import { useAppStore } from "@/store/appStore";
import { AD_UNIT_IDS, APP_OPEN_MIN_INTERVAL_MS } from "@/lib/ads";
import { getAdSkipStatus } from "@/lib/adSkip";

const LAST_SHOWN_KEY = "app_open_ad_last_shown_v1";
const DISCLOSURE_SEEN_KEY = "app_open_ad_disclosure_seen_v1";

export function useAppOpenAdGate(): { pendingDisclosure: boolean; acknowledgeDisclosure: () => void } {
  const verified = useAppStore((s) => s.verified);
  const isGenesisHolder = useAppStore((s) => s.isGenesisHolder);
  const wallet = useAppStore((s) => s.wallet?.address);

  const adUnitId = verified
    ? AD_UNIT_IDS.appOpenMain
    : isGenesisHolder
      ? AD_UNIT_IDS.appOpenGenesis
      : null;

  const { isLoaded, load, show } = useAppOpenAd(adUnitId);
  const attemptedRef = useRef(false);
  const [pendingDisclosure, setPendingDisclosure] = useState(false);

  useEffect(() => {
    if (adUnitId) load();
  }, [adUnitId, load]);

  useEffect(() => {
    if (!isLoaded || attemptedRef.current) return;
    attemptedRef.current = true;

    (async () => {
      try {
        const lastShown = await AsyncStorage.getItem(LAST_SHOWN_KEY);
        const elapsed = lastShown ? Date.now() - parseInt(lastShown, 10) : Infinity;
        if (elapsed < APP_OPEN_MIN_INTERVAL_MS) return;

        // Paid entitlement (adSkip.ts) — worker-verified, checked server-side
        // every cold start rather than trusting an on-device flag.
        if (wallet) {
          const status = await getAdSkipStatus(wallet);
          if (status.skipAds) return;
        }

        const disclosureSeen = await AsyncStorage.getItem(DISCLOSURE_SEEN_KEY);
        if (!disclosureSeen) {
          setPendingDisclosure(true);
          return;
        }

        show();
        await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      } catch {
        // Non-critical — worst case this cold start just doesn't show one.
      }
    })();
  }, [isLoaded, show, wallet]);

  const acknowledgeDisclosure = useCallback(() => {
    setPendingDisclosure(false);
    (async () => {
      try {
        await AsyncStorage.setItem(DISCLOSURE_SEEN_KEY, "1");
        show();
        await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      } catch {
        // Non-critical.
      }
    })();
  }, [show]);

  return { pendingDisclosure, acknowledgeDisclosure };
}
