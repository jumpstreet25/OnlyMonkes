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
import { rpcUrl, getJupiterBuild, buildSwapTransaction, fetchWithTimeout, SOL_MINT, ACTION_ICON, CORS_HEADERS } from "./index";

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

// ─── Prices + share value (added 2026-08-27 for the treasury transparency UI + $20 auto-sweep alert) ──
// SOL/USD: no Jupiter Price API endpoint responds anymore (api.jup.ag/price/v2
// and lite-api.jup.ag both 404 as of this date) and DexScreener's token-address
// lookup collides with an unrelated same-address token on another chain
// ("Wrapped FOGO" on Fogo shares So111...112 byte-for-byte with Solana's
// native mint) — confirmed by direct curl before writing this. A real
// same-domain Jupiter quote (1 SOL -> USDC) sidesteps both problems.
async function fetchSolUsdPrice(env: Env): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.jup.ag/swap/v2/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT.toBase58()}&amount=1000000000&slippageBps=50`,
      { headers: env.JUP_API_KEY ? { "x-api-key": env.JUP_API_KEY } : {} },
      8_000,
    );
    if (!res.ok) return null;
    const d = await res.json() as any;
    const out = Number(d?.outAmount);
    return Number.isFinite(out) && out > 0 ? out / 1e6 : null;
  } catch { return null; }
}

// SKR/USD. 2026-08-31: this used to be DexScreener-only with no fallback —
// a single transient timeout/rate-limit here silently zeroed the ENTIRE SKR
// contribution to totalUsd (both staked and unstaked), which is normally
// the majority of the treasury's real value vs. the SOL/USDC portions.
// Confirmed live: a Treasury screen capture showed totalUsd exactly equal
// to the SOL-only amount while stakedSkr displayed correctly alongside it
// (stakedSkr comes from a separate on-chain read, unaffected by this price
// fetch) — the only way that combination happens is skrUsdPrice having come
// back null for that one request. Direct curl afterward showed DexScreener
// healthy again, consistent with a transient blip, not a dead endpoint.
// Layered now: DexScreener (picking the highest-liquidity pair, not just
// pairs[0], in case a second SKR pool ever appears) -> a real Jupiter swap
// quote (1 SKR -> USDC, the same same-domain-quote workaround already
// proven for SOL/USD above — Jupiter's actual Price API is dead, confirmed
// elsewhere in this codebase) -> last-known-good price cached in KV, so a
// full outage of both live sources degrades to a slightly-stale number
// instead of silently dropping most of the treasury's displayed value.
async function fetchSkrUsdPrice(env: Env): Promise<number | null> {
  const KV_KEY = `${TREASURY_KV_PREFIX}lastSkrPriceUsd`;
  const remember = async (price: number) => {
    try { await env.FRAME_ALERTS.put(KV_KEY, String(price)); } catch { /* non-fatal */ }
  };

  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${SKR_MINT.toBase58()}`, {}, 8_000);
    if (res.ok) {
      const pairs = await res.json() as Array<{ priceUsd?: string; liquidity?: { usd?: number } }>;
      const best = (pairs ?? []).reduce<{ priceUsd?: string; liquidity?: { usd?: number } } | null>(
        (a, b) => ((b.liquidity?.usd ?? 0) > (a?.liquidity?.usd ?? -1) ? b : a), null,
      );
      const price = best?.priceUsd ? parseFloat(best.priceUsd) : null;
      if (price && Number.isFinite(price) && price > 0) {
        await remember(price);
        return price;
      }
    }
  } catch { /* fall through */ }

  try {
    const res = await fetchWithTimeout(
      `https://api.jup.ag/swap/v2/quote?inputMint=${SKR_MINT.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=1000000&slippageBps=50`,
      { headers: env.JUP_API_KEY ? { "x-api-key": env.JUP_API_KEY } : {} },
      8_000,
    );
    if (res.ok) {
      const d = await res.json() as any;
      const out = Number(d?.outAmount);
      if (Number.isFinite(out) && out > 0) {
        const price = out / 1e6;
        await remember(price);
        return price;
      }
    }
  } catch { /* fall through */ }

  try {
    const cached = await env.FRAME_ALERTS.get(KV_KEY);
    return cached ? parseFloat(cached) : null;
  } catch { return null; }
}

