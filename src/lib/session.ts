/**
 * session.ts
 *
 * Persists the last-connected wallet for up to 7 days.
 * On re-launch, if a valid session exists, the wallet state is restored
 * automatically — the user skips the Connect screen and goes straight
 * to NFT verification.
 */

import * as SecureStore from "expo-secure-store";
import type { WalletAccount } from "@/types";

const SK_ADDRESS = "session_wallet_address";
const SK_LABEL = "session_wallet_label";
const SK_TIMESTAMP = "session_timestamp";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function saveSession(wallet: WalletAccount): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_ADDRESS, wallet.address),
    SecureStore.setItemAsync(SK_LABEL, wallet.label ?? ""),
    SecureStore.setItemAsync(SK_TIMESTAMP, String(Date.now())),
  ]);
}

/**
 * Returns the saved WalletAccount if the session is still valid (< 7 days).
 * Returns null if no session exists or it has expired.
 */
export async function loadSession(): Promise<WalletAccount | null> {
  try {
    const [address, label, tsStr] = await Promise.all([
      SecureStore.getItemAsync(SK_ADDRESS),
      SecureStore.getItemAsync(SK_LABEL),
      SecureStore.getItemAsync(SK_TIMESTAMP),
    ]);

    if (!address || !tsStr) return null;

    const age = Date.now() - parseInt(tsStr, 10);
    if (age > SESSION_TTL_MS) {
      await clearSession();
      return null;
    }

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

// ─── Matrica session ──────────────────────────────────────────────────────────

const SK_MATRICA_TOKEN   = "matrica_access_token";
const SK_MATRICA_WALLET  = "matrica_wallet_address";
const SK_MATRICA_TS      = "matrica_session_ts";

export async function saveMatricaSession(
  accessToken: string,
  walletAddress: string
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_MATRICA_TOKEN,  accessToken),
    SecureStore.setItemAsync(SK_MATRICA_WALLET, walletAddress),
    SecureStore.setItemAsync(SK_MATRICA_TS,     String(Date.now())),
  ]);
}

export async function loadMatricaSession(): Promise<WalletAccount | null> {
  try {
    const [token, wallet, tsStr] = await Promise.all([
      SecureStore.getItemAsync(SK_MATRICA_TOKEN),
      SecureStore.getItemAsync(SK_MATRICA_WALLET),
      SecureStore.getItemAsync(SK_MATRICA_TS),
    ]);

    if (!token || !wallet || !tsStr) return null;

    const age = Date.now() - parseInt(tsStr, 10);
    if (age > SESSION_TTL_MS) {
      await clearMatricaSession();
      return null;
    }

    return {
      address: wallet,
      label: "Matrica",
      chains: ["solana:mainnet"],
      features: ["solana:signMessage", "solana:signTransaction"],
    };
  } catch {
    return null;
  }
}

export async function clearMatricaSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SK_MATRICA_TOKEN),
    SecureStore.deleteItemAsync(SK_MATRICA_WALLET),
    SecureStore.deleteItemAsync(SK_MATRICA_TS),
  ]);
}
