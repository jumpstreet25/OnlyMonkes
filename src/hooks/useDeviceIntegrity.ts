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

export function useDeviceIntegrity() {
  const wallet = useAppStore((s) => s.wallet);
  const setDeviceIntegrityStatus = useAppStore((s) => s.setDeviceIntegrityStatus);
  const { signMessage } = useMobileWallet();

  const checkDeviceIntegrity = useCallback(async (): Promise<DeviceIntegrityResult> => {
    if (!wallet?.address) {
      return { status: "unverified", error: "No wallet connected" };
    }
    const result = await issueDeviceIntegrityAttestation(wallet.address, signMessage);
    setDeviceIntegrityStatus(result.status);
    return result;
  }, [wallet?.address, signMessage, setDeviceIntegrityStatus]);

  return { checkDeviceIntegrity };
}
