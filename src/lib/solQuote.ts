/** TOKEN/SOL mark from a DexScreener pair. Never a leftover USD print. */
export function isSolQuote(pair: { quoteToken?: { symbol?: string } } | null | undefined): boolean {
  const q = String(pair?.quoteToken?.symbol ?? '').toUpperCase();
  return q === 'SOL' || q === 'WSOL';
}

export function quotePoolRank(pair: { quoteToken?: { symbol?: string } }): number {
  const q = String(pair?.quoteToken?.symbol ?? '').toUpperCase();
  if (q === 'SOL' || q === 'WSOL') return 0;
  if (q === 'SKR') return 1;
  return 2;
}

export function pickSolPair<T extends {
  quoteToken?: { symbol?: string };
  liquidity?: { usd?: number };
}>(pairs: T[]): T | undefined {
  if (!pairs.length) return undefined;
  return [...pairs].sort((a, b) => {
    const r = quotePoolRank(a) - quotePoolRank(b);
    if (r !== 0) return r;
    return (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0);
  })[0];
}

export function solMarkFromPair(pair: {
  priceNative?: string | number;
  priceUsd?: string | number;
  quoteToken?: { symbol?: string };
} | null | undefined): number {
  if (!pair) return 0;
  const native = typeof pair.priceNative === 'number' ? pair.priceNative : parseFloat(String(pair.priceNative ?? '0'));
  if (native > 0) return native;
  return 0;
}

/** Scale USD OHLCV onto TOKEN/SOL using the pair's native/usd ratio. */
export function usdToSolScale(pair: {
  priceNative?: string | number;
  priceUsd?: string | number;
} | null | undefined): number {
  if (!pair) return 1;
  const native = typeof pair.priceNative === 'number' ? pair.priceNative : parseFloat(String(pair.priceNative ?? '0'));
  const usd = typeof pair.priceUsd === 'number' ? pair.priceUsd : parseFloat(String(pair.priceUsd ?? '0'));
  if (native > 0 && usd > 0) return native / usd;
  return 1;
}

export function formatSolPx(p: number): string {
  if (!Number.isFinite(p) || !(p > 0)) return '—';
  if (p >= 1) return `${p.toFixed(4)} SOL`;
  return `${p.toPrecision(6)} SOL`;
}
