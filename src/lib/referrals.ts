/**
 * Referrals (2026-10-24) — app side of worker-actions/src/referrals.ts.
 *
 * Every call proves the wallet with the phone's hardware Keystore key (the one
 * Device Integrity verified for this holder wallet) signing the action + a
 * fresh server nonce — same as livekitProof.ts, no wallet prompt.
 *
 * Bananas live on the phone: a claim only records the invite, and
 * collectReferralBananas() pays everything owed (250 per new holder you
 * invited, 100 once for joining with an invite).
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";
import { addBananas } from "@/lib/bananaRewards";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { reverifyDevice } from "@/lib/deviceReverify";
import { grantSpecialBadge } from "@/lib/badges";

const BASE = "https://onlymonkes.app";
export const INVITE_CODE = /^[2-9A-HJ-NP-Z]{6}$/;

export interface MyReferral {
  code: string;
  url: string;
  card: string;
  name: string;
  referred: number;
  pending: number;
  badges: number[];
  nextBadge: number | null;
  rewards: { referrer: number; newHolder: number };
  season: { id: string; end: number; count: number } | null;
}

export type ReferralError = { error: string; reason?: string };

async function proof(action: string): Promise<Record<string, string> | null> {
  if (Platform.OS !== "android" || !isDeviceAttestAvailable()) return null;
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return null;
  try {
    const res = await fetch(`${BASE}/api/device-integrity/challenge`, { method: "POST" });
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

/** canPrompt: may ask the wallet for a signature to verify this phone (only for something the user just tapped). */
async function post<T>(path: string, action: string, body: Record<string, unknown> = {}, canPrompt = true): Promise<T | ReferralError> {
  const p = await proof(action);
  if (!p) return { error: "This phone isn't verified yet. Open the app's verify step, then try again.", reason: "no_proof" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, proof: p }),
    });
    const json = (await res.json().catch(() => ({}))) as T & ReferralError;
    if (res.status === 403 && canPrompt && /device not verified/i.test(json.error ?? "")) {
      // No (fresh) Device Integrity verdict for this wallet: verify now (one wallet
      // signature), then try once more.
      const r = await reverifyDevice(`referral:${action.split(":")[0]}`);
      if (r.status === "clean") return post<T>(path, action, body, false);
      return { error: "Couldn't verify this phone. Approve the signature in your wallet, then try again.", reason: "not_verified" };
    }
    return res.ok ? json : { error: json.error || "Something went wrong", reason: json.reason };
  } catch {
    return { error: "No connection. Try again.", reason: "network" };
  }
}

export const isReferralError = (r: unknown): r is ReferralError => !!r && typeof r === "object" && "error" in r;

/** Recruiter badges (1 / 5 / 25) into the profile badge system; idempotent. */
export function grantRecruiterBadges(earned: number[]): void {
  for (const n of earned) {
    if (n === 1 || n === 5 || n === 25) grantSpecialBadge(`recruiter_${n}`);
  }
}

/** Your invite (created on first call); also updates the name + PFP shown on your card. */
export async function getMyReferral(): Promise<MyReferral | ReferralError> {
  const s = useAppStore.getState();
  const pfp = parseMonkeNumber(s.verifiedNft?.name);
  const r = await post<MyReferral>("/api/referral/me", "me", { name: s.username ?? "", ...(pfp ? { pfp } : {}) });
  if (!isReferralError(r) && Array.isArray(r.badges)) grantRecruiterBadges(r.badges);
  return r;
}

/** Records that you joined with `code`. Bananas arrive through collectReferralBananas(). */
export function claimInvite(code: string): Promise<{ ok: true; already?: boolean; bananas: number; name: string } | ReferralError> {
  const c = code.trim().toUpperCase();
  return post(`/api/referral/claim`, `claim:${c}`, { code: c });
}

/** Who sent this invite (public: name + PFP number). */
export async function lookupInvite(code: string): Promise<{ name: string; pfp: number | null } | null> {
  const c = code.trim().toUpperCase();
  if (!INVITE_CODE.test(c)) return null;
  try {
    const res = await fetch(`${BASE}/api/referral/code/${c}`);
    return res.ok ? ((await res.json()) as { name: string; pfp: number | null }) : null;
  } catch {
    return null;
  }
}

let lastCollect = 0;

/**
 * Adds every referral banana the server owes this wallet (once; the server
 * marks them paid before answering). Throttled to once per 10 minutes unless
 * forced (right after a claim).
 */
export async function collectReferralBananas(force = false): Promise<{ bananas: number; referrals: number; welcome: boolean }> {
  const none = { bananas: 0, referrals: 0, welcome: false };
  if (!force && Date.now() - lastCollect < 10 * 60_000) return none;
  lastCollect = Date.now();
  // The automatic collect (Main Chat open) never pops a wallet prompt; the invite screens do.
  const r = await post<{ bananas: number; referrals: number; welcome: boolean }>("/api/referral/collect", "collect", {}, force);
  if (isReferralError(r) || !(r.bananas > 0)) return none;
  const total = await addBananas(r.bananas);
  useAppStore.getState().setBananaBalance(total);
  // New invitee(s): refresh the badge count so a Recruiter badge lands now.
  if (r.referrals > 0) void getMyReferral().catch(() => {});
  return r;
}
