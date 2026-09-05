/**
 * PortfolioResponseBubble — plain-text /portfolio reply.
 *
 * 2026-09-05: was a heavy composite "card" (bordered box, watermark logo,
 * divided stat columns, per-position boxes with sparkline charts + pill
 * chips + breakdown dividers). User asked to drop the card entirely and
 * show the same data as plain lines in a normal message bubble — tapping
 * a position/closed-trade row still opens the same LivePnLCardModal /
 * PnLCardModal (share buttons live there, not in this bubble). All the
 * P&L math is unchanged, only the rendering got lighter.
 *
 * Driven by tradesStore.portfolioResponse, set on every PORTFOLIO_RESPONSE:
 * DM from the bot.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { THEME, FONTS } from '@/lib/constants';
import type { PortfolioResponse, PortfolioCard } from '@/store/tradesStore';
import type { ParsedPortfolioPosition, ParsedRecentClosed } from '@/lib/xmtp';
import type { ClosedTrade } from '@/lib/positions';

interface PortfolioResponseBubbleProps {
  response: PortfolioResponse;
  /** Tap a position row → opens LivePnLCardModal (rendered at parent screen).
   *  Lifted up because FlatList recycles cells and a nested Modal portals
   *  unreliably from inside a recycled cell. */
  onPressPosition?: (card: PortfolioCard) => void;
  /** Tap a closed-trade row → opens PnLCardModal with the closed trade.
   *  Same lift-up rationale as onPressPosition. */
  onPressClosedTrade?: (trade: ClosedTrade) => void;
}

