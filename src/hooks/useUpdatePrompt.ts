/**
 * useUpdatePrompt — in-app "Update ready" prompt so applying a downloaded
 * OTA doesn't require force-closing the app.
 *
 * app.config.ts's `checkAutomatically: 'ON_LOAD'` already checks-and-
 * downloads once per cold launch, but a long-lived foregrounded session
 * that's never force-closed would otherwise never discover or apply a
 * newer update. This adds a throttled check on every AppState foreground
 * resume (same pattern as the XMTP foreground-resync elsewhere in this
 * app), and surfaces `expo-updates`' own `isUpdatePending` (a downloaded,
 * ready-to-launch update) as a dismissible in-app prompt instead of
 * silently waiting for the user to eventually kill and reopen the app.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

const FOREGROUND_CHECK_MIN_INTERVAL_MS = 20 * 60 * 1000; // 20 min

export function useUpdatePrompt(): { visible: boolean; applyUpdate: () => void; dismiss: () => void } {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissedUpdateId, setDismissedUpdateId] = useState<string | undefined>(undefined);
  const lastCheckRef = useRef(0);

  const runCheck = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheckRef.current < FOREGROUND_CHECK_MIN_INTERVAL_MS) return;
    lastCheckRef.current = now;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
      }
    } catch {
      // non-critical — worst case this check silently no-ops and the
      // normal check-on-next-cold-launch path still applies eventually.
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => sub.remove();
  }, [runCheck]);

  const applyUpdate = useCallback(() => {
    Updates.reloadAsync().catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    setDismissedUpdateId(downloadedUpdate?.updateId);
  }, [downloadedUpdate?.updateId]);

  const visible = isUpdatePending && !!downloadedUpdate?.updateId && downloadedUpdate.updateId !== dismissedUpdateId;

  return { visible, applyUpdate, dismiss };
}
