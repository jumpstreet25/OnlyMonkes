/**
 * session.ts
 *
 * Persists the last-connected wallet indefinitely.
 * On re-launch, if a valid session exists, the wallet state is restored
 * automatically — the user skips the Connect screen and goes straight
 * to NFT verification.
 */

import * as SecureStore from "expo-secure-store";
import type { WalletAccount, OwnedNFT } from "@/types";

const SK_ADDRESS = "session_wallet_address";
const SK_LABEL = "session_wallet_label";
const SK_TIMESTAMP = "session_timestamp";

// No TTL — session persists indefinitely across app updates

export async function saveSession(wallet: WalletAccount): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_ADDRESS, wallet.address),
    SecureStore.setItemAsync(SK_LABEL, wallet.label ?? ""),
    SecureStore.setItemAsync(SK_TIMESTAMP, String(Date.now())),
  ]);
}

/**
 * Returns the saved WalletAccount if a session exists.
 * Sessions persist indefinitely — no TTL expiry.
 */
export async function loadSession(): Promise<WalletAccount | null> {
  try {
    const [address, label] = await Promise.all([
      SecureStore.getItemAsync(SK_ADDRESS),
      SecureStore.getItemAsync(SK_LABEL),
    ]);

    if (!address) return null;

    return {
      address,
      label: label || undefined,
      chains: ["solana:mainnet"],
      features: ["solana:signMessage", "solana:signTransaction"],
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SK_ADDRESS),
    SecureStore.deleteItemAsync(SK_LABEL),
    SecureStore.deleteItemAsync(SK_TIMESTAMP),
  ]);
}

/**
 * One-time cleanup: delete stale Matrica SecureStore keys left from previous builds.
 * Safe to call multiple times — deleteItemAsync is a no-op if the key doesn't exist.
 */
export async function clearLegacyKeys(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync("matrica_access_token").catch(() => {}),
    SecureStore.deleteItemAsync("matrica_wallet_address").catch(() => {}),
    SecureStore.deleteItemAsync("matrica_session_ts").catch(() => {}),
  ]);
}

// ─── Verified NFT cache ────────────────────────────────────────────────────────
// Stores the NFT the user selected so we can skip the verify screen on re-launch.

const SK_VERIFIED_NFT = "session_verified_nft";

export async function saveVerifiedNft(nft: OwnedNFT): Promise<void> {
  await SecureStore.setItemAsync(SK_VERIFIED_NFT, JSON.stringify(nft));
}

export async function loadVerifiedNft(): Promise<OwnedNFT | null> {
  try {
    const raw = await SecureStore.getItemAsync(SK_VERIFIED_NFT);
    return raw ? (JSON.parse(raw) as OwnedNFT) : null;
  } catch {
    return null;
  }
}

export async function clearVerifiedNft(): Promise<void> {
  await SecureStore.deleteItemAsync(SK_VERIFIED_NFT);
}
