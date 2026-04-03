/**
 * BananaShopModal — In-app UI customization store.
 *
 * Browse by tier/category, see items with preview images,
 * purchase with bananas + crypto ($SKR or $SOL via MWA).
 * Equip owned items, one per category.
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
} from "react-native";
import * as Haptics from "expo-haptics";
import { playSound } from "@/lib/sounds";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS, DEV_WALLET, SKR_MINT } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { spendBananas, addBananas } from "@/lib/bananaRewards";
import { sendShopPayment } from "@/lib/solana";
import {
  getAvailableItems, loadShopState, saveShopState, addOwnedItem, equipItem, unequipCategory,
  getTierInfo, getCategoryName, getEquippedStyles, PURCHASE_DISCLAIMER, bindPfpItemToNft,
  type ShopItem, type ShopCategory, type ShopState,
} from "@/lib/bananaShop";
import { applyThemeFromShop } from "@/lib/shopTheme";
import { triggerProfileRebroadcast, sendRawToGroup } from "@/hooks/useXmtp";

/** Fetch SOL/USD price with Jupiter → CoinGecko fallback. */
async function fetchSolPrice(): Promise<number> {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const TIMEOUT = 6000;

  // Try Jupiter Price API v2
  try {
    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), TIMEOUT);
    const r1 = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`, { signal: c1.signal });
    clearTimeout(t1);
    if (r1.ok) {
      const d1 = await r1.json() as any;
      const p1 = parseFloat(d1?.data?.[SOL_MINT]?.price ?? "0");
      if (p1 > 0) return p1;
    }
  } catch { /* fall through */ }

  // Fallback: CoinGecko simple price (free, no auth)
  try {
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), TIMEOUT);
    const r2 = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: c2.signal },
    );
    clearTimeout(t2);
    if (r2.ok) {
      const d2 = await r2.json() as any;
      const p2 = parseFloat(d2?.solana?.usd ?? "0");
      if (p2 > 0) return p2;
    }
  } catch { /* fall through */ }

  throw new Error("Could not fetch SOL price — check your connection and try again");
}

interface BananaShopModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BananaShopModal({ visible, onClose }: BananaShopModalProps) {
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const [shopState, setShopState] = useState<ShopState | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ShopCategory | "all">("all");

  useEffect(() => {
    if (visible) loadShopState().then(setShopState);
  }, [visible]);

  const items = useMemo(() => getAvailableItems(), []);

  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter(i => i.category === activeCategory);
  }, [items, activeCategory]);

  // Group by tier
  const groupedByTier = useMemo(() => {
    const tiers: Record<number, ShopItem[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const item of filteredItems) {
      (tiers[item.tier] ??= []).push(item);
    }
    return tiers;
  }, [filteredItems]);

  const handlePurchase = useCallback(async (item: ShopItem) => {
    if (!shopState) return;
    if (shopState.owned.includes(item.id)) {
      // Already owned — equip/unequip
      if (shopState.equipped[item.category] === item.id) {
        const updated = await unequipCategory(item.category);
        setShopState(updated);
        getEquippedStyles().then(s => { if (s.pfpAuraEnabled) { s.pfpAuraColor = (s.glowColor as string) ?? useAppStore.getState().nftDominantColor ?? undefined; } useAppStore.getState().setShopStyles(s); applyThemeFromShop(s); triggerProfileRebroadcast("").catch(() => {}); }).catch(() => {});
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        const updated = await equipItem(item.id);
        setShopState(updated);
        getEquippedStyles().then(s => { if (s.pfpAuraEnabled) { s.pfpAuraColor = (s.glowColor as string) ?? useAppStore.getState().nftDominantColor ?? undefined; } useAppStore.getState().setShopStyles(s); applyThemeFromShop(s); triggerProfileRebroadcast("").catch(() => {}); }).catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return;
    }

    // Check banana balance
    if (bananaBalance < item.bananaCost) {
      Alert.alert(
        "Not enough bananas",
        `You need ${item.bananaCost} 🍌 but have ${bananaBalance}. Keep logging in daily!`,
      );
      return;
    }

    // Confirm purchase with disclaimer
    const isFirstPurchase = shopState.owned.length === 0;
    const disclaimerText = isFirstPurchase ? `\n\n${PURCHASE_DISCLAIMER}` : "";
    Alert.alert(
      `Buy ${item.name}?`,
      `${item.bananaCost} 🍌 + $${item.usdCost} in SOL\n\nYou'll sign a wallet transaction to complete.${disclaimerText}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Buy Now",
          onPress: async () => {
            setPurchasing(item.id);
            try {
              // 1. Deduct bananas
              const spent = await spendBananas(item.bananaCost);
              if (!spent) {
                Alert.alert("Error", "Failed to deduct bananas");
                return;
              }
              useAppStore.getState().setBananaBalance(bananaBalance - item.bananaCost);

              // 2. MWA payment — transfer SOL to DEV_WALLET (skip for dev wallet owner)
              const myWallet = useAppStore.getState().wallet?.address;
              const isDevWallet = myWallet && myWallet === DEV_WALLET;

              if (!isDevWallet) {
                try {
                  const solPrice = await fetchSolPrice();
                  await sendShopPayment(item.usdCost, solPrice);
                } catch (payErr: any) {
                  await addBananas(item.bananaCost);
                  useAppStore.getState().setBananaBalance(bananaBalance);
                  throw new Error(`Payment failed: ${payErr?.message ?? "wallet rejected"}`);
                }
              }

              // 3. Mark item as owned + equip it
              const updated = await addOwnedItem(item.id);
              updated.equipped[item.category] = item.id;
              await saveShopState(updated);
              setShopState(updated);

              // 4. Bind PFP items to the currently equipped NFT mint
              if (item.category === "pfp") {
                const nftMint = useAppStore.getState().verifiedNft?.mint;
                if (nftMint) await bindPfpItemToNft(item.id, nftMint);
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              // Refresh shop styles so MessageBubble updates immediately
              getEquippedStyles().then(s => {
                // Inject PFP aura color so other users can render the glow
                const ndc = useAppStore.getState().nftDominantColor;
                if (s.pfpAuraEnabled && ndc) s.pfpAuraColor = ndc;
                useAppStore.getState().setShopStyles(s);
                applyThemeFromShop(s);
                triggerProfileRebroadcast("").catch(() => {});
              }).catch(() => {});
              // Notify bot of purchase (filtered from chat display)
              const buyerName = useAppStore.getState().username ?? "Unknown";
              sendRawToGroup(`SHOP_PURCHASE:${buyerName}:${item.name}`).catch(() => {});
              playSound("purchase");
              Alert.alert("Purchased!", `${item.name} is now equipped.`);
            } catch (err: any) {
              Alert.alert("Purchase failed", err?.message ?? "Please try again");
            } finally {
              setPurchasing(null);
            }
          },
        },
      ],
    );
  }, [shopState, bananaBalance]);

  const categories: Array<{ key: ShopCategory | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "bubble", label: "Bubbles" },
    { key: "text", label: "Text" },
    { key: "pfp", label: "PFP" },
    { key: "theme", label: "Themes" },
  ];

  return (
    <GlassModal
      visible={visible}
      onClose={onClose}
      position="bottom"
      animationType="slide"
      cardStyle={{ height: Dimensions.get("window").height * 0.75 }}
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Banana Shop</Text>
          <View style={styles.balancePill}>
            <Text style={styles.balanceText}>{bananaBalance} 🍌</Text>
          </View>
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
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

        {/* Items */}
        <ScrollView style={[styles.content, { flex: 1 }]} showsVerticalScrollIndicator={false}>
          {([1, 2, 3, 4] as number[]).map(tier => {
            const tierItems = groupedByTier[tier];
            if (!tierItems || tierItems.length === 0) return null;
            const { label, color } = getTierInfo(tier);

            return (
              <View key={tier} style={styles.tierSection}>
                <View style={styles.tierHeader}>
                  <View style={[styles.tierBadge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
                    <Text style={[styles.tierBadgeText, { color }]}>{label}</Text>
                  </View>
                  <Text style={styles.tierPrice}>${tier} in SKR or SOL</Text>
                </View>

                <View style={styles.itemGrid}>
                  {tierItems.map(item => {
                    const owned = shopState?.owned.includes(item.id);
                    const equipped = shopState?.equipped[item.category] === item.id;
                    const canAfford = bananaBalance >= item.bananaCost;
                    const isBuying = purchasing === item.id;

                    return (
                      <Pressable
                        key={item.id}
                        style={[
                          styles.itemCard,
                          owned && styles.itemCardOwned,
                          equipped && styles.itemCardEquipped,
                        ]}
                        onPress={() => handlePurchase(item)}
                        disabled={isBuying}
                      >
                        {/* Seasonal badge */}
                        {item.seasonal && (
                          <View style={styles.seasonalBadge}>
                            <Text style={styles.seasonalText}>LIMITED</Text>
                          </View>
                        )}

                        <Text style={styles.itemPreview}>{item.preview}</Text>
                        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>

                        {/* Price or status */}
                        {isBuying ? (
                          <ActivityIndicator size="small" color={color} style={{ marginTop: 6 }} />
                        ) : owned ? (
                          <View style={[styles.statusPill, equipped ? styles.equippedPill : styles.ownedPill]}>
                            <Text style={styles.statusText}>
                              {equipped ? "EQUIPPED" : "OWNED — Tap to equip"}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.pricePill}>
                            <Text style={[styles.priceText, !canAfford && styles.priceTextDim]}>
                              {item.bananaCost} 🍌
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

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#6CB4EE",
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: "#FFD54F",
    textShadowColor: "rgba(255,213,79,0.4)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  balancePill: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.2)",
  },
  balanceText: {
    fontFamily: FONTS.display,
    fontSize: 14,
    color: "#FFD54F",
  },

  // Category filter
  catRow: {
    paddingHorizontal: 12,
    maxHeight: 44,
    marginBottom: 8,
  },
  catPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginRight: 8,
  },
  catPillActive: {
    backgroundColor: "rgba(255,213,79,0.12)",
    borderColor: "rgba(255,213,79,0.3)",
  },
  catText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: THEME.textMuted,
  },
  catTextActive: {
    color: "#FFD54F",
  },

  content: {
    flex: 1,
    paddingHorizontal: 12,
  },

  // Tier section
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
  tierPrice: {
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
    width: "47%",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  itemCardOwned: {
    borderColor: "rgba(108,180,238,0.2)",
    backgroundColor: "rgba(108,180,238,0.04)",
  },
  itemCardEquipped: {
    borderColor: "rgba(255,213,79,0.35)",
    backgroundColor: "rgba(255,213,79,0.06)",
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  seasonalBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#EF4444",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  seasonalText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#fff",
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  itemPreview: {
    fontSize: 32,
  },
  itemName: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.text,
    textAlign: "center",
  },
  itemDesc: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    textAlign: "center",
    lineHeight: 14,
  },

  pricePill: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  priceText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#FFD54F",
    fontWeight: "600",
  },
  priceTextDim: {
    color: THEME.textFaint,
  },

  statusPill: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  ownedPill: {
    backgroundColor: "rgba(108,180,238,0.1)",
  },
  equippedPill: {
    backgroundColor: "rgba(255,213,79,0.15)",
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#FFD54F",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
