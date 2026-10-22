import type { WalletAccount } from "@/types";
import { collectWithMwa } from "@/web/mwaSession";
import { loginWithBundle } from "@/web/bundleLogin";
import { MWA_WALLET_NAME } from "@/web/walletStandard";
import { clearWebSignIn, signInWithWallet } from "@/web/webAuth";

/**
 * Web: a wallet-signed sign-in proves the wallet and its Saga Monke / Genesis
 * Token to the actions worker, which issues the token the self-hosted XMTP
 * backend requires. Throws a readable error for non-holders.
 */
export async function signInForChat(walletAddress: string): Promise<void> {
  await signInWithWallet(walletAddress);
}

export async function signOutOfChat(): Promise<void> {
  await clearWebSignIn();
}

/**
 * Join requests are the same as the phone app's: the bot checks the claimed
 * wallet's holdings itself and admits the sending inbox. (The staging helper's
 * token proof is only for the self-hosted test backend.)
 */
export async function joinProofSuffix(): Promise<string> {
  return "";
}

/**
 * Phone browsers, Mobile Wallet Adapter: the whole login (connect, sign-in,
 * chat identity) in one wallet launch. Must be called straight from the tap —
 * Chrome on Android only opens the wallet for a launch that follows a tap.
 */
export function startSingleSessionLogin(choiceKey: string): Promise<WalletAccount> | null {
  if (choiceKey !== MWA_WALLET_NAME) return null;
  const bundle = collectWithMwa();
  return bundle.then((b) => loginWithBundle(b, "Seed Vault"));
}

export { importPhoneProfile } from "@/web/profileImport";
