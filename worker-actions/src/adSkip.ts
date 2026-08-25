/**
 * adSkip.ts — "Send $SKR to skip ads for a month" Blink + entitlement store.
 *
 * Same pattern as treasury.ts: this file only ever BUILDS an unsigned SPL
 * transfer from the caller's own wallet and returns it as base64 (Solana
 * Actions spec). Never imports Keypair, never holds a private key — the
 * user's own wallet signs via MWA/Solflare/Blink adapter.
 *
 * Plain SKR->publisher SPL transfer, no swap bundled in — the user pays in
 * $SKR they already hold (get some via /api/actions/treasury-swap or
 * jup.ag/swap/SOL-SKR first if they don't). Bundling a same-tx SOL->SKR
 * swap-then-forward was considered and rejected: Jupiter's exact-in swap
 * doesn't guarantee the exact SKR output the tx would need to hardcode for
 * the forwarding instruction, so it'd either need a slippage buffer (user
 * overpays) or risk atomic failure on a normal 1% market move. A plain
 * transfer of a live-priced amount has neither problem.
 *
 * Price: $5.00/mo target, converted to SKR at time of GET/POST via
 * DexScreener's SKR/USDC pair (same source ChatScreen.tsx already uses for
 * SKR/USD display) — never hardcoded, SKR price moves.
 *
 * Entitlement flow: POST /api/actions/ad-skip returns the unsigned tx: the
 * client submits it, then calls /api/ad-skip/verify with {wallet, txSig}.
 * This worker re-fetches that tx from RPC, confirms it actually paid the
 * publisher's SKR ATA the expected amount, and only then writes 30 days of
 * entitlement into AD_ENTITLEMENTS KV. The app never sets its own
 * entitlement client-side.
 */
import { Connection, PublicKey, TransactionMessage, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Env } from "./index";
import { rpcUrl, ACTION_ICON, CORS_HEADERS } from "./index";
import { SKR_MINT, PUBLISHER_WALLET } from "./treasury";

// ─── Local response helpers (mirrors treasury.ts's) ────────────────────────
function jsonResponse(data: unknown, status = 200, actionHeaders = false): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, "Content-Type": "application/json" };
  if (actionHeaders) {
    headers["X-Action-Version"] = "2.0";
    headers["X-Blockchain-Ids"] = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  }
  return new Response(JSON.stringify(data), { status, headers });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

const SKR_DECIMALS = 6;
const SKIP_PRICE_USD = 5;
const SKIP_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
// A live quote more than this stale is refused rather than risk pricing a
// month of ad-skip off a dead/cached number.
const PRICE_MAX_AGE_MS = 5 * 60 * 1000;

let cachedPrice: { usd: number; at: number } | null = null;

