/**
 * Linked devices — every phone and browser that opened this wallet's chat is an
 * XMTP installation on the inbox, and the backend caps an inbox at ~10. This lets
 * a signed-in holder remove the ones they no longer use. Removal is signed by the
 * wallet-bound key already in SecureStore (no wallet prompt) and can never remove
 * this device: if this device can't be found in the list, nothing can be removed.
 *
 * Not covered yet: a holder already at the cap on a NEW device has no client, so
 * can't open this screen; that needs a client-free revoke on the sign-in error
 * (revokeInstallationsWithBackend) — JS-only, can follow as a 3.1 OTA.
 */

import { getXmtpClient } from "@/hooks/useXmtp";
import { getWalletBoundSigner } from "@/lib/xmtp";

export const INSTALLATION_CAP = 10;

/** Error codes the screen turns into translated text. */
export type DeviceErrorCode = "NOT_CONNECTED" | "THIS_DEVICE_UNKNOWN" | "NEEDS_WALLET" | "NOT_RECOVERY_KEY";

export class DeviceError extends Error {
  constructor(public code: DeviceErrorCode) {
    super(code);
  }
}

export interface LinkedDevice {
  id: string;
  createdAt?: number;
  isThisDevice: boolean;
}

/** Installation IDs are hex; compare without case or a 0x prefix. */
export function sameInstallation(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/^0x/, "");
  return n(a) === n(b);
}

/** This device first, then newest first; unknown dates last. */
export function orderDevices(
  installations: { id: string; createdAt?: number }[],
  thisId: string,
): LinkedDevice[] {
  return installations
    .map((i) => ({ id: i.id, createdAt: i.createdAt, isThisDevice: sameInstallation(i.id, thisId) }))
    .sort((a, b) =>
      a.isThisDevice !== b.isThisDevice ? (a.isThisDevice ? -1 : 1) : (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
}

export async function listLinkedDevices(): Promise<LinkedDevice[]> {
  const client = getXmtpClient();
  if (!client) throw new DeviceError("NOT_CONNECTED");
  const state = await client.inboxState(true);
  const devices = orderDevices(state.installations, client.installationId);
  if (!devices.some((d) => d.isThisDevice)) throw new DeviceError("THIS_DEVICE_UNKNOWN");
  return devices;
}

export async function removeLinkedDevices(ids: string[]): Promise<void> {
  const client = getXmtpClient();
  if (!client) throw new DeviceError("NOT_CONNECTED");
  const targets = ids.filter((id) => !sameInstallation(id, client.installationId));
  if (!targets.length) return;
  const signer = await getWalletBoundSigner();
  if (!signer) throw new DeviceError("NEEDS_WALLET");
  // Only the inbox's recovery identity may revoke; say so instead of a raw SDK error.
  const state = await client.inboxState(true);
  const mine = (await signer.getIdentifier()).identifier.toLowerCase();
  if (state.recoveryIdentifier && state.recoveryIdentifier !== mine) throw new DeviceError("NOT_RECOVERY_KEY");
  await client.revokeInstallations(signer, targets as Parameters<typeof client.revokeInstallations>[1]);
}
