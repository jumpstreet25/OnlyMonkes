/**
 * Web sign-in → XMTP access token (worker-actions/src/webAuth.ts).
 *
 * The wallet signs a one-time sign-in message from the actions worker; the
 * worker checks holder status and returns a 24h token the self-hosted XMTP
 * backend accepts. Tokens refresh while still valid; after that the wallet
 * signs again. Token is kept in the encrypted web SecureStore stand-in.
 */

import * as SecureStore from "expo-secure-store";
import { connectWallet, getSelectedWallet, signMessageRaw } from "./walletStandard";

const DEFAULT_WORKER = "https://onlymonkes-actions.jumpstreet25.workers.dev";

/** Actions worker; a local test harness may point it at `wrangler dev`. */
function workerUrl(): string {
  const o = (globalThis as any).__OM_ACTIONS_URL;
  return typeof o === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o) ? o : DEFAULT_WORKER;
}
const TOKEN_KEY = "om_web_xmtp_token";
const REFRESH_WITHIN_S = 2 * 3600;

export type Stored = { token: string; expiresAt: number; wallet: string; tier: string };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function post(path: string, body: unknown, bearer?: string): Promise<any> {
  const res = await fetch(`${workerUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(typeof data?.error === "string" ? data.error : `sign-in failed (${res.status})`);
    (err as any).status = res.status;
    throw err;
  }
  return data;
}

async function load(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

async function save(s: Stored): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(s));
}

/** Store a token obtained elsewhere (phone pairing, src/web/pairing.ts). */
export async function saveWebSignIn(s: Stored): Promise<void> {
  await save(s);
}

export async function clearWebSignIn(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}

let _signIn: Promise<Stored> | null = null;

/** Wallet-signed sign-in. Throws a readable error for non-holders. */
export function signInWithWallet(walletAddress: string): Promise<Stored> {
  if (_signIn) return _signIn;
  _signIn = (async () => {
    const wallet = await getSelectedWallet();
    const accounts = await connectWallet(wallet, true);
    const account = accounts.find((a) => a.address === walletAddress) ?? accounts[0];
    if (!account || account.address !== walletAddress) throw new Error("Connected wallet does not match this account");
    const { nonce, message } = await post("/api/auth/challenge", { address: walletAddress });
    const sig = await signMessageRaw(wallet, account, new TextEncoder().encode(message));
    const r = await post("/api/auth/login", { nonce, signature: toBase64(sig) });
    const stored: Stored = { token: r.token, expiresAt: r.expiresAt, wallet: walletAddress, tier: r.tier };
    await save(stored);
    return stored;
  })();
  _signIn.finally(() => { _signIn = null; }).catch(() => {});
  return _signIn;
}

/**
 * Bearer credential for the XMTP backend: cached token, refreshed when it is
 * close to expiry, or a fresh wallet sign-in once it has expired.
 */
export async function getXmtpCredential(): Promise<{ value: string; expiresAtSeconds: bigint }> {
  const now = Math.floor(Date.now() / 1000);
  let s = await load();
  if (s && s.expiresAt - now < REFRESH_WITHIN_S && s.expiresAt > now + 60) {
    try {
      const r = await post("/api/auth/refresh", {}, s.token);
      s = { ...s, token: r.token, expiresAt: r.expiresAt, tier: r.tier };
      await save(s);
    } catch (e) {
      if ((e as any)?.status === 403) {
        await clearWebSignIn();
        throw e;
      }
    }
  }
  if (!s || s.expiresAt <= now + 60) {
    if (!s?.wallet) throw new Error("Sign in with your wallet to open chat");
    s = await signInWithWallet(s.wallet);
  }
  return { value: `Bearer ${s.token}`, expiresAtSeconds: BigInt(s.expiresAt) };
}
