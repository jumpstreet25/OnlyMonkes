import { PublicKey } from '@solana/web3.js';

/**
 * Generate a Solana Pay transfer URL.
 * Spec: https://docs.solanapay.com/spec#transfer-request
 * Format: solana:<recipient>?amount=<amount>&spl-token=<mint>&label=<label>&message=<message>
 */
export function createTipUrl(
  recipientWallet: string,
  amount?: number,
  tokenMint?: string,
  label = 'OnlyMonkes Tip',
  message = 'Tip via OnlyMonkes',
): string {
  let url = `solana:${recipientWallet}`;
  const params: string[] = [];
  if (amount && amount > 0) params.push(`amount=${amount}`);
  if (tokenMint) params.push(`spl-token=${tokenMint}`);
  params.push(`label=${encodeURIComponent(label)}`);
  params.push(`message=${encodeURIComponent(message)}`);
  if (params.length) url += '?' + params.join('&');
  return url;
}

/**
 * Validate a Solana wallet address (base58 public key).
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    const pk = new PublicKey(address);
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}
