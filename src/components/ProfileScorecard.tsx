/**
 * ProfileScorecard — Black glassmorphic profile card with Skia 3D glass.
 *
 * Uses the same Skia glow + glass treatment as premium chat bubbles.
 * Glow color follows the user's equipped shop cosmetic.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";
import { Canvas, RoundedRect, BlurMask, LinearGradient, Group, Rect, Circle, vec } from "@shopify/react-native-skia";
import { useAppStore } from "@/store/appStore";
import { getEarnedBadges, getBadgeDef } from "@/lib/badges";
import { loadBananaState, type BananaState } from "@/lib/bananaRewards";
import { getShieldExpiry, daysUntilNextPurchase, purchaseShield, SHIELD_COST_BANANAS } from "@/lib/streakShield";
import { THEME, FONTS } from "@/lib/constants";

interface ProfileScorecardProps {
  onEditProfile: () => void;
  onPressPfp?: () => void;
  onClose?: () => void;
}

const SOLANA_PURPLE = "#9945FF";

// Skia 3D glass card — same treatment as premium chat bubbles
function SkiaGlassCard({ width, height, glowColor }: { width: number; height: number; glowColor: string }) {
  if (width <= 0 || height <= 0) return null;
  const pad = 20;
  const r = 20;
  const x = pad;
  const y = pad;
  const w = width;
  const h = height;
  const minDim = Math.min(w, h);

  return (
    <Canvas style={{ width: w + pad * 2, height: h + pad * 2, position: "absolute", top: -pad, left: -pad }} pointerEvents="none">
      {/* Outer glow */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color={glowColor + "30"}>
        <BlurMask blur={16} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color={glowColor + "18"}>
        <BlurMask blur={8} style="normal" />
      </RoundedRect>

      {/* Glass body — dark */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color="rgba(6, 6, 14, 0.94)" />

      {/* Interior effects */}
      <Group clip={{ rect: { x, y, width: w, height: h }, rx: r, ry: r }}>
        {/* Base tint */}
        <Rect x={x} y={y} width={w} height={h}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + w, y + h)}
            colors={[glowColor + "0C", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.10)"]}
            positions={[0, 0.35, 1]}
          />
        </Rect>

        {/* Sun-spot glare */}
        <Circle cx={x + w * 0.25} cy={y + h * 0.15} r={minDim * 0.25} color={glowColor + "10"}>
          <BlurMask blur={minDim * 0.15} style="normal" />
        </Circle>
        <Circle cx={x + w * 0.22} cy={y + h * 0.12} r={minDim * 0.08} color="rgba(255,255,255,0.06)">
          <BlurMask blur={minDim * 0.06} style="normal" />
        </Circle>

        {/* Top rim */}
        <Rect x={x} y={y} width={w} height={2}>
          <LinearGradient
            start={vec(x, y)} end={vec(x + w, y)}
            colors={["transparent", glowColor + "18", "rgba(255,255,255,0.15)", glowColor + "18", "transparent"]}
            positions={[0.05, 0.2, 0.5, 0.8, 0.95]}
          />
        </Rect>

        {/* Bottom depth */}
        <Rect x={x} y={y + h * 0.6} width={w} height={h * 0.4}>
          <LinearGradient
            start={vec(x + w / 2, y + h * 0.6)} end={vec(x + w / 2, y + h)}
            colors={["transparent", "rgba(0,0,0,0.20)"]}
          />
        </Rect>
      </Group>

      {/* Border */}
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color="transparent" style="stroke" strokeWidth={0.75}>
        <LinearGradient
          start={vec(x, y)} end={vec(x + w, y + h)}
          colors={[glowColor + "22", glowColor + "0A", "rgba(255,255,255,0.03)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
}

export function ProfileScorecard({ onEditProfile, onPressPfp, onClose }: ProfileScorecardProps) {
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const username = useAppStore(s => s.username);
  const xAccount = useAppStore(s => s.xAccount);
  const wallet = useAppStore(s => s.wallet);
  const location = useAppStore(s => s.location);
  const loginStreak = useAppStore(s => s.loginStreak);
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const shopStyles = useAppStore(s => s.shopStyles);
  const isLegendary = useAppStore(s => s.isLegendary);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);

  const [bananaState, setBananaState] = useState<BananaState | null>(null);
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const [shieldExpiry, setShieldExpiry] = useState<string | null>(null);
  const [shieldCooldown, setShieldCooldown] = useState<number>(0);
  const [shieldBuying, setShieldBuying] = useState(false);

  useEffect(() => { loadBananaState().then(setBananaState).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [exp, cd] = await Promise.all([getShieldExpiry(), daysUntilNextPurchase()]);
      if (!alive) return;
      setShieldExpiry(exp);
      setShieldCooldown(cd);
    };
    refresh();
    return () => { alive = false; };
  }, []);

  const handleBuyShield = async () => {
    if (shieldBuying) return;
    setShieldBuying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const res = await purchaseShield();
    if (res.ok) {
      const [exp, cd] = await Promise.all([getShieldExpiry(), daysUntilNextPurchase()]);
      setShieldExpiry(exp);
      setShieldCooldown(cd);
      toast.success("🛡️ Streak Shield active");
    } else {
      toast.error(res.reason);
    }
    setShieldBuying(false);
  };

  const badgeIds = getEarnedBadges();
  const badges = badgeIds.map(id => getBadgeDef(id)).filter(Boolean);
  const walletShort = wallet?.address ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : null;

  // Use shop glow color → NFT dominant color → Solana purple
  const glowColor = (shopStyles.glowColor as string) ?? nftDominantColor ?? SOLANA_PURPLE;
  const pfpRingColor = shopStyles.pfpAuraEnabled ? (nftDominantColor ?? glowColor) : glowColor;

  const handleCopyWallet = () => {
    if (wallet?.address) {
      Clipboard.setStringAsync(wallet.address);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toast.success("Copied to clipboard");
    }
  };

  return (
    <View
      style={st.card}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(cardSize.w - width) > 1 || Math.abs(cardSize.h - height) > 1) {
          setCardSize({ w: width, h: height });
        }
      }}
    >
      {cardSize.w > 0 && <SkiaGlassCard width={cardSize.w} height={cardSize.h} glowColor={glowColor} />}

      {/* Top-right: Edit + Close buttons */}
      <View style={st.topActions}>
        <Pressable onPress={onEditProfile} style={st.actionBtn} hitSlop={8}>
          <Text style={[st.actionIcon, { fontFamily: FONTS.body }]}>✎</Text>
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={st.actionBtn} hitSlop={8}>
            <Text style={[st.actionIcon, { fontFamily: FONTS.body }]}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Profile row */}
      <View style={st.topRow}>
        <Pressable onPress={onPressPfp} hitSlop={6}>
          <View style={[st.pfpWrap, { borderColor: pfpRingColor + "50" }]}>
            {verifiedNft?.image ? (
              <Image source={{ uri: verifiedNft.image }} style={st.pfp} />
            ) : (
              <View style={[st.pfp, st.pfpFallback]}><Text style={{ fontSize: 24 }}>🐒</Text></View>
            )}
          </View>
        </Pressable>

        <View style={st.info}>
          <Text style={st.username} numberOfLines={1}>
            {username ?? "Monke"}{isLegendary ? " 🌟" : ""}{shopStyles.isShopCustomer ? " 🍌" : ""}
          </Text>
          {verifiedNft?.name ? <Text style={st.sub} numberOfLines={1}>{verifiedNft.name}</Text> : null}
          {xAccount ? <Text style={st.sub} numberOfLines={1}>@{xAccount}</Text> : null}
          {walletShort ? (
            <Pressable onPress={handleCopyWallet} style={{ flexDirection: "row" }}>
              <Text style={st.wallet}>{walletShort} 📋</Text>
            </Pressable>
          ) : null}
          {location ? <Text style={st.sub} numberOfLines={1}>📍 {location}</Text> : null}
          {bananaState && bananaState.totalCycles > 0 ? (
            <Text style={st.sub}>🐒 {bananaState.totalCycles * 7}+ days active</Text>
          ) : null}
        </View>
      </View>

      {/* Stats */}
      <View style={st.statsGrid}>
        {[
          { val: bananaState?.totalEarned ?? bananaBalance, label: "🍌 Earned" },
          { val: loginStreak ?? 0, label: "🔥 Streak" },
          { val: badges.length, label: "⭐ Badges" },
          { val: bananaState?.totalCycles ?? 0, label: "🔄 Cycles" },
        ].map((s, i) => (
          <View key={i} style={st.statItem}>
            <Text style={st.statValue}>{s.val}</Text>
            <Text style={st.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Streak Shield — Discord-style loss aversion */}
      {(loginStreak ?? 0) >= 2 && (
        shieldExpiry ? (
          <View style={[st.shieldRow, { borderColor: glowColor + "33" }]}>
            <Text style={st.shieldText}>🛡️ Shield active through {shieldExpiry}</Text>
          </View>
        ) : (
          <Pressable
            onPress={handleBuyShield}
            disabled={shieldBuying || shieldCooldown > 0 || (bananaBalance ?? 0) < SHIELD_COST_BANANAS}
            style={({ pressed }) => [
              st.shieldRow,
              {
                borderColor: glowColor + "55",
                opacity: shieldBuying || shieldCooldown > 0 || (bananaBalance ?? 0) < SHIELD_COST_BANANAS ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={st.shieldText}>
              {shieldCooldown > 0
                ? `🛡️ Shield cooldown — ${shieldCooldown}d`
                : `🛡️ Buy Streak Shield · ${SHIELD_COST_BANANAS} 🍌`}
            </Text>
          </Pressable>
        )
      )}

      {/* NFT Traits */}
      {verifiedNft?.traits && verifiedNft.traits.length > 0 && (
        <View style={st.traitsSection}>
          <Text style={st.traitsTitle}>NFT Traits</Text>
          <View style={st.traitsGrid}>
            {verifiedNft.traits.slice(0, 6).map((t, i) => (
              <View key={i} style={[st.traitPill, { borderColor: glowColor + "15" }]}>
                <Text style={st.traitType}>{t.trait_type}</Text>
                <Text style={st.traitValue}>{t.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Milestones */}
      {badges.length > 0 && (
        <View style={st.milestones}>
          {badges.map(b => (
            <View key={b!.id} style={[st.pill, { borderColor: glowColor + "18" }]}>
              <Text style={st.pillText}>{b!.emoji} {b!.name}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginBottom: 12, marginTop: 18, borderRadius: 20, padding: 16, overflow: "visible" },
  topActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 6 },
  actionBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionIcon: { fontSize: 15, color: "#777", fontWeight: "400" as const },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  pfpWrap: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, overflow: "hidden" },
  pfp: { width: 52, height: 52, borderRadius: 26 },
  pfpFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  info: { flex: 1, gap: 2 },
  username: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text },
  sub: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  wallet: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  statsGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, gap: 6 },
  statItem: { flex: 1, alignItems: "center", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 12, paddingVertical: 8, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.04)" },
  statValue: { fontFamily: FONTS.displayMed, fontSize: 18, color: THEME.text },
  statLabel: { fontFamily: FONTS.body, fontSize: 10, color: THEME.textMuted, marginTop: 2 },
  shieldRow: { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.5, marginBottom: 12, alignItems: "center" },
  shieldText: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.text, letterSpacing: 0.3 },
  milestones: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 0.5 },
  pillText: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted },
  traitsSection: { marginTop: 12, gap: 6 },
  traitsTitle: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted, marginBottom: 2 },
  traitsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  traitPill: { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 0.5, minWidth: "28%" as any },
  traitType: { fontFamily: FONTS.mono, fontSize: 8, color: THEME.textFaint, textTransform: "uppercase", letterSpacing: 0.5 },
  traitValue: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.text, marginTop: 1 },
});
