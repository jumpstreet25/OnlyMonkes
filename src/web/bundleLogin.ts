/**
 * Finish a web login from a wallet bundle (wallet, token, chat-identity
 * signature) — from a paired phone (src/web/pairing.ts) or this phone's own
 * single-session wallet approval (src/web/mwaSession.ts). Same steps as
 * useMobileWallet.connect, minus the wallet prompts.
 */
import { useAppStore } from "@/store/appStore";
import { rehydrateForWallet } from "@/lib/walletIdentity";
import { bindXmtpToWallet, prepareWalletBoundXmtp } from "@/lib/xmtp";
import { xmtpIdentityMessageBytes } from "@/lib/xmtpIdentity";
import type { WalletAccount } from "@/types";
import { saveWebSignIn } from "./webAuth";

export type WalletBundle = { wallet: string; token: string; expiresAt: number; tier: string; identity: string };

function fromB64url(s: string): Uint8Array {
  const n = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(n + "=".repeat((4 - (n.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export async function loginWithBundle(bundle: WalletBundle, label: string): Promise<WalletAccount> {
  await saveWebSignIn({ token: bundle.token, expiresAt: bundle.expiresAt, wallet: bundle.wallet, tier: bundle.tier });
  const account: WalletAccount = {
    address: bundle.wallet,
    label,
    chains: ["solana:mainnet"],
    features: ["solana:signMessage"],
  };
  useAppStore.getState().setWallet(account);
  await rehydrateForWallet(account.address);
  bindXmtpToWallet(account.address);
  const expected = xmtpIdentityMessageBytes(bundle.wallet, 0);
  await prepareWalletBoundXmtp(account.address, async (bytes) => {
    if (bytes.length !== expected.length || bytes.some((b, i) => b !== expected[i])) {
      throw new Error("This login can only sign the chat identity message");
    }
    return fromB64url(bundle.identity);
  });
  return account;
}
