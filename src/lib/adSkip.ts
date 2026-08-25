/**
 * adSkip.ts — client-side "send $5 in $SKR to skip ads for 30 days" flow.
 *
 * Same MWA sign/send pattern as solana.ts's sendSkrTip/sendShopPayment —
 * plain SPL transfer to DEV_WALLET (the OnlyMonkes publisher wallet, see
 * feedback_dev_wallet_is_publisher_wallet memory), no swap. Live SKR/USD
 * comes from fetchSkrPriceUsd() (Jupiter price v2), the same source the SKR
 * Banana Shop payment path already trusts.
 *
 * After the transfer confirms, this calls the worker
 * (worker-actions/src/adSkip.ts's POST /api/ad-skip/verify) so entitlement
 * state lives server-side in AD_ENTITLEMENTS KV — the app never grants
 * itself skip-ads client-side.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { transact, Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import {
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { HELIUS_RPC_URL, SKR_MINT, DEV_WALLET } from "./constants";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "./security";
import { fetchSkrPriceUsd, mwaAuthorize } from "./solana";
import { fetchWithTimeout } from "./fetchWithTimeout";

const ACTIONS_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const SKR_DECIMALS = 6;
const SKIP_PRICE_USD = 5;

export interface AdSkipStatus {
  skipAds: boolean;
  expiresAt: number | null;
}

/** Read-only entitlement check — never grants anything itself. */
export async function getAdSkipStatus(wallet: string): Promise<AdSkipStatus> {
  try {
    const res = await fetchWithTimeout(`${ACTIONS_BASE}/api/ad-skip/status?wallet=${wallet}`, { timeoutMs: 8000 });
    if (!res.ok) return { skipAds: false, expiresAt: null };
    return (await res.json()) as AdSkipStatus;
  } catch {
    return { skipAds: false, expiresAt: null };
  }
}

/**
 * Send ~$5 worth of $SKR to the publisher wallet, then have the worker
 * verify the payment on-chain and grant 30 days of skip-ads.
 */
export async function payToSkipAds(): Promise<AdSkipStatus> {
  assertDeviceTrusted("Ad-skip payment");
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("Wallet not connected");

  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const mintPubkey = new PublicKey(SKR_MINT);
  const devPubkey = new PublicKey(DEV_WALLET);

  const skrUsd = await fetchSkrPriceUsd();
  const skrAmount = SKIP_PRICE_USD / skrUsd;
  const baseUnits = BigInt(Math.round(skrAmount * 10 ** SKR_DECIMALS));

  // Pre-flight balance check — fail before opening MWA
  try {
    const senderAta = getAssociatedTokenAddressSync(mintPubkey, new PublicKey(wallet));
    const balanceInfo = await connection.getTokenAccountBalance(senderAta);
    const ui = parseFloat(balanceInfo.value.uiAmountString ?? "0");
    if (ui < skrAmount) {
      throw new Error(`Insufficient SKR: ${ui.toFixed(2)} < ${skrAmount.toFixed(2)}`);
    }
  } catch (err: any) {
    if (err.message?.startsWith("Insufficient")) throw err;
    throw new Error("No SKR balance found — get some SKR first (Jupiter or the treasury-swap Blink), then try again");
  }

  const txSig = await transact(async (mobileWallet: Web3MobileWallet) => {
    const senderPubkey = await mwaAuthorize(mobileWallet);
    const minContextSlot = await connection.getSlot();
    const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderPubkey);
    const devATA = getAssociatedTokenAddressSync(mintPubkey, devPubkey);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, devATA, devPubkey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    tx.add(createTransferInstruction(senderATA, devATA, senderPubkey, baseUnits, [], TOKEN_PROGRAM_ID));

    const [sig] = await mobileWallet.signAndSendTransactions({ transactions: [tx], minContextSlot });
    return sig;
  });

  const signature = typeof txSig === "string" ? txSig : Buffer.from(txSig).toString("base64");

  const verifyRes = await fetchWithTimeout(`${ACTIONS_BASE}/api/ad-skip/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: 20000,
    body: JSON.stringify({ wallet, txSig: signature }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}) as any);
    throw new Error(body?.error || "Payment sent, but verification failed — contact support if ads don't stop");
  }
  return (await verifyRes.json()) as AdSkipStatus;
}