async function getSkrUsdPrice(): Promise<number> {
  if (cachedPrice && Date.now() - cachedPrice.at < PRICE_MAX_AGE_MS) return cachedPrice.usd;
  // DexScreener's /tokens/{address} lookup returns `pairs: null` for this
  // mint as of 2026-08-24 (confirmed live, not transient) — /search still
  // indexes it fine. Filter to this exact mint on Solana and take the
  // highest-liquidity pair so a thin/stale listing can't skew the price.
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${SKR_MINT.toBase58()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DexScreener price lookup failed (${res.status})`);
  const data = await res.json() as { pairs?: Array<{ chainId?: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }> };
  const skrPairs = (data?.pairs ?? []).filter((p) => p.chainId === "solana" && p.baseToken?.address === SKR_MINT.toBase58());
  skrPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const priceUsd = parseFloat(skrPairs[0]?.priceUsd ?? "");
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("No live SKR/USD price available");
  cachedPrice = { usd: priceUsd, at: Date.now() };
  return priceUsd;
}

/** $5.00 worth of SKR at the current live price, in whole SKR (not raw units). */
async function computeSkipPriceSkr(): Promise<{ skr: number; skrUsd: number }> {
  const skrUsd = await getSkrUsdPrice();
  return { skr: SKIP_PRICE_USD / skrUsd, skrUsd };
}

// ─── GET /api/ad-skip/status?wallet= — read-only entitlement check ─────────
export async function handleAdSkipStatus(url: URL, env: Env): Promise<Response> {
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return errorResponse("Missing wallet");
  try {
    new PublicKey(wallet);
  } catch {
    return errorResponse("Invalid wallet address");
  }

  const raw = await env.AD_ENTITLEMENTS.get(wallet);
  if (!raw) return jsonResponse({ skipAds: false, expiresAt: null });

  try {
    const entry = JSON.parse(raw) as { expiresAt: number; txSig: string };
    const skipAds = entry.expiresAt > Date.now();
    return jsonResponse({ skipAds, expiresAt: entry.expiresAt });
  } catch {
    return jsonResponse({ skipAds: false, expiresAt: null });
  }
}

// ─── GET /api/actions/ad-skip — Action metadata ────────────────────────────
export async function handleAdSkipGet(): Promise<Response> {
  let label = `Send ~$${SKIP_PRICE_USD} in SKR`;
  let description = `Send $${SKIP_PRICE_USD} worth of $SKR to the OnlyMonkes Vault (staked, not sold) to skip ads for 30 days.`;
  try {
    const { skr, skrUsd } = await computeSkipPriceSkr();
    label = `Send ${skr.toFixed(2)} SKR (~$${SKIP_PRICE_USD})`;
    description = `Send ${skr.toFixed(2)} $SKR (~$${SKIP_PRICE_USD} at $${skrUsd.toFixed(6)}/SKR) to the OnlyMonkes Vault — staked, not sold — to skip ads for 30 days.`;
  } catch {
    // Fall back to the generic copy above; POST re-derives the live price anyway.
  }

  return jsonResponse(
    {
      type: "action",
      icon: ACTION_ICON,
      title: "Skip ads for 30 days",
      description,
      label,
      links: {
        actions: [{ label, href: "/api/actions/ad-skip" }],
      },
    },
    200,
    true,
  );
}

// ─── POST /api/actions/ad-skip — build the unsigned SKR transfer ──────────
export async function handleAdSkipPost(body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") return errorResponse("Missing account");
  let payer: PublicKey;
  try {
    payer = new PublicKey(account);
  } catch {
    return errorResponse("Invalid wallet address");
  }

  try {
    const { skr } = await computeSkipPriceSkr();
    const amountRaw = BigInt(Math.round(skr * 10 ** SKR_DECIMALS));
    if (amountRaw <= 0n) return errorResponse("Computed SKR amount is zero — try again");

    const fromAta = getAssociatedTokenAddressSync(SKR_MINT, payer);
    const toAta = getAssociatedTokenAddressSync(SKR_MINT, PUBLISHER_WALLET);

    const instructions: TransactionInstruction[] = [
      // Idempotent — no-ops if the publisher's SKR ATA already exists (it does).
      createAssociatedTokenAccountIdempotentInstruction(payer, toAta, PUBLISHER_WALLET, SKR_MINT),
      createTransferInstruction(fromAta, toAta, payer, amountRaw, [], TOKEN_PROGRAM_ID),
    ];

    const connection = new Connection(rpcUrl(env), "finalized");
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(messageV0);

    return jsonResponse({
      type: "transaction",
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      message: `Sending ${skr.toFixed(2)} SKR to skip ads for 30 days`,
    });
  } catch (err) {
    return errorResponse(`Ad-skip transfer failed: ${(err as Error).message}`, 500);
  }
}

// ─── POST /api/ad-skip/verify — confirm payment on-chain, grant entitlement ──
export async function handleAdSkipVerify(body: any, env: Env): Promise<Response> {
  const wallet = body?.wallet;
  const txSig = body?.txSig;
  if (!wallet || typeof wallet !== "string") return errorResponse("Missing wallet");
  if (!txSig || typeof txSig !== "string") return errorResponse("Missing txSig");
  try {
    new PublicKey(wallet);
  } catch {
    return errorResponse("Invalid wallet address");
  }

  try {
    const connection = new Connection(rpcUrl(env), "confirmed");
    const tx = await connection.getParsedTransaction(txSig, { maxSupportedTransactionVersion: 0 });
    if (!tx) return errorResponse("Transaction not found — it may not be confirmed yet, try again shortly", 404);
    if (tx.meta?.err) return errorResponse("Transaction failed on-chain");

    const signerKey = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
    if (signerKey !== wallet) return errorResponse("Transaction signer does not match wallet");

    const toAta = getAssociatedTokenAddressSync(SKR_MINT, PUBLISHER_WALLET).toBase58();
    const pre = tx.meta?.preTokenBalances?.find((b) => b.mint === SKR_MINT.toBase58() && tx.transaction.message.accountKeys[b.accountIndex]?.pubkey.toBase58() === toAta);
    const post = tx.meta?.postTokenBalances?.find((b) => b.mint === SKR_MINT.toBase58() && tx.transaction.message.accountKeys[b.accountIndex]?.pubkey.toBase58() === toAta);
    const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(post?.uiTokenAmount.amount ?? "0");
    if (postAmount <= preAmount) {
      return errorResponse("Transaction did not pay the OnlyMonkes publisher wallet in SKR");
    }

    const expiresAt = Date.now() + SKIP_DURATION_MS;
    await env.AD_ENTITLEMENTS.put(wallet, JSON.stringify({ expiresAt, txSig }));
    return jsonResponse({ skipAds: true, expiresAt });
  } catch (err) {
    return errorResponse(`Verification failed: ${(err as Error).message}`, 500);
  }
}
