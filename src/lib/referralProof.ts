import { Buffer } from "buffer";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";

/** Phone: the hardware Keystore key (Device Integrity) signs the action + a fresh server nonce. */
export async function referralProof(action: string): Promise<Record<string, string> | null> {
  if (Platform.OS !== "android" || !isDeviceAttestAvailable()) return null;
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return null;
  try {
    const res = await fetch("https://onlymonkes.app/api/device-integrity/challenge", { method: "POST" });
    if (!res.ok) return null;
    const { nonce } = (await res.json()) as { nonce?: string };
    if (!nonce) return null;
    const devicePubKey = await getDevicePublicKeyBase64();
    const message = `OnlyMonkes Referral\naction:${action}\nnonce:${nonce}`;
    const sig = await signWithDeviceKey(Buffer.from(message, "utf8").toString("base64"));
    return { kind: "device", wallet, devicePubKey, nonce, sig };
  } catch {
    return null;
  }
}
