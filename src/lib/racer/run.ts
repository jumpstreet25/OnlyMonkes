/**
 * Monke RC daily board, leader ghost and daily bananas (worker-actions/src/racer.ts).
 * The game posts each finished race ({ type: "racer", event: "clear", v, course, ms,
 * laps, ghost }); daily races go to the worker with a holder proof and the reply
 * (best, rank, top 10, bananas paid) goes back to the game. The phone asks for the
 * day's bananas (pay) and adds them; the web never does. Never a wallet prompt.
 */
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { holderGameProof } from "@/lib/royaleProof";
import { addBananas } from "@/lib/bananaRewards";

const WORKER_BASE = "https://onlymonkes.app";

export type RacerRunReply = { ok: true; day: string; best: number; improved: boolean; rank: number | null; top: { name: string; n: number | null; t: number }[]; paid: number };

export const isDailyTrack = (c: unknown): c is string => typeof c === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c);

export async function submitRacerRun(run: Record<string, unknown>): Promise<RacerRunReply | null> {
  const course = run.course, ms = Math.round(Number(run.ms));
  if (!isDailyTrack(course) || !Number.isFinite(ms)) return null;
  try {
    const proof = await holderGameProof((nonce) => `OnlyMonkes Racer\naction:run:${course}:${ms}\nnonce:${nonce}`, false);
    const { verifiedNft, allNfts } = useAppStore.getState();
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null) ?? null;
    const pay = Platform.OS !== "web";
    const res = await fetch(`${WORKER_BASE}/api/racer/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof, v: run.v, course, ms, laps: run.laps, ghost: run.ghost, n, pay }),
    });
    const out = (await res.json().catch(() => null)) as RacerRunReply | null;
    // 404 "not released" (board off, or not a tester) and refused races show nothing.
    if (!res.ok || !out?.ok || !Array.isArray(out.top)) return null;
    const paid = pay && typeof out.paid === "number" && out.paid > 0 && out.paid <= 100 ? out.paid : 0;
    if (paid) useAppStore.getState().setBananaBalance(await addBananas(paid));
    return { ...out, paid };
  } catch {
    return null;
  }
}
