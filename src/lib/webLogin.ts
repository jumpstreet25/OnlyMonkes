import type { WalletAccount } from "@/types";

/** Native: chat access is the wallet-bound XMTP identity alone; nothing to do. */
export async function signInForChat(_walletAddress: string): Promise<void> {}
export async function signOutOfChat(): Promise<void> {}

/** Native: join requests carry only the wallet. */
export async function joinProofSuffix(): Promise<string> {
  return "";
}

/** Native: the MWA wallet apps connect through useMobileWallet. */
export function startSingleSessionLogin(_choiceKey: string): Promise<WalletAccount> | null {
  return null;
}

export type ImportedProfile = { username: string; bio: string; xAccount: string; tipWallet: string; location: string };

/** Native: the phone already has its own profile. */
export async function importPhoneProfile(): Promise<ImportedProfile | null> {
  return null;
}
