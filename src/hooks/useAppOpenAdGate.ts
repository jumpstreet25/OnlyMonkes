/**
 * useAppOpenAdGate — automatic (no tap-to-start) full-screen ad, shown once
 * per cold start (force-close + reopen), rate-limited to once per
 * APP_OPEN_MIN_INTERVAL_MS even across repeated cold starts. Mount once at
 * the app root (`app/_layout.tsx`).
 *
 * "Once per cold start" falls out of this being a plain mount-time effect
 * rather than an AppState listener — it runs exactly once per JS process
 * lifetime, so a simple background→foreground resume (the app was never
 * actually killed) never re-triggers it. Only a genuine force-close +
 * reopen re-mounts the root layout and gives this effect another chance to
 * fire, and even then only if enough real time has passed.
 *
 * Tier: Saga Monke holders (verified) get the shorter Main slot even if
 * they also hold a Genesis Token (a dual holder is a Monke holder first);
 * Genesis-only holders get the longer Genesis slot. Neither → no ad.
 */
import { useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppOpenAd } from "react-native-google-mobile-ads";
import { useAppStore } from "@/store/appStore";
import { AD_UNIT_IDS, APP_OPEN_MIN_INTERVAL_MS } from "@/lib/ads";

const LAST_SHOWN_KEY = "app_open_ad_last_shown_v1";

export function useAppOpenAdGate(): void {
  const verified = useAppStore((s) => s.verified);
  const isGenesisHolder = useAppStore((s) => s.isGenesisHolder);

  const adUnitId = verified
    ? AD_UNIT_IDS.appOpenMain
    : isGenesisHolder
      ? AD_UNIT_IDS.appOpenGenesis
      : null;

  const { isLoaded, load, show } = useAppOpenAd(adUnitId);
  const attemptedRef = useRef(false);

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

        show();
        await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      } catch {
        // Non-critical — worst case this cold start just doesn't show one.
      }
    })();
  }, [isLoaded, show]);
}
