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
import bs58 from "bs58";
import { useAppStore } from "@/store/appStore";
import { bindXmtpToWallet, prepareWalletBoundXmtp } from "@/lib/xmtp";
import { rehydrateForWallet } from "@/lib/walletIdentity";
import { assertDeviceTrusted } from "@/lib/security";
import { refreshInboxLinks } from "@/lib/inboxLinking";
import type { WalletAccount } from "@/types";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://github.com/jumpstreet25/OnlyMonkes",
  icon: "favicon.ico",
};

/**
 * Core MWA signing call, parameterized on explicit auth values rather than
 * hook state — lets `connect()` sign immediately with the auth it just
 * received, without waiting on a React re-render to see it via `wallet`/
 * `authToken` state (those only update on the component's next render).
 */
async function signMessageWithAuth(
  messageBytes: Uint8Array,
  auth: { walletAddress: string; authToken: string; rawAddress: string | null },
): Promise<Uint8Array> {
  assertDeviceTrusted("Identity sign");
  const addressForMwa = auth.rawAddress ?? auth.walletAddress;
  return transact(async (mobileWallet: Web3MobileWallet) => {
    await mobileWallet.authorize({
      cluster: "mainnet-beta",
      identity: APP_IDENTITY,
      auth_token: auth.authToken,
    } as Parameters<typeof mobileWallet.authorize>[0]);
    const [sig] = await mobileWallet.signMessages({
      addresses: [addressForMwa],
      payloads: [messageBytes],
    });
    return sig;
  });
}

/**
 * Sign arbitrary bytes with the connected wallet. Re-authorizes via the
 * cached MWA token when the hook's in-memory session is gone (app relaunch).
 */
export async function signBytesWithMwa(
  walletAddress: string,
  messageBytes: Uint8Array,
): Promise<Uint8Array> {
  assertDeviceTrusted("Identity sign");
  const cachedToken = useAppStore.getState().mwaAuthToken;
  return transact(async (mobileWallet: Web3MobileWallet) => {
    let addrRaw: string;
    if (cachedToken) {
      try {
        const result = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
          auth_token: cachedToken,
        } as Parameters<typeof mobileWallet.authorize>[0]);
        useAppStore.getState().setMwaAuthToken(result.auth_token);
        addrRaw = result.accounts[0].address as string;
      } catch {
        const result = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
        });
        useAppStore.getState().setMwaAuthToken(result.auth_token);
        addrRaw = result.accounts[0].address as string;
      }
    } else {
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
      });
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address as string;
    }
    const [sig] = await mobileWallet.signMessages({
      addresses: [addrRaw],
      payloads: [messageBytes],
    });
    return sig;
  });
}

export function useMobileWallet() {
  const { setWallet, setLoading, setError, setMwaAuthToken, wallet, reset } = useAppStore();
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

      // Captured directly from this connect()'s own auth result — avoids
      // relying on the hook's `authToken`/`rawAddress` state, which only
      // updates on the component's NEXT render, not within this call.
      let freshAuth: { authToken: string; rawAddress: string } | null = null;

      const account = await transact(async (mobileWallet: Web3MobileWallet) => {
        const authResult = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
        });

        setAuthToken(authResult.auth_token);
        setMwaAuthToken(authResult.auth_token);

        // MWA v2 returns accounts[0].address as a base64-encoded public key.
        // We must decode it to bytes before passing to PublicKey constructor.
        const addrRaw = authResult.accounts[0].address;
        setRawAddress(addrRaw as string);
        freshAuth = { authToken: authResult.auth_token, rawAddress: addrRaw as string };
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
      await rehydrateForWallet(account.address);
      bindXmtpToWallet(account.address);

      if (freshAuth) {
        const auth = freshAuth as { authToken: string; rawAddress: string };
        try {
          await prepareWalletBoundXmtp(account.address, (messageBytes) =>
            signMessageWithAuth(messageBytes, {
              walletAddress: account.address,
              authToken: auth.authToken,
              rawAddress: auth.rawAddress,
            }),
          );
        } catch (e) {
          console.warn("[XMTP] wallet-bound identity sign skipped:", (e as Error)?.message);
        }
      }

      // Best-effort, fire-and-forget: learn every other inboxId already known
      // for this wallet (e.g. a leftover random inbox from before this bind)
      // so messages from them render as "own" instead of a stranger's.
      if (freshAuth) {
        const auth = freshAuth as { authToken: string; rawAddress: string };
        refreshInboxLinks(account.address, async (message: string) => {
          const messageBytes = new TextEncoder().encode(message);
          const sigBytes = await signMessageWithAuth(messageBytes, {
            walletAddress: account.address,
            authToken: auth.authToken,
            rawAddress: auth.rawAddress,
          });
          return { signatureBase58: bs58.encode(sigBytes), pubkeyBase58: account.address };
        });
      }

      return account;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setWallet, setLoading, setError, setMwaAuthToken]);

  /**
   * Sign a message — used for XMTP key derivation.
   * Opens wallet app for user approval.
   */
  const signMessage = useCallback(
    async (messageBytes: Uint8Array): Promise<Uint8Array> => {
      if (!wallet || !authToken) {
        throw new Error("Wallet not connected");
      }
      return signMessageWithAuth(messageBytes, {
        walletAddress: wallet.address,
        authToken,
        rawAddress,
      });
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