// stake_config.share_price — u64 LE, 9-decimal fixed point, at byte offset
// 137 in the account. Not documented anywhere (no IDL type export for this
// account was captured) — empirically located 2026-08-27 by scanning the
// live account for a u64 that (a) matches a plausible 1.0-2.0x range at
// either 6 or 9 decimals and (b) is consistent with organic growth from the
// known 2026-08-22 reading of ~1.126 at ~26.5% APY (1.126 * 1.0036 over 5
// days ≈ 1.130 — the 9-decimal candidate at this offset read 1.1293, the
// 6-decimal candidate at another offset read 1.0623 and doesn't fit). If
// this ever reads obviously wrong (e.g. 0, or wildly outside a slow-APY
// growth curve from the last known value), the program was likely upgraded
// and this offset needs re-deriving the same way — see
// reference_skr_guardian_staking_program.md for the re-derivation method.
const SHARE_PRICE_OFFSET = 137;
async function readSharePriceFromConnection(connection: Connection): Promise<number | null> {
  const { stakeConfig } = derivePdas();
  const info = await connection.getAccountInfo(stakeConfig); // let an RPC-level failure throw — withRpcFallback needs to see it to retry
  if (!info || info.data.length < SHARE_PRICE_OFFSET + 8) return null; // valid response, account just doesn't have this data — not a failure
  const raw = info.data.readBigUInt64LE(SHARE_PRICE_OFFSET);
  const price = Number(raw) / 1e9;
  return price > 0.5 && price < 10 ? price : null; // sanity bound, not a real ceiling
}

// 2026-09-12 incident follow-up: this used to swallow its own errors internally and always
// return null on ANY failure, which meant it never got a chance to retry via the public-RPC
// fallback below (that catch already turned an RPC 429 into "no share price" before
// withRpcFallback's own catch could ever see it) — silently zeroing stakedSkr (and therefore a
// real chunk of totalUsd) every time Helius alone was unavailable, not just when both providers
// were down. Now takes both connections and only gives up after the fallback also fails.
async function readSharePrice(primary: Connection, fallback: Connection): Promise<number | null> {
  try {
    return await withRpcFallback(primary, fallback, readSharePriceFromConnection);
  } catch {
    return null;
  }
}

const TREASURY_KV_PREFIX = "treasury:";

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

// 2026-09-12 incident: this handler had zero error handling around its RPC calls — when the
// shared Helius key hit its account-wide usage cap (MonkeLedger's DAS scans draw against the
// same account, see project memory on the interim shared key), every one of these plain
// getBalance/getParsedTokenAccountsByOwner calls threw, and with nothing catching it the whole
// /api/treasury/status request crashed with an unhandled exception (Cloudflare error 1101) instead
// of a clean error. None of these three calls are DAS-specific — they're plain RPC methods any
// provider supports — so they now fall back to a free public RPC on failure instead of depending
// on Helius alone for something this simple.
const TREASURY_RPC_FALLBACK_URL = "https://solana-rpc.publicnode.com";

async function withRpcFallback<T>(
  primary: Connection,
  fallback: Connection,
  fn: (c: Connection) => Promise<T>,
): Promise<T> {
  try {
    return await fn(primary);
  } catch (err) {
    console.warn("[treasury] primary RPC call failed, retrying via fallback:", err instanceof Error ? err.message : err);
    return fn(fallback);
  }
}

// SPL Token Account layout: 32 mint + 32 owner + 8 amount (u64 LE) + ... — reading the amount at
// a fixed byte offset via plain getAccountInfo, instead of getParsedTokenAccountsByOwner, is what
// makes this fall back to a free public RPC at all: getParsedTokenAccountsByOwner requires an
// "owner index" that PublicNode's free tier flatly refuses ("Indexed requests require a personal
// token") even for a single already-known ATA — confirmed directly against PublicNode during the
// 2026-09-12 incident. getAccountInfo on a specific address has no such restriction anywhere.
const SPL_TOKEN_AMOUNT_OFFSET = 64;

async function getAtaUiAmount(connection: Connection, mint: PublicKey, owner: PublicKey, decimals: number): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (!info || info.data.length < SPL_TOKEN_AMOUNT_OFFSET + 8) return 0; // ATA never created — 0 balance
  const raw = info.data.readBigUInt64LE(SPL_TOKEN_AMOUNT_OFFSET);
  return Number(raw) / 10 ** decimals;
}

