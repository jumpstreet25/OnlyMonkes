/**
 * PortfolioResponseBubble — single composite bubble rendering an entire
 * AutonoMonke /portfolio response.
 *
 * Header section: wallet, realized/unrealized P&L, trade counters, win rate.
 * Per-position rows: token, live P&L %, entry, status (T1/T2), tappable
 * sparkline. Tap a row → opens LivePnLCardModal with share buttons.
 *
 * Replaces the older "1 text bubble + N PORTFOLIO_CARD: bubbles" flow that
 * fragmented the UI. Driven by tradesStore.portfolioResponse, which is set
 * on every PORTFOLIO_RESPONSE: DM from the bot.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { THEME, FONTS } from '@/lib/constants';
import { Sparkline } from '@/components/Sparkline';
import { LivePnLCardModal } from '@/components/LivePnLCardModal';
import type { PortfolioResponse, PortfolioCard } from '@/store/tradesStore';
import type { ParsedPortfolioPosition } from '@/lib/xmtp';

interface PortfolioResponseBubbleProps {
  response: PortfolioResponse;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${sec}s`;
}

/** Adapt a position from the response into the shape LivePnLCardModal expects. */
function positionAsCard(pos: ParsedPortfolioPosition): PortfolioCard {
  return {
    source: 'autonomonke',
    kind: 'live',
    positionId: pos.positionId,
    token: pos.token,
    mint: pos.mint,
    entryPriceUsd: pos.entryPriceUsd,
    currentPriceUsd: pos.currentPriceUsd,
    entrySolAmount: pos.entrySolAmount,
    currentSolValue: pos.currentSolValue,
    pnlPct: pos.pnlPct,
    pnlSol: pos.pnlSol,
    stopPrice: pos.stopPrice,
    target1: pos.target1,
    target2: pos.target2,
    t1Hit: pos.t1Hit,
    t2Hit: pos.t2Hit,
    highWaterMark: pos.highWaterMark,
    openedAt: pos.openedAt,
    durationMs: pos.durationMs,
    taComposite: pos.taComposite,
    ts: Date.now(),
  };
}

