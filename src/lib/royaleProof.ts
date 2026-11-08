/**
 * Holder proof for Jungle Royale (MonkeCaves versus, worker-actions/src/royale/).
 * The game page asks the app for it; the match server checks it.
 *
 * Phone: the Device Integrity hardware key signs a fresh server nonce (no wallet
 * prompt) when this wallet has a clean Saga Monke verdict; otherwise one wallet
 * signature for the holder sign-in token (livekitProof.ts holderProof, kept 24 h).
 * Web has its own version (royaleProof.web.ts, the holder sign-in token).
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";
import { fetchDeviceIntegrityStatus } from "@/lib/deviceIntegrity";
import { holderProof } from "@/lib/livekitProof";

const WORKER_BASE = "https://onlymonkes.app";

export async function royaleProof(): Promise<Record<string, string>> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("Connect your wallet first");
  if (Platform.OS === "android" && isDeviceAttestAvailable()) {
    const status = await fetchDeviceIntegrityStatus(wallet);
    if (status.status === "clean" && status.holderTier === "sagaMonke") {
      try {
        const res = await fetch(`${WORKER_BASE}/api/device-integrity/challenge`, { method: "POST" });
        const { nonce } = (await res.json()) as { nonce?: string };
        if (res.ok && nonce) {
          const devicePubKey = await getDevicePublicKeyBase64();
          const message = `OnlyMonkes Jungle Royale\nnonce:${nonce}`;
          const sig = await signWithDeviceKey(Buffer.from(message, "utf8").toString("base64"));
          return { kind: "device", wallet, devicePubKey, nonce, sig };
        }
      } catch { /* fall back to the wallet signature */ }
    }
  }
  return holderProof();
}
