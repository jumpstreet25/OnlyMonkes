/**
 * Linked devices — every phone and browser that opened this wallet's chat is an
 * XMTP installation on the inbox, and the backend caps an inbox at ~10. Without
 * a way to remove old ones, a holder who reinstalls or tries a few browsers gets
 * locked out of signing in. Removal is signed by the wallet-bound key already in
 * SecureStore (no wallet prompt) and can never remove this device.
 */

import { getXmtpClient } from "@/hooks/useXmtp";
import { getWalletBoundSigner } from "@/lib/xmtp";

export const INSTALLATION_CAP = 10;

export interface LinkedDevice {
  id: string;
  createdAt?: number;
  isThisDevice: boolean;
}

/** This device first, then newest first; unknown dates last. */
export function orderDevices(
  installations: { id: string; createdAt?: number }[],
  thisId: string,
): LinkedDevice[] {
  return installations
    .map((i) => ({ id: i.id, createdAt: i.createdAt, isThisDevice: i.id === thisId }))
    .sort((a, b) =>
      a.isThisDevice !== b.isThisDevice ? (a.isThisDevice ? -1 : 1) : (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
}

export async function listLinkedDevices(): Promise<LinkedDevice[]> {
  const client = getXmtpClient();
  if (!client) throw new Error("Chat isn't connected yet.");
  const state = await client.inboxState(true);
  return orderDevices(state.installations, client.installationId);
}

export async function removeLinkedDevices(ids: string[]): Promise<void> {
  const client = getXmtpClient();
  if (!client) throw new Error("Chat isn't connected yet.");
  const targets = ids.filter((id) => id !== client.installationId);
  if (!targets.length) return;
  const signer = await getWalletBoundSigner();
  if (!signer) throw new Error("Reconnect your wallet, then try again.");
  await client.revokeInstallations(signer, targets);
}