export function PortfolioResponseBubble({ response }: PortfolioResponseBubbleProps) {
  const [activeCard, setActiveCard] = useState<PortfolioCard | null>(null);

  const realizedSign = response.realizedPnlPct >= 0 ? '+' : '';
  const unrealizedSign = response.unrealizedPnlSol >= 0 ? '+' : '';
  const realizedColor = response.realizedPnlPct >= 0 ? THEME.gold : THEME.error;
  const unrealizedColor = response.unrealizedPnlSol >= 0 ? THEME.gold : THEME.error;

  return (
    <>
      <View style={styles.row}>
        <View style={styles.bubble}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>📊 AutonoMonke Portfolio</Text>
            <Text style={styles.wallet}>
              {response.walletAddress.slice(0, 8)}…{response.walletAddress.slice(-4)}
            </Text>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statBlock}>
              <Text style={styles.statLabel}>Realized</Text>
              <Text style={[styles.statValue, { color: realizedColor }]}>
                {realizedSign}{response.realizedPnlPct.toFixed(2)}%
              </Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statLabel}>Unrealized</Text>
              <Text style={[styles.statValue, { color: unrealizedColor }]}>
                {unrealizedSign}{response.unrealizedPnlSol.toFixed(4)} SOL
              </Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statLabel}>Trades</Text>
              <Text style={styles.statValue}>
                {response.totalTrades}
              </Text>
              <Text style={styles.statSub}>
                {response.wins}W / {response.losses}L · {response.winRate.toFixed(0)}%
              </Text>
            </View>
          </View>

          {response.walletBalanceSOL != null && (
            <Text style={styles.balanceText}>
              On-chain balance: {response.walletBalanceSOL.toFixed(4)} SOL
            </Text>
          )}

          {/* Open positions with sparklines */}
          {response.positions.length > 0 ? (
            <View style={styles.positionsSection}>
              <Text style={styles.sectionLabel}>Open ({response.positions.length})</Text>
              {response.positions.map(pos => {
                const isUp = pos.pnlPct >= 0;
                const accent = isUp ? THEME.gold : THEME.error;
                const sign = isUp ? '+' : '';
                return (
                  <Pressable
                    key={pos.positionId}
                    onPress={() => setActiveCard(positionAsCard(pos))}
                    style={({ pressed }) => [styles.posRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.posTopRow}>
                      <Text style={styles.posToken}>{pos.token.toUpperCase()}</Text>
                      <Text style={[styles.posPnl, { color: accent }]}>
                        {sign}{pos.pnlPct.toFixed(2)}%
                      </Text>
                    </View>
                    <View style={styles.posChart}>
                      <Sparkline closes={pos.sparkline} width={260} height={32} colorOverride={accent} />
                    </View>
                    <View style={styles.posMetaRow}>
                      <Text style={styles.posMeta}>{pos.entrySolAmount.toFixed(4)} SOL</Text>
                      <Text style={styles.posMeta}>·</Text>
                      <Text style={styles.posMeta}>T1 {pos.t1Hit ? '✅' : '⏳'}</Text>
                      <Text style={styles.posMeta}>T2 {pos.t2Hit ? '✅' : '⏳'}</Text>
                      <Text style={styles.posMeta}>·</Text>
                      <Text style={styles.posMeta}>{formatDuration(pos.durationMs)}</Text>
                      <Text style={styles.posTap}>tap →</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>No open positions yet. Wait for a 🐒 signal.</Text>
          )}

          {/* Recent closed */}
          {response.recentClosed.length > 0 && (
            <View style={styles.closedSection}>
              <Text style={styles.sectionLabel}>Recent closed</Text>
              {response.recentClosed.map((c, i) => {
                const won = c.pnlPct >= 0;
                return (
                  <View key={`${c.token}-${i}`} style={styles.closedRow}>
                    <Text style={styles.closedEmoji}>{won ? '✅' : '🛑'}</Text>
                    <Text style={styles.closedToken}>{c.token.toUpperCase()}</Text>
                    <Text style={[styles.closedPnl, { color: won ? THEME.gold : THEME.error }]}>
                      {won ? '+' : ''}{c.pnlPct.toFixed(2)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <LivePnLCardModal
        card={activeCard}
        visible={!!activeCard}
        onClose={() => setActiveCard(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 6, alignItems: 'flex-start' },
  bubble: {
    width: '94%', maxWidth: 420,
    borderRadius: 18, borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surfaceHigh,
    paddingVertical: 14, paddingHorizontal: 14,
    gap: 12,
  },
  header: { gap: 2 },
  title: { fontFamily: FONTS.display, fontSize: 14, color: THEME.text, letterSpacing: 0.4 },
  wallet: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, letterSpacing: 0.6 },

  statRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: THEME.surface, borderRadius: 12,
  },
  statBlock: { gap: 2, flex: 1 },
  statLabel: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, letterSpacing: 0.8 },
  statValue: { fontFamily: FONTS.display, fontSize: 13, color: THEME.text, letterSpacing: -0.2 },
  statSub: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted },
  balanceText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: -4 },

  positionsSection: { gap: 8 },
  sectionLabel: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, letterSpacing: 1 },
  posRow: {
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: THEME.surface, borderRadius: 12,
    gap: 4,
  },
  posTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  posToken: { fontFamily: FONTS.display, fontSize: 14, color: THEME.text, letterSpacing: 0.3 },
  posPnl: { fontFamily: FONTS.display, fontSize: 14, letterSpacing: -0.2 },
  posChart: { marginVertical: 2, alignItems: 'stretch' },
  posMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  posMeta: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  posTap: { fontFamily: FONTS.bodyMed, fontSize: 10, color: THEME.textMuted, marginLeft: 'auto' },

  emptyText: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, textAlign: 'center', paddingVertical: 8 },

  closedSection: { gap: 4, marginTop: 4 },
  closedRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  closedEmoji: { fontSize: 12 },
  closedToken: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, flex: 1 },
  closedPnl: { fontFamily: FONTS.mono, fontSize: 11 },
});
