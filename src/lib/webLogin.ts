/** Native: chat access is the wallet-bound XMTP identity alone; nothing to do. */
export async function signInForChat(_walletAddress: string): Promise<void> {}
export async function signOutOfChat(): Promise<void> {}

/** Native: join requests carry only the wallet. */
export async function joinProofSuffix(): Promise<string> {
  return "";
}
