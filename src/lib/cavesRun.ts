/**
 * MonkeCaves speed-run board (worker-actions/src/caves.ts). The game posts each cleared
 * cave ({ type: "caves", event: "clear", v, level, timeMs, kills, secrets }); the app sends
 * it here with a holder proof and hands the reply (best time, rank, that cave's top 10)
 * back to the game. Never a wallet prompt: no proof, no submit.
 */
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { holderGameProof } from "@/lib/royaleProof";

const WORKER_BASE = "https://onlymonkes.app";

export type CavesRunReply = { ok: true; week: string; best: number; improved: boolean; rank: number | null; top: { name: string; n: number | null; t: number }[]; max?: number; bananas?: number; today?: number; cap?: number };

export async function submitCavesRun(run: { v?: unknown; level?: unknown; timeMs?: unknown; kills?: unknown; secrets?: unknown }): Promise<CavesRunReply | null> {
  const cave = Number(run.level), timeMs = Math.round(Number(run.timeMs));
  if (!Number.isInteger(cave) || !Number.isFinite(timeMs)) return null;
  try {
    const proof = await holderGameProof((nonce) => `OnlyMonkes Caves\naction:run:${cave}:${timeMs}\nnonce:${nonce}`, false);
    const { verifiedNft, allNfts } = useAppStore.getState();
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null) ?? null;
    const res = await fetch(`${WORKER_BASE}/api/caves/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof, v: run.v, cave, timeMs, kills: run.kills, secrets: run.secrets, n }),
    });
    const out = (await res.json().catch(() => null)) as CavesRunReply | null;
    // 404 "not released" (board off, or not a tester) and refused runs just show nothing.
    return res.ok && out?.ok && Array.isArray(out.top) ? out : null;
  } catch {
    return null;
  }
}

/** Saved campaign progress: the highest cave this holder has beaten (phone and web share it). */
export async function fetchCavesProgress(): Promise<{ max: number; today: number; cap: number } | null> {
  try {
    const proof = await holderGameProof((nonce) => `OnlyMonkes Caves\naction:progress\nnonce:${nonce}`, false);
    const res = await fetch(`${WORKER_BASE}/api/caves/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    const out = (await res.json().catch(() => null)) as { max?: unknown; today?: unknown; cap?: unknown } | null;
    if (!res.ok || !out || !Number.isInteger(out.max)) return null;
    return { max: out.max as number, today: Number(out.today) || 0, cap: Number(out.cap) || 100 };
  } catch {
    return null;
  }
}
