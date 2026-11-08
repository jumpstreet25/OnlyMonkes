/**
 * Holder proofs for MonkeCaves: Jungle Royale (worker-actions/src/royale/) and the
 * speed-run board (worker-actions/src/caves.ts). Each signs its own message.
 *
 * Phone: the Device Integrity hardware key signs a fresh server nonce (no wallet
 * prompt) when this wallet has a clean Saga Monke verdict; otherwise one wallet
 * signature for the holder sign-in token (livekitProof.ts holderProof, kept 24 h).
 * Web has its own version (royaleProof.web.ts, the holder sign-in token).
 * canPrompt false: never a wallet prompt (throws instead).
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";
import { fetchDeviceIntegrityStatus } from "@/lib/deviceIntegrity";
import { holderProof } from "@/lib/livekitProof";

const WORKER_BASE = "https://onlymonkes.app";

export const royaleProof = (canPrompt = true) => holderGameProof((nonce) => `OnlyMonkes Jungle Royale\nnonce:${nonce}`, canPrompt);

export async function holderGameProof(messageFor: (nonce: string) => string, canPrompt = true): Promise<Record<string, string>> {
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
          const sig = await signWithDeviceKey(Buffer.from(messageFor(nonce), "utf8").toString("base64"));
          return { kind: "device", wallet, devicePubKey, nonce, sig };
        }
      } catch { /* fall back to the wallet signature */ }
    }
  }
  return holderProof(canPrompt);
}
