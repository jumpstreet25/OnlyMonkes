/**
 * Your devices — the phones verified on this wallet (Device Integrity, up to 5 per wallet).
 * Each call is signed by this phone's hardware key over a fresh server nonce, so no wallet
 * prompt; the worker answers only a phone that is itself verified on the wallet
 * (worker-actions/src/deviceIntegrity.ts handleDeviceIntegrityDevices).
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";

const WORKER_BASE = "https://onlymonkes.app";

export interface MyDevice {
  id: string;
  label: string | null;
  isThisDevice: boolean;
  verifiedAt: number;
  expiresAt: number;
}

export type MyDevicesErrorCode = "UNSUPPORTED" | "NOT_VERIFIED" | "FAILED";

export class MyDevicesError extends Error {
  constructor(public code: MyDevicesErrorCode, message?: string) {
    super(message ?? code);
  }
}

export function devicesMessage(action: string, wallet: string, target: string, nonce: string): string {
  return `OnlyMonkes Devices\naction:${action}\nwallet:${wallet}\ntarget:${target}\nnonce:${nonce}`;
}

async function call(wallet: string, action: "list" | "remove", target = "-"): Promise<{ max: number; devices: MyDevice[] }> {
  if (Platform.OS !== "android" || !isDeviceAttestAvailable()) throw new MyDevicesError("UNSUPPORTED");
  const ch = await fetch(`${WORKER_BASE}/api/device-integrity/challenge`, { method: "POST" });
  if (!ch.ok) throw new MyDevicesError("FAILED", `challenge HTTP ${ch.status}`);
  const { nonce } = (await ch.json()) as { nonce?: string };
  if (!nonce) throw new MyDevicesError("FAILED", "no nonce");
  const devicePubKeyBase64 = await getDevicePublicKeyBase64();
  const deviceSigBase64 = await signWithDeviceKey(Buffer.from(devicesMessage(action, wallet, target, nonce), "utf8").toString("base64"));
  const res = await fetch(`${WORKER_BASE}/api/device-integrity/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, walletAddress: wallet, devicePubKeyBase64, nonce, deviceSigBase64, target }),
  });
  const data = (await res.json().catch(() => ({}))) as { max?: number; devices?: MyDevice[]; error?: string };
  if (res.status === 403) throw new MyDevicesError("NOT_VERIFIED", data.error);
  if (!res.ok || !Array.isArray(data.devices)) throw new MyDevicesError("FAILED", data.error ?? `HTTP ${res.status}`);
  return { max: data.max ?? 5, devices: data.devices };
}

export const listMyDevices = (wallet: string) => call(wallet, "list");

export function removeMyDevice(wallet: string, id: string) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new MyDevicesError("FAILED", "bad device id");
  return call(wallet, "remove", id);
}

/** Model name sent when this phone verifies, so the list can say "Seeker" instead of an id. */
export function thisDeviceLabel(): string | undefined {
  const c = Platform.constants as { Model?: string; Brand?: string } | undefined;
  const model = c?.Model?.trim();
  return model ? model.slice(0, 40) : undefined;
}
