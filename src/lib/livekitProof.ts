/**
 * Proof sent with every LiveKit token request (worker/src/index.ts →
 * worker-actions/src/livekitAuth.ts): the phone's hardware Keystore key —
 * the one Device Integrity verified and bound to this holder wallet — signs
 * this room + identity + a fresh server nonce. No wallet prompt.
 * Web has its own version (livekitProof.web.ts, holder sign-in token).
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";

const WORKER_BASE = "https://onlymonkes.app";

export async function livekitProof(roomName: string, identity: string): Promise<Record<string, string> | undefined> {
  if (Platform.OS !== "android" || !isDeviceAttestAvailable()) return undefined;
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return undefined;
  try {
    const res = await fetch(`${WORKER_BASE}/api/device-integrity/challenge`, { method: "POST" });
    if (!res.ok) return undefined;
    const { nonce } = (await res.json()) as { nonce?: string };
    if (!nonce) return undefined;
    const devicePubKey = await getDevicePublicKeyBase64();
    const message = `OnlyMonkes LiveKit\nroom:${roomName}\nidentity:${identity}\nnonce:${nonce}`;
    const sig = await signWithDeviceKey(Buffer.from(message, "utf8").toString("base64"));
    return { kind: "device", wallet, devicePubKey, nonce, sig };
  } catch {
    return undefined;
  }
}
