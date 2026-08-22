/**
 * treasury.ts — SKR treasury Blinks: sweep whatever ad/survey income has
 * landed in the OnlyMonkes publisher wallet into SKR, then stake it with
 * Solana Mobile's Guardian program so it earns yield for community
 * giveaways.
 *
 * Same pattern as index.ts's /api/actions/swap: every handler here only
 * ever BUILDS an unsigned transaction from a public address and returns it
 * as base64 (Solana Actions spec). This file never imports Keypair and
 * never holds a private key — the publisher wallet signs via Solflare (MWA)
 * whenever a human taps through, on whatever cadence they choose. No cron,
 * no hot key in Cloudflare.
 *
 * Flow: tap /api/actions/treasury-swap (SOL or USDC sitting in the
 * publisher wallet → SKR — the ?inputMint= param picks which; both land
 * here, since AutonoMonke's 5%/2.5% realized-profit fee (Monke_Eliza's
 * DEV_WALLET, same address as PUBLISHER_WALLET below) pays out in
 * whichever currency the closed position was denominated in), then tap
 * /api/actions/treasury-stake (that SKR → staked with the sole listed
 * guardian, "Solana Mobile Guardian").
 *
 * Guardian staking program spec below was reverse-engineered from
 * stake.solanamobile.com's own JS bundle + its on-chain Anchor IDL
 * (2026-08-22) — no public SDK or docs page exists. See the project memory
 * `reference_skr_guardian_staking_program.md` for how to re-derive this if
 * the program ever upgrades. Confirmed live via `simulateTransaction`
 * against this exact wallet before being wired in here.
 */
import {
  Connection,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Env } from "./index";
import { rpcUrl, getJupiterBuild, buildSwapTransaction, SOL_MINT, ACTION_ICON, CORS_HEADERS } from "./index";

// ─── Local response helpers (mirrors index.ts's, kept local to avoid a churny export) ──────
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

// ─── Confirmed on-chain addresses (2026-08-22) ─────────────────────────────────
export const SKR_MINT = new PublicKey("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const PUBLISHER_WALLET = new PublicKey("BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o");

// Per-input-mint config for the swap Action — decimals for raw-amount math,
// a sensible per-tap safety cap, and the "not worth it yet" advisory floor
// (gas + Jupiter slippage eat a fixed-ish cost regardless of swap size).
const SWAP_INPUTS: Record<string, { mint: string; decimals: number; maxPerTx: number; minRecommended: number; symbol: string }> = {
  sol: { mint: SOL_MINT, decimals: 9, maxPerTx: 5, minRecommended: 0.03, symbol: "SOL" },
  usdc: { mint: USDC_MINT.toBase58(), decimals: 6, maxPerTx: 500, minRecommended: 5, symbol: "USDC" },
};
const STAKING_PROGRAM_ID = new PublicKey("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
// The only Guardian currently listed by stake.solanamobile.com — "Solana Mobile Guardian", 0% commission.
const GUARDIAN = new PublicKey("SKRGdBwzb1AtFW2chhBnZpGFnFLj6Mi7HM7iwjXALvw");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
// Anchor `stake` instruction discriminator, read directly off the program's on-chain IDL.
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);

function derivePdas() {
  const [stakeConfig] = PublicKey.findProgramAddressSync([Buffer.from("stake_config")], STAKING_PROGRAM_ID);
  const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from("stake_vault")], STAKING_PROGRAM_ID);
  const [guardianPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("guardian_pool"), stakeConfig.toBuffer(), GUARDIAN.toBuffer()],
    STAKING_PROGRAM_ID,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], STAKING_PROGRAM_ID);
  return { stakeConfig, stakeVault, guardianPool, eventAuthority };
}

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

/** Builds the stake() instruction — deposits `amountRaw` (SKR base units, 6dp) with the Guardian. */
function buildStakeInstruction(staker: PublicKey, amountRaw: bigint): TransactionInstruction {
  const { stakeConfig, stakeVault, guardianPool, eventAuthority } = derivePdas();
  const [userStake] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), stakeConfig.toBuffer(), staker.toBuffer(), guardianPool.toBuffer()],
    STAKING_PROGRAM_ID,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(SKR_MINT, staker);

  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: stakeConfig, isSigner: false, isWritable: true },
      { pubkey: guardianPool, isSigner: false, isWritable: true },
      { pubkey: staker, isSigner: true, isWritable: true },   // payer
      { pubkey: staker, isSigner: false, isWritable: false }, // user
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: SKR_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: STAKING_PROGRAM_ID, isSigner: false, isWritable: false }, // Anchor event-CPI self-reference
    ],
    data: Buffer.concat([STAKE_DISCRIMINATOR, encodeU64LE(amountRaw)]),
  });
}

