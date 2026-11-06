/**
 * Helius keys on two accounts. Credits are counted per account, so calls
 * alternate between HELIUS_NFT_API_KEY (falls back to HELIUS_API_KEY) and
 * HELIUS_API_KEY_2 (another account); the RPC proxy retries a call on the
 * other key when one is rate limited or out of credits. Without
 * HELIUS_API_KEY_2 everything stays on the first key.
 */

export interface HeliusKeyEnv {
  HELIUS_API_KEY?: string;
  HELIUS_NFT_API_KEY?: string;
  HELIUS_API_KEY_2?: string;
}

let turn = 0;

export function heliusKeys(env: HeliusKeyEnv): string[] {
  return [env.HELIUS_NFT_API_KEY || env.HELIUS_API_KEY, env.HELIUS_API_KEY_2].filter((k): k is string => !!k);
}

/** This call's key: the next one in turn. */
export function heliusKey(env: HeliusKeyEnv): string {
  const keys = heliusKeys(env);
  return keys[turn++ % keys.length] ?? "";
}

/** Status codes that mean "try the other account": rate limit, credits gone, key refused. */
export function heliusKeyFailed(status: number): boolean {
  return status === 429 || status === 401 || status === 403 || status === 402;
}
