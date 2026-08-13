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

import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { THEME, FONTS } from '@/lib/constants';
import { Sparkline } from '@/components/Sparkline';
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

  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
          {/* Header — 📊 AutonoMonke + watermark left, wallet pill right */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>📊 AutonoMonke</Text>
              <Image
                source={require('../../assets/watermark.png')}
                style={styles.headerMark}
                resizeMode="contain"
              />
            </View>
            {(() => {
              // Display the HOT wallet — that's what actually holds tokens
              // and executes trades. Login wallet is just the identity key.
              // Falls back to walletAddress for old bot builds that don't
              // include hotWalletAddress yet.
              const addr = response.hotWalletAddress ?? response.walletAddress;
              return (
                <Text style={styles.wallet}>
                  🔥 {addr.slice(0, 4)}…{addr.slice(-4)}
                </Text>
              );
            })()}
          </View>

          {/* Hairline-separated stats — three even columns */}
          <View style={styles.statRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>REALIZED</Text>
              <Text style={[styles.statValue, { color: realizedColor }]}>
                {realizedSign}{response.realizedPnlPct.toFixed(2)}%
              </Text>
              {response.realizedPnlSol != null && (
                <Text style={styles.statSub}>
                  {response.realizedPnlSol >= 0 ? '+' : ''}{response.realizedPnlSol.toFixed(4)} SOL
                </Text>
              )}
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>UNREALIZED</Text>
              <Text style={[styles.statValue, { color: unrealizedColor }]}>
                {unrealizedSign}{response.unrealizedPnlSol.toFixed(3)} SOL
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>TRADES</Text>
              <Text style={styles.statValue}>{response.totalTrades}</Text>
              <Text style={styles.statSub}>
                {response.wins}W·{response.losses}L · {response.winRate.toFixed(0)}%
              </Text>
            </View>
          </View>

          {response.walletBalanceSOL != null && (
            <Text style={styles.balanceText}>
              {response.walletBalanceSOL.toFixed(4)} SOL on-chain
            </Text>
          )}

          {/* Open positions */}
          {response.positions.length > 0 ? (
            <View style={styles.positionsSection}>
              <Text style={styles.sectionLabel}>OPEN · {response.positions.length}</Text>
              {response.positions.map(pos => {
                // Partial-sell-aware breakdown. If the bot supplied
                // realizedSolFromSells (post-2026-05-14 bot build), render
                // a 3-line Holding / Realized / Net breakdown that reflects
                // the position's actual remaining exposure. Older payloads
                // fall back to the prior single-line "entry SOL · duration"
                // display.
                const realized = pos.realizedSolFromSells ?? 0;
                const netSol = realized + pos.currentSolValue - pos.entrySolAmount;
                const netUp = netSol >= 0;
                const hasPartialData = pos.realizedSolFromSells != null;
                // Chip must match Net: price-only leftover-bag % disagrees after T1.
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
                    style={({ pressed }) => [styles.posRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.posTopRow}>
                      <View style={styles.posTokenRow}>
                        <Text style={styles.posToken}>${pos.token.toUpperCase()}</Text>
                        {pos.houseMoney && (
                          <View style={styles.houseMoneyChip}>
                            <Text style={styles.houseMoneyText}>🟢 HOUSE MONEY</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.pnlChip, { backgroundColor: chipAccent + '22', borderColor: chipAccent + '55' }]}>
                        <Text style={[styles.pnlChipText, { color: chipAccent }]}>
                          {chipSign}{displayPct.toFixed(2)}%
                        </Text>
                      </View>
                    </View>
                    <View style={styles.posChart}>
                      <Sparkline closes={pos.sparkline} width={260} height={32} colorOverride={chipAccent} />
                    </View>
                    {hasPartialData ? (
                      <View style={styles.posBreakdown}>
                        <View style={styles.posBreakdownRow}>
                          <Text style={styles.posBreakdownLabel}>Holding</Text>
                          <Text style={styles.posBreakdownValue}>
                            {pos.currentSolValue.toFixed(4)} SOL
                            {pos.fractionRemaining != null && (
                              <Text style={styles.posBreakdownSub}>  ·  {(pos.fractionRemaining * 100).toFixed(0)}% of pos</Text>
                            )}
                          </Text>
                        </View>
                        {realized > 0 && (
                          <View style={styles.posBreakdownRow}>
                            <Text style={styles.posBreakdownLabel}>Realized</Text>
                            <Text style={[styles.posBreakdownValue, { color: THEME.gold }]}>
                              +{realized.toFixed(4)} SOL
                              <Text style={styles.posBreakdownSub}>  ·  {((realized / pos.entrySolAmount) * 100).toFixed(0)}% of cost</Text>
                            </Text>
                          </View>
                        )}
                        <View style={[styles.posBreakdownRow, styles.posBreakdownTotal]}>
                          <Text style={styles.posBreakdownLabel}>Net</Text>
                          <Text style={[styles.posBreakdownValue, { color: netUp ? THEME.gold : THEME.error }]}>
                            {netUp ? '+' : ''}{netSol.toFixed(4)} SOL
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.posMetaRow}>
                        <Text style={styles.posMeta}>{pos.entrySolAmount.toFixed(3)} SOL</Text>
                        <Text style={styles.posMetaSep}>·</Text>
                        <Text style={styles.posMeta}>{formatDuration(pos.durationMs)}</Text>
                      </View>
                    )}
                    {/* Targets relative to entry — "+12% T1 ✓ · +24% T2 · -8% SL".
                        Shows the user where they are vs the planned exits.
                        Hit targets stay green with a ✓; missed-stop tints red. */}
                    <View style={styles.posMetaRow}>
                      {pos.target1 != null && (
                        <Text style={[styles.posMeta, pos.t1Hit && { color: THEME.gold }]}>
                          T1 {pos.t1Hit ? '✓ ' : ''}{(((pos.target1 - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%
                        </Text>
                      )}
                      {pos.target2 != null && (
                        <>
                          <Text style={styles.posMetaSep}>·</Text>
                          <Text style={[styles.posMeta, pos.t2Hit && { color: THEME.gold }]}>
                            T2 {pos.t2Hit ? '✓ ' : ''}{(((pos.target2 - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%
                          </Text>
                        </>
                      )}
                      <Text style={styles.posMetaSep}>·</Text>
                      <Text style={[styles.posMeta, { color: THEME.error + 'CC' }]}>
                        SL {(((pos.stopPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%
                      </Text>
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
              <Text style={styles.sectionLabel}>RECENT CLOSED · tap to share</Text>
              {response.recentClosed.map((c, i) => {
                const won = c.pnlPct >= 0;
                const accent = won ? THEME.gold : THEME.error;
                return (
                  <Pressable
                    key={`${c.token}-${c.closedAt}-${i}`}
                    onPress={() => onPressClosedTrade?.(closedRowAsTrade(c))}
                    style={({ pressed }) => [styles.closedRow, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.closedEmoji}>{won ? '✅' : '🛑'}</Text>
                    <Text style={styles.closedToken}>${c.token.toUpperCase()}</Text>
                    <Text style={[styles.closedPnl, { color: accent }]}>
                      {won ? '+' : ''}{c.pnlPct.toFixed(2)}%
                    </Text>
                    <Text style={styles.closedShareIcon}>↗</Text>
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
    borderRadius: 18, borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surfaceHigh,
    paddingVertical: 14, paddingHorizontal: 14,
    gap: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: FONTS.display, fontSize: 14, color: THEME.text, letterSpacing: 0.4 },
  headerMark: { width: 38, height: 14, opacity: 0.7 },
  wallet: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, letterSpacing: 0.6,
    paddingVertical: 3, paddingHorizontal: 8,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
  },

  // Hairline-style stats — dividers instead of card-in-card.
  statRow: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.border,
  },
  statCol: { flex: 1, gap: 2, paddingHorizontal: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: THEME.border },
  statLabel: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, letterSpacing: 0.8 },
  statValue: { fontFamily: FONTS.display, fontSize: 13, color: THEME.text, letterSpacing: -0.2 },
  statSub: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted },
  balanceText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: -4, textAlign: 'right' },

  positionsSection: { gap: 8 },
  sectionLabel: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, letterSpacing: 1.2 },
  posRow: {
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: THEME.surface, borderRadius: 12,
    gap: 4,
  },
  posTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posTokenRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  houseMoneyChip: {
    paddingVertical: 2, paddingHorizontal: 6,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: THEME.gold + '22', borderColor: THEME.gold + '66',
  },
  houseMoneyText: { fontFamily: FONTS.mono, fontSize: 8, color: THEME.gold, letterSpacing: 0.6 },
  posBreakdown: {
    paddingVertical: 6, paddingHorizontal: 4, gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: THEME.border,
    marginTop: 2,
  },
  posBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posBreakdownTotal: { marginTop: 2, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: THEME.border + '88' },
  posBreakdownLabel: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, letterSpacing: 0.4 },
  posBreakdownValue: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text },
  posBreakdownSub: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted },
  posToken: { fontFamily: FONTS.display, fontSize: 14, color: THEME.text, letterSpacing: 0.3 },
  pnlChip: {
    paddingVertical: 2, paddingHorizontal: 8,
    borderRadius: 999, borderWidth: 1,
  },
  pnlChipText: { fontFamily: FONTS.display, fontSize: 12, letterSpacing: -0.2 },
  posChart: { marginVertical: 2, alignItems: 'stretch' },
  posMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  posMeta: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  posMetaSep: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.border },

  emptyText: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, textAlign: 'center', paddingVertical: 8 },

  closedSection: { gap: 4, marginTop: 4 },
  closedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  closedEmoji: { fontSize: 12 },
  closedToken: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, flex: 1 },
  closedPnl: { fontFamily: FONTS.mono, fontSize: 11 },
  closedShareIcon: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, marginLeft: 4 },
});
