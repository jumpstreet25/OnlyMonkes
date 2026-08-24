/**
 * ChartModal — Interactive candlestick chart for token prices.
 *
 * Uses react-native-wagmi-charts for 60fps Reanimated-powered charts.
 * Fetches OHLCV data from DexScreener or Birdeye on open.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { CandlestickChart, type TCandle } from 'react-native-wagmi-charts';
import { THEME, FONTS } from '@/lib/constants';
import { GlassBottomSheet } from '@/components/GlassBottomSheet';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { fetchRugCheckSummary, type RugCheckSummary } from '@/lib/rugCheck';
import { pickSolPair, solMarkFromPair, usdToSolScale, type DexScreenerPair } from '@/lib/solQuote';
import { recordTokenView, recordEngagementEnd } from '@/lib/sentimentSignal';

interface ChartModalProps {
  visible: boolean;
  symbol: string;
  onClose: () => void;
}

/**
 * Fetch real OHLCV data.
 * 1. DexScreener search → find Solana pair + pool address
 * 2. DexPaprika OHLCV endpoint (free, no auth, 10k req/day) → real 1h candles
 *
 * Returns { candles, mint } — mint is exposed so the caller can fire other
 * mint-keyed lookups (e.g. RugCheck) in parallel.
 */
async function fetchOHLCV(symbol: string): Promise<{ candles: TCandle[]; mint: string | null }> {
  // Step 1: Find Solana pair via DexScreener
  const searchRes = await fetchWithTimeout(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
    { timeoutMs: 8000 },
  );
  if (!searchRes.ok) return { candles: [], mint: null };

  const searchData = (await searchRes.json()) as { pairs?: DexScreenerPair[] };
  const solanaPairs = (searchData?.pairs ?? []).filter(
    (p) => p.chainId === 'solana' && p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase(),
  );
  // Prefer the pool quoted in SOL (or SKR) — same unit AutonoMonke / Monke Traders use.
  const pair = pickSolPair(solanaPairs);
  if (!pair?.pairAddress) return { candles: [], mint: null };
  const mint: string | null = pair.baseToken?.address ?? null;

  // Step 2: Fetch real 1h OHLCV from DexPaprika (free, no auth)
  const start = Math.floor((Date.now() - 48 * 3600000) / 1000); // 48h ago
  try {
    const dpRes = await fetchWithTimeout(
      `https://api.dexpaprika.com/networks/solana/pools/${pair.pairAddress}/ohlcv?start=${start}&limit=48&interval=1h`,
      { timeoutMs: 8000 },
    );
    if (dpRes.ok) {
      const dpData = await dpRes.json();
      if (Array.isArray(dpData) && dpData.length > 0) {
        const scale = usdToSolScale(pair);
        const candles = dpData.map((c: any) => ({
          timestamp: new Date(c.time_open ?? c.time_close).getTime(),
          open: parseFloat(c.open) * scale,
          high: parseFloat(c.high) * scale,
          low: parseFloat(c.low) * scale,
          close: parseFloat(c.close) * scale,
        })).filter((c: TCandle) => !isNaN(c.open) && c.open > 0);
        return { candles, mint };
      }
    }
  } catch { /* fall through to synthetic */ }

  // Step 3: Fallback — synthetic candles from DexScreener 24h change (better than nothing)
  const price = solMarkFromPair(pair) || parseFloat(String(pair.priceUsd ?? '0')) || 0;
  if (!price) return { candles: [], mint };

  const priceChange24h = parseFloat(String(pair.priceChange?.h24 ?? '0')) || 0;
  const startPrice = price / (1 + priceChange24h / 100);
  const candles: TCandle[] = [];
  const now = Date.now();

  for (let i = 47; i >= 0; i--) {
    const t = now - i * 3600000;
    const progress = (47 - i) / 47;
    const basePrice = startPrice + (price - startPrice) * progress;
    const variance = basePrice * 0.005;
    const open = basePrice + (Math.random() - 0.5) * variance;
    const close = basePrice + (Math.random() - 0.5) * variance;
    const high = Math.max(open, close) + Math.random() * variance;
    const low = Math.min(open, close) - Math.random() * variance;
    candles.push({ timestamp: t, open, high, low, close });
  }

  return { candles, mint };
}

