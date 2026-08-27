/**
 * AdGate — isolates the entire Google Mobile Ads app-open flow behind an
 * error boundary, so a failure anywhere in it (SDK init, native module
 * missing/broken on a given device, an ad-load throw) can never take down
 * the rest of the app. Mount once at the app root, in place of directly
 * calling useAppOpenAdGate()/rendering <AdDisclosureModal> there.
 *
 * 2026-08-27: a real user reported the app crashing on every single launch
 * after this build (never on-device verified on any device but the dev's
 * own Seeker before shipping). Root cause unconfirmed without their device
 * logs/Sentry access, but two real structural gaps were found regardless:
 *   1. mobileAds().initialize() used to run at MODULE SCOPE in _layout.tsx —
 *      before React even starts rendering — with only a Promise .catch(),
 *      no protection against a SYNCHRONOUS throw (e.g. from a native
 *      module that isn't resolvable on a given device/Play-Services state).
 *      A module-eval-time throw crashes the whole JS bundle load.
 *   2. useAppOpenAdGate() was called directly in RootLayout's body with no
 *      error boundary anywhere above it — ANY render-phase throw from it
 *      (or from useAppOpenAd()'s native bridge calls) had nowhere to be
 *      caught and took the entire app down with it.
 * This component fixes both: initialize() is now deferred (after mount,
 * not at import time) and wrapped in try/catch for a synchronous throw in
 * addition to the existing async .catch(); the whole gate is wrapped in a
 * silent ErrorBoundary so ads simply not working is the worst case, never
 * a crash.
 */
import { useEffect } from "react";
import mobileAds from "react-native-google-mobile-ads";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AdDisclosureModal } from "@/components/AdDisclosureModal";
import { useAppOpenAdGate } from "@/hooks/useAppOpenAdGate";
import { captureError } from "@/lib/sentry";
import { ADS_ENABLED } from "@/lib/ads";

function AdGateInner() {
  useEffect(() => {
    // 2026-08-27: with ads gated off (ADS_ENABLED, see ads.ts) no ad will
    // ever be requested — don't even touch the native Google Mobile Ads
    // module. A real user's Seeker reported a launch crash right after
    // this SDK was first wired in; root cause unconfirmed (a device-side
    // Play Services gap is plausible, but unverified), so until that's
    // actually understood, the safest thing is to give this native module
    // zero surface area to fail on when there's nothing for it to do anyway.
    if (!ADS_ENABLED) return;
    try {
      mobileAds()
        .initialize()
        .catch((err) => {
          if (__DEV__) console.warn("[ads] mobileAds().initialize() failed:", err);
          captureError(err, { context: "mobileAds.initialize" });
        });
    } catch (err) {
      // Synchronous throw — e.g. the native module itself couldn't be
      // resolved on this device. The whole point of this component: this
      // must never escape past here.
      if (__DEV__) console.warn("[ads] mobileAds() threw synchronously:", err);
      captureError(err, { context: "mobileAds.initialize.sync" });
    }
  }, []);

  const { pendingDisclosure, acknowledgeDisclosure } = useAppOpenAdGate();
  return <AdDisclosureModal visible={pendingDisclosure} onAcknowledge={acknowledgeDisclosure} />;
}

export function AdGate() {
  return (
    <ErrorBoundary silent>
      <AdGateInner />
    </ErrorBoundary>
  );
}
