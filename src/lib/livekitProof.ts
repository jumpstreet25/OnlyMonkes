/**
 * Proof sent with every LiveKit token request (worker/src/index.ts →
 * worker-actions/src/livekitAuth.ts): the phone's hardware Keystore key —
 * the one Device Integrity verified and bound to this holder wallet — signs
 * this room + identity + a fresh server nonce. No wallet prompt.
 * Web has its own version (livekitProof.web.ts, holder sign-in token).
 *
 * holderProof() is the fallback when the token server refuses the device
 * proof (no Device Integrity verdict for this wallet): one wallet signature
 * gets the same holder sign-in token the web app uses, kept in memory for
 * its 24 h life, so no holder is locked out of rooms.
 */
import { Buffer } from "buffer";
import { Platform } from "react-native";
import { toast } from "sonner-native";
import { useAppStore } from "@/store/appStore";
import { getDevicePublicKeyBase64, isDeviceAttestAvailable, signWithDeviceKey } from "@/lib/deviceAttest";
import { signBytesWithMwa } from "@/hooks/useMobileWallet";

const WORKER_BASE = "https://onlymonkes.app";

export async function livekitProof(roomName: string, identity: string): Promise<Record<string, string> | undefined> {
  if (Platform.OS !== "android" || !isDeviceAttestAvailable()) return undefined;
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) return undefined;
  try {
    const res = await fetch(`${WORKER_BASE}/api/device-integrity/challenge`, { method: "POST" });
    if (!res.ok) return undefined;
    const { nonce } = (await res.json()) as { nonce?: string };
    if (!nonce) return undefined;
    const devicePubKey = await getDevicePublicKeyBase64();
    const message = `OnlyMonkes LiveKit\nroom:${roomName}\nidentity:${identity}\nnonce:${nonce}`;
    const sig = await signWithDeviceKey(Buffer.from(message, "utf8").toString("base64"));
    return { kind: "device", wallet, devicePubKey, nonce, sig };
  } catch {
    return undefined;
  }
}

let _holder: { wallet: string; token: string; expiresAt: number } | null = null;
const MISMATCH_PAUSE_MS = 5 * 60_000;
let _mismatch: { wallet: string; until: number; message: string } | null = null;

export async function holderProof(canPrompt = true): Promise<{ kind: "holder"; token: string }> {
  const { token } = await holderSession(canPrompt);
  return { kind: "holder", token };
}

/** The holder sign-in itself (one MWA signature, ~24 h). Also the XMTP backend credential (xmtpCredential.ts).
 *  `canPrompt: false` never opens the wallet: it answers from the cached session or throws. */
export async function holderSession(canPrompt = true): Promise<{ wallet: string; token: string; expiresAt: number }> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("Connect your wallet first");
  if (_holder?.wallet === wallet && _holder.expiresAt * 1000 > Date.now() + 60_000) return _holder;
  if (!canPrompt) throw new Error("Holder check needs a wallet signature");
  // After a wrong-account answer, don't reopen the wallet for every XMTP credential retry.
  if (_mismatch?.wallet === wallet && _mismatch.until > Date.now()) throw new Error(_mismatch.message);
  // The sign-in endpoints only answer our own origins.
  const headers = { "Content-Type": "application/json", Origin: WORKER_BASE };
  const ch = await fetch(`${WORKER_BASE}/api/auth/challenge`, { method: "POST", headers, body: JSON.stringify({ address: wallet }) });
  const { nonce, message, error } = (await ch.json().catch(() => ({}))) as { nonce?: string; message?: string; error?: string };
  if (!ch.ok || !nonce || !message) throw new Error(error ?? `Holder check failed (${ch.status})`);
  let sig: Uint8Array;
  try {
    sig = await signBytesWithMwa(wallet, new Uint8Array(Buffer.from(message, "utf8")));
  } catch (e) {
    if ((e as Error)?.name === "WalletMismatchError") {
      _mismatch = { wallet, until: Date.now() + MISMATCH_PAUSE_MS, message: (e as Error).message };
      try { toast.error((e as Error).message); } catch { /* UI not ready */ }
    }
    throw e;
  }
  const login = await fetch(`${WORKER_BASE}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ nonce, signature: Buffer.from(sig).toString("base64") }),
  });
  const out = (await login.json().catch(() => ({}))) as { token?: string; expiresAt?: number; error?: string };
  if (!login.ok || !out.token || !out.expiresAt) throw new Error(out.error ?? `Holder check failed (${login.status})`);
  _holder = { wallet, token: out.token, expiresAt: out.expiresAt };
  return _holder;
}
