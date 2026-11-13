/**
 * MonkeCaves clear bananas (worker-actions/src/caves.ts). The worker credits each clear
 * (once per cave per UTC day, 100 a day, separate from Jungle Royale's cap); the phone
 * collects here. Phone only: bananas live on the phone and the web only mirrors the balance.
 */
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { addBananas } from "@/lib/bananaRewards";
import { holderGameProof } from "@/lib/royaleProof";

const WORKER_BASE = "https://onlymonkes.app";
let lastCollect = 0;

/** Adds every cave banana the server owes this wallet. Never a wallet prompt; throttled to once per 10 min unless forced. */
export async function collectCavesBananas(force = false): Promise<number> {
  if (Platform.OS === "web") return 0;
  if (!force && Date.now() - lastCollect < 10 * 60_000) return 0;
  lastCollect = Date.now();
  try {
    const proof = await holderGameProof((nonce) => `OnlyMonkes Caves\naction:collect\nnonce:${nonce}`, false);
    const res = await fetch(`${WORKER_BASE}/api/caves/collect`, {
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
