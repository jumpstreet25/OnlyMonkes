/**
 * Bearer credential for OnlyMonkes' self-hosted XMTP backend (3.1, SDK 8).
 *
 * The backend's [auth] accepts the same holder token as the web app's sign-in
 * (worker `/api/auth/login`, ~24 h). The phone gets it with one MWA signature
 * (livekitProof.holderSession), keeps it in SecureStore so a restart doesn't
 * prompt again, and renews it through `/api/auth/refresh` before it expires.
 */

import * as SecureStore from "expo-secure-store";
import { useAppStore } from "@/store/appStore";
import { captureError } from "@/lib/sentry";

const WORKER_BASE = "https://onlymonkes.app";
const SK_TOKEN = "om_xmtp_holder_v1";
const REFRESH_WITHIN_S = 6 * 3600;

type Stored = { wallet: string; token: string; expiresAt: number };

let _mem: Stored | null = null;
let _lastFailure: string | null = null;

/**
 * Breaker. The SDK asks for a credential every time it needs one and retries on its own, so after a
 * failure each ask used to open the wallet again (Saga 2026-11-19: 288 failures, Solflare popping up
 * over and over, memory up to 3.2 GB). While blocked, asks are answered from a valid saved token or
 * fail at once — no wallet, no network, no Sentry. A wallet "no" (cancelled, wrong account, no wallet)
 * blocks until the user taps Retry; anything else backs off 15 s → 5 min.
 */
type Block = { wallet: string; reason: string; until: number; failures: number };
let _block: Block | null = null;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const USER_ANSWER = /cancel|declin|reject|denied|not approved|wallet app is on|connect your wallet|needs a wallet signature|not a holder|no saga monke/i;

/** True when this failure needs the user, not a retry. */
export function isUserAnswerFailure(message: string): boolean {
  return USER_ANSWER.test(message);
}

/** Next block after a failure (pure, for tests). */
export function nextBlock(prev: Block | null, wallet: string, reason: string, now: number): Block {
  const failures = prev && prev.wallet === wallet ? prev.failures + 1 : 1;
  const until = isUserAnswerFailure(reason) ? Number.POSITIVE_INFINITY : now + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
  return { wallet, reason, until, failures };
}

/** The user tapped Retry / signed in again: the next ask may open the wallet. */
export function allowXmtpCredentialPrompt(): void {
  _block = null;
}

/** The real reason behind the SDK's generic "credential callback failed" (shown on the chat error screen). */
export function lastXmtpCredentialFailure(): string | null {
  return _lastFailure;
}

/** `wallet` undefined (a push/background runtime with no app store yet) = whatever is stored. */
async function load(wallet?: string): Promise<Stored | null> {
  if (_mem && (!wallet || _mem.wallet === wallet)) return _mem;
  try {
    const raw = await SecureStore.getItemAsync(SK_TOKEN);
    const s = raw ? (JSON.parse(raw) as Stored) : null;
    return s && (!wallet || s.wallet === wallet) ? (_mem = s) : null;
  } catch {
    return null;
  }
}

/** Wallet of the last holder sign-in on this phone (background handlers bind to it). */
export async function lastXmtpWallet(): Promise<string | null> {
  return (await load())?.wallet ?? null;
}

async function save(s: Stored): Promise<void> {
  _mem = s;
  try { await SecureStore.setItemAsync(SK_TOKEN, JSON.stringify(s)); } catch { /* memory copy still works */ }
}

export async function clearXmtpCredential(): Promise<void> {
  _mem = null;
  _block = null;
  try { await SecureStore.deleteItemAsync(SK_TOKEN); } catch { /* nothing stored */ }
}

async function refresh(s: Stored): Promise<Stored | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: WORKER_BASE, Authorization: `Bearer ${s.token}` },
      body: "{}",
    });
    if (res.status === 403) { await clearXmtpCredential(); return null; }
    const out = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: number };
    return res.ok && out.token && out.expiresAt ? { ...s, token: out.token, expiresAt: out.expiresAt } : s;
  } catch {
    return s;
  }
}

/** SDK 8 CredentialSource shape: `{ value: "Bearer …", expiresAtSeconds }`. The SDK reports any throw
 *  here only as "credential callback failed", so the real reason is logged first (no token/wallet). */
export async function getXmtpCredential(): Promise<{ value: string; expiresAtSeconds: bigint }> {
  const wallet = useAppStore.getState().wallet?.address ?? "";
  const blocked = !!_block && _block.wallet === wallet && _block.until > Date.now();
  try {
    const out = await credentialInner(!blocked);
    _lastFailure = null;
    _block = null;
    return out;
  } catch (e) {
    if (blocked) throw new Error(_block!.reason);
    _lastFailure = String((e as Error)?.message ?? e).slice(0, 300);
    const reason = String((e as Error)?.message ?? e).replace(/[1-9A-HJ-NP-Za-km-z]{32,44}|eyJ[\w.-]+/g, "<redacted>").slice(0, 200);
    const first = !_block || _block.wallet !== wallet;
    _block = nextBlock(_block, wallet, _lastFailure, Date.now());
    console.warn("[XMTP] credential failed:", reason, isUserAnswerFailure(reason) ? "(waiting for Retry)" : `(next try in ${Math.round((_block.until - Date.now()) / 1000)}s)`);
    // One report per failure streak, not one per SDK retry.
    if (first) { try { captureError(new Error(`xmtp credential: ${reason}`), { where: "xmtpCredential" }); } catch { /* reporting only */ } }
    throw e;
  }
}

async function credentialInner(canPrompt = true): Promise<{ value: string; expiresAtSeconds: bigint }> {
  const wallet = useAppStore.getState().wallet?.address;
  const now = Math.floor(Date.now() / 1000);
  let s = await load(wallet);
  // No wallet in a background runtime: a stored token works, but a new sign-in needs the UI.
  if (!wallet && (!s || s.expiresAt <= now + 60)) throw new Error("Connect your wallet first");
  if (canPrompt && s && s.expiresAt > now + 60 && s.expiresAt - now < REFRESH_WITHIN_S) {
    s = await refresh(s);
    if (s) await save(s);
  }
  if (!s || s.expiresAt <= now + 60) {
    // Loaded here, not at the top: livekitProof → useMobileWallet → xmtp.ts → xmtpSdk → this file
    // is a cycle, and at app start it left xmtp.ts with undefined codec classes (3.1 splash crash).
    const { holderSession } = await import("@/lib/livekitProof");
    if (!canPrompt) throw new Error("waiting");
    s = await holderSession();
    await save(s);
  }
  return { value: `Bearer ${s.token}`, expiresAtSeconds: BigInt(s.expiresAt) };
}