/** Shared balance+price read, used by /status, /threshold-check, and /weekly-summary
 *  so all three agree on the same numbers instead of three slightly-different reads. */
async function readTreasurySnapshot(env: Env) {
  // disableRetryOnRateLimit is required here — @solana/web3.js's Connection otherwise retries a
  // 429 internally ~16 times with escalating backoff (500ms -> 4s+ per attempt, 25s+ total)
  // BEFORE ever throwing, which starved withRpcFallback of any chance to fail over quickly and
  // blew straight through this request's wall-clock budget during the 2026-09-12 incident.
  const connection = new Connection(rpcUrl(env), { commitment: "confirmed", disableRetryOnRateLimit: true });
  const fallbackConnection = new Connection(TREASURY_RPC_FALLBACK_URL, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const [solLamports, skrUi, usdcUi, solUsdPrice, skrUsdPrice, sharePrice] = await Promise.all([
    withRpcFallback(connection, fallbackConnection, (c) => c.getBalance(PUBLISHER_WALLET)),
    withRpcFallback(connection, fallbackConnection, (c) => getAtaUiAmount(c, SKR_MINT, PUBLISHER_WALLET, 6)),
    withRpcFallback(connection, fallbackConnection, (c) => getAtaUiAmount(c, USDC_MINT, PUBLISHER_WALLET, 6)),
    fetchSolUsdPrice(env),
    fetchSkrUsdPrice(env),
    readSharePrice(connection, fallbackConnection),
  ]);
  const solUi = solLamports / 1e9;

  let stakedShares = "0";
  let stakedSkr = 0;
  {
    // 2026-09-12 incident follow-up: this used to swallow ANY failure here (including an RPC
    // failure on BOTH providers) as "no stake account yet, default to 0" — during the incident
    // that silently zeroed a real, substantial staked balance on every request where this one
    // lookup happened to fail even though the rest of the snapshot succeeded, and then cached
    // that wrong zero over a previously-good value. Only a genuine `info === null` (a real
    // answer: this account doesn't exist) should default to 0 — an RPC-level failure must
    // propagate so the caller falls back to the last good cached snapshot instead.
    const { stakeConfig, guardianPool } = derivePdas();
    const [userStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), stakeConfig.toBuffer(), PUBLISHER_WALLET.toBuffer(), guardianPool.toBuffer()],
      STAKING_PROGRAM_ID,
    );
    const info = await withRpcFallback(connection, fallbackConnection, (c) => c.getAccountInfo(userStake));
    if (info) {
      // UserStake layout: 8 disc + 1 bump + 32 stake_config + 32 user + 32 guardian_pool + 16 shares (u128 LE) ...
      const sharesOffset = 8 + 1 + 32 + 32 + 32;
      const rawShares = info.data.readBigUInt64LE(sharesOffset); // lower 8 bytes suffice at current scale
      stakedShares = rawShares.toString();
      if (sharePrice) stakedSkr = (Number(rawShares) / 1e6) * sharePrice;
    }
  }

  const skrPortionUsd = skrUsdPrice ? (skrUi + stakedSkr) * skrUsdPrice : null;
  const totalUsd =
    (solUsdPrice ? solUi * solUsdPrice : 0) +
    usdcUi + // stablecoin, 1:1
    (skrPortionUsd ?? 0);
  const sweepableUsd = (solUsdPrice ? solUi * solUsdPrice : 0) + usdcUi; // not-yet-swapped income only

  const result = { solUi, usdcUi, skrUi, stakedShares, stakedSkr, solUsdPrice, skrUsdPrice, sharePrice, totalUsd, sweepableUsd };
  // Cache every successful read — this is what lets handleTreasuryStatus below serve
  // last-known-good data instead of a bare error when Helius AND the public-RPC fallback are
  // both rate-limited at once (confirmed happens together — see the 2026-09-12 incident note
  // above). Non-fatal if the KV write itself fails.
  cacheSnapshot(env, result).catch(() => {});
  return { connection, ...result };
}

const TREASURY_SNAPSHOT_KV_KEY = `${TREASURY_KV_PREFIX}snapshot`;
type CachedTreasurySnapshot = Awaited<ReturnType<typeof readTreasurySnapshot>> extends infer T
  ? T extends { connection: unknown } ? Omit<T, "connection"> & { cachedAtMs: number } : never
  : never;

