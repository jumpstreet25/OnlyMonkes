/**
 * BananaShopModal — Full-screen premium glassmorphic Banana Shop.
 *
 * Browse by tier/category, tap items to preview effects,
 * purchase with bananas + crypto ($SKR or $SOL via MWA).
 * Equip owned items, one per category (text is stackable).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Dimensions,
  Modal,
  StatusBar,
} from "react-native";
import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";
import { LinearGradient } from "expo-linear-gradient";
import { playSound } from "@/lib/sounds";
import { THEME, FONTS, DEV_WALLET } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { spendBananas, addBananas } from "@/lib/bananaRewards";
import { sendShopPaymentMulti, type ShopCurrency } from "@/lib/solana";
import { CurrencyPickerSheet } from "@/components/CurrencyPickerSheet";
import { WorldMiniPreview } from "@/components/worlds/WorldLayer";
import {
  getAvailableItems, loadShopState, saveShopState, addOwnedItem, equipItem, unequipCategory, unequipItem,
  getTierInfo, getCategoryName, getEquippedStyles, PURCHASE_DISCLAIMER, bindPfpItemToNft,
  type ShopItem, type ShopCategory, type ShopState,
} from "@/lib/bananaShop";
import { applyThemeFromShop } from "@/lib/shopTheme";
import { openCrate, getCrateCost, getRarityColor, type LootResult } from "@/lib/lootCrate";
import { triggerProfileRebroadcast } from "@/hooks/useXmtp";
import { isReceiptMintingAvailable, mintPurchaseReceipt } from "@/lib/cnftReceipts";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Get a human-readable effect summary for the preview popup. */
function getEffectSummary(item: ShopItem): string {
  switch (item.category) {
    case "bubble": {
      const color = item.style.glowColor as string | undefined;
      if (item.style.bgColor) return `Custom bubble background with ${color ?? "colored"} glow`;
      if (item.style.glassOpacity) return `Frosted glass bubble with ${color ?? "ice-blue"} glow`;
      return `${color ?? "Colored"} neon glow around all your messages`;
    }
    case "text": {
      if (item.style.nameColor) return `Your username displays in ${item.style.nameColor} in chat`;
      if (item.style.customTextColor) return "Pick any color from the wheel for your message text";
      if (item.style.fontWeight === "bold") return "All your messages render in bold weight";
      if (item.style.fontFamily === "mono") return "Messages use monospace font (JetBrains Mono)";
      if (item.style.textGlow) return "Your message text gets a soft luminous glow effect";
      return "Custom text styling for your messages";
    }
    case "pfp": {
      if (item.style.pfpThemeEnabled) return "Your NFT's dominant color tints your bubble border and glow";
      if (item.style.pfpAuraEnabled) return "Your PFP gets a colored aura using your NFT's palette";
      if (item.style.pfpFrame === "pulse") return "Animated pulsing ring appears around your avatar";
      if (item.style.pfpFrame === "glow") return "Constant soft glow ring around your avatar";
      return "Custom PFP styling";
    }
    case "theme": {
      if (item.style.pfpFullTheme) return "Your entire app UI uses colors derived from your NFT's palette";
      const accent = item.style.themeAccent as string | undefined;
      return `App-wide color scheme: background, surfaces, and accent (${accent ?? "custom"})`;
    }
    case "world": {
      const wid = item.style.worldId as string | undefined;
      if (wid === "world_banana_grove") return "Animated jungle backdrop with bananas drifting down behind your chat";
      if (wid === "world_solana_cyberpunk") return "Purple-to-teal Saga grid backdrop with a slow neon drift";
      if (wid === "world_trading_floor") return "Dark room with a candlestick chart layer drifting behind your messages";
      return item.description;
    }
    default: return item.description;
  }
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

const PRESETS = ["#FFD700", "#FF6B6B", "#00FFFF", "#FF69B4", "#39FF14", "#9945FF", "#6CB4EE", "#FF8C00", "#FFFFFF"];
const BRIGHTNESS_LEVELS = [
  { label: "Light", l: 75 },
  { label: "Normal", l: 55 },
  { label: "Vivid", l: 45 },
];

function ColorPickerSection({ currentColor, onColorChange }: { currentColor: string; onColorChange: (c: string) => void }) {
  const [hue, setHue] = useState(0);
  const [brightness, setBrightness] = useState(1);
  const [barWidth, setBarWidth] = useState(300);

  const handleBarPress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const h = Math.round((x / barWidth) * 360) % 360;
    setHue(h);
    onColorChange(hslToHex(h, 100, BRIGHTNESS_LEVELS[brightness].l));
  };

  return (
    <View style={colorStyles.section}>
      <View style={colorStyles.headerRow}>
        <Text style={colorStyles.label}>Your Text Color</Text>
        <View style={[colorStyles.preview, { backgroundColor: currentColor }]} />
      </View>
      <Pressable
        onPress={handleBarPress}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        style={colorStyles.barWrap}
      >
        <LinearGradient
          colors={["#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF", "#FF0000"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={colorStyles.gradient}
        />
        <View style={[colorStyles.thumb, { left: `${(hue / 360) * 100}%` }]} />
      </Pressable>
      <View style={colorStyles.brightnessRow}>
        {BRIGHTNESS_LEVELS.map((b, i) => (
          <Pressable
            key={b.label}
            style={[colorStyles.brightPill, brightness === i && colorStyles.brightPillActive]}
            onPress={() => { setBrightness(i); onColorChange(hslToHex(hue, 100, b.l)); }}
          >
            <Text style={[colorStyles.brightText, brightness === i && colorStyles.brightTextActive]}>{b.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PRESETS.map(c => (
            <Pressable
              key={c}
              style={[colorStyles.dot, { backgroundColor: c }, currentColor === c && colorStyles.dotActive]}
              onPress={() => onColorChange(c)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const colorStyles = StyleSheet.create({
  section: { marginBottom: 16, gap: 10, paddingHorizontal: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: FONTS.display, fontSize: 13, color: THEME.text },
  preview: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" },
  barWrap: {
    height: 36, borderRadius: 18, overflow: "hidden",
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.1)",
  },
  gradient: { flex: 1, borderRadius: 18 },
  thumb: {
    position: "absolute", top: 2, width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 2, borderColor: "#fff", marginLeft: -16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4,
  },
  brightnessRow: { flexDirection: "row", gap: 8 },
  brightPill: {
    flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
  },
  brightPillActive: { backgroundColor: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.3)" },
  brightText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  brightTextActive: { color: "#7C3AED" },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  dotActive: {
    borderColor: "#fff",
    shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
});

// ─── Preview Popup ────────────────────────────────────────────────────────────

interface PreviewPopupProps {
  item: ShopItem | null;
  owned: boolean;
  equipped: boolean;
  canAfford: boolean;
  onClose: () => void;
  onAction: () => void;
  purchasing: boolean;
}

function PreviewPopup({ item, owned, equipped, canAfford, onClose, onAction, purchasing }: PreviewPopupProps) {
  if (!item) return null;
  const { label: tierLabel, color: tierColor } = getTierInfo(item.tier);
  const catName = getCategoryName(item.category);

  // Build mock bubble styles based on item
  const mockBubbleStyle: any = {
    backgroundColor: "rgba(30,30,50,0.85)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  };
  const mockNameStyle: any = {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#9945FF",
    marginBottom: 4,
  };
  const mockTextStyle: any = {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.text,
  };
  let mockGlowStyle: any = {};

  // Apply item styles to mock
  if (item.category === "bubble") {
    if (item.style.glowColor) {
      mockGlowStyle = {
        shadowColor: item.style.glowColor as string,
        shadowOpacity: (item.style.glowOpacity as number) ?? 0.7,
        shadowRadius: (item.style.glowRadius as number) ?? 16,
        shadowOffset: { width: 0, height: 0 },
      };
      mockBubbleStyle.borderColor = (item.style.glowColor as string) + "50";
    }
    if (item.style.bgColor) mockBubbleStyle.backgroundColor = item.style.bgColor;
    if (item.style.glassOpacity) mockBubbleStyle.backgroundColor = `rgba(168,216,255,${item.style.glassOpacity})`;
  } else if (item.category === "text") {
    if (item.style.nameColor) mockNameStyle.color = item.style.nameColor as string;
    if (item.style.fontWeight) mockTextStyle.fontWeight = item.style.fontWeight as string;
    if (item.style.fontFamily === "mono") mockTextStyle.fontFamily = FONTS.mono;
    if (item.style.textGlow) {
      mockTextStyle.textShadowColor = "rgba(255,255,255,0.6)";
      mockTextStyle.textShadowOffset = { width: 0, height: 0 };
      mockTextStyle.textShadowRadius = 8;
    }
    if (item.style.customTextColor) {
      mockTextStyle.color = "#FFD700";
      mockNameStyle.color = THEME.text;
    }
  } else if (item.category === "pfp") {
    // Show a mock PFP circle with effect
    mockGlowStyle = {
      shadowColor: "#9945FF",
      shadowOpacity: 0.8,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
    };
  } else if (item.category === "theme") {
    const bg = item.style.themeBg as string | undefined;
    const surface = item.style.themeSurface as string | undefined;
    const accent = item.style.themeAccent as string | undefined;
    if (bg) mockBubbleStyle.backgroundColor = surface ?? bg;
    if (accent) {
      mockBubbleStyle.borderColor = accent + "40";
      mockNameStyle.color = accent;
      mockGlowStyle = {
        shadowColor: accent,
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
      };
    }
  }

  const usdLabel = `$${item.usdCost.toFixed(2)}`;
  const actionLabel = purchasing
    ? "Processing..."
    : equipped
      ? "Unequip"
      : owned
        ? "Equip"
        : canAfford
          ? `Buy — ${item.bananaCost} 🍌 + ${usdLabel}`
          : `Need ${item.bananaCost} 🍌`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={previewStyles.backdrop}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        <View style={previewStyles.dimLayer} />

        <View style={previewStyles.card}>
          <LinearGradient
            colors={["rgba(248,248,255,0.06)", "rgba(0,0,0,0.15)"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 24 }]}
          />
          {/* Top highlight */}
          <View style={previewStyles.highlight} />

          {/* Close */}
          <Pressable onPress={onClose} style={previewStyles.closeBtn} hitSlop={12}>
            <Text style={previewStyles.closeText}>✕</Text>
          </Pressable>

          {/* Header */}
          <Text style={previewStyles.itemName}>{item.name}</Text>
          <View style={previewStyles.metaRow}>
            <View style={[previewStyles.tierPill, { backgroundColor: tierColor + "18", borderColor: tierColor + "40" }]}>
              <Text style={[previewStyles.tierText, { color: tierColor }]}>{tierLabel}</Text>
            </View>
            <Text style={previewStyles.catLabel}>{catName}</Text>
            {item.seasonal && (
              <View style={previewStyles.limitedPill}>
                <Text style={previewStyles.limitedText}>LIMITED</Text>
              </View>
            )}
          </View>

          {/* Description */}
          <Text style={previewStyles.desc}>{item.description}</Text>
          <Text style={previewStyles.effectLabel}>What changes:</Text>
          <Text style={previewStyles.effectText}>{getEffectSummary(item)}</Text>

          {/* Live preview */}
          <Text style={previewStyles.previewLabel}>Preview</Text>
          <View style={previewStyles.previewArea}>
            {item.category === "pfp" ? (
              <View style={{ alignItems: "center", gap: 8 }}>
                <View style={[previewStyles.mockPfp, mockGlowStyle,
                  item.style.pfpFrame === "pulse" && { borderWidth: 2, borderColor: "#9945FF" },
                  item.style.pfpFrame === "glow" && { borderWidth: 2, borderColor: "#9945FF" },
                ]}>
                  <Text style={{ fontSize: 22 }}>🐒</Text>
                </View>
                <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted }}>
                  {item.style.pfpFrame === "pulse" ? "Ring pulses in/out" : item.style.pfpFrame === "glow" ? "Soft constant glow" : "NFT color aura"}
                </Text>
              </View>
            ) : item.category === "world" ? (
              <View style={{ alignItems: "center", gap: 8, width: "100%" }}>
                <WorldMiniPreview
                  worldId={(item.style.worldId as string) ?? item.id}
                  width={SCREEN_W * 0.7}
                  height={120}
                />
                <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: THEME.textMuted, textAlign: "center" }}>
                  Animated background renders behind your chat messages
                </Text>
              </View>
            ) : item.category === "theme" ? (
              <View style={{ gap: 8, width: "100%" }}>
                {/* Mini theme preview */}
                <View style={[previewStyles.themeMock, { backgroundColor: (item.style.themeBg as string) ?? THEME.bg }]}>
                  <View style={[previewStyles.themeHeader, { backgroundColor: (item.style.themeSurface as string) ?? THEME.surface }]}>
                    <Text style={[previewStyles.themeTitle, { color: (item.style.themeAccent as string) ?? THEME.accent }]}>
                      OnlyMonkes
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 6 }}>
                    <View style={[mockBubbleStyle, mockGlowStyle, { padding: 8, borderRadius: 10 }]}>
                      <Text style={[mockNameStyle, { fontSize: 10 }]}>MonkeUser</Text>
                      <Text style={[mockTextStyle, { fontSize: 10 }]}>gm monkes</Text>
                    </View>
                    <View style={[previewStyles.themeAccentBar, { backgroundColor: (item.style.themeAccent as string) ?? THEME.accent }]} />
                  </View>
                </View>
                {item.style.pfpFullTheme && (
                  <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: THEME.textMuted, textAlign: "center" }}>
                    Colors derived from your equipped NFT
                  </Text>
                )}
              </View>
            ) : (
              <View style={[mockBubbleStyle, mockGlowStyle, { alignSelf: "stretch" }]}>
                <Text style={mockNameStyle}>MonkeUser 🍌</Text>
                <Text style={mockTextStyle}>
                  {item.category === "text" && item.style.customTextColor
                    ? "Your messages in your chosen color"
                    : "gm monkes, wagmi"}
                </Text>
              </View>
            )}
          </View>

          {/* Action button */}
          <Pressable
            style={[
              previewStyles.actionBtn,
              equipped && previewStyles.actionBtnUnequip,
              !owned && !canAfford && previewStyles.actionBtnDisabled,
            ]}
            onPress={onAction}
            disabled={purchasing || (!owned && !canAfford)}
          >
            {purchasing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={previewStyles.actionText}>{actionLabel}</Text>
            )}
          </Pressable>

          {/* Price breakdown for unowned */}
          {!owned && (
            <Text style={previewStyles.priceBreakdown}>
              {item.bananaCost} 🍌 (engagement) + ${item.usdCost.toFixed(2)} (SOL · USDC · SKR — 10% off in SKR)
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const previewStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center" },
  dimLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  card: {
    width: SCREEN_W * 0.88,
    maxWidth: 380,
    backgroundColor: "rgba(12,12,22,0.94)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(248,248,255,0.10)",
    padding: 24,
    overflow: "hidden",
  },
  highlight: {
    position: "absolute", top: 0, left: 20, right: 20, height: 1.5,
    backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 1,
  },
  closeBtn: { position: "absolute", top: 16, right: 16, zIndex: 10 },
  closeText: { fontSize: 18, color: THEME.textMuted },
  itemName: { fontFamily: FONTS.display, fontSize: 22, color: THEME.text, marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  tierPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  tierText: { fontFamily: FONTS.mono, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  catLabel: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  limitedPill: { backgroundColor: "#EF4444", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  limitedText: { fontFamily: FONTS.mono, fontSize: 8, color: "#fff", fontWeight: "700" },
  desc: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, lineHeight: 18, marginBottom: 12 },
  effectLabel: { fontFamily: FONTS.displayMed, fontSize: 11, color: THEME.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 },
  effectText: { fontFamily: FONTS.body, fontSize: 12, color: THEME.text, lineHeight: 17, marginBottom: 16 },
  previewLabel: { fontFamily: FONTS.displayMed, fontSize: 11, color: THEME.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  previewArea: {
    backgroundColor: "rgba(10,10,15,0.6)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.04)",
    marginBottom: 20,
    alignItems: "center",
  },
  mockPfp: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(40,40,60,0.8)",
    alignItems: "center", justifyContent: "center",
  },
  themeMock: {
    borderRadius: 12, overflow: "hidden",
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
  },
  themeHeader: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  themeTitle: { fontFamily: FONTS.display, fontSize: 12 },
  themeAccentBar: { height: 3, borderRadius: 2, marginHorizontal: 10, marginBottom: 6 },
  actionBtn: {
    backgroundColor: "rgba(255,213,79,0.15)",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.3)",
  },
  actionBtnUnequip: {
    backgroundColor: "rgba(108,180,238,0.1)",
    borderColor: "rgba(108,180,238,0.25)",
  },
  actionBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.06)",
  },
  actionText: { fontFamily: FONTS.displayMed, fontSize: 14, color: "#FFD54F" },
  priceBreakdown: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint,
    textAlign: "center", marginTop: 10,
  },
});

// ─── Main Shop ────────────────────────────────────────────────────────────────

interface BananaShopModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BananaShopModal({ visible, onClose }: BananaShopModalProps) {
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const [shopState, setShopState] = useState<ShopState | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ShopCategory | "all">("all");
  const [customColor, setCustomColor] = useState(shopState?.customTextColor ?? "#FFD700");
  const [spinningCrate, setSpinningCrate] = useState(false);
  const [crateResult, setCrateResult] = useState<LootResult | null>(null);
  const [previewItem, setPreviewItem] = useState<ShopItem | null>(null);
  const [purchaseItem, setPurchaseItem] = useState<ShopItem | null>(null);

  useEffect(() => {
    if (visible) loadShopState().then(setShopState);
  }, [visible]);

  const items = useMemo(() => getAvailableItems(), []);

  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter(i => i.category === activeCategory);
  }, [items, activeCategory]);

  const groupedByTier = useMemo(() => {
    const tiers: Record<number, ShopItem[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const item of filteredItems) {
      (tiers[item.tier] ??= []).push(item);
    }
    return tiers;
  }, [filteredItems]);

  // Shared equip/unequip + purchase logic (used by both card tap and preview popup)
  const handleAction = useCallback(async (item: ShopItem) => {
    if (!shopState) return;
    if (shopState.owned.includes(item.id)) {
      // Already owned — equip/unequip
      const equipped = shopState.equipped[item.category];
      const isEquipped = Array.isArray(equipped) ? equipped.includes(item.id) : equipped === item.id;
      if (isEquipped) {
        const updated = Array.isArray(equipped)
          ? await unequipItem(item.id)
          : await unequipCategory(item.category);
        setShopState(updated);
        getEquippedStyles().then(s => {
          if (s.pfpAuraEnabled) s.pfpAuraColor = (s.glowColor as string) ?? useAppStore.getState().nftDominantColor ?? undefined;
          useAppStore.getState().setShopStyles(s);
          applyThemeFromShop(s);
          triggerProfileRebroadcast("").catch(() => {});
        }).catch(() => {});
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        const updated = await equipItem(item.id);
        setShopState(updated);
        getEquippedStyles().then(s => {
          if (s.pfpAuraEnabled) s.pfpAuraColor = (s.glowColor as string) ?? useAppStore.getState().nftDominantColor ?? undefined;
          useAppStore.getState().setShopStyles(s);
          applyThemeFromShop(s);
          triggerProfileRebroadcast("").catch(() => {});
        }).catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return;
    }

    // Dev wallet bypasses both banana check and crypto payment — for testing.
    // Production users still hit the full balance check below.
    const myWalletForCheck = useAppStore.getState().wallet?.address;
    const isDevForBananaCheck = myWalletForCheck === DEV_WALLET;

    if (!isDevForBananaCheck && bananaBalance < item.bananaCost) {
      Alert.alert("Not enough bananas", `You need ${item.bananaCost} 🍌 but have ${bananaBalance}. Keep logging in daily!`);
      return;
    }

    // All purchases go through the multi-currency picker (SOL / USDC / SKR).
    // Show disclaimer Alert once on first-ever purchase, then open picker.
    const isFirstPurchase = shopState.owned.length === 0;
    if (isFirstPurchase) {
      Alert.alert(
        `Buy ${item.name}?`,
        `${item.bananaCost} 🍌 + $${item.usdCost.toFixed(2)}\n\n${PURCHASE_DISCLAIMER}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: () => setPurchaseItem(item) },
        ],
      );
    } else {
      setPurchaseItem(item);
    }
  }, [shopState, bananaBalance]);

  const categories: Array<{ key: ShopCategory | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "bubble", label: "Bubbles" },
    { key: "text", label: "Text" },
    { key: "pfp", label: "PFP" },
    { key: "theme", label: "Themes" },
    { key: "world", label: "Worlds" },
  ];

  // Helper to check item state
  const getItemState = useCallback((item: ShopItem) => {
    const owned = shopState?.owned.includes(item.id) ?? false;
    const catEquipped = shopState?.equipped[item.category];
    const equipped = Array.isArray(catEquipped) ? catEquipped.includes(item.id) : catEquipped === item.id;
    const canAfford = bananaBalance >= item.bananaCost;
    return { owned, equipped, canAfford };
  }, [shopState, bananaBalance]);

  const previewState = previewItem ? getItemState(previewItem) : { owned: false, equipped: false, canAfford: false };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.fullRoot}>
        {/* Glass background */}
        <LinearGradient
          colors={["rgba(12,12,22,1)", "rgba(8,8,18,1)", "rgba(5,5,12,1)"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Subtle top gradient shimmer */}
        <LinearGradient
          colors={["rgba(255,213,79,0.06)", "rgba(255,213,79,0.02)", "transparent"]}
          style={styles.topShimmer}
        />

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>Banana Shop</Text>
            <Text style={styles.subtitle}>{items.length} customizations</Text>
          </View>
          <View style={styles.balancePill}>
            <Text style={styles.balanceText}>{bananaBalance} 🍌</Text>
          </View>
          {useAppStore.getState().wallet?.address === DEV_WALLET && (
            <View style={styles.devPill}>
              <Text style={styles.devPillText}>DEV</Text>
            </View>
          )}
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {categories.map(c => (
            <Pressable
              key={c.key}
              style={[styles.catPill, activeCategory === c.key && styles.catPillActive]}
              onPress={() => setActiveCategory(c.key)}
            >
              <Text style={[styles.catText, activeCategory === c.key && styles.catTextActive]}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>

          {/* Banana Chest */}
          {activeCategory === "all" && (
            <Pressable
              style={styles.crateCard}
              onPress={async () => {
                if (spinningCrate) return;
                const cost = getCrateCost();
                const crateWallet = useAppStore.getState().wallet?.address;
                const isDevCrate = crateWallet === DEV_WALLET;
                if (!isDevCrate && bananaBalance < cost) {
                  Alert.alert("Not enough bananas", `You need ${cost} 🍌 to open a Banana Chest.`);
                  return;
                }
                Alert.alert("Open Banana Chest?", `Spend ${cost} 🍌 for a random prize?\n\nPrizes: Banana bonus, 2x multiplier, free shop items, legendary exclusives!`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Open!", onPress: async () => {
                    setSpinningCrate(true);
                    if (!isDevCrate) {
                      const spent = await spendBananas(cost);
                      if (!spent) { setSpinningCrate(false); return; }
                      useAppStore.getState().setBananaBalance(bananaBalance - cost);
                    }
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    const result = await openCrate();
                    if (result.bananaBonus) {
                      await addBananas(result.bananaBonus);
                      useAppStore.getState().setBananaBalance(
                        (isDevCrate ? bananaBalance : bananaBalance - cost) + result.bananaBonus,
                      );
                    }
                    setCrateResult(result);
                    setSpinningCrate(false);
                    if (result.unlockedItemId) loadShopState().then(setShopState);
                  }},
                ]);
              }}
            >
              <LinearGradient
                colors={["rgba(255,213,79,0.08)", "rgba(255,213,79,0.02)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
              />
              <View style={styles.crateInner}>
                <Text style={{ fontSize: 28 }}>🎰</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.crateName}>Banana Chest</Text>
                  <Text style={styles.crateDesc}>Random prize — bonuses, items, or legendaries</Text>
                </View>
                <View style={styles.costPill}>
                  <Text style={styles.costText}>50 🍌</Text>
                </View>
              </View>
            </Pressable>
          )}

          {/* Crate result */}
          {crateResult && (
            <Pressable style={[styles.crateResultCard, { borderColor: getRarityColor(crateResult.rarity) + "60" }]} onPress={() => setCrateResult(null)}>
              <Text style={{ fontSize: 32 }}>{crateResult.emoji}</Text>
              <Text style={[styles.crateName, { color: getRarityColor(crateResult.rarity) }]}>{crateResult.title}</Text>
              <Text style={styles.crateDesc}>{crateResult.description}</Text>
              <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, marginTop: 4 }}>Tap to dismiss</Text>
            </Pressable>
          )}

          {/* Custom text color picker */}
          {(Array.isArray(shopState?.equipped.text) ? shopState.equipped.text.includes("text_custom_color") : shopState?.equipped.text === "text_custom_color") && (
            <ColorPickerSection
              currentColor={customColor}
              onColorChange={async (c: string) => {
                setCustomColor(c);
                const state = await loadShopState();
                state.customTextColor = c;
                await saveShopState(state);
                setShopState(state);
                getEquippedStyles().then(s => {
                  useAppStore.getState().setShopStyles(s);
                  triggerProfileRebroadcast("").catch(() => {});
                });
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            />
          )}

          {/* Item grid grouped by tier */}
          {([1, 2, 3, 4, 5] as number[]).map(tier => {
            const tierItems = groupedByTier[tier];
            if (!tierItems || tierItems.length === 0) return null;
            const { label, color } = getTierInfo(tier);

            return (
              <View key={tier} style={styles.tierSection}>
                <View style={styles.tierHeader}>
                  <View style={[styles.tierBadge, { backgroundColor: color + "15", borderColor: color + "35" }]}>
                    <Text style={[styles.tierBadgeText, { color }]}>{label}</Text>
                  </View>
                  <View style={styles.tierPriceWrap}>
                    <Text style={styles.tierPriceLabel}>
                      {tier === 5 ? "$4.99 · SOL/USDC/SKR" : `$${tier} · SOL/USDC/SKR`}
                    </Text>
                  </View>
                </View>

                <View style={styles.itemGrid}>
                  {tierItems.map(item => {
                    const { owned, equipped, canAfford } = getItemState(item);
                    const isBuying = purchasing === item.id;
                    const glowColor = item.style.glowColor as string | undefined;
                    const nameColor = item.style.nameColor as string | undefined;
                    const accent = item.style.themeAccent as string | undefined;

                    // Determine accent color for the card based on item type
                    const cardAccent = equipped ? "#FFD54F"
                      : owned ? "#6CB4EE"
                      : glowColor ?? nameColor ?? accent ?? color;

                    return (
                      <Pressable
                        key={item.id}
                        style={[
                          styles.itemCard,
                          { borderColor: owned ? cardAccent + "30" : "rgba(255,255,255,0.06)" },
                          equipped && {
                            borderColor: "#FFD54F50",
                            shadowColor: "#FFD54F",
                            shadowOffset: { width: 0, height: 0 },
                            shadowOpacity: 0.15,
                            shadowRadius: 12,
                            elevation: 4,
                          },
                        ]}
                        onPress={() => setPreviewItem(item)}
                        disabled={isBuying}
                      >
                        <LinearGradient
                          colors={
                            equipped
                              ? ["rgba(255,213,79,0.06)", "rgba(255,213,79,0.02)"]
                              : owned
                                ? ["rgba(108,180,238,0.04)", "rgba(108,180,238,0.01)"]
                                : ["rgba(255,255,255,0.03)", "rgba(255,255,255,0.01)"]
                          }
                          style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
                        />

                        {/* Seasonal badge */}
                        {item.seasonal && (
                          <View style={styles.seasonalBadge}>
                            <Text style={styles.seasonalText}>LIMITED</Text>
                          </View>
                        )}

                        {/* Color indicator strip */}
                        {glowColor && (
                          <View style={[styles.colorStrip, { backgroundColor: glowColor }]} />
                        )}
                        {nameColor && !glowColor && (
                          <View style={[styles.colorStrip, { backgroundColor: nameColor }]} />
                        )}
                        {accent && !glowColor && !nameColor && (
                          <View style={[styles.colorStrip, { backgroundColor: accent }]} />
                        )}

                        {/* Item info */}
                        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>

                        {/* Category pill */}
                        <View style={styles.itemCatPill}>
                          <Text style={styles.itemCatText}>{getCategoryName(item.category)}</Text>
                        </View>

                        {/* Price or status */}
                        {isBuying ? (
                          <ActivityIndicator size="small" color={color} style={{ marginTop: 6 }} />
                        ) : owned ? (
                          <View style={[styles.statusPill, equipped ? styles.equippedPill : styles.ownedPill]}>
                            <Text style={[styles.statusText, equipped ? { color: "#FFD54F" } : { color: "#6CB4EE" }]}>
                              {equipped ? "EQUIPPED" : "OWNED"}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.pricePill}>
                            <Text style={[styles.priceText, !canAfford && styles.priceTextDim]}>
                              {item.bananaCost} 🍌 + ${item.usdCost}
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Preview popup */}
      <PreviewPopup
        item={previewItem}
        owned={previewState.owned}
        equipped={previewState.equipped}
        canAfford={previewState.canAfford}
        purchasing={purchasing === previewItem?.id}
        onClose={() => setPreviewItem(null)}
        onAction={() => {
          if (!previewItem) return;
          const item = previewItem;
          // Always dismiss the preview first so any subsequent UI (disclaimer
          // Alert, currency picker, MWA prompt) sits at the top of the modal
          // stack — avoids the picker getting hidden behind the preview.
          setPreviewItem(null);
          // Defer handleAction by one frame so the preview's close animation
          // unmounts cleanly before the next modal opens.
          setTimeout(() => handleAction(item), 120);
        }}
      />

      {/* Multi-currency picker — used for all Tier 1-5 purchases */}
      <CurrencyPickerSheet
        visible={!!purchaseItem}
        usdCost={purchaseItem?.usdCost ?? 0}
        itemName={purchaseItem?.name ?? ""}
        onClose={() => setPurchaseItem(null)}
        onChoose={async (currency: ShopCurrency) => {
          const item = purchaseItem;
          if (!item || !shopState) return;
          setPurchaseItem(null);
          setPurchasing(item.id);
          try {
            const myWallet = useAppStore.getState().wallet?.address;
            const isDevWallet = myWallet && myWallet === DEV_WALLET;

            // Dev wallet skips banana spend AND crypto payment (test path).
            if (!isDevWallet) {
              const spent = await spendBananas(item.bananaCost);
              if (!spent) { Alert.alert("Error", "Failed to deduct bananas"); return; }
              useAppStore.getState().setBananaBalance(bananaBalance - item.bananaCost);

              try {
                await sendShopPaymentMulti(item.usdCost, currency);
              } catch (payErr: any) {
                await addBananas(item.bananaCost);
                useAppStore.getState().setBananaBalance(bananaBalance);
                throw new Error(`Payment failed: ${payErr?.message ?? "wallet rejected"}`);
              }
            }

            const updated = await addOwnedItem(item.id);
            updated.equipped[item.category] = item.id;
            await saveShopState(updated);
            setShopState(updated);

            // PFP-category items are bound to the currently equipped NFT mint
            if (item.category === "pfp") {
              const nftMint = useAppStore.getState().verifiedNft?.mint;
              if (nftMint) await bindPfpItemToNft(item.id, nftMint);
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            getEquippedStyles().then(s => {
              const ndc = useAppStore.getState().nftDominantColor;
              if (s.pfpAuraEnabled && ndc) s.pfpAuraColor = ndc;
              useAppStore.getState().setShopStyles(s);
              applyThemeFromShop(s);
              triggerProfileRebroadcast("").catch(() => {});
            }).catch(() => {});
            playSound("purchase");

            // Show success immediately — receipt minting runs in background.
            Alert.alert("Purchased!", `${item.name} is now equipped.`);

            // Auto-mint cNFT receipt as a permanent on-chain log entry tied
            // to the buyer wallet. Non-blocking, fail-silent: the purchase is
            // already recorded locally + via PROFILE_UPDATE broadcast, so a
            // failed mint never affects ownership.
            const walletAddr = useAppStore.getState().wallet?.address;
            if (isReceiptMintingAvailable() && walletAddr) {
              mintPurchaseReceipt(item, walletAddr)
                .then((result) => {
                  if (result.success) {
                    toast.success("On-chain receipt minted");
                  }
                  // Silent on failure — purchase is still safe via other channels
                })
                .catch(() => { /* silent */ });
            }
          } catch (err: any) {
            Alert.alert("Purchase failed", err?.message ?? "Please try again");
          } finally {
            setPurchasing(null);
            setPreviewItem(null);
          }
        }}
      />
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fullRoot: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  topShimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.08)",
  },
  backText: {
    fontSize: 18,
    color: THEME.text,
  },
  titleWrap: { flex: 1 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: "#FFD54F",
    textShadowColor: "rgba(255,213,79,0.35)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    marginTop: 1,
  },
  balancePill: {
    backgroundColor: "rgba(255,213,79,0.08)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.18)",
  },
  devPill: {
    marginLeft: 6,
    backgroundColor: "rgba(20,241,149,0.10)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 0.75,
    borderColor: "rgba(20,241,149,0.35)",
  },
  devPillText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#14F195",
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  balanceText: {
    fontFamily: FONTS.display,
    fontSize: 14,
    color: "#FFD54F",
  },

  // Category filter
  catRow: {
    maxHeight: 44,
    marginBottom: 12,
  },
  catPill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
    marginRight: 8,
  },
  catPillActive: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderColor: "rgba(255,213,79,0.25)",
  },
  catText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textMuted,
  },
  catTextActive: {
    color: "#FFD54F",
  },

  content: {
    flex: 1,
  },

  // Banana Chest
  crateCard: {
    borderRadius: 16,
    borderWidth: 0.75,
    borderColor: "rgba(255,213,79,0.15)",
    marginBottom: 16,
    overflow: "hidden",
  },
  crateInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  crateName: {
    fontFamily: FONTS.display,
    fontSize: 15,
    color: THEME.text,
  },
  crateDesc: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    marginTop: 2,
  },
  costPill: {
    backgroundColor: "rgba(255,213,79,0.12)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 0.75,
    borderColor: "rgba(255,213,79,0.2)",
  },
  costText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#FFD54F",
    fontWeight: "600",
  },
  crateResultCard: {
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(18,18,30,0.9)",
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    marginBottom: 16,
  },

  // Tier sections
  tierSection: {
    marginBottom: 24,
  },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  tierPriceWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  tierPriceLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
  },

  // Item grid
  itemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  itemCard: {
    width: (SCREEN_W - 42) / 2,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 14,
    borderWidth: 0.75,
    padding: 14,
    gap: 5,
    overflow: "hidden",
  },
  colorStrip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    opacity: 0.7,
  },
  seasonalBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#EF4444",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    zIndex: 2,
  },
  seasonalText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#fff",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  itemName: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.text,
    marginTop: 2,
  },
  itemDesc: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    lineHeight: 14,
  },
  itemCatPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  itemCatText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: THEME.textDim,
    letterSpacing: 0.3,
  },

  pricePill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,213,79,0.08)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    borderWidth: 0.75,
    borderColor: "rgba(255,213,79,0.12)",
  },
  priceText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#FFD54F",
    fontWeight: "600",
  },
  priceTextDim: {
    color: THEME.textFaint,
  },

  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
  ownedPill: {
    backgroundColor: "rgba(108,180,238,0.08)",
    borderWidth: 0.75,
    borderColor: "rgba(108,180,238,0.15)",
  },
  equippedPill: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderWidth: 0.75,
    borderColor: "rgba(255,213,79,0.2)",
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
