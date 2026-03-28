/**
 * costBasis.ts — Track token purchase cost for profit-based fee calculation.
 *
 * Records SOL spent per token mint on buys. On sells, calculates
 * proportional cost basis and profit for fee deduction.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_COST_BASIS = 'om_cost_basis_v1';

interface CostBasisEntry {
  mint: string;
  totalSolInvested: number;
}

let _cache: Map<string, number> = new Map();
let _loaded = false;

export async function loadCostBasis(force = false): Promise<void> {
  if (_loaded && !force) return;
  try {
    const raw = await AsyncStorage.getItem(AK_COST_BASIS);
    if (raw) {
      const entries = JSON.parse(raw) as CostBasisEntry[];
      _cache = new Map(entries.map(e => [e.mint, e.totalSolInvested]));
    }
  } catch { /* non-critical */ }
  _loaded = true;
}

/** Record SOL spent buying a token. Accumulates across multiple buys. */
export function recordBuy(mint: string, solSpent: number): void {
  const current = _cache.get(mint) ?? 0;
  _cache.set(mint, current + solSpent);
  _persist();
}

/** Get total SOL invested in a token. */
export function getCostBasis(mint: string): number {
  return _cache.get(mint) ?? 0;
}

/**
 * Record a sell and return the proportional cost basis consumed.
 *
 * @param mint        Token mint sold
 * @param tokensSold  Number of tokens sold (human-readable)
 * @param totalBalance Total token balance BEFORE the sell (human-readable)
 * @returns The proportional cost basis of the sold portion
 */
export function recordSell(mint: string, tokensSold: number, totalBalance: number): number {
  const basis = _cache.get(mint) ?? 0;
  if (basis <= 0 || totalBalance <= 0) {
    _cache.delete(mint);
    _persist();
    return 0;
  }

  const fraction = Math.min(tokensSold / totalBalance, 1);
  const soldBasis = basis * fraction;
  const remaining = basis - soldBasis;

  if (remaining < 0.0001 || fraction >= 0.999) {
    _cache.delete(mint);
  } else {
    _cache.set(mint, remaining);
  }
  _persist();
  return soldBasis;
}

function _persist(): void {
  const entries = [..._cache.entries()].map(([mint, totalSolInvested]) => ({
    mint,
    totalSolInvested,
  }));
  AsyncStorage.setItem(AK_COST_BASIS, JSON.stringify(entries)).catch(() => {});
}
