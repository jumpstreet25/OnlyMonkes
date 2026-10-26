/**
 * useDeviceIntegrity — wires the challenge→sign→issue round trip (deviceIntegrity.ts) to the
 * current wallet + appStore. Sibling to useSentimentOptIn.ts.
 *
 * Two call sites, two severities (see VerifyScreen.tsx / ConnectScreen.tsx):
 *  - Full verification flow (first login, periodic re-check): a confirmed hardware-chain
 *    failure is a hard gate, same severity as failing NFT ownership.
 *  - Fast session-restore background refresh: never blocks anything, just updates the cached
 *    status for the next time a sensitive action checks it.
 */

import { useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { useMobileWallet } from "./useMobileWallet";
import { issueDeviceIntegrityAttestation, type DeviceIntegrityResult } from "@/lib/deviceIntegrity";
import { recordDeviceIntegrity } from "@/lib/deviceReverify";

export function useDeviceIntegrity() {
  const wallet = useAppStore((s) => s.wallet);
  const { signMessage } = useMobileWallet();

  const checkDeviceIntegrity = useCallback(async (): Promise<DeviceIntegrityResult> => {
    if (!wallet?.address) {
      return { status: "unverified", error: "No wallet connected" };
    }
    const result = await issueDeviceIntegrityAttestation(wallet.address, signMessage);
    // Only a success counts as fresh: a failure (dismissed prompt, transient error)
    // used to wait the full 7-day TTL before the background refresh tried again.
    recordDeviceIntegrity(result, "checkDeviceIntegrity");
    return result;
  }, [wallet?.address, signMessage]);

  return { checkDeviceIntegrity };
}