// ─── GET /api/treasury/status — read-only balances, no Action envelope ────────
export async function handleTreasuryStatus(env: Env): Promise<Response> {
  const connection = new Connection(rpcUrl(env), "confirmed");
  const [solLamports, skrAccounts, usdcAccounts] = await Promise.all([
    connection.getBalance(PUBLISHER_WALLET),
    connection.getParsedTokenAccountsByOwner(PUBLISHER_WALLET, { mint: SKR_MINT }),
    connection.getParsedTokenAccountsByOwner(PUBLISHER_WALLET, { mint: USDC_MINT }),
  ]);
  const skrUi = skrAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
  const usdcUi = usdcAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;

  let stakedShares = "0";
  try {
    const { stakeConfig, guardianPool } = derivePdas();
    const [userStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), stakeConfig.toBuffer(), PUBLISHER_WALLET.toBuffer(), guardianPool.toBuffer()],
      STAKING_PROGRAM_ID,
    );
    const info = await connection.getAccountInfo(userStake);
    if (info) {
      // UserStake layout: 8 disc + 1 bump + 32 stake_config + 32 user + 32 guardian_pool + 16 shares (u128 LE) ...
      const sharesOffset = 8 + 1 + 32 + 32 + 32;
      stakedShares = info.data.readBigUInt64LE(sharesOffset).toString(); // lower 8 bytes suffice at current scale
    }
  } catch { /* no stake account yet — fine, defaults to "0" */ }

  const solUi = solLamports / 1e9;
  return jsonResponse({
    wallet: PUBLISHER_WALLET.toBase58(),
    sol: solUi,
    usdc: usdcUi,
    skr: skrUi,
    stakedShares,
    minRecommendedSwap: { sol: SWAP_INPUTS.sol.minRecommended, usdc: SWAP_INPUTS.usdc.minRecommended },
    // "Has enough to sign for at all" (rent + fees) vs. "worth signing for" —
    // gas + Jupiter slippage eat a fixed-ish cost regardless of swap size,
    // so converting dribbles wastes a bigger proportion of them. Nothing
    // fires automatically here (every conversion is a human tap), so this
    // is guidance, not an enforced gate — see handleTreasurySwapPost for
    // where a hard floor would go if that ever changes.
    readyToConvert: solUi > 0.005 || usdcUi > 0.5,
    worthConvertingNow: {
      sol: solUi >= SWAP_INPUTS.sol.minRecommended,
      usdc: usdcUi >= SWAP_INPUTS.usdc.minRecommended,
    },
    readyToStake: skrUi >= 1, // on-chain min_stake_amount
  });
}

// ─── /api/actions/treasury-swap — sweep publisher-wallet SOL or USDC into SKR ──
// AutonoMonke's realized-profit fee (Monke_Eliza's DEV_WALLET = this same
// PUBLISHER_WALLET) pays out in whatever the closed position's base currency
// was — SOL, USDC, or SKR. SKR needs no swap; this endpoint covers the other
// two. ?inputMint= picks which ("sol" default, or "usdc").
function resolveSwapInput(url: URL): { key: string; cfg: typeof SWAP_INPUTS[string] } | null {
  const key = (url.searchParams.get("inputMint") || "sol").toLowerCase();
  const cfg = SWAP_INPUTS[key];
  return cfg ? { key, cfg } : null;
}

export function handleTreasurySwapGet(url: URL): Response {
  const resolved = resolveSwapInput(url);
  if (!resolved) return errorResponse(`Unknown inputMint — use "sol" or "usdc"`);
  const { cfg } = resolved;
  const amount = url.searchParams.get("amount") || (cfg.symbol === "SOL" ? "0.1" : "10");
  const amountNum = parseFloat(amount);
  const belowThreshold = Number.isFinite(amountNum) && amountNum < cfg.minRecommended;
  const description = belowThreshold
    ? `Swap ${amount} ${cfg.symbol} from the OnlyMonkes publisher wallet into SKR via Jupiter. Heads up: below ${cfg.minRecommended} ${cfg.symbol}, network fees + slippage eat a disproportionate share — worth letting more accumulate unless you're deliberately sweeping dust.`
    : `Swap ${amount} ${cfg.symbol} from the OnlyMonkes publisher wallet into SKR via Jupiter, ready to stake with the Guardian.`;
  return jsonResponse(
    {
      type: "action",
      icon: ACTION_ICON,
      title: `Convert treasury ${cfg.symbol} to SKR`,
      description,
      label: `Swap ${amount} ${cfg.symbol} → SKR`,
      links: {
        actions: [
          { label: `Swap ${amount} ${cfg.symbol} → SKR`, href: `/api/actions/treasury-swap?inputMint=${resolved.key}&amount=${amount}` },
        ],
      },
    },
    200,
    true,
  );
}

