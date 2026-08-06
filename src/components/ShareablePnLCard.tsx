/**
 * ShareablePnLCard — premium 4:5 portrait card for X / IG / Main Chat shares.
 *
 * Replaces the older square Skia card. Pure RN Views + expo-linear-gradient
 * so react-native-view-shot captures it cleanly (no GPU-surface readback
 * issue that black-fill'd the Skia version on Android).
 *
 * World-aware accent: getWorldAccent() pulls the gold/cream/cyan/green
 * tint matching the user's currently-equipped world.
 *
 * Sparkline intentionally omitted — Skia can't be captured reliably and the
 * big P&L number reads better as the visual hero at 1080px share width.
 */

import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME, FONTS, getWorldAccent } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import type { ClosedTrade } from '@/lib/positions';

interface ShareablePnLCardProps {
  trade: ClosedTrade;
  /** Card width in px. Card height = width * 1.25 (4:5 portrait). */
  width?: number;
  /** Trade is still open — labels CURRENT/AGE instead of EXIT/DURATION,
   *  state pill says LIVE instead of CLOSED. */
  isLive?: boolean;
}

const WIN_COLOR = THEME.gold;
const LOSS_COLOR = THEME.error;

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

function formatSol(amount: number, digits = 4): string {
  if (Math.abs(amount) >= 100) return amount.toFixed(2);
  if (Math.abs(amount) >= 1) return amount.toFixed(3);
  return amount.toFixed(digits);
}

export const ShareablePnLCard = forwardRef<View, ShareablePnLCardProps>(
  ({ trade, width = 360, isLive }: ShareablePnLCardProps, ref) => {
    const username = useAppStore(s => s.username);
    const wallet = useAppStore(s => s.wallet);
    const verifiedNft = useAppStore(s => s.verifiedNft);
    const shopStyles = useAppStore(s => s.shopStyles);
    // (2026-05-10) Bug fix: previous version read shopStyles.equipped.world
    // which never existed — every other consumer (ChatHeader, MenuDrawer,
    // ProfileScorecard, ChatInput, BotChannelScreen, MessageBubble,
    // WorldLayer) reads shopStyles.worldId. World tinting was silently dead.
    const worldId = (shopStyles?.worldId as string | undefined) ?? null;

    const isWin = trade.pnlPct >= 0;
    const accent = isWin ? WIN_COLOR : LOSS_COLOR;
    const sign = isWin ? '+' : '';

    const height = Math.round(width * 1.25); // 4:5 portrait

    const worldAccent = getWorldAccent(worldId);
    // Gradient: dark base + world tint (subtle) + accent glow (top-right)
    const gradColors: readonly [string, string, string] = [
      worldAccent + '14',
      'rgba(8,8,18,0.96)',
      accent + '16',
    ];

    const walletShort = wallet?.address
      ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
      : null;

    // (2026-05-10) User-identity color priority chain — same as MessageBubble
    // sender-name styling. Lets the card name read in the user's world tint
    // / glow color / custom name color, instead of plain white.
    const usernameColor =
      (shopStyles?.nameColor as string | undefined) ??
      (shopStyles?.glowColor as string | undefined) ??
      (worldId ? worldAccent : '#6CB4EE');

    // PFP for footer. Card is always the user's own trade, so verifiedNft
    // is the right source. Falls through to text-only footer if no NFT.
    const pfpUri = verifiedNft?.image ?? null;

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[styles.outer, { width, height }]}
      >
        {/* Layer 1: dark base */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(6,6,14,0.98)', borderRadius: 24 }]} />

        {/* Layer 2: world+accent gradient overlay */}
        <LinearGradient
          colors={gradColors}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 24 }]}
        />

        {/* Layer 3: top-right glow blob (matches accent — win=gold, loss=red) */}
        <View
          style={{
            position: 'absolute',
            top: -width * 0.15,
            right: -width * 0.12,
            width: width * 0.55,
            height: width * 0.55,
            borderRadius: width * 0.275,
            backgroundColor: accent + '14',
          }}
        />

        {/* Layer 4: 1px gradient border */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: 24, borderWidth: 1, borderColor: accent + '50' },
          ]}
        />

        {/* State pill — absolute top-right corner so the doubled logo can
            own the full width of the header row without crowding. */}
        <View
          style={[
            styles.statePill,
            { top: 14, right: 14, borderColor: accent + '80', backgroundColor: accent + '22' },
          ]}
        >
          <Text style={[styles.statePillText, { color: accent }]}>
            {isLive ? '● LIVE' : 'CLOSED'}
          </Text>
        </View>

        {/* Layer 5: content */}
        <View style={styles.content}>
          {/* Hero header — OnlyMonkes logo, doubled in size from the prior
              version (was width*0.42 × width*0.12; now width*0.84 × width*0.24)
              and centered as a full-width banner. */}
          <View style={styles.headerWrap}>
            <Image
              source={require('../../assets/Header-transparent.png')}
              style={{ width: width * 0.84, height: width * 0.24 }}
              resizeMode="contain"
            />
          </View>

          {/* Source tag — centered now that the logo owns the header. */}
          <Text style={[styles.sourceTag, { color: accent + 'CC' }]}>
            {trade.source === 'autonomonke' ? 'AUTONOMONKE' : 'MONKE TRADE'}
          </Text>

          {/* Hairline */}
          <View style={styles.hairline} />

          {/* Hero block — token + P&L% massive + P&L SOL */}
          <View style={styles.heroBlock}>
            <Text style={styles.token}>${trade.token.toUpperCase()}</Text>
            <Text style={[styles.pnlPct, { color: accent }]}>
              {sign}{trade.pnlPct.toFixed(2)}%
            </Text>
            <Text style={[styles.pnlSol, { color: accent + 'DD' }]}>
              {isWin ? '↑ ' : '↓ '}{sign}{formatSol(trade.pnlSol)} SOL
            </Text>
          </View>

          <View style={styles.hairline} />

          {/* Stats — Entry / Current-or-Exit / Age-or-Duration */}
          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>ENTRY</Text>
              <Text style={styles.statValue}>{formatSol(trade.entrySolAmount)}</Text>
              <Text style={styles.statSub}>SOL</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>{isLive ? 'CURRENT' : 'EXIT'}</Text>
              <Text style={styles.statValue}>{formatSol(trade.exitSolAmount)}</Text>
              <Text style={styles.statSub}>SOL</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>{isLive ? 'AGE' : 'DURATION'}</Text>
              <Text style={styles.statValue}>{formatDuration(trade.durationMs)}</Text>
              <Text style={styles.statSub}>{isLive ? 'open' : 'held'}</Text>
            </View>
          </View>

          <View style={styles.spacer} />

          {/* Footer — PFP + username (in user's identity color) + wallet. */}
          <View style={styles.footerRow}>
            {pfpUri ? (
              <View style={[styles.pfpRing, { borderColor: usernameColor }]}>
                <Image source={{ uri: pfpUri }} style={styles.pfpImg} />
              </View>
            ) : null}
            <View style={styles.footerTextCol}>
              {username && (
                <Text style={[styles.username, { color: usernameColor }]} numberOfLines={1}>
                  @{username}
                </Text>
              )}
              {walletShort && <Text style={styles.walletAddr}>{walletShort}</Text>}
            </View>
          </View>
        </View>

        {/* 2026-07-30: "Shot using OnlyMonkes" watermark — was only ever
            shown in the share-sheet modal's header chrome (outside the
            capture area), so it never actually made it into the exported
            share image. Baking it in here, bottom-right, matches every
            other watermarked share surface in the app (chat images, video,
            camera preview). */}
        <Image
          source={require('../../assets/watermark.png')}
          style={[styles.watermark, { width: width * 0.3, height: width * 0.3 * (1024 / 1536) }]}
          resizeMode="contain"
        />
      </View>
    );
  }
);

