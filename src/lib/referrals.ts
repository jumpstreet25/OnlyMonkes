/**
 * Referrals (2026-10-24) — app side of worker-actions/src/referrals.ts.
 *
 * Every call proves the wallet with no wallet prompt (referralProof.ts): the
 * phone's hardware Keystore key (the one Device Integrity verified for this
 * holder wallet) signing the action + a fresh server nonce, or on the web the
 * holder sign-in token.
 *
 * Bananas live on the phone: a claim only records the invite, and
 * collectReferralBananas() pays everything owed (250 per new holder you
 * invited, 100 once for joining with an invite). The web claims and shows your
 * invite but never collects: its balance mirrors the phone's.
 */
import { Platform } from "react-native";
import { useAppStore } from "@/store/appStore";
import { referralProof } from "@/lib/referralProof";
import { grantSpecialBadge } from "@/lib/badges";
import { addBananas } from "@/lib/bananaRewards";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";

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

async function post<T>(path: string, action: string, body: Record<string, unknown> = {}): Promise<T | ReferralError> {
  const p = await referralProof(action);
  if (!p) {
    const error = Platform.OS === "web" ? "Sign in again, then try again." : "This phone isn't verified yet. Open the app's verify step, then try again.";
    return { error, reason: "no_proof" };
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, proof: p }),
    });
    const json = (await res.json().catch(() => ({}))) as T & ReferralError;
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
  if (Platform.OS === "web") return none;
  if (!force && Date.now() - lastCollect < 10 * 60_000) return none;
  lastCollect = Date.now();
  const r = await post<{ bananas: number; referrals: number; welcome: boolean }>("/api/referral/collect", "collect");
  if (isReferralError(r) || !(r.bananas > 0)) return none;
  const total = await addBananas(r.bananas);
  useAppStore.getState().setBananaBalance(total);
  return r;
}
