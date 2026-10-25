/**
 * ChatSidebar — website, wide screens: Discord-style channel column beside
 * Main Chat in place of the Banana Menu popup (ChatScreen). Same destinations
 * as the menu's tiles (MenuDrawer.tsx); the menu's own panels (leaderboard,
 * events, images, links, tools) open straight into that panel via onOpenView.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { FONTS } from "@/lib/constants";
import { useThemeColor } from "@/lib/shopTheme";
import { useAppStore } from "@/store/appStore";
import { MenuIcon, type MenuIconName } from "@/components/MenuIcon";
import { BananaShopModal } from "@/components/BananaShopModal";
import { getMonkeMemeConfig, monkeMemeVisible, type MonkeMemeConfig } from "@/lib/monkeMeme/config";

export const SIDEBAR_WIDTH = 248;
/** Half-screen windows: icon rail with the name under each icon. */
export const SIDEBAR_COMPACT_WIDTH = 76;

/** MenuDrawer's own panels the sidebar can open directly. */
export type SidebarPanel = "leaderboard" | "events" | "images" | "links" | "tools";

interface Item {
  key: string;
  label: string;
  /** Shorter name for the compact rail. */
  short?: string;
  icon: MenuIconName;
  onPress: () => void;
  badge?: number;
  active?: boolean;
}

