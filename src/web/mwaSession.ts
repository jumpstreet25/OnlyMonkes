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

export function collectWithMwa(): Promise<WalletBundle> {
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
