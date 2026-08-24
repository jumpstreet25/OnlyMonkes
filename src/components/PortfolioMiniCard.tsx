/**
 * PortfolioMiniCard — tappable mini-card for a live AutonoMonke position.
 *
 * Rendered in the bot DM feed under the AutonoMonke Portfolio response,
 * one per open position. Tap → opens LivePnLCardModal with share buttons
 * (Save / Copy / Share-X / Share-MainChat / Both).
 *
 * Mirrors PnLCardMessage shape for closed trades but shows LIVE P&L —
 * green (positive) / red (negative) accent, "OPEN" status badge.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LiquidGlass as BlurView } from '@/components/LiquidGlass';
import { THEME, FONTS } from '@/lib/constants';
import { getBlurProps, GLASS_CHROME_BG } from '@/lib/glassTheme';
import type { PortfolioCard } from '@/store/tradesStore';

interface PortfolioMiniCardProps {
  card: PortfolioCard;
  onPress: (card: PortfolioCard) => void;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function PortfolioMiniCard({ card, onPress }: PortfolioMiniCardProps) {
  const isWin = card.pnlPct >= 0;
  const accent = isWin ? THEME.gold : THEME.error;
  const sign = isWin ? '+' : '';

  return (
    <Pressable
      onPress={() => onPress(card)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.bubble, { borderColor: accent + '55' }]}>
        {/* MonkeGlass — same treatment as the chat chrome bars. */}
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: GLASS_CHROME_BG }]} pointerEvents="none" />
        <View style={styles.header}>
          <Text style={[styles.label, { color: accent }]}>🤖 OPEN POSITION</Text>
          <Text style={styles.live}>● LIVE</Text>
        </View>
        <View style={styles.middle}>
          <Text style={[styles.pct, { color: accent }]}>
            {sign}{card.pnlPct.toFixed(2)}%
          </Text>
          <Text style={styles.token}>${card.token.toUpperCase()}</Text>
        </View>
        <View style={styles.targetsRow}>
          <Text style={styles.entry}>
            {card.entrySolAmount.toFixed(4)} SOL
          </Text>
          <Text style={styles.target}>T1 {card.t1Hit ? '✅' : '⏳'}</Text>
          <Text style={styles.target}>T2 {card.t2Hit ? '✅' : '⏳'}</Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.meta}>{formatDuration(card.durationMs)}</Text>
          <Text style={styles.cta}>Tap to share →</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-end' },
  bubble: {
    minWidth: 240,
    maxWidth: '85%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    // Background is now the BlurView + tint View layered as the first two
    // children (MonkeGlass, 2026-08-03) instead of a static color here.
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.2 },
  live: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.error, letterSpacing: 1 },
  middle: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  pct: { fontFamily: FONTS.display, fontSize: 22, letterSpacing: -0.5 },
  token: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.text },
  targetsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entry: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  target: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  meta: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted },
  cta: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted },
});
