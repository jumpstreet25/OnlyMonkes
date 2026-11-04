/**
 * Re-run Device Integrity on demand (phone app): when a server refuses a
 * device-key proof ("device not verified for this wallet" — referrals,
 * LiveKit room passes), get a fresh verdict and let the caller retry. It first
 * refreshes with the phone's key alone (no prompt; works once this wallet has
 * bound the key); one wallet signature only when the user just tapped
 * something that needs it (walletPrompt). Found 2026-10-26: one wallet in the whole KV had a verdict,
 * so a holders-only switch would have locked nearly everyone out.
 */
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { issueDeviceIntegrityAttestation, type DeviceIntegrityResult } from "@/lib/deviceIntegrity";
import { signBytesWithMwa } from "@/hooks/useMobileWallet";
import { captureError } from "@/lib/sentry";

let _inflight: Promise<DeviceIntegrityResult> | null = null;
let _triedThisSession = false;

/** Records a verification result; only a success counts as "fresh" (a failure retries next time). */
export function recordDeviceIntegrity(result: DeviceIntegrityResult, where: string): void {
  useAppStore.getState().setDeviceIntegrityStatus(result.status, result.status === "unverified" ? null : Date.now());
  // A dismissed or unanswered wallet prompt (MWA "Timed out waiting for response"), or no wallet app
  // answering at all (ConnectionFailedException, Sentry ONLYMONKES-15), is not a failure.
  if (result.status !== "clean" && !/Cancellation|cancel|TimeoutException|Timed out waiting|ConnectionFailedException|Unable to connect to websocket|not bound to this wallet/i.test(result.error ?? "")) {
    captureError(new Error(`Device integrity not issued: ${result.status}`), { area: "deviceIntegrity", where, reason: result.error ?? "" });
  }
}

/** One verification at a time; resolves with the result (never throws). */
export function reverifyDevice(where: string, opts: { walletPrompt?: boolean } = {}): Promise<DeviceIntegrityResult> {
  if (Platform.OS !== "android") return Promise.resolve({ status: "unverified", error: "not a phone" });
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return Promise.resolve({ status: "unverified", error: "no wallet" });
  if (!_inflight) {
    _triedThisSession = true;
    _inflight = issueDeviceIntegrityAttestation(wallet, null)
      .then((r) => r.status === "clean" || !opts.walletPrompt
        ? r
        : issueDeviceIntegrityAttestation(wallet, (bytes) => signBytesWithMwa(wallet, bytes)))
      .then((r) => { recordDeviceIntegrity(r, where); return r; })
      .finally(() => { _inflight = null; });
  }
  return _inflight;
}

/** Background upgrade, at most once per app session (e.g. a room pass issued only in rollout mode). */
export function reverifyDeviceOnce(where: string): void {
  if (_triedThisSession || useAppStore.getState().deviceIntegrityStatus === "clean") return;
  void reverifyDevice(where);
}
