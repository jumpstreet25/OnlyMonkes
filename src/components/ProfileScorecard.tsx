/**
 * ProfileScorecard — Premium glassmorphic profile card for the Community drawer.
 *
 * Shows: PFP (with Skia glow), username, wallet, location, stats grid,
 * earned milestones, and edit button.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Canvas, RoundedRect, BlurMask, LinearGradient, Group, Rect, vec } from "@shopify/react-native-skia";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile } from "@/lib/userProfile";
import { getEarnedBadges, getBadgeDef } from "@/lib/badges";
import { loadBananaState, type BananaState } from "@/lib/bananaRewards";
import { THEME, FONTS } from "@/lib/constants";

interface ProfileScorecardProps {
  onEditProfile: () => void;
  onPressPfp?: () => void;
}

// Skia glass card background
function SkiaGlassCard({ width, height }: { width: number; height: number }) {
  if (width <= 0 || height <= 0) return null;
  const pad = 4;
  const r = 20;
  const x = pad;
  const y = pad;
  const w = width;
  const h = height;

  return (
    <Canvas style={{ width: w + pad * 2, height: h + pad * 2, position: "absolute", top: -pad, left: -pad }} pointerEvents="none">
      {/* Subtle outer glow */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color="rgba(153, 69, 255, 0.20)">
        <BlurMask blur={12} style="normal" />
      </RoundedRect>
      {/* Glass body */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color="rgba(14, 14, 26, 0.85)" />
      {/* Glass gradient */}
      <Group clip={{ rect: { x, y, width: w, height: h }, rx: r, ry: r }}>
        <Rect x={x} y={y} width={w} height={h}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + w, y + h)}
            colors={["rgba(153,69,255,0.08)", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.08)"]}
            positions={[0, 0.35, 1]}
          />
        </Rect>
        {/* Top highlight */}
        <Rect x={x} y={y} width={w} height={2}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + w, y)}
            colors={["transparent", "rgba(153,69,255,0.15)", "rgba(255,255,255,0.12)", "rgba(153,69,255,0.15)", "transparent"]}
            positions={[0.05, 0.25, 0.5, 0.75, 0.95]}
          />
        </Rect>
        {/* Bottom depth */}
        <Rect x={x} y={y + h * 0.6} width={w} height={h * 0.4}>
          <LinearGradient
            start={vec(x + w / 2, y + h * 0.6)}
            end={vec(x + w / 2, y + h)}
            colors={["transparent", "rgba(0,0,0,0.15)"]}
          />
        </Rect>
      </Group>
      {/* Border */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color="transparent" style="stroke" strokeWidth={0.75}>
        <LinearGradient
          start={vec(x, y)}
          end={vec(x + w, y + h)}
          colors={["rgba(153,69,255,0.20)", "rgba(153,69,255,0.08)", "rgba(255,255,255,0.03)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
}

export function ProfileScorecard({ onEditProfile, onPressPfp }: ProfileScorecardProps) {
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const username = useAppStore(s => s.username);
  const xAccount = useAppStore(s => s.xAccount);
  const myInboxId = useAppStore(s => s.myInboxId);
  const wallet = useAppStore(s => s.wallet);
  const location = useAppStore(s => s.location);
  const loginStreak = useAppStore(s => s.loginStreak);
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const shopStyles = useAppStore(s => s.shopStyles);
  const isLegendary = useAppStore(s => s.isLegendary);

  const [bananaState, setBananaState] = useState<BananaState | null>(null);
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    loadBananaState().then(setBananaState).catch(() => {});
  }, []);

  const badgeIds = getEarnedBadges();
  const badges = badgeIds.map(id => getBadgeDef(id)).filter(Boolean);
  const walletShort = wallet?.address
    ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`
    : null;

  const handleCopyWallet = () => {
    if (wallet?.address) {
      Clipboard.setStringAsync(wallet.address);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const ownedItems = shopStyles.isShopCustomer ? "Yes" : "No";

  return (
    <View
      style={s.card}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(cardSize.w - width) > 1 || Math.abs(cardSize.h - height) > 1) {
          setCardSize({ w: width, h: height });
        }
      }}
    >
      {/* Skia glass background */}
      {cardSize.w > 0 && <SkiaGlassCard width={cardSize.w} height={cardSize.h} />}

      {/* ── Top row: PFP + info + edit ── */}
      <View style={s.topRow}>
        <Pressable onPress={onPressPfp} hitSlop={6}>
          <View style={s.pfpWrap}>
            {verifiedNft?.image ? (
              <Image source={{ uri: verifiedNft.image }} style={s.pfp} />
            ) : (
              <View style={[s.pfp, s.pfpFallback]}>
                <Text style={{ fontSize: 24 }}>🐒</Text>
              </View>
            )}
          </View>
        </Pressable>

        <View style={s.info}>
          <Text style={s.username} numberOfLines={1}>
            {username ?? "Monke"}{isLegendary ? " 🌟" : ""}{shopStyles.isShopCustomer ? " 🍌" : ""}
          </Text>
          {xAccount ? <Text style={s.xHandle} numberOfLines={1}>@{xAccount}</Text> : null}
          {walletShort ? (
            <Pressable onPress={handleCopyWallet} style={s.walletRow}>
              <Text style={s.wallet}>{walletShort} 📋</Text>
            </Pressable>
          ) : null}
          {location ? <Text style={s.location} numberOfLines={1}>📍 {location}</Text> : null}
        </View>

        <Pressable onPress={onEditProfile} style={s.editBtn} hitSlop={8}>
          <Text style={s.editBtnText}>✏️</Text>
        </Pressable>
      </View>

      {/* ── Stats grid ── */}
      <View style={s.statsGrid}>
        <View style={s.statItem}>
          <Text style={s.statValue}>{bananaState?.totalEarned ?? bananaBalance}</Text>
          <Text style={s.statLabel}>🍌 Earned</Text>
        </View>
        <View style={s.statItem}>
          <Text style={s.statValue}>{loginStreak ?? 0}</Text>
          <Text style={s.statLabel}>🔥 Streak</Text>
        </View>
        <View style={s.statItem}>
          <Text style={s.statValue}>{badges.length}</Text>
          <Text style={s.statLabel}>⭐ Badges</Text>
        </View>
        <View style={s.statItem}>
          <Text style={s.statValue}>{bananaState?.totalCycles ?? 0}</Text>
          <Text style={s.statLabel}>🔄 Cycles</Text>
        </View>
      </View>

      {/* ── Milestones ── */}
      {badges.length > 0 && (
        <View style={s.milestones}>
          {badges.map((b) => (
            <View key={b!.id} style={s.milestonePill}>
              <Text style={s.milestoneText}>{b!.emoji} {b!.name}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginBottom: 12,
    borderRadius: 20,
    padding: 16,
    overflow: "visible",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  pfpWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(153, 69, 255, 0.3)",
    overflow: "hidden",
  },
  pfp: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  pfpFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(153, 69, 255, 0.1)",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  username: {
    fontFamily: FONTS.displayMed,
    fontSize: 17,
    color: THEME.text,
  },
  xHandle: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: "#6CB4EE",
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  wallet: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
  },
  location: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(153, 69, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(153, 69, 255, 0.15)",
  },
  editBtnText: {
    fontSize: 16,
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.05)",
  },
  statValue: {
    fontFamily: FONTS.displayMed,
    fontSize: 18,
    color: THEME.text,
  },
  statLabel: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 2,
  },
  milestones: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  milestonePill: {
    backgroundColor: "rgba(153, 69, 255, 0.10)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: "rgba(153, 69, 255, 0.15)",
  },
  milestoneText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: "#C4A0FF",
  },
});