export function ChatSidebar({ totalDmUnread, onOpenPanel, onEditProfile, compact = false }: {
  totalDmUnread: number;
  onOpenPanel: (panel: SidebarPanel) => void;
  onEditProfile: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const bg = useThemeColor("surface");
  const border = useThemeColor("border");
  const text = useThemeColor("text");
  const muted = useThemeColor("textMuted");
  const hover = useThemeColor("surfaceHigh");
  const accent = useThemeColor("accent");
  const gold = useThemeColor("gold");

  const username = useAppStore((s) => s.username);
  const pfp = useAppStore((s) => s.verifiedNft?.image ?? null);
  const bananaBalance = useAppStore((s) => s.bananaBalance);
  const isGenesisHolder = useAppStore((s) => s.isGenesisHolder);
  const communityBadges = useAppStore((s) => s.communityBadges);
  const isGroupAdmin = useAppStore((s) => s.isGroupAdmin);
  const wallet = useAppStore((s) => s.wallet?.address ?? null);
  const [memeCfg, setMemeCfg] = useState<MonkeMemeConfig | null>(null);
  useEffect(() => { getMonkeMemeConfig().then(setMemeCfg).catch(() => {}); }, []);
  const [shopOpen, setShopOpen] = useState(false);

  const go = (path: string) => () => router.push(path as any);
  const sections: { title: string; items: Item[] }[] = [
    {
      title: t("sidebar.chats"),
      items: [
        { key: "main", label: t("sidebar.mainChat"), short: t("sidebar.mainShort"), icon: "speech", onPress: () => {}, active: true },
        ...(isGenesisHolder ? [{ key: "genesis", label: t("sidebar.genesisChat"), short: "Genesis", icon: "gem" as MenuIconName, onPress: () => router.replace("/genesis-chat" as any) }] : []),
        {
          key: "dms", label: t("sidebar.dms"), short: "DMs", icon: "messages", badge: totalDmUnread,
          onPress: () => { useAppStore.getState().clearCommunityBadge("dms"); router.push("/dms" as any); },
        },
        { key: "trades", label: "MonkeTrades", short: "Trades", icon: "target", onPress: go("/bot-channel?channelId=trades") },
      ],
    },
    {
      title: t("sidebar.community"),
      items: [
        { key: "leaderboard", label: t("menuDrawer.leaderboard"), short: t("sidebar.leadersShort"), icon: "leaderboard", onPress: () => onOpenPanel("leaderboard") },
        {
          key: "events", label: t("menuDrawer.events"), icon: "events", badge: communityBadges?.events,
          onPress: () => { useAppStore.getState().clearCommunityBadge("events"); onOpenPanel("events"); },
        },
        { key: "images", label: t("menuDrawer.images"), icon: "images", onPress: () => onOpenPanel("images") },
        {
          key: "links", label: t("menuDrawer.links"), icon: "links", badge: communityBadges?.links,
          onPress: () => { useAppStore.getState().clearCommunityBadge("links"); onOpenPanel("links"); },
        },
        { key: "globe", label: t("menuDrawer.globe"), icon: "globe", onPress: go("/globe") },
        { key: "invite", label: t("menuDrawer.invite"), icon: "confetti", onPress: go("/invite-friends") },
      ],
    },
    {
      title: t("sidebar.trading"),
      items: [
        { key: "markets", label: "MonkeMarkets", short: "Markets", icon: "monkemarkets", onPress: go("/marketplace") },
        { key: "portfolio", label: t("menuDrawer.portfolio"), icon: "portfolio", onPress: go("/portfolio") },
        { key: "treasury", label: "OnlyTreasury", short: "Treasury", icon: "gem", onPress: go("/treasury") },
        { key: "watchlist", label: t("menuDrawer.watchlist"), icon: "watchlist", onPress: go("/watchlist") },
      ],
    },
    {
      title: t("sidebar.create"),
      items: [
        ...(monkeMemeVisible(memeCfg, isGroupAdmin, wallet) ? [{ key: "meme", label: t("menuDrawer.monkeMeme"), icon: "monkeface" as MenuIconName, onPress: go("/monkememe") }] : []),
        { key: "3d", label: "3D Monke", icon: "monkeface", onPress: go("/monke3d") },
      ],
    },
    {
      title: t("sidebar.more"),
      items: [
        { key: "tools", label: t("menuDrawer.monkeTools"), short: t("sidebar.toolsShort"), icon: "monketools", onPress: () => onOpenPanel("tools") },
        { key: "settings", label: t("menuDrawer.settings"), icon: "settings", onPress: go("/settings") },
        { key: "memorial", label: t("menuDrawer.memorial"), icon: "star", onPress: go("/memorial") },
      ],
    },
  ];

  if (compact) {
    return (
      <View style={[styles.rail, styles.railCompact, { backgroundColor: bg, borderRightColor: border }]}>
        <Pressable
          onPress={onEditProfile}
          style={({ hovered }: any) => [styles.cTop, { borderBottomColor: border }, hovered && { backgroundColor: hover }]}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.editProfile")}
        >
          {pfp ? <Image source={{ uri: pfp }} style={styles.pfp} /> : <View style={[styles.pfp, { backgroundColor: hover }]} />}
        </Pressable>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.cScrollContent} showsVerticalScrollIndicator={false}>
          {sections.filter((s) => s.items.length > 0).map((section, si) => (
            <View key={section.title} style={[styles.cSection, si > 0 && { borderTopColor: border, borderTopWidth: 1 }]}>
              {section.items.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={item.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: !!item.active }}
                  style={({ hovered, pressed }: any) => [
                    styles.cItem,
                    (hovered || pressed || item.active) && { backgroundColor: hover },
                  ]}
                >
                  <View>
                    <MenuIcon name={item.icon} size={22} color={item.active ? text : muted} />
                    {item.badge ? (
                      <View style={[styles.badge, styles.cBadge, { backgroundColor: accent }]}>
                        <Text style={styles.badgeText}>{item.badge > 99 ? "99+" : item.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.cLabel, { color: item.active ? text : muted }]} numberOfLines={1}>
                    {item.short ?? item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => setShopOpen(true)}
          style={({ hovered }: any) => [styles.cMe, { borderTopColor: border }, hovered && { backgroundColor: hover }]}
          accessibilityRole="button"
          accessibilityLabel={`${bananaBalance} bananas, open the Banana Shop`}
        >
          <Text style={styles.cBanana}>🍌</Text>
          <Text style={[styles.cBananaCount, { color: gold }]} numberOfLines={1}>{bananaBalance}</Text>
        </Pressable>
        <BananaShopModal visible={shopOpen} onClose={() => setShopOpen(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.rail, { backgroundColor: bg, borderRightColor: border }]}>
      <View style={[styles.top, { borderBottomColor: border }]}>
        <Pressable
          onPress={onEditProfile}
          style={({ hovered }: any) => [styles.meTop, hovered && { backgroundColor: hover }]}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.editProfile")}
        >
          {pfp ? <Image source={{ uri: pfp }} style={styles.pfp} /> : <View style={[styles.pfp, { backgroundColor: hover }]} />}
          <Text style={[styles.meName, { color: text }]} numberOfLines={1}>{username || "Monke"}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShopOpen(true)}
          style={({ hovered }: any) => [styles.bananaPill, { borderColor: border }, hovered && { backgroundColor: hover }]}
          accessibilityRole="button"
          accessibilityLabel={`${bananaBalance} bananas, open the Banana Shop`}
        >
          <Text style={[styles.bananaText, { color: gold }]}>{bananaBalance} 🍌</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {sections.filter((s) => s.items.length > 0).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: muted }]}>{section.title}</Text>
            {section.items.map((item) => (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityState={{ selected: !!item.active }}
                style={({ hovered, pressed }: any) => [
                  styles.item,
                  (hovered || pressed) && { backgroundColor: hover },
                  item.active && { backgroundColor: hover },
                ]}
              >
                <MenuIcon name={item.icon} size={18} color={item.active ? text : muted} />
                <Text style={[styles.itemLabel, { color: item.active ? text : muted }, item.active && styles.itemLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.badge ? (
                  <View style={[styles.badge, { backgroundColor: accent }]}>
                    <Text style={styles.badgeText}>{item.badge > 99 ? "99+" : item.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      <BananaShopModal visible={shopOpen} onClose={() => setShopOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: SIDEBAR_WIDTH, height: "100%", borderRightWidth: 1, flexDirection: "column" },
  top: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderBottomWidth: 1, gap: 8 },
  meTop: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 8 },
  bananaPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  bananaText: { fontFamily: FONTS.bodySemi, fontSize: 13, fontVariant: ["tabular-nums"] },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: 10, paddingHorizontal: 8, gap: 14 },
  section: { gap: 2 },
  sectionTitle: { fontFamily: FONTS.bodySemi, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 8, paddingBottom: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, height: 34, paddingHorizontal: 8, borderRadius: 6 },
  itemLabel: { flex: 1, fontFamily: FONTS.bodyMed, fontSize: 14 },
  itemLabelActive: { fontFamily: FONTS.bodySemi },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: FONTS.bodySemi, fontSize: 11, color: "#fff" },
  pfp: { width: 32, height: 32, borderRadius: 8 },
  // Compact rail (half-screen windows)
  railCompact: { width: SIDEBAR_COMPACT_WIDTH },
  cTop: { height: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 1 },
  cBanana: { fontSize: 16, lineHeight: 18 },
  cBananaCount: { fontFamily: FONTS.bodySemi, fontSize: 11, fontVariant: ["tabular-nums"], maxWidth: SIDEBAR_COMPACT_WIDTH - 8 },
  cScrollContent: { paddingVertical: 6, paddingHorizontal: 6 },
  cSection: { paddingVertical: 6, gap: 2 },
  cItem: { alignItems: "center", gap: 3, paddingVertical: 6, borderRadius: 8 },
  cLabel: { fontFamily: FONTS.bodyMed, fontSize: 10, maxWidth: SIDEBAR_COMPACT_WIDTH - 10, textAlign: "center" },
  cBadge: { position: "absolute", top: -6, right: -10 },
  cMe: { alignItems: "center", paddingVertical: 10, borderTopWidth: 1 },
  meName: { fontFamily: FONTS.bodySemi, fontSize: 14, flexShrink: 1 },
});
