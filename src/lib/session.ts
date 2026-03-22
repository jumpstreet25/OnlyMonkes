/**
 * session.ts
 *
 * Persists the last-connected wallet indefinitely.
 * On re-launch, if a valid session exists, the wallet state is restored
 * automatically — the user skips the Connect screen and goes straight
 * to NFT verification.
 */

import * as SecureStore from "expo-secure-store";
import { AppState, AppStateStatus } from "react-native";
import type { WalletAccount, OwnedNFT } from "@/types";

const SK_ADDRESS = "session_wallet_address";
const SK_LABEL = "session_wallet_label";
const SK_TIMESTAMP = "session_timestamp";
const SK_LAST_NFT_CHECK = "session_last_nft_check";

/** Re-check NFT ownership every 24 hours */
const NFT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

/** Clear Matrica session keys (legacy auth system, now replaced by NFT verification). */
export const clearMatricaSession = clearLegacyKeys;

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
  await SecureStore.deleteItemAsync(SK_LAST_NFT_CHECK);
}

// ─── 24h NFT ownership re-validation ──────────────────────────────────────────

/** Mark that we just verified NFT ownership (called after initial verify + re-checks). */
export async function stampNftCheck(): Promise<void> {
  await SecureStore.setItemAsync(SK_LAST_NFT_CHECK, String(Date.now()));
}

/** Returns true if 24h have elapsed since the last NFT ownership check. */
export async function shouldRevalidateNft(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(SK_LAST_NFT_CHECK);
    if (!raw) return true; // never checked
    return Date.now() - Number(raw) >= NFT_CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

let _nftCheckAppStateSub: { remove: () => void } | null = null;

/**
 * Start a background listener that re-checks NFT ownership every 24h.
 * Runs the check on app foreground events. If the user no longer owns
 * their NFT, clears the session and calls `onForceLogout()`.
 */
export function startNftOwnershipGuard(onForceLogout: () => void): void {
  // Avoid duplicate subscriptions
  if (_nftCheckAppStateSub) return;

  // Lazy import to avoid circular dependency
  const doCheck = async () => {
    try {
      const needsCheck = await shouldRevalidateNft();
      if (!needsCheck) return;

      const wallet = await loadSession();
      const nft = await loadVerifiedNft();
      if (!wallet || !nft) return;

      // Dynamic import to keep session.ts lightweight
      const { verifyNFTOwnership } = await import("./nftVerification");
      const result = await verifyNFTOwnership(wallet.address);

      if (!result.verified) {
        console.log("[NFTGuard] User no longer owns a collection NFT — forcing logout");
        await clearSession();
        await clearVerifiedNft();
        onForceLogout();
        return;
      }

      // Still owns an NFT — stamp the check
      await stampNftCheck();
    } catch (err) {
      // Network errors are non-fatal — we'll retry next foreground
      console.warn("[NFTGuard] Re-check failed, will retry:", err);
    }
  };

  // Don't check immediately on boot — ConnectScreen handles initial verification.
  // Only re-check when the user backgrounds and returns to the app after 24h.
  let lastState: AppStateStatus = AppState.currentState;
  _nftCheckAppStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (lastState !== "active" && next === "active") {
      doCheck();
    }
    lastState = next;
  });
}

/** Stop the NFT ownership guard listener. */
export function stopNftOwnershipGuard(): void {
  if (_nftCheckAppStateSub) {
    _nftCheckAppStateSub.remove();
    _nftCheckAppStateSub = null;
  }
}
