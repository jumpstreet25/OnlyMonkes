/**
 * Sign In With Solana on the connect screen — the wallet proof Device Integrity uses, so the
 * holder never sees a separate "sign message" prompt for it. The worker hands out the nonce
 * (valid 10 min); the signed result lives in memory only until Device Integrity sends it, once.
 * Wallets without native sign-in get the MWA library's fallback (one sign at connect).
 */

const WORKER_BASE = "https://onlymonkes.app";
const CHALLENGE_TIMEOUT_MS = 3_000;
const MAX_AGE_MS = 9 * 60 * 1000;

export interface SignInProof {
  wallet: string;
  nonce: string;
  messageBase64: string;
  signatureBase64: string;
  at: number;
}

let pending: SignInProof | null = null;

/** The sign_in_payload for MWA authorize, or null when the worker can't be reached in time (plain connect). */
export async function fetchSignInPayload(): Promise<{ nonce: string; payload: Record<string, string> } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHALLENGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE}/api/device-integrity/challenge?for=signin`, { method: "POST", signal: ctrl.signal });
    if (!res.ok) return null;
    const { nonce, domain } = (await res.json()) as { nonce?: string; domain?: string };
    if (!nonce || !domain) return null;
    return {
      nonce,
      payload: {
        domain,
        statement: "Sign in to OnlyMonkes. This only proves the wallet is yours; it can't move funds.",
        nonce,
        issuedAt: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const toStdBase64 = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return b + "=".repeat((4 - (b.length % 4)) % 4);
};

export function rememberSignIn(wallet: string, nonce: string, result: { signed_message: string; signature: string }): void {
  pending = {
    wallet,
    nonce,
    messageBase64: toStdBase64(result.signed_message),
    signatureBase64: toStdBase64(result.signature),
    at: Date.now(),
  };
}

/** The connect screen's sign-in for this wallet, if fresh; single use. */
export function takeSignIn(wallet: string): SignInProof | null {
  const p = pending;
  pending = null;
  return p && p.wallet === wallet && Date.now() - p.at < MAX_AGE_MS ? p : null;
}
