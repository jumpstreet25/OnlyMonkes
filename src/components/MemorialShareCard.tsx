/**
 * MemorialShareCard — shareable "In Memoriam" card for X, rendering every burnt Saga Monke on
 * one card, grouped by rarity tier (rarity computed by MonkeLedger across the whole 10,014-Monke
 * collection — see indexer.ts's computeRarity()).
 *
 * Pure RN Views + expo-linear-gradient, same as ShareablePnLCard/MonkeCloutCard — react-native-
 * view-shot captures this cleanly on Android; a Skia <Canvas> would come back black.
 *
 * Renders every item with flexWrap (no FlashList/ScrollView) so react-native-view-shot captures
 * the FULL content height in one shot, not just whatever's in the visible viewport.
 */
import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME, FONTS } from '@/lib/constants';
import type { BurntMonke, RarityTier } from '@/lib/nftVerification';

interface MemorialShareCardProps {
  monkes: BurntMonke[];
  width?: number;
}

const TIER_ORDER: RarityTier[] = ['Legendary', 'Rare', 'Uncommon', 'Common'];
const TIER_COLOR: Record<RarityTier, string> = {
  Legendary: '#FFD700',
  Rare: '#C084FC',
  Uncommon: '#60A5FA',
  Common: '#9CA3AF',
};

function groupByTier(monkes: BurntMonke[]): { tier: RarityTier | 'Unknown'; items: BurntMonke[] }[] {
  const groups = new Map<RarityTier | 'Unknown', BurntMonke[]>();
  for (const m of monkes) {
    const key = m.rarityTier ?? 'Unknown';
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  const order: (RarityTier | 'Unknown')[] = [...TIER_ORDER, 'Unknown'];
  return order
    .filter((t) => groups.has(t))
    .map((tier) => ({ tier, items: groups.get(tier)! }));
}

export const MemorialShareCard = forwardRef<View, MemorialShareCardProps>(
  ({ monkes, width = 400 }: MemorialShareCardProps, ref) => {
    const groups = groupByTier(monkes);
    const cols = 4;
    const gap = 10;
    const pad = 22;
    const thumbSize = (width - pad * 2 - gap * (cols - 1)) / cols;

    return (
      <View ref={ref} collapsable={false} style={[styles.outer, { width }]}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(6,6,14,0.98)', borderRadius: 24 }]} />
        <LinearGradient
          colors={['rgba(124,58,237,0.10)', 'rgba(8,8,18,0.97)', 'rgba(124,58,237,0.08)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 24 }]}
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(124,58,237,0.35)' }]}
        />

        <View style={{ padding: pad }}>
          {/* Header */}
          <View style={styles.headerWrap}>
            <Image
              source={require('../../assets/Header-transparent.png')}
              style={{ width: width * 0.6, height: width * 0.17 }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.title}>🪦 IN MEMORIAM 🪦</Text>
          <Text style={styles.subtitle}>
            {monkes.length} Saga Monke{monkes.length === 1 ? '' : 's'} Gone But Never Forgotten
          </Text>
          <View style={styles.hairline} />

          {groups.map(({ tier, items }) => (
            <View key={tier} style={styles.tierSection}>
              <View style={styles.tierHeaderRow}>
                <View style={[styles.tierDot, { backgroundColor: tier === 'Unknown' ? THEME.textDim : TIER_COLOR[tier] }]} />
                <Text style={[styles.tierLabel, { color: tier === 'Unknown' ? THEME.textDim : TIER_COLOR[tier] }]}>
                  {tier.toUpperCase()} · {items.length}
                </Text>
              </View>
              <View style={[styles.grid, { gap }]}>
                {items.map((m) => (
                  <View key={m.mint} style={{ width: thumbSize, alignItems: 'center' }}>
                    {m.image ? (
                      <Image source={{ uri: m.image }} style={[styles.thumb, { width: thumbSize, height: thumbSize }]} />
                    ) : (
                      <View style={[styles.thumb, styles.thumbFallback, { width: thumbSize, height: thumbSize }]}>
                        <Text style={{ fontSize: thumbSize * 0.45 }}>💀</Text>
                      </View>
                    )}
                    <Text style={styles.thumbLabel} numberOfLines={1}>
                      {m.number !== null ? `#${m.number}` : '?'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View style={styles.hairline} />
          <Text style={styles.epitaph}>Rest easy, homies. 🍌</Text>
        </View>

        <Image
          source={require('../../assets/watermark.png')}
          style={[styles.watermark, { width: width * 0.28, height: width * 0.28 * (1024 / 1536) }]}
          resizeMode="contain"
        />
      </View>
    );
  }
);

MemorialShareCard.displayName = 'MemorialShareCard';

const styles = StyleSheet.create({
  outer: { borderRadius: 24, overflow: 'hidden', backgroundColor: 'rgba(6,6,14,0.98)' },
  headerWrap: { alignItems: 'center', marginBottom: 6 },
  title: {
    fontFamily: FONTS.display, fontSize: 22, color: THEME.text,
    textAlign: 'center', letterSpacing: 1, marginTop: 4,
  },
  subtitle: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted,
    textAlign: 'center', marginTop: 6,
  },
  hairline: { height: 1, backgroundColor: THEME.border, opacity: 0.5, marginVertical: 16 },
  tierSection: { marginBottom: 18 },
  tierHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierLabel: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  thumb: { borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.12)' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbLabel: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textDim, marginTop: 4 },
  epitaph: {
    fontFamily: FONTS.mono, fontSize: 13, color: THEME.textMuted,
    textAlign: 'center', fontStyle: 'italic',
  },
  watermark: { position: 'absolute', bottom: 10, right: 14, opacity: 0.9 },
});
