/**
 * solana.ts
 *
 * SKR token tipping helpers.
 * Builds an SPL token transfer transaction and signs it via Mobile Wallet Adapter.
 *
 * Split: 95% to message recipient, 5% to the dev wallet (Jump.skr).
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET } from "./constants";
import { useAppStore } from "@/store/appStore";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

const DEV_FEE_PERCENT = 0.05;

/**
 * Re-authorize using the cached MWA auth token (biometric prompt, no app switch).
 * Falls back to full authorize if the token is missing or expired.
 * Returns the sender's PublicKey derived from the auth result.
 */
async function mwaAuthorize(mobileWallet: Web3MobileWallet): Promise<PublicKey> {
  const cachedToken = useAppStore.getState().mwaAuthToken;

  let addrRaw: string | Uint8Array;

  if (cachedToken) {
    try {
      // Reauthorize — shows biometric/PIN overlay without switching apps
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
        auth_token: cachedToken,
      } as Parameters<typeof mobileWallet.authorize>[0]);
      // Refresh token in store in case it rotated
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    } catch {
      // Token expired — fall through to full authorize
      const result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    }
  } else {
    const result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
    useAppStore.getState().setMwaAuthToken(result.auth_token);
    addrRaw = result.accounts[0].address;
  }

  const pubkeyBytes = typeof addrRaw === "string" ? Buffer.from(addrRaw, "base64") : addrRaw;
  return new PublicKey(pubkeyBytes);
}

/**
 * Send SKR tips to a recipient with a 5% dev fee.
 * @param recipientWallet  Base58 Solana wallet of the message sender to tip
 * @param amountUi         Human-readable SKR amount (e.g. 1 for 1 SKR)
 * @returns transaction signature
 */
export async function sendSkrTip(
  recipientWallet: string,
  amountUi: number
): Promise<string> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey  = new PublicKey(DEV_WALLET);
  const recipientPubkey = new PublicKey(recipientWallet);

  // Fetch token decimals
  const mintInfo = await getMint(connection, mintPubkey);
  const decimals = mintInfo.decimals;

  const totalLamports = Math.round(amountUi * Math.pow(10, decimals));
  const devLamports   = Math.round(totalLamports * DEV_FEE_PERCENT);
  const userLamports  = totalLamports - devLamports;

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    // Reauthorize with cached token — biometric prompt only, no app switch
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch slot AFTER auth so the simulation context is always fresh
    const minContextSlot = await connection.getSlot();

    // Derive all ATAs
    const senderATA    = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);
    const devATA       = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    // Create recipient ATA if needed (idempotent — no-op if already exists)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey,
        recipientATA,
        recipientPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // Create dev ATA if needed
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey,
        devATA,
        devPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // Transfer to recipient (95%)
    tx.add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        senderPubkey,
        BigInt(userLamports),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Transfer to dev (5%)
    tx.add(
      createTransferInstruction(
        senderATA,
        devATA,
        senderPubkey,
        BigInt(devLamports),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Sign and send — minContextSlot pre-fetched so wallet simulation has fresh state
    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });

    return sig;
  });

  return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
}

/**
 * Send a direct tip to the developer wallet (100% to dev, no split).
 */
export async function sendDevTip(amountUi: number): Promise<string> {
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey  = new PublicKey(DEV_WALLET);

  const mintInfo = await getMint(connection, mintPubkey);
  const lamports = Math.round(amountUi * Math.pow(10, mintInfo.decimals));

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);

    // Fetch slot AFTER auth so the simulation context is always fresh
    const minContextSlot = await connection.getSlot();

    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const devATA    = getAssociatedTokenAddressSync(mintPubkey, devPubkey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });

    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    tx.add(
      createTransferInstruction(
        senderATA, devATA, senderPubkey, BigInt(lamports), [], TOKEN_PROGRAM_ID
      )
    );

    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
      minContextSlot,
    });

    return sig;
  });

  return typeof signature === "string" ? signature : Buffer.from(signature).toString("base64");
}
