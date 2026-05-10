import React, { forwardRef, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { ConfettiView } from '@/components/ConfettiView';
import type { ClosedTrade } from '@/lib/positions';

interface PnLCardProps {
  trade: ClosedTrade;
  width?: number;
  showConfetti?: boolean;
  /** When true, the trade is still open — relabel EXIT→CURRENT, DURATION→AGE,
   *  and add a small LIVE pill so users don't misread "Exit" as a real close. */
  isLive?: boolean;
}

const WIN_COLOR = THEME.gold;
const LOSS_COLOR = THEME.error;
const WIN_THRESHOLD_PCT = 5;

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
  if (amount >= 100) return amount.toFixed(2);
  if (amount >= 1) return amount.toFixed(3);
  return amount.toFixed(digits);
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * RN-only re-implementation of the original Skia glass background. The Skia
 * version rendered to a GPU surface that react-native-view-shot couldn't
 * read back on Android — every captured PnL card came out solid black/brown.
 * This version uses expo-linear-gradient + plain Views and captures cleanly.
 *
 * Visual components, layered bottom→top:
 *   1. Solid dark base                                 (rgba(6,6,14,0.96))
 *   2. Diagonal glow→white→shadow gradient              (top-left→bot-right)
 *   3. Soft glow blob in the top-right corner          (rounded view, blur via shadow)
 *   4. Smaller white highlight inside the glow blob
 *   5. Top-edge specular sweep                         (horizontal gradient strip)
 *   6. Bottom darkening                                 (vertical gradient on lower 35%)
 *   7. 1-px gradient border                            (color-shifting outline)
 */
function GlassBg({ width, height, glowColor }: { width: number; height: number; glowColor: string }) {
  if (width <= 0 || height <= 0) return null;
  const r = 24;
  const minDim = Math.min(width, height);

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { borderRadius: r, overflow: 'hidden', backgroundColor: 'rgba(6,6,14,0.96)' },
      ]}
    >
      {/* 2. Diagonal gradient overlay */}
      <LinearGradient
        colors={[glowColor + '12', 'rgba(255,255,255,0.02)', 'rgba(0,0,0,0.18)']}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* 3 + 4. Top-right glow blob with inner highlight */}
      <View
        style={{
          position: 'absolute',
          top: height * 0.18 - minDim * 0.32,
          left: width * 0.78 - minDim * 0.32,
          width: minDim * 0.64,
          height: minDim * 0.64,
          borderRadius: minDim * 0.32,
          backgroundColor: glowColor + '14',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: height * 0.14 - minDim * 0.08,
          left: width * 0.82 - minDim * 0.08,
          width: minDim * 0.16,
          height: minDim * 0.16,
          borderRadius: minDim * 0.08,
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      />

      {/* 5. Top-edge specular sweep */}
      <LinearGradient
        colors={['transparent', glowColor + '24', 'rgba(255,255,255,0.20)', glowColor + '24', 'transparent']}
        locations={[0.05, 0.25, 0.5, 0.75, 0.95]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', top: 0, left: 0, width, height: 2 }}
      />

      {/* 6. Bottom darkening */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.28)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', bottom: 0, left: 0, width, height: height * 0.35 }}
      />

      {/* 7. Gradient border (drawn on top via 1-px overlay rings) */}
      <View
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          borderRadius: r,
          borderWidth: 1,
          borderColor: glowColor + '40',
        }}
      />
    </View>
  );
}

export const PnLCard = forwardRef<View, PnLCardProps>(({ trade, width = 320, showConfetti, isLive }: PnLCardProps, ref) => {
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const username = useAppStore(s => s.username);
  const [confettiKey, setConfettiKey] = useState(0);

  const isWin = trade.pnlPct >= 0;
  const isBigWin = trade.pnlPct >= WIN_THRESHOLD_PCT;
  const glow = isWin ? WIN_COLOR : LOSS_COLOR;
  const wantsConfetti = showConfetti ?? isBigWin;

  const height = Math.round(width * 1.0);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.outer, { width, height }]}
    >
      <GlassBg width={width} height={height} glowColor={glow} />

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>🍌 ONLYMONKES</Text>
          <Text style={[styles.sourceTag, { color: glow + 'CC' }]}>
            {trade.source === 'autonomonke' ? 'AUTONOMONKE' : 'MONKE TRADE'}
          </Text>
        </View>

        <View style={styles.userRow}>
          <View style={[styles.pfpRing, { borderColor: glow + '66' }]}>
            {verifiedNft?.image ? (
              <Image source={{ uri: verifiedNft.image }} style={styles.pfp} />
            ) : (
              <View style={[styles.pfp, styles.pfpFallback]}><Text style={{ fontSize: 18 }}>🐒</Text></View>
            )}
          </View>
          <Text style={styles.username} numberOfLines={1}>{username ?? 'Monke'}</Text>
        </View>

        <View style={styles.pnlBlock}>
          <Text style={[styles.pnlPct, { color: glow }]}>
            {isWin ? '↑ ' : '↓ '}{formatPct(trade.pnlPct)}
          </Text>
          <Text style={[styles.token, { borderColor: glow + '40' }]}>
            ${trade.token.toUpperCase()}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>ENTRY</Text>
            <Text style={styles.statValue}>{formatSol(trade.entrySolAmount)} SOL</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>{isLive ? 'CURRENT' : 'EXIT'}</Text>
            <Text style={styles.statValue}>{formatSol(trade.exitSolAmount)} SOL</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>{isLive ? 'AGE' : 'DURATION'}</Text>
            <Text style={styles.statValue}>{formatDuration(trade.durationMs)}</Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.pnlSol}>
            {trade.pnlSol >= 0 ? '+' : ''}{formatSol(trade.pnlSol)} SOL
          </Text>
        </View>
      </View>

      {wantsConfetti && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ConfettiView key={confettiKey} onDone={() => setConfettiKey(k => k + 1)} />
        </View>
      )}
    </View>
  );
});

PnLCard.displayName = 'PnLCard';

const styles = StyleSheet.create({
  outer: { borderRadius: 24, overflow: 'hidden' },
  content: { flex: 1, padding: 20, justifyContent: 'space-between' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: FONTS.display, fontSize: 11, letterSpacing: 2, color: THEME.text },
  sourceTag: { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.5 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pfpRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, overflow: 'hidden' },
  pfp: { width: 40, height: 40, borderRadius: 20 },
  pfpFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  username: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.text, flex: 1 },
  pnlBlock: { alignItems: 'center', gap: 10 },
  pnlPct: { fontFamily: FONTS.display, fontSize: 52, letterSpacing: -1.5, textAlign: 'center' },
  token: {
    fontFamily: FONTS.mono, fontSize: 16, color: THEME.text, letterSpacing: 1,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statCol: { flex: 1, alignItems: 'center', gap: 4 },
  statLabel: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: THEME.textMuted },
  statValue: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.text },
  footerRow: { alignItems: 'center' },
  pnlSol: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.text },
});