export async function handleTreasurySwapPost(url: URL, body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") return errorResponse("Missing account");
  if (account !== PUBLISHER_WALLET.toBase58()) {
    return errorResponse("This action only builds transactions for the OnlyMonkes publisher wallet");
  }

  const resolved = resolveSwapInput(url);
  if (!resolved) return errorResponse(`Unknown inputMint — use "sol" or "usdc"`);
  const { cfg } = resolved;

  const amount = parseFloat(url.searchParams.get("amount") || "0");
  if (!Number.isFinite(amount) || amount <= 0 || amount > cfg.maxPerTx) {
    return errorResponse(`Invalid amount (max ${cfg.maxPerTx} ${cfg.symbol})`);
  }

  try {
    const amountRawUnits = String(Math.round(amount * 10 ** cfg.decimals));
    const build = await getJupiterBuild(cfg.mint, SKR_MINT.toBase58(), amountRawUnits, account, 100, env);
    const priceImpact = parseFloat(build.priceImpactPct || "0");
    if (priceImpact > 15) return errorResponse("Price impact too high (>15%)");

    const swapTransaction = await buildSwapTransaction(build, account, env);
    return jsonResponse({ type: "transaction", transaction: swapTransaction, message: `Swapping ${amount} ${cfg.symbol} → SKR` });
  } catch (err) {
    return errorResponse(`Treasury swap failed: ${(err as Error).message}`, 500);
  }
}

// ─── /api/actions/treasury-stake — stake the wallet's current SKR with the Guardian ──
export async function handleTreasuryStakeGet(url: URL, env: Env): Promise<Response> {
  let defaultAmount = url.searchParams.get("amount");
  if (!defaultAmount) {
    try {
      const connection = new Connection(rpcUrl(env), "confirmed");
      const skrAccounts = await connection.getParsedTokenAccountsByOwner(PUBLISHER_WALLET, { mint: SKR_MINT });
      const uiAmount = skrAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
      defaultAmount = uiAmount > 0 ? String(uiAmount) : "1";
    } catch {
      defaultAmount = "1";
    }
  }

  return jsonResponse(
    {
      type: "action",
      icon: ACTION_ICON,
      title: "Stake SKR with the Guardian",
      description: `Stake ${defaultAmount} SKR with Solana Mobile's "Solana Mobile Guardian" (0% commission). Rewards accrue as share-price appreciation — 48h cooldown to unstake later.`,
      label: `Stake ${defaultAmount} SKR`,
      links: {
        actions: [
          { label: `Stake ${defaultAmount} SKR`, href: `/api/actions/treasury-stake?amount=${defaultAmount}` },
        ],
      },
    },
    200,
    true,
  );
}

export async function handleTreasuryStakePost(url: URL, body: any, env: Env): Promise<Response> {
  const account = body?.account;
  if (!account || typeof account !== "string") return errorResponse("Missing account");
  let staker: PublicKey;
  try { staker = new PublicKey(account); } catch { return errorResponse("Invalid wallet address"); }
  if (!staker.equals(PUBLISHER_WALLET)) {
    return errorResponse("This action only builds transactions for the OnlyMonkes publisher wallet");
  }

  const amount = parseFloat(url.searchParams.get("amount") || "0");
  if (!Number.isFinite(amount) || amount < 1) {
    return errorResponse("Invalid amount (minimum 1 SKR — on-chain min_stake_amount)");
  }

  try {
    const connection = new Connection(rpcUrl(env), "confirmed");
    const amountRaw = BigInt(Math.round(amount * 1e6)); // 6 decimals
    const ix = buildStakeInstruction(staker, amountRaw);

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: staker,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(messageV0);

    return jsonResponse({
      type: "transaction",
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      message: `Staking ${amount} SKR with the Guardian`,
    });
  } catch (err) {
    return errorResponse(`Treasury stake failed: ${(err as Error).message}`, 500);
  }
}
