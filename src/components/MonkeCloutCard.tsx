/**
 * MonkeCloutCard — shareable 4:5 portrait card for a user's Monke Clout
 * standing, for X / IG / Main Chat shares.
 *
 * Modeled directly on ShareablePnLCard.tsx: pure RN Views + expo-linear-
 * gradient (no Skia — react-native-view-shot captures this cleanly, unlike
 * the GPU-surface readback issues Skia canvases hit on Android).
 */

import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME, FONTS, getWorldAccent } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { getRankDisplay, getCloutTier, type CloutProfile } from '@/lib/monkeClout';

interface MonkeCloutCardProps {
  profile: CloutProfile;
  /** Card width in px. Card height = width * 1.25 (4:5 portrait). */
  width?: number;
}

const ACCENT = THEME.gold;

export const MonkeCloutCard = forwardRef<View, MonkeCloutCardProps>(
  ({ profile, width = 360 }: MonkeCloutCardProps, ref) => {
    const wallet = useAppStore(s => s.wallet);
    const verifiedNft = useAppStore(s => s.verifiedNft);
    const shopStyles = useAppStore(s => s.shopStyles);
    const worldId = (shopStyles?.worldId as string | undefined) ?? null;

    const height = Math.round(width * 1.25); // 4:5 portrait

    const worldAccent = getWorldAccent(worldId);
    const gradColors: readonly [string, string, string] = [
      worldAccent + '14',
      'rgba(8,8,18,0.96)',
      ACCENT + '16',
    ];

    const walletShort = wallet?.address
      ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
      : null;

    const usernameColor =
      (shopStyles?.nameColor as string | undefined) ??
      (shopStyles?.glowColor as string | undefined) ??
      (worldId ? worldAccent : '#6CB4EE');

    const pfpUri = verifiedNft?.image ?? null;
    const tier = getCloutTier(profile.cloutScore);
    const rankDisplay = getRankDisplay(profile.rank);

    return (
      <View ref={ref} collapsable={false} style={[styles.outer, { width, height }]}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(6,6,14,0.98)', borderRadius: 24 }]} />

        <LinearGradient
          colors={gradColors}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 24 }]}
        />

        <View
          style={{
            position: 'absolute',
            top: -width * 0.15,
            right: -width * 0.12,
            width: width * 0.55,
            height: width * 0.55,
            borderRadius: width * 0.275,
            backgroundColor: ACCENT + '14',
          }}
        />

        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: 24, borderWidth: 1, borderColor: ACCENT + '50' },
          ]}
        />

        {profile.flair && (
          <View style={[styles.statePill, { top: 14, right: 14, borderColor: ACCENT + '80', backgroundColor: ACCENT + '22' }]}>
            <Text style={[styles.statePillText, { color: ACCENT }]}>{profile.flair.toUpperCase()}</Text>
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.headerWrap}>
            <Image
              source={require('../../assets/Header-transparent.png')}
              style={{ width: width * 0.84, height: width * 0.24 }}
              resizeMode="contain"
            />
          </View>

          <Text style={[styles.sourceTag, { color: ACCENT + 'CC' }]}>MONKE CLOUT</Text>

          <View style={styles.hairline} />

          <View style={styles.heroBlock}>
            <Text style={styles.rankBig}>{rankDisplay}</Text>
            <Text style={[styles.cloutScore, { color: ACCENT }]}>{profile.cloutScore}</Text>
            <Text style={[styles.tierName, { color: ACCENT + 'DD' }]}>{tier}</Text>
          </View>

          <View style={styles.hairline} />

          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>STREAK</Text>
              <Text style={styles.statValue}>{profile.streakDays}</Text>
              <Text style={styles.statSub}>days</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>CYCLES</Text>
              <Text style={styles.statValue}>{profile.totalCycles}</Text>
              <Text style={styles.statSub}>completed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>ACTIVITY</Text>
              <Text style={styles.statValue}>{profile.messagesThisWeek}</Text>
              <Text style={styles.statSub}>msgs/wk</Text>
            </View>
          </View>

          <View style={styles.spacer} />

          <View style={styles.footerRow}>
            {pfpUri ? (
              <View style={[styles.pfpRing, { borderColor: usernameColor }]}>
                <Image source={{ uri: pfpUri }} style={styles.pfpImg} />
              </View>
            ) : null}
            <View style={styles.footerTextCol}>
              <Text style={[styles.username, { color: usernameColor }]} numberOfLines={1}>
                @{profile.username}
              </Text>
              {walletShort && <Text style={styles.walletAddr}>{walletShort}</Text>}
            </View>
          </View>
        </View>
      </View>
    );
  }
);

MonkeCloutCard.displayName = 'MonkeCloutCard';

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
  rankBig: {
    fontFamily: FONTS.display,
    fontSize: 30,
    marginBottom: 4,
  },
  cloutScore: {
    fontFamily: FONTS.display,
    fontSize: 56,
    letterSpacing: -1,
    lineHeight: 60,
  },
  tierName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
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
});