async function cacheSnapshot(env: Env, data: Omit<CachedTreasurySnapshot, "cachedAtMs">): Promise<void> {
  await env.FRAME_ALERTS.put(TREASURY_SNAPSHOT_KV_KEY, JSON.stringify({ ...data, cachedAtMs: Date.now() }));
}

async function readCachedSnapshot(env: Env): Promise<CachedTreasurySnapshot | null> {
  try {
    const raw = await env.FRAME_ALERTS.get(TREASURY_SNAPSHOT_KV_KEY);
    return raw ? (JSON.parse(raw) as CachedTreasurySnapshot) : null;
  } catch {
    return null;
  }
}

function buildStatusResponse(
  snap: Omit<CachedTreasurySnapshot, "cachedAtMs">,
  extra: { stale: boolean; asOfMs: number | null },
): Response {
  return jsonResponse({
    wallet: PUBLISHER_WALLET.toBase58(),
    sol: snap.solUi,
    usdc: snap.usdcUi,
    skr: snap.skrUi,
    stakedShares: snap.stakedShares,
    stakedSkr: snap.stakedSkr,
    sharePrice: snap.sharePrice,
    solUsdPrice: snap.solUsdPrice,
    skrUsdPrice: snap.skrUsdPrice,
    totalUsd: snap.totalUsd,
    minRecommendedSwap: { sol: SWAP_INPUTS.sol.minRecommended, usdc: SWAP_INPUTS.usdc.minRecommended },
    // "Has enough to sign for at all" (rent + fees) vs. "worth signing for" —
    // gas + Jupiter slippage eat a fixed-ish cost regardless of swap size,
    // so converting dribbles wastes a bigger proportion of them. Nothing
    // fires automatically here (every conversion is a human tap), so this
    // is guidance, not an enforced gate — see handleTreasurySwapPost for
    // where a hard floor would go if that ever changes.
    readyToConvert: snap.solUi > 0.005 || snap.usdcUi > 0.5,
    worthConvertingNow: {
      sol: snap.solUi >= SWAP_INPUTS.sol.minRecommended,
      usdc: snap.usdcUi >= SWAP_INPUTS.usdc.minRecommended,
    },
    readyToStake: snap.skrUi >= 1, // on-chain min_stake_amount
    // Added 2026-09-12 — lets the app show "as of X ago" instead of silently passing off stale
    // numbers as live when both RPC providers are down at once and this is serving from cache.
    stale: extra.stale,
    asOfMs: extra.asOfMs,
  });
}

/** Proactive cache warm — called from index.ts's hourly cron so a fresh snapshot exists in KV
 *  even if no user happens to open the Treasury screen during a given window. Swallows its own
 *  errors: readTreasurySnapshot already logs failures, and a missed warm just leaves the
 *  previous cache entry in place for handleTreasuryStatus's fallback path to use. */
export async function refreshTreasurySnapshotCache(env: Env): Promise<void> {
  try {
    await readTreasurySnapshot(env);
  } catch (err) {
    console.warn("[treasury] scheduled cache warm failed:", err instanceof Error ? err.message : err);
  }
}

// ─── GET /api/treasury/status — read-only balances, no Action envelope ────────
export async function handleTreasuryStatus(env: Env): Promise<Response> {
  try {
    const snap = await readTreasurySnapshot(env);
    return buildStatusResponse(snap, { stale: false, asOfMs: Date.now() });
  } catch (err) {
    // readTreasurySnapshot's own RPC calls already fall back to a public RPC on failure (see
    // withRpcFallback above), so reaching here means BOTH providers failed at once — confirmed to
    // happen together during the 2026-09-12 incident (Helius hit its account-wide usage cap while
    // MonkeLedger was mid-refresh; the public-RPC fallback got IP-rate-limited independently,
    // since Cloudflare Workers share egress IPs with many other free-tier consumers). Serve the
    // last successfully-cached snapshot instead of a bare error — stale real numbers beat nothing.
    console.warn("[treasury] live read failed on both RPC providers, trying cache:", err instanceof Error ? err.message : err);
    const cached = await readCachedSnapshot(env);
    if (cached) {
      const { cachedAtMs, ...snap } = cached;
      return buildStatusResponse(snap, { stale: true, asOfMs: cachedAtMs });
    }
    console.error("[treasury] no cached snapshot available either — nothing to serve");
    return errorResponse("Treasury status temporarily unavailable — try again shortly", 503);
  }
}