ShareablePnLCard.displayName = 'ShareablePnLCard';

const styles = StyleSheet.create({
  outer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(6,6,14,0.98)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    justifyContent: 'space-between',
  },
  // Header is now a single centered logo banner (size doubled). State pill
  // moved to an absolute corner overlay so it doesn't compete for width.
  headerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  statePill: {
    position: 'absolute',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 2,
  },
  statePillText: {
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  sourceTag: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 6,
    textAlign: 'center',
  },
  hairline: {
    height: 1,
    backgroundColor: THEME.border,
    opacity: 0.5,
    marginVertical: 14,
  },
  heroBlock: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  token: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: THEME.text,
    letterSpacing: 1,
    marginBottom: 6,
  },
  pnlPct: {
    fontFamily: FONTS.display,
    fontSize: 56,
    letterSpacing: -1,
    lineHeight: 60,
  },
  pnlSol: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 4,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: THEME.border,
  },
  statLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textMuted,
    letterSpacing: 1,
  },
  statValue: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: THEME.text,
    letterSpacing: -0.2,
  },
  statSub: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textMuted,
  },
  spacer: { flex: 1 },
  // Footer is now PFP + name/wallet column, left-aligned. The watermark on
  // the right was dropped — the doubled header banner already carries the
  // OnlyMonkes brand.
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pfpRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pfpImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  footerTextCol: {
    flex: 1,
    gap: 2,
  },
  username: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  walletAddr: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 0.5,
  },
  watermark: {
    position: 'absolute',
    bottom: 10,
    right: 14,
    opacity: 0.9,
  },
});
