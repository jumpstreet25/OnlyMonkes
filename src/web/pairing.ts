/**
 * Phone → desktop login pairing ("scan with your Seeker").
 *
 * Desktop: one-time X25519 key → POST /api/pair/start → QR with
 *   `${origin}/pair#id=<id>&k=<desktop public key>` and a 4-digit code.
 * Phone (the Seeker's own browser, where Seeker Connect works): shows the
 *   same code, signs the sign-in (holder token) and the chat-identity message,
 *   encrypts { wallet, token, identity } to the desktop key, POST /complete.
 * Desktop: polls, decrypts, stores the token and derives the same XMTP inbox
 *   from the identity signature — the phone's keys never leave the phone, and
 *   the worker only relays ciphertext (worker-actions/src/webPair.ts).
 */

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { xmtpIdentityMessageBytes } from "@/lib/xmtpIdentity";
import { saveWebSignIn, signInWithWallet } from "./webAuth";
import { connectWallet, getSelectedWallet, signMessageMwaFormat } from "./walletStandard";

const DEFAULT_WORKER = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const POLL_MS = 2000;
const PAIR_TTL_MS = 5 * 60 * 1000;
const INFO = new TextEncoder().encode("onlymonkes-pair-v1");

export type PairBundle = { wallet: string; token: string; expiresAt: number; tier: string; identity: string };

function workerUrl(): string {
  const o = (globalThis as any).__OM_ACTIONS_URL;
  return typeof o === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o) ? o : DEFAULT_WORKER;
}

export function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const n = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(n + "=".repeat((4 - (n.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${workerUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : `pairing failed (${res.status})`);
  return data;
}

/** 4-digit code both screens show, derived from the desktop's public key. */
export function pairCode(desktopKeyB64url: string): string {
  const h = sha256(fromB64url(desktopKeyB64url));
  return String(((h[0] << 16) | (h[1] << 8) | h[2]) % 10000).padStart(4, "0");
}

async function aesKey(shared: Uint8Array, id: string, usage: KeyUsage): Promise<CryptoKey> {
  const raw = hkdf(sha256, shared, new TextEncoder().encode(id), INFO, 32);
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, [usage]);
}

export type SealedBundle = { phoneKey: string; iv: string; data: string };

/** Phone: encrypt the bundle to the desktop's one-time X25519 key. */
export async function sealBundle(desktopKey: string, id: string, bundle: PairBundle): Promise<SealedBundle> {
  const priv = x25519.utils.randomPrivateKey();
  const key = await aesKey(x25519.getSharedSecret(priv, fromB64url(desktopKey)), id, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
    key,
    new TextEncoder().encode(JSON.stringify(bundle)),
  ));
  return { phoneKey: toB64url(x25519.getPublicKey(priv)), iv: toB64url(iv), data: toB64url(data) };
}

/** Desktop: decrypt with the one-time private key. Throws if anything was altered. */
export async function openBundle(desktopPriv: Uint8Array, id: string, sealed: SealedBundle): Promise<PairBundle> {
  const key = await aesKey(x25519.getSharedSecret(desktopPriv, fromB64url(sealed.phoneKey)), id, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(sealed.iv) as BufferSource, additionalData: new TextEncoder().encode(id) },
    key,
    fromB64url(sealed.data) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as PairBundle;
}

// ─── Desktop ─────────────────────────────────────────────────────────────────

export type DesktopPairing = {
  id: string;
  url: string;
  code: string;
  /** Typed on the phone when its camera / wallet scanner won't open the QR link. */
  shortCode: string;
  /** Resolves with the decrypted bundle once the phone approves. */
  result: Promise<PairBundle>;
  cancel: () => void;
};

export async function startDesktopPairing(): Promise<DesktopPairing> {
  const priv = x25519.utils.randomPrivateKey();
  const desktopKey = toB64url(x25519.getPublicKey(priv));
  const { id, shortCode } = await post("/api/pair/start", { desktopKey });
  const url = `${window.location.origin}/pair#id=${id}&k=${desktopKey}`;
  let cancelled = false;
  const result = (async () => {
    const deadline = Date.now() + PAIR_TTL_MS;
    while (!cancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled) break;
      const r = await post("/api/pair/poll", { id }).catch(() => null);
      if (r?.status !== "done") continue;
      const bundle = await openBundle(priv, id, r.bundle);
      await saveWebSignIn({ token: bundle.token, expiresAt: bundle.expiresAt, wallet: bundle.wallet, tier: bundle.tier });
      return bundle;
    }
    throw new Error(cancelled ? "Pairing cancelled" : "Pairing timed out — show a new code");
  })();
  result.catch(() => {});
  return { id, url, code: pairCode(desktopKey), shortCode, result, cancel: () => { cancelled = true; } };
}

// ─── Phone ───────────────────────────────────────────────────────────────────

/** "k7q4 mx2p" / "K7Q4-MX2P" / "K7Q4MXZP" with O/I/L typos → "K7Q4MX2P", or null. */
export function normalizeShortCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(c) ? c : null;
}

export function formatShortCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Phone: resolve a typed short code to the pairing it belongs to. */
export async function lookupShortCode(input: string): Promise<{ id: string; desktopKey: string }> {
  const shortCode = normalizeShortCode(input);
  if (!shortCode) throw new Error("That code doesn't look right — it's 8 letters and numbers, like K7Q4-MX2P");
  const r = await post("/api/pair/lookup", { shortCode });
  return { id: r.id, desktopKey: r.desktopKey };
}

/** Phone: is this pairing still waiting for approval? (Does not consume it.) */
export async function pairingIsLive(id: string): Promise<boolean> {
  try {
    const r = await post("/api/pair/poll", { id });
    return r?.status === "pending";
  } catch {
    return false;
  }
}

/** Parse `#id=<id>&k=<desktop key>` from the /pair link. */
export function readPairLink(hash: string): { id: string; desktopKey: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const id = p.get("id") ?? "";
  const desktopKey = p.get("k") ?? "";
  return /^[0-9a-f]{32}$/.test(id) && /^[A-Za-z0-9_-]{43}$/.test(desktopKey) ? { id, desktopKey } : null;
}

/**
 * Phone side, Wallet Standard wallets (Seeker Connect etc.): sign in and sign
 * the chat-identity message through the wallet chosen on the pair screen.
 */
export async function collectWithWalletStandard(): Promise<PairBundle> {
  const wallet = await getSelectedWallet();
  const [account] = await connectWallet(wallet, false);
  if (!account) throw new Error("No wallet account connected");
  const signIn = await signInWithWallet(account.address);
  const identity = await signMessageMwaFormat(wallet, account, xmtpIdentityMessageBytes(account.address, 0));
  return { wallet: account.address, token: signIn.token, expiresAt: signIn.expiresAt, tier: signIn.tier, identity: toB64url(identity) };
}

/** Phone side: encrypt the collected bundle to the desktop key and hand it over. */
export async function approveOnPhone(link: { id: string; desktopKey: string }, bundle: Promise<PairBundle>): Promise<void> {
  await post("/api/pair/complete", { id: link.id, ...(await sealBundle(link.desktopKey, link.id, await bundle)) });
}
