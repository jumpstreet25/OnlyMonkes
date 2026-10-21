import { clearWebSignIn, getXmtpCredential, signInWithWallet } from "@/web/webAuth";

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
 * Web: join requests also carry the sign-in token (sent only to the staging
 * helper over the E2E-encrypted DM) so it can admit the sender's inbox without
 * trusting a claimed wallet. See scripts/web/staging-helper.
 */
export async function joinProofSuffix(): Promise<string> {
  const { value } = await getXmtpCredential();
  return `|t=${value.replace(/^Bearer /, "")}`;
}
