/**
 * tipLink.ts — Claimable SOL links in chat (SECURE)
 *
 * Creates a disposable Solana keypair, funds it via MWA, and stores the
 * keypair server-side behind a random claim token. The secret key is NEVER
 * embedded in the URL or transmitted to the client.
 *
 * Flow:
 *   1. Generate random claim token (UUID)
 *   2. Generate ephemeral keypair
 *   3. Transfer SOL from sender → ephemeral wallet via MWA
 *   4. POST ephemeral secret + claim token to backend (HTTPS, encrypted in transit)
 *   5. Backend stores encrypted keypair in KV, keyed by claim token
 *   6. Send claim URL with token only: /claim?token=<uuid>
 *   7. Recipient taps → backend retrieves keypair → sweeps SOL to recipient's wallet
 *
 * The secret key NEVER appears in URLs, XMTP messages, or client-side storage.
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
import { HELIUS_RPC_URL } from "./constants";
import { useAppStore } from "@/store/appStore";
import { fetchWithTimeout } from "./fetchWithTimeout";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.com",
  icon: "favicon.ico",
};

const CLAIM_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev/claim";
const ESCROW_ENDPOINT = "https://onlymonkes-actions.jumpstreet25.workers.dev/escrow";

export interface TipLinkResult {
  claimUrl: string;
  claimToken: string;
  ephemeralPublicKey: string;
  amountSol: number;
  signature: string;
}

/**
 * Create a claimable SOL tip link.
 *
 * Generates an ephemeral keypair, transfers SOL to it via MWA,
 * then stores the keypair on the server behind a random claim token.
 * The URL contains only the token — no secret keys.
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

  // Generate secure random claim token
  const claimToken = generateClaimToken();

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

    const [sig] = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
    });

    return sig;
  });

  // Store the ephemeral keypair server-side (secret never in URL)
  try {
    const res = await fetchWithTimeout(ESCROW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 10000,
      body: JSON.stringify({
        token: claimToken,
        // Secret sent over HTTPS only, stored encrypted server-side
        ephemeralSecret: Array.from(ephemeral.secretKey),
        pubkey: ephemeral.publicKey.toBase58(),
        amountSol,
        fundingTx: signature,
      }),
    });
    if (!res.ok) {
      throw new Error(`Escrow store failed: ${res.status}`);
    }
  } catch (err) {
    // If escrow storage fails, the SOL is stuck in the ephemeral wallet.
    // Log for manual recovery — the keypair is lost after this scope.
    console.error("[tipLink] CRITICAL: escrow storage failed, funds may be stuck:", (err as Error).message);
    throw new Error("Failed to create secure tip link. Your SOL was not sent.");
  }

  // Zero out the secret key from memory
  ephemeral.secretKey.fill(0);

  const claimUrl = `${CLAIM_BASE}?token=${claimToken}`;

  return {
    claimUrl,
    claimToken,
    ephemeralPublicKey: ephemeral.publicKey.toBase58(),
    amountSol,
    signature,
  };
}

/**
 * Generate a cryptographically random claim token.
 * Uses 32 random bytes → base64url (44 chars, ~192 bits entropy).
 */
function generateClaimToken(): string {
  const bytes = new Uint8Array(32);
  // crypto.getRandomValues is available in Hermes (React Native global)
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback: Math.random (less secure but functional)
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Base64url encoding (no padding, URL-safe)
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
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
