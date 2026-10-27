/**
 * Bearer credential for OnlyMonkes' self-hosted XMTP backend (3.1, SDK 8).
 *
 * The backend's [auth] accepts the same holder token as the web app's sign-in
 * (worker `/api/auth/login`, ~24 h). The phone gets it with one MWA signature
 * (livekitProof.holderSession), keeps it in SecureStore so a restart doesn't
 * prompt again, and renews it through `/api/auth/refresh` before it expires.
 */

import * as SecureStore from "expo-secure-store";
import { holderSession } from "@/lib/livekitProof";
import { useAppStore } from "@/store/appStore";

const WORKER_BASE = "https://onlymonkes.app";
const SK_TOKEN = "om_xmtp_holder_v1";
const REFRESH_WITHIN_S = 6 * 3600;

type Stored = { wallet: string; token: string; expiresAt: number };

let _mem: Stored | null = null;

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

/** SDK 8 CredentialSource shape: `{ value: "Bearer …", expiresAtSeconds }`. */
export async function getXmtpCredential(): Promise<{ value: string; expiresAtSeconds: bigint }> {
  const wallet = useAppStore.getState().wallet?.address;
  const now = Math.floor(Date.now() / 1000);
  let s = await load(wallet);
  // No wallet in a background runtime: a stored token works, but a new sign-in needs the UI.
  if (!wallet && (!s || s.expiresAt <= now + 60)) throw new Error("Connect your wallet first");
  if (s && s.expiresAt > now + 60 && s.expiresAt - now < REFRESH_WITHIN_S) {
    s = await refresh(s);
    if (s) await save(s);
  }
  if (!s || s.expiresAt <= now + 60) {
    s = await holderSession();
    await save(s);
  }
  return { value: `Bearer ${s.token}`, expiresAtSeconds: BigInt(s.expiresAt) };
}