// ─── GET /api/treasury/threshold-check — "$20 of dApp income accrued" alert ──
// Per user decision 2026-08-27: no hot key anywhere for this, so this never
// signs or moves funds itself — it only tells the caller (the bot, on a
// polling interval) when the publisher wallet's un-swapped SOL+USDC has
// grown by $20+ since the last time this fired, so the bot can DM the admin
// a one-tap Blink link (the existing /api/actions/treasury-swap flow,
// unchanged) to approve via Solflare. Baseline is stored in FRAME_ALERTS KV
// (same namespace already used for the "stats:latest" single-object
// pattern) under "treasury:sweepBaselineUsd" — reusing it rather than
// standing up a whole new KV namespace for one small JSON blob.
const SWEEP_ALERT_THRESHOLD_USD = 20;

export async function handleTreasuryThreshold(env: Env): Promise<Response> {
  const snap = await readTreasurySnapshot(env);
  const key = `${TREASURY_KV_PREFIX}sweepBaselineUsd`;
  let baseline = 0;
  try {
    const raw = await env.FRAME_ALERTS.get(key);
    if (raw) baseline = JSON.parse(raw)?.baselineUsd ?? 0;
  } catch { /* treat as first-ever check */ }

  const deltaUsd = snap.sweepableUsd - baseline;
  const crossed = snap.solUsdPrice !== null && deltaUsd >= SWEEP_ALERT_THRESHOLD_USD;

  if (crossed) {
    await env.FRAME_ALERTS.put(key, JSON.stringify({ baselineUsd: snap.sweepableUsd, updatedAt: Date.now() }));
  }

  return jsonResponse({
    crossed,
    deltaUsd: Math.round(deltaUsd * 100) / 100,
    sweepableUsd: Math.round(snap.sweepableUsd * 100) / 100,
    sol: snap.solUi,
    usdc: snap.usdcUi,
    // Points straight at the existing tap-to-sign swap Blink for whichever
    // currency dominates the sweepable balance — human still taps Confirm.
    blinkAction: (() => {
      const solUsdValue = snap.solUi * (snap.solUsdPrice ?? 0);
      return snap.usdcUi > solUsdValue
        ? `https://onlymonkes-actions.jumpstreet25.workers.dev/api/actions/treasury-swap?inputMint=usdc&amount=${snap.usdcUi.toFixed(2)}`
        : `https://onlymonkes-actions.jumpstreet25.workers.dev/api/actions/treasury-swap?inputMint=sol&amount=${snap.solUi.toFixed(4)}`;
    })(),
  });
}

// ─── GET /api/treasury/weekly-summary — feeds the Treasury bot's weekly digest post ──
// Read-only by default (safe to poll from the app too); pass ?rollover=true
// (only the bot's weekly cron job does this) to also reset the week-start
// baseline to right now, so next week's delta starts from today's total.
export async function handleTreasuryWeeklySummary(url: URL, env: Env): Promise<Response> {
  const snap = await readTreasurySnapshot(env);
  const key = `${TREASURY_KV_PREFIX}weekBaseline`;
  let weekBaselineUsd = snap.totalUsd;
  let weekStartTs = Date.now();
  try {
    const raw = await env.FRAME_ALERTS.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      weekBaselineUsd = parsed?.totalUsd ?? snap.totalUsd;
      weekStartTs = parsed?.ts ?? Date.now();
    }
  } catch { /* first-ever call — baseline defaults to current total, weekIncomeUsd will read 0 */ }

  const weekIncomeUsd = snap.totalUsd - weekBaselineUsd;

  if (url.searchParams.get("rollover") === "true") {
    await env.FRAME_ALERTS.put(key, JSON.stringify({ totalUsd: snap.totalUsd, ts: Date.now() }));
  }

  return jsonResponse({
    wallet: PUBLISHER_WALLET.toBase58(),
    sol: snap.solUi,
    usdc: snap.usdcUi,
    skr: snap.skrUi,
    stakedSkr: snap.stakedSkr,
    solUsdPrice: snap.solUsdPrice,
    skrUsdPrice: snap.skrUsdPrice,
    totalUsd: Math.round(snap.totalUsd * 100) / 100,
    weekIncomeUsd: Math.round(weekIncomeUsd * 100) / 100,
    weekStartTs,
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