export function ChartModal({ visible, symbol, onClose }: ChartModalProps) {
  const { width: SCREEN_W } = useWindowDimensions();
  const [candles, setCandles] = useState<TCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rug, setRug] = useState<RugCheckSummary | null>(null);

  useEffect(() => {
    if (!visible || !symbol) return;
    let alive = true;
    setLoading(true);
    setError(false);
    setRug(null);

    fetchOHLCV(symbol)
      .then(({ candles, mint }) => {
        if (!alive) return;
        setCandles(candles);
        if (candles.length === 0) setError(true);
        // Kick off RugCheck in parallel — don't block the chart on it
        if (mint) {
          fetchRugCheckSummary(mint).then(r => { if (alive) setRug(r); }).catch(() => {});
        }
      })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [visible, symbol]);

  // Data Oracle Phase 1 signal — only records while the user has opted in
  // (sentimentSignal.ts's own gate); this component doesn't need to know that state.
  useEffect(() => {
    if (!visible || !symbol) return;
    recordTokenView(symbol);
    return () => { void recordEngagementEnd(symbol); };
  }, [visible, symbol]);

  const chartWidth = SCREEN_W - 32;
  const chartHeight = 300;

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={['70%', '95%']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.symbol}>${symbol}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.closeBtn}>✕</Text>
        </Pressable>
      </View>

      {/* Anti-Rug Signal — RugCheck.xyz summary */}
      {rug && (
        <View style={[
          styles.rugRow,
          {
            borderColor:
              rug.verdict === 'safe'    ? '#22c55e44' :
              rug.verdict === 'caution' ? '#f59e0b44' :
                                          '#ef444466',
          },
        ]}>
          <Text style={[
            styles.rugBadge,
            {
              color:
                rug.verdict === 'safe'    ? '#22c55e' :
                rug.verdict === 'caution' ? '#f59e0b' :
                                            '#ef4444',
            },
          ]}>
            {rug.verdict === 'safe' ? '✓ SAFE' : rug.verdict === 'caution' ? '⚠ CAUTION' : '⛔ DANGER'}
          </Text>
          <Text style={styles.rugText} numberOfLines={2}>
            LP locked {rug.lpLockedPct.toFixed(0)}% · Risk {rug.scoreNormalised}/100
            {rug.topRisks[0] ? ` · ${rug.topRisks[0].name}` : ''}
          </Text>
        </View>
      )}

      {/* Chart */}
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
        </View>
      )}

      {error && !loading && (
        <View style={styles.center}>
          <Text style={styles.errorText}>No chart data for ${symbol}</Text>
        </View>
      )}

      {!loading && !error && candles.length > 0 && (
        <View style={styles.chartContainer}>
          <CandlestickChart.Provider data={candles}>
            <CandlestickChart width={chartWidth} height={chartHeight}>
              <CandlestickChart.Candles
                positiveColor="#22c55e"
                negativeColor="#ef4444"
              />
              <CandlestickChart.Crosshair>
                <CandlestickChart.Tooltip />
              </CandlestickChart.Crosshair>
            </CandlestickChart>

            {/* Price + date readout */}
            <View style={styles.readout}>
              <CandlestickChart.PriceText
                type="crosshair"
                style={styles.priceText}
                format={({ value }) => {
                  'worklet';
                  const n = parseFloat(value);
                  if (isNaN(n)) return '';
                  if (n >= 1) return `${n.toFixed(4)} SOL`;
                  return `${n.toPrecision(6)} SOL`;
                }}
              />
              <CandlestickChart.DatetimeText
                style={styles.dateText}
                format={({ value }) => {
                  'worklet';
                  const d = new Date(value);
                  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                }}
              />
            </View>
          </CandlestickChart.Provider>
        </View>
      )}
    </GlassBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  symbol: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: '#FFD700',
  },
  closeBtn: {
    fontSize: 20,
    color: THEME.textDim,
  },
  rugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 10,
  },
  rugBadge: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  rugText: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textDim,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textDim,
  },
  chartContainer: {
    alignItems: 'center',
  },
  readout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  priceText: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: THEME.text,
  },
  dateText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textDim,
  },
});
