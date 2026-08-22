/**
 * deviceIntegrity.ts — Device Integrity Attestation: orchestrates the challenge→sign→issue
 * round trip against the worker, given a wallet address + MWA `signMessage`. Sibling to
 * deviceRegistration.ts (same shape: no live hook dependency, callers pass in their own
 * `signMessage`), reusing the same hardware key deviceAttest.ts already exposes — no new
 * native code, no second key.
 *
 * See worker-actions/src/deviceIntegrity.ts's doc comment for the full design (why this is
 * backend-verified + KV-cached rather than on-chain, what claims are checked, the freshness
 * caveat on the cert chain vs. the live nonce signature).
 */

import { Buffer } from "buffer";
import { getDevicePublicKeyBase64, getDeviceAttestationCertChain, signWithDeviceKey } from "./deviceAttest";
import { getActiveThreats } from "./security";

const WORKER_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";

function buildBindingMessage(devicePubKeyBase64: string, nonce: string): string {
  return `OnlyMonkes Device Integrity Attestation\ndevice:${devicePubKeyBase64}\nnonce:${nonce}`;
}

export type DeviceIntegrityStatus = "clean" | "unverified" | "hardware_failed";

export interface DeviceIntegrityResult {
  status: DeviceIntegrityStatus;
  holderTier?: "none" | "sagaMonke" | "genesis";
  expiresAt?: number;
  error?: string;
}

/**
 * `signMessage` is `useMobileWallet().signMessage` (wallet sig, ed25519) — passed in rather
 * than imported, same convention as deviceRegistration.ts. The device-key signature (freshness
 * proof over the server nonce) always goes through deviceAttest.ts's signWithDeviceKey — that's
 * the hardware key, not the wallet.
 */
export async function issueDeviceIntegrityAttestation(
  walletAddress: string,
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<DeviceIntegrityResult> {
  try {
    const challengeRes = await fetch(`${WORKER_BASE}/api/device-integrity/challenge`, { method: "POST" });
    if (!challengeRes.ok) return { status: "unverified", error: `challenge HTTP ${challengeRes.status}` };
    const { nonce } = await challengeRes.json() as { nonce: string };

    const devicePubKeyBase64 = await getDevicePublicKeyBase64();
    const certChainBase64 = await getDeviceAttestationCertChain();
    if (certChainBase64.length === 0) {
      // Genuinely can't produce a chain (e.g. pre-API-28 device, or Keystore attestation
      // unsupported) — this is a real "can't prove hardware provenance" case, not transient.
      return { status: "hardware_failed", error: "device did not produce an attestation cert chain" };
    }

    const bindingMessage = buildBindingMessage(devicePubKeyBase64, nonce);
    const bindingBytes = new TextEncoder().encode(bindingMessage);

    const deviceSigBase64 = await signWithDeviceKey(Buffer.from(bindingBytes).toString("base64"));
    const walletSigBytes = await signMessage(bindingBytes);
    const walletSigBase64 = Buffer.from(walletSigBytes).toString("base64");

    const raspThreats = getActiveThreats();

    const issueRes = await fetch(`${WORKER_BASE}/api/device-integrity/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        devicePubKeyBase64,
        certChainBase64,
        nonce,
        deviceSigBase64,
        walletSigBase64,
        raspThreats,
      }),
    });

    if (issueRes.ok) {
      const data = await issueRes.json() as { status: "clean"; holderTier: DeviceIntegrityResult["holderTier"]; expiresAt: number };
      return { status: "clean", holderTier: data.holderTier, expiresAt: data.expiresAt };
    }

    const err = await issueRes.json().catch(() => ({}) as { error?: string });
    // Only a genuine hardware-chain failure is a hard gate — every other rejection (RASP,
    // ownership uncertain, transient) degrades to "unverified" so a flaky provider or a
    // dismissed signature prompt doesn't lock a real holder out of chat.
    if (issueRes.status === 403 && (err.error ?? "").toLowerCase().includes("hardware attestation failed")) {
      return { status: "hardware_failed", error: err.error };
    }
    return { status: "unverified", error: err.error ?? `issue HTTP ${issueRes.status}` };
  } catch (e) {
    return { status: "unverified", error: e instanceof Error ? e.message : "Device integrity check failed" };
  }
}

/** Cheap cached-verdict read — no live re-verification. Used for bot-side/background checks. */
export async function fetchDeviceIntegrityStatus(walletAddress: string): Promise<DeviceIntegrityResult> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/device-integrity/status?wallet=${encodeURIComponent(walletAddress)}`);
    if (!res.ok) return { status: "unverified" };
    const data = await res.json() as { status: DeviceIntegrityStatus; holderTier?: DeviceIntegrityResult["holderTier"]; expiresAt?: number };
    return { status: data.status, holderTier: data.holderTier, expiresAt: data.expiresAt };
  } catch {
    return { status: "unverified" };
  }
}
