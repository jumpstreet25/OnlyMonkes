/**
 * tipLink.ts — Claimable SOL links in chat
 *
 * Creates a disposable Solana keypair, funds it via MWA, and encodes the
 * secret into a URL. The recipient taps the link to claim the SOL.
 *
 * Flow:
 *   1. Generate ephemeral keypair
 *   2. Transfer SOL from sender → ephemeral wallet via MWA
 *   3. Build claim URL encoding the ephemeral secret key
 *   4. Send URL in chat as TIPLINK:<url>|<amount>|<senderUsername>
 *   5. Recipient taps → opens claim page → sweeps SOL to their wallet
 *
 * Claim page: hosted at https://onlymonkes-actions.jumpstreet25.workers.dev/claim
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import bs58 from "bs58";
import { HELIUS_RPC_URL } from "./constants";
import { useAppStore } from "@/store/appStore";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

const CLAIM_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev/claim";

export interface TipLinkResult {
  claimUrl: string;
  ephemeralPublicKey: string;
  amountSol: number;
  signature: string;
}

/**
 * Create a claimable SOL tip link.
 *
 * Generates an ephemeral keypair, transfers SOL to it via MWA,
 * and returns a URL the recipient can use to claim the funds.
 */
export async function createTipLink(amountSol: number): Promise<TipLinkResult> {
  if (amountSol <= 0 || amountSol > 10) {
    throw new Error("Tip amount must be between 0.001 and 10 SOL");
  }

  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const ephemeral = Keypair.generate();
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  // Add rent exemption (minimum balance to keep account alive)
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const totalLamports = lamports + rentExempt;

  const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
    // Re-auth or fresh auth
    const cachedToken = useAppStore.getState().mwaAuthToken;
    let addrRaw: string | Uint8Array;

    if (cachedToken) {
      try {
        const result = await mobileWallet.reauthorize({
          auth_token: cachedToken,
          identity: APP_IDENTITY,
        });
        addrRaw = result.accounts[0].address;
      } catch {
        const result = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
        });
        useAppStore.getState().setMwaAuthToken(result.auth_token);
        addrRaw = result.accounts[0].address;
      }
    } else {
      const result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
      });
      useAppStore.getState().setMwaAuthToken(result.auth_token);
      addrRaw = result.accounts[0].address;
    }

    const sender = new PublicKey(
      typeof addrRaw === "string" ? addrRaw : addrRaw
    );

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: ephemeral.publicKey,
        lamports: totalLamports,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;

    const signed = await mobileWallet.signTransactions({
      transactions: [tx],
    });

    const sig = await connection.sendRawTransaction(signed[0].serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    return sig;
  });

  // Encode the ephemeral secret key in the claim URL
  const secretB58 = bs58.encode(ephemeral.secretKey);
  const claimUrl = `${CLAIM_BASE}?key=${secretB58}&amount=${amountSol}`;

  return {
    claimUrl,
    ephemeralPublicKey: ephemeral.publicKey.toBase58(),
    amountSol,
    signature,
  };
}

/**
 * Parse a TIPLINK: message content.
 * Format: TIPLINK:<url>|<amountSol>|<senderUsername>
 */
export function parseTipLinkMessage(content: string): {
  url: string;
  amount: number;
  sender: string;
} | null {
  if (!content.startsWith("TIPLINK:")) return null;
  const parts = content.slice(8).split("|");
  if (parts.length < 3) return null;
  return {
    url: parts[0],
    amount: parseFloat(parts[1]) || 0,
    sender: parts[2],
  };
}
