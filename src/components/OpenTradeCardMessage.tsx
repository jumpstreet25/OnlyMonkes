import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { THEME, FONTS } from '@/lib/constants';
import type { OpenTrade } from '@/lib/positions';

interface OpenTradeCardMessageProps {
  trade: OpenTrade;
}

function formatElapsed(openedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - openedAt) / 1000));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${sec}s`;
}

function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

function formatPct(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '';
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

/**
 * Active AutonoMonke position card. Mirrors PnLCardMessage shape (right-aligned
 * pressable bubble in the DM feed) but for an OPEN position — no PnL %, no
 * duration-since-close. Shows entry, stop, T1/T2 and a live "watching for Xm"
 * timer that ticks every 30s. The card auto-disappears when the matching
 * TRADE_CLOSED arrives (handled by tradesStore.addClosedTrade auto-pruning
 * by mint, no UI work needed here).
 */
export function OpenTradeCardMessage({ trade }: OpenTradeCardMessageProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    // Tick every 30s — this is a "live" card so the elapsed string stays fresh
    // without burning every-second renders. 30s is plenty for "watching 17m".
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const accent = THEME.accent;
  const elapsed = formatElapsed(trade.openedAt, now);
  const stopPctStr = formatPct(trade.stopPct ? -Math.abs(trade.stopPct) : undefined);

  return (
    <View style={styles.row}>
      <View style={[styles.bubble, { borderColor: accent + '55' }]}>
        <View style={styles.header}>
          <Text style={[styles.label, { color: accent }]}>🤖 AUTONOMONKE OPEN</Text>
          <Text style={styles.live}>● LIVE</Text>
        </View>
        <View style={styles.middle}>
          <Text style={styles.token}>${trade.token.toUpperCase()}</Text>
          <Text style={styles.entry}>entry {formatPrice(trade.entryPriceUsd)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {trade.entrySolAmount.toFixed(3)} SOL in
          </Text>
          {trade.taComposite != null && (
            <Text style={styles.meta}>· TA {trade.taComposite}/100</Text>
          )}
        </View>
        <View style={styles.targetsRow}>
          <Text style={styles.stopText}>
            stop {formatPrice(trade.stopPrice)}{stopPctStr ? ` (${stopPctStr})` : ''}
          </Text>
          {trade.target1 != null && (
            <Text style={styles.targetText}>T1 {formatPrice(trade.target1)}</Text>
          )}
          {trade.target2 != null && (
            <Text style={styles.targetText}>T2 {formatPrice(trade.target2)}</Text>
          )}
        </View>
        <View style={styles.footer}>
          <Text style={styles.watching}>watching · {elapsed}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-end' },
  bubble: {
    minWidth: 240,
    maxWidth: '90%',
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: THEME.surfaceHigh,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.2 },
  live: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.success, letterSpacing: 0.8 },
  middle: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  token: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  entry: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  meta: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted },
  targetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  stopText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.error },
  targetText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.success },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 },
  watching: { fontFamily: FONTS.body, fontSize: 10, color: THEME.textFaint, fontStyle: 'italic' },
});
