/**
 * Phone browsers: everything the web app needs from the wallet in ONE Mobile
 * Wallet Adapter session — authorize, then sign the sign-in challenge and the
 * chat-identity message together.
 *
 * Separate wallet launches don't work from Chrome on Android: only the launch
 * that follows a tap opens the wallet app; later ones (started after network
 * calls) load the wallet's App Link as a web page instead (owner hit this on a
 * Seeker: fingerprint approved, then solanamobile.com/seeker). So call
 * collectWithMwa() directly from the tap handler, before any await.
 *
 * Signed payloads come back as message + signature (MWA spec), exactly the
 * bytes the phone app feeds into its XMTP identity derivation.
 */
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import bs58 from "bs58";
import { xmtpIdentityMessageBytes } from "@/lib/xmtpIdentity";
import { completeSignIn, requestSignInChallenge } from "./webAuth";
import { APP_IDENTITY } from "./walletStandard";

const SIGNATURE_BYTES = 64;

export type WalletBundle = { wallet: string; token: string; expiresAt: number; tier: string; identity: string };

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Chrome's Local Network Access permission ("loopback-network", Chrome 142+)
 * gates the localhost WebSocket MWA talks to the wallet over. Without it the
 * wallet session hangs silently (owner's Seeker, 2026-10-24: code shown,
 * "Waiting for your wallet…" forever). Same check as
 * @solana-mobile/wallet-standard-mobile ≥0.5. The state is read ahead of time
 * because the tap handler can't await before launching the wallet.
 */
let loopback: "granted" | "prompt" | "denied" | "unsupported" = "unsupported";
const permissions = typeof navigator !== "undefined" ? (navigator as any).permissions : undefined;
if (permissions?.query) {
  permissions
    .query({ name: "loopback-network" })
    .then((p: { state: typeof loopback; addEventListener: (t: string, f: () => void) => void }) => {
      loopback = p.state;
      p.addEventListener("change", () => { loopback = p.state; });
    })
    .catch(() => { /* browser without the permission: nothing to ask */ });
}

function loopbackBlocked(): Error | null {
  if (loopback === "prompt") {
    // Ask from inside the tap: this request is what makes Chrome show its prompt.
    fetch("http://localhost").catch(() => {});
    return new Error("Chrome needs your OK to reach your wallet. Tap Allow on its prompt, then tap your wallet again.");
  }
  if (loopback === "denied") {
    return new Error("Chrome is blocking the connection to your wallet. Tap the icon left of the address bar, then Permissions, and allow Local network access. Then tap your wallet again.");
  }
  return null;
}

export function collectWithMwa(): Promise<WalletBundle> {
  const blocked = loopbackBlocked();
  if (blocked) return Promise.reject(blocked);
  let nonce = "";
  let wallet = "";
  // transact() must start in this synchronous call (see top of file).
  const session = transact(async (w): Promise<Uint8Array[]> => {
    const auth = await w.authorize({ identity: APP_IDENTITY, chain: "solana:mainnet" });
    const account = auth.accounts[0];
    if (!account) throw new Error("The wallet returned no account");
    const addressB64 = account.address as string;
    wallet = bs58.encode(unb64(addressB64));
    const challenge = await requestSignInChallenge(wallet);
    nonce = challenge.nonce;
    const { signed_payloads } = await w.signMessages({
      addresses: [addressB64],
      payloads: [b64(new TextEncoder().encode(challenge.message)), b64(xmtpIdentityMessageBytes(wallet, 0))],
    });
    if (signed_payloads.length !== 2) throw new Error("The wallet did not sign both messages");
    return signed_payloads.map(unb64);
  });
  return (async () => {
    const [signIn, identity] = await session;
    const stored = await completeSignIn(wallet, nonce, signIn.slice(-SIGNATURE_BYTES));
    return { wallet, token: stored.token, expiresAt: stored.expiresAt, tier: stored.tier, identity: b64url(identity) };
  })();
}
