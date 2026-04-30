/**
 * streakShield.ts — Discord-style streak protection.
 *
 * Player spends 100 🍌 to buy a 1-day shield. If they miss a login
 * day, the shield is consumed instead of the streak resetting.
 *
 * Cap: 1 purchase per 7-day cycle (prevents trivializing streaks).
 *
 * State (AsyncStorage `streak_shield_v1`):
 *   { activeUntil: <ISO YYYY-MM-DD>; lastPurchaseISO: <ISO YYYY-MM-DD> }
 *   - activeUntil: shield protects through this date inclusive
 *   - lastPurchaseISO: enforce 7-day purchase cooldown
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { spendBananas } from "@/lib/bananaRewards";

const AK_SHIELD = "streak_shield_v1";
export const SHIELD_COST_BANANAS = 100;
export const SHIELD_COOLDOWN_DAYS = 7;

interface ShieldState {
  activeUntil: string;       // YYYY-MM-DD; empty if never purchased
  lastPurchaseISO: string;   // YYYY-MM-DD; empty if never purchased
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(aISO: string, bISO: string): number {
  if (!aISO || !bISO) return Number.POSITIVE_INFINITY;
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86_400_000);
}

async function loadState(): Promise<ShieldState> {
  try {
    const raw = await AsyncStorage.getItem(AK_SHIELD);
    if (!raw) return { activeUntil: "", lastPurchaseISO: "" };
    const parsed = JSON.parse(raw) as Partial<ShieldState>;
    return {
      activeUntil: parsed.activeUntil ?? "",
      lastPurchaseISO: parsed.lastPurchaseISO ?? "",
    };
  } catch {
    return { activeUntil: "", lastPurchaseISO: "" };
  }
}

async function saveState(s: ShieldState): Promise<void> {
  try { await AsyncStorage.setItem(AK_SHIELD, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Returns true if a shield is currently active (covers today). */
export async function hasActiveShield(): Promise<boolean> {
  const s = await loadState();
  if (!s.activeUntil) return false;
  return daysBetween(todayISO(), s.activeUntil) >= 0;
}

/** Returns the date string the shield protects through, or null if none. */
export async function getShieldExpiry(): Promise<string | null> {
  const s = await loadState();
  if (!s.activeUntil) return null;
  return daysBetween(todayISO(), s.activeUntil) >= 0 ? s.activeUntil : null;
}

/**
 * Returns the number of days until the next purchase is allowed.
 * 0 = purchasable now. Positive = days remaining.
 */
export async function daysUntilNextPurchase(): Promise<number> {
  const s = await loadState();
  if (!s.lastPurchaseISO) return 0;
  const elapsed = daysBetween(s.lastPurchaseISO, todayISO());
  return Math.max(0, SHIELD_COOLDOWN_DAYS - elapsed);
}

/**
 * Purchase a fresh 1-day shield for SHIELD_COST_BANANAS.
 * Fails if cooldown not elapsed or insufficient banana balance.
 * Returns { ok, reason } so the caller can render an error toast.
 */
export async function purchaseShield(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cooldown = await daysUntilNextPurchase();
  if (cooldown > 0) {
    return { ok: false, reason: `Shield cooldown — ${cooldown} day(s) left` };
  }
  const spent = await spendBananas(SHIELD_COST_BANANAS);
  if (!spent) return { ok: false, reason: "Not enough bananas" };

  const next: ShieldState = {
    activeUntil: tomorrowISO(),
    lastPurchaseISO: todayISO(),
  };
  await saveState(next);
  return { ok: true };
}

/**
 * Consume the shield (called by streaks.ts when a missed-day reset would
 * otherwise happen). Returns true if a shield was active and was consumed.
 */
export async function consumeShield(): Promise<boolean> {
  const active = await hasActiveShield();
  if (!active) return false;
  const s = await loadState();
  await saveState({ ...s, activeUntil: "" });
  return true;
}
