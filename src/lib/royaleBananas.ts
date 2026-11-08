/**
 * Jungle Royale bananas (worker-actions/src/royale/royale.ts). The match server
 * credits what each holder earned (capped per day); the phone collects it here.
 * Phone only: bananas live on the phone and the web only mirrors the balance.
 */
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { addBananas } from "@/lib/bananaRewards";
import { royaleProof } from "@/lib/royaleProof";

const WORKER_BASE = "https://onlymonkes.app";
let lastCollect = 0;

/**
 * Adds every Royale banana the server owes this wallet. Never pops a wallet
 * prompt; with no device key or cached holder token it waits for the next try.
 * Throttled to once per 10 minutes unless forced (right after a match).
 */
export async function collectRoyaleBananas(force = false): Promise<number> {
  if (Platform.OS === "web") return 0;
  if (!force && Date.now() - lastCollect < 10 * 60_000) return 0;
  lastCollect = Date.now();
  try {
    const proof = await royaleProof(false);
    const res = await fetch(`${WORKER_BASE}/api/royale/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    const { bananas } = (await res.json().catch(() => ({}))) as { bananas?: number };
    if (!res.ok || !(typeof bananas === "number" && bananas > 0 && bananas <= 10_000)) return 0;
    useAppStore.getState().setBananaBalance(await addBananas(bananas));
    return bananas;
  } catch {
    return 0;
  }
}