function closedRowAsTrade(c: ParsedRecentClosed): ClosedTrade {
  return {
    id: `closed-${c.mint}-${c.closedAt}`,
    source: 'autonomonke',
    token: c.token,
    mint: c.mint,
    entrySolAmount: c.entrySolAmount,
    exitSolAmount: c.exitSolAmount,
    pnlSol: c.pnlSol,
    pnlPct: c.pnlPct,
    durationMs: c.durationMs,
    openedAt: c.openedAt,
    closedAt: c.closedAt,
    reason: c.reason,
  };
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

export function PortfolioResponseBubble({ response, onPressPosition, onPressClosedTrade }: PortfolioResponseBubbleProps) {
  const realizedSign = response.realizedPnlPct >= 0 ? '+' : '';
  const unrealizedSign = response.unrealizedPnlSol >= 0 ? '+' : '';
  const realizedColor = response.realizedPnlPct >= 0 ? THEME.gold : THEME.error;
  const unrealizedColor = response.unrealizedPnlSol >= 0 ? THEME.gold : THEME.error;
  const addr = response.hotWalletAddress ?? response.walletAddress;

  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Text style={styles.headerLine}>
          📊 <Text style={styles.bold}>AutonoMonke</Text>{'   '}
          <Text style={styles.muted}>🔥 {addr.slice(0, 4)}…{addr.slice(-4)}</Text>
        </Text>

        <Text style={styles.summaryLine}>
          Realized{' '}
          <Text style={{ color: realizedColor }}>
            {realizedSign}{response.realizedPnlPct.toFixed(2)}%
            {response.realizedPnlSol != null && ` (${response.realizedPnlSol >= 0 ? '+' : ''}${response.realizedPnlSol.toFixed(4)} SOL)`}
          </Text>
          {'  ·  Unrealized '}
          <Text style={{ color: unrealizedColor }}>{unrealizedSign}{response.unrealizedPnlSol.toFixed(3)} SOL</Text>
          {'  ·  '}{response.totalTrades} trades · {response.wins}W/{response.losses}L · {response.winRate.toFixed(0)}%
        </Text>

        {response.walletBalanceSOL != null && (
          <Text style={styles.muted}>{response.walletBalanceSOL.toFixed(4)} SOL on-chain</Text>
        )}

        {response.positions.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>OPEN · {response.positions.length}</Text>
            {response.positions.map(pos => {
              // Same partial-sell-aware net calc the old card used — chip
              // must match Net, price-only leftover-bag % disagrees after T1.
              const realized = pos.realizedSolFromSells ?? 0;
              const netSol = realized + pos.currentSolValue - pos.entrySolAmount;
              const netUp = netSol >= 0;
              const hasPartialData = pos.realizedSolFromSells != null;
              const displayPct = pos.entrySolAmount > 0
                ? (netSol / pos.entrySolAmount) * 100
                : pos.pnlPct;
              const chipUp = displayPct >= 0;
              const chipAccent = chipUp ? THEME.gold : THEME.error;
              const chipSign = chipUp ? '+' : '';
              return (
                <Pressable
                  key={pos.positionId}
                  onPress={() => onPressPosition?.(positionAsCard({
                    ...pos,
                    pnlPct: displayPct,
                    pnlSol: netSol,
                  }))}
                  style={({ pressed }) => [styles.tapLine, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.posLine}>
                    <Text style={styles.bold}>${pos.token.toUpperCase()}</Text>{'  '}
                    <Text style={{ color: chipAccent }}>{chipSign}{displayPct.toFixed(2)}%</Text>
                    {pos.houseMoney && '  🟢 house money'}
                  </Text>
                  {hasPartialData ? (
                    <Text style={styles.muted}>
                      Holding {pos.currentSolValue.toFixed(4)} SOL
                      {pos.fractionRemaining != null && ` (${(pos.fractionRemaining * 100).toFixed(0)}%)`}
                      {realized > 0 && `  ·  Realized +${realized.toFixed(4)} SOL`}
                      {'  ·  Net '}
                      <Text style={{ color: netUp ? THEME.gold : THEME.error }}>
                        {netUp ? '+' : ''}{netSol.toFixed(4)} SOL
                      </Text>
                    </Text>
                  ) : (
                    <Text style={styles.muted}>
                      {pos.entrySolAmount.toFixed(3)} SOL · {formatDuration(pos.durationMs)}
                    </Text>
                  )}
                  <Text style={styles.muted}>
                    {pos.target1 != null && `T1 ${pos.t1Hit ? '✓ ' : ''}${(((pos.target1 - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%`}
                    {pos.target2 != null && `  ·  T2 ${pos.t2Hit ? '✓ ' : ''}${(((pos.target2 - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%`}
                    {`  ·  SL ${(((pos.stopPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.muted}>No open positions yet. Wait for a 🐒 signal.</Text>
        )}

        {response.recentClosed.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RECENT CLOSED · tap to share</Text>
            {response.recentClosed.map((c, i) => {
              const won = c.pnlPct >= 0;
              const accent = won ? THEME.gold : THEME.error;
              return (
                <Pressable
                  key={`${c.token}-${c.closedAt}-${i}`}
                  onPress={() => onPressClosedTrade?.(closedRowAsTrade(c))}
                  style={({ pressed }) => [styles.tapLine, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.posLine}>
                    {won ? '✅' : '🛑'} <Text style={styles.bold}>${c.token.toUpperCase()}</Text>{'  '}
                    <Text style={{ color: accent }}>{won ? '+' : ''}{c.pnlPct.toFixed(2)}%</Text>
                    <Text style={styles.muted}>  ↗</Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 6, alignItems: 'flex-start' },
  bubble: {
    width: '94%', maxWidth: 420,
    borderRadius: 18,
    backgroundColor: THEME.surface,
    paddingVertical: 12, paddingHorizontal: 14,
    gap: 6,
  },
  bold: { fontFamily: FONTS.bodySemi },
  muted: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  headerLine: { fontFamily: FONTS.body, fontSize: 13, color: THEME.text },
  summaryLine: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, lineHeight: 16 },

  section: { gap: 6, marginTop: 2 },
  sectionLabel: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, letterSpacing: 1.2 },

  tapLine: { gap: 1, paddingVertical: 2 },
  posLine: { fontFamily: FONTS.body, fontSize: 13, color: THEME.text },
});
