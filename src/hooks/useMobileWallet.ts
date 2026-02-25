/**
 * useMobileWallet
 *
 * Wraps Solana Mobile Wallet Adapter (MWA) for:
 *  - Connecting to an installed wallet app
 *  - Requesting authorization
 *  - Signing messages (used for XMTP init)
 *  - Disconnecting
 *
 * MWA protocol docs:
 * https://docs.solanamobile.com/react-native/mwa_deep_dive
 */

import { useCallback, useState } from "react";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey } from "@solana/web3.js";
import { Linking } from "react-native";
import { useAppStore } from "@/store/appStore";
import type { WalletAccount } from "@/types";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",  // Update to your app's URI
  icon: "favicon.ico",
};

export function useMobileWallet() {
  const { setWallet, setLoading, setError, wallet, reset } = useAppStore();
  const [authToken, setAuthToken] = useState<string | null>(null);
  // Store the raw base64 address from MWA for use in subsequent MWA calls
  const [rawAddress, setRawAddress] = useState<string | null>(null);

  /**
   * Connect wallet via MWA.
   * walletScheme: optional URI scheme to bring a specific wallet to
   * foreground before transact() fires (e.g. "phantom://", "solflare://").
   * Android will then prefer the foregrounded app when routing the MWA intent.
   */
  const connect = useCallback(async (walletScheme?: string): Promise<WalletAccount | null> => {
    setLoading(true);
    setError(null);

    try {
      // Bring specific wallet to foreground so Android MWA routes to it
      if (walletScheme) {
        try {
          const canOpen = await Linking.canOpenURL(walletScheme);
          if (canOpen) {
            await Linking.openURL(walletScheme);
            // Give the wallet app 900 ms to come to foreground
            await new Promise<void>((r) => setTimeout(r, 900));
          }
        } catch { /* wallet not installed — fall through to system chooser */ }
      }

      const account = await transact(async (mobileWallet: Web3MobileWallet) => {
        const authResult = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
        });

        setAuthToken(authResult.auth_token);

        // MWA v2 returns accounts[0].address as a base64-encoded public key.
        // We must decode it to bytes before passing to PublicKey constructor.
        const addrRaw = authResult.accounts[0].address;
        setRawAddress(addrRaw as string);
        const pubkeyBytes =
          typeof addrRaw === "string"
            ? Buffer.from(addrRaw, "base64")
            : addrRaw;
        const pubkey = new PublicKey(pubkeyBytes);

        const walletAccount: WalletAccount = {
          address: pubkey.toBase58(),
          label: authResult.accounts[0].label,
          chains: ["solana:mainnet"],
          features: ["solana:signMessage", "solana:signTransaction"],
        };

        return walletAccount;
      });

      setWallet(account);
      return account;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setWallet, setLoading, setError]);

  /**
   * Sign a message — used for XMTP key derivation.
   * Opens wallet app for user approval.
   */
  const signMessage = useCallback(
    async (messageBytes: Uint8Array): Promise<Uint8Array> => {
      if (!wallet || !authToken) {
        throw new Error("Wallet not connected");
      }

      // Use the original base64 address for MWA signMessages (protocol requirement)
      const addressForMwa = rawAddress ?? wallet.address;

      const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
        // Re-authorize with cached token
        await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
          auth_token: authToken,
        } as Parameters<typeof mobileWallet.authorize>[0]);

        const [sig] = await mobileWallet.signMessages({
          addresses: [addressForMwa],
          payloads: [messageBytes],
        });

        return sig;
      });

      return signature;
    },
    [wallet, authToken, rawAddress]
  );

  /**
   * Disconnect: clear auth token and reset store.
   */
  const disconnect = useCallback(() => {
    setAuthToken(null);
    reset();
  }, [reset]);

  return { connect, signMessage, disconnect };
}
