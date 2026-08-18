/**
 * deviceRegistration.ts — one-time binding of this device's DeviceAttest key to the
 * connected Solana wallet, proven via a wallet-signed message (MWA `signMessage`).
 *
 * Required before the worker accepts any signed batch from this device (see
 * sentimentOracle.ts's register-device handler) — a batch signature alone only proves
 * possession of a hardware key, not which wallet it belongs to. Without this step, someone
 * could submit batches claiming any public SagaMonkes holder's wallet address from an
 * unrelated device.
 */

import { Buffer } from "buffer";
import { getDevicePublicKeyBase64 } from "./deviceAttest";

const WORKER_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";

function buildBindingMessage(devicePubKeyBase64: string, ts: number): string {
  return `OnlyMonkes Sentiment Oracle Device Registration\ndevice:${devicePubKeyBase64}\nts:${ts}`;
}

export interface RegisterDeviceResult {
  ok: boolean;
  error?: string;
}

/**
 * `signMessage` is `useMobileWallet().signMessage` — passed in rather than imported so this
 * module has no dependency on a live wallet-adapter hook instance; callers already have one.
 */
export async function registerDevice(
  walletAddress: string,
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<RegisterDeviceResult> {
  try {
    const devicePubKeyBase64 = await getDevicePublicKeyBase64();
    const ts = Date.now();
    const message = buildBindingMessage(devicePubKeyBase64, ts);
    const messageBytes = new TextEncoder().encode(message);
    const sigBytes = await signMessage(messageBytes);
    const walletSignatureBase64 = Buffer.from(sigBytes).toString("base64");

    const res = await fetch(`${WORKER_BASE}/api/sentiment/register-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, devicePubKeyBase64, ts, walletSignatureBase64 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Registration failed" };
  }
}

/** Best-effort — opt-out already stops local collection/upload regardless of whether this
 *  network call succeeds, so failures here are swallowed rather than surfaced. */
export async function unregisterDevice(): Promise<void> {
  try {
    const devicePubKeyBase64 = await getDevicePublicKeyBase64();
    await fetch(`${WORKER_BASE}/api/sentiment/unregister-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devicePubKeyBase64 }),
    });
  } catch {
    // best-effort
  }
}
