/**
 * Wide web layout (2026-10-29): desktop browsers and a phone mirrored to a car screen in
 * landscape used to get the phone layout stretched edge to edge. From WIDE_MIN_PX the app gets
 * a left rail (chats + menu screens) beside the open screen, and from PANEL_MIN_PX a right
 * panel with the holder's own AutonoMonke bags and recent closes (read from tradesStore —
 * whatever the bot last sent this inbox; nothing is fetched or signed here).
 * Below WIDE_MIN_PX, and before sign-in, it renders the phone layout unchanged.
 */
import React, { type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { useTradesStore } from "@/store/tradesStore";
import { MenuIcon, type MenuIconName } from "./MenuIcon";

export const WIDE_MIN_PX = 760;
export const PANEL_MIN_PX = 1180;
const NO_SHELL = new Set(["/", "/verify", "/pair"]);

interface RailItem { path: string; icon: MenuIconName; label: string; match?: (p: string) => boolean }

/** Pure: which rail entries a holder sees (Genesis-only holders reach Genesis Chat only). */
export function railItems(t: (k: string) => string, monke: boolean, genesis: boolean): RailItem[] {
  if (!monke) return genesis ? [{ path: "/genesis-chat", icon: "speech", label: t("wide.genesis") }] : [];
  const items: RailItem[] = [
    { path: "/chat", icon: "speech", label: t("wide.mainChat") },
    { path: "/bot-channel?channelId=trades", icon: "chart_up", label: "MonkeTrades", match: (p) => p.startsWith("/bot-channel") },
    { path: "/dms", icon: "messages", label: t("wide.messages"), match: (p) => p === "/dms" || p.startsWith("/dm/") || p.startsWith("/group-dm") },
  ];
  if (genesis) items.splice(1, 0, { path: "/genesis-chat", icon: "speech", label: t("wide.genesis") });
  items.push(
    { path: "/portfolio", icon: "portfolio", label: t("menuDrawer.portfolio") },
    { path: "/watchlist", icon: "watchlist", label: t("menuDrawer.watchlist") },
    { path: "/marketplace", icon: "monkemarkets", label: "MonkeMarkets" },
    { path: "/treasury", icon: "banana", label: "OnlyTreasury" },
    { path: "/globe", icon: "globe", label: t("menuDrawer.globe") },
    { path: "/settings", icon: "settings", label: t("menuDrawer.settings") },
  );
  return items;
}

export function isRailActive(item: RailItem, pathname: string): boolean {
  return item.match ? item.match(pathname) : pathname === item.path;
}

const sol = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(3)} SOL`);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const pnlColor = (n: number) => (n > 0 ? THEME.success : n < 0 ? THEME.error : THEME.textMuted);

function ago(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  return m < 60 ? t("wide.minAgo", { n: m }) : t("wide.hourAgo", { n: Math.round(m / 60) });
}

function Rail({ items, pathname }: { items: RailItem[]; pathname: string }) {
  return (
    <ScrollView style={styles.rail} contentContainerStyle={styles.railInner}>
      <Text style={styles.brand}>OnlyMonkes</Text>
      {items.map((it) => {
        const active = isRailActive(it, pathname);
        return (
          <Pressable
            key={it.path}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.navigate(it.path as any)}
            style={({ hovered }: any) => [styles.railItem, active && styles.railItemActive, hovered && !active && styles.railItemHover]}
          >
            <MenuIcon name={it.icon} size={22} color={active ? THEME.accent : THEME.textMuted} />
            <Text style={[styles.railLabel, active && styles.railLabelActive]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function BagsPanel() {
  const { t } = useTranslation();
  const portfolio = useTradesStore((s) => s.portfolioResponse);
  const openTrades = useTradesStore((s) => s.openTrades);
  const closed = useTradesStore((s) => s.closedTrades);
  const positions = portfolio?.positions ?? [];
  const recent = closed.slice(0, 6);

  return (
    <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
      <Text style={styles.panelTitle}>{t("wide.bags")}</Text>
      {portfolio ? (
        <>
          <Text style={styles.muted}>{t("wide.snapshot", { when: ago(portfolio.ts, t) })}</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}><Text style={styles.statLabel}>{t("wide.wallet")}</Text><Text style={styles.statValue}>{sol(portfolio.walletBalanceSOL)}</Text></View>
            <View style={styles.stat}><Text style={styles.statLabel}>{t("wide.winRate")}</Text><Text style={styles.statValue}>{Math.round(portfolio.winRate)}%</Text></View>
          </View>
          {positions.length === 0 && <Text style={styles.muted}>{t("wide.noBags")}</Text>}
          {positions.map((p) => (
            <View key={p.positionId} style={styles.row}>
              <Text style={styles.rowToken} numberOfLines={1}>${p.token}</Text>
              <Text style={styles.rowValue}>{sol(p.currentSolValue)}</Text>
              <Text style={[styles.rowPnl, { color: pnlColor(p.pnlPct) }]}>{pct(p.pnlPct)}</Text>
            </View>
          ))}
        </>
      ) : openTrades.length > 0 ? (
        openTrades.map((o) => (
          <View key={o.id} style={styles.row}>
            <Text style={styles.rowToken} numberOfLines={1}>${o.token}</Text>
            <Text style={styles.rowValue}>{sol(o.entrySolAmount)}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>{t("wide.askPortfolio")}</Text>
      )}

      <Text style={[styles.panelTitle, styles.panelGap]}>{t("wide.recent")}</Text>
      {recent.length === 0 && <Text style={styles.muted}>{t("wide.noRecent")}</Text>}
      {recent.map((c) => (
        <View key={c.id} style={styles.row}>
          <Text style={styles.rowToken} numberOfLines={1}>${c.token}</Text>
          <Text style={styles.rowValue}>{ago(c.closedAt, t)}</Text>
          <Text style={[styles.rowPnl, { color: pnlColor(c.pnlPct) }]}>{pct(c.pnlPct)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function WideShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { t } = useTranslation();
  const wallet = useAppStore((s) => s.wallet);
  const monke = useAppStore((s) => s.verified);
  const genesis = useAppStore((s) => s.isGenesisHolder);

  // Same tree in both modes — the navigator below never remounts when the window crosses
  // WIDE_MIN_PX or the holder signs in; only the rail and panel come and go.
  const wide = width >= WIDE_MIN_PX && !!wallet && (monke || genesis) && !NO_SHELL.has(pathname);
  return (
    <View style={styles.shell}>
      {wide && <Rail items={railItems(t, monke, genesis)} pathname={pathname} />}
      <View style={[styles.center, wide && styles.centerWide]}>{children}</View>
      {wide && width >= PANEL_MIN_PX && monke && <BagsPanel />}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: THEME.bg },
  center: { flex: 1, minWidth: 0 },
  centerWide: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  rail: { width: 210, flexGrow: 0, flexShrink: 0 },
  railInner: { paddingVertical: 14, paddingHorizontal: 10, gap: 4 },
  brand: { fontFamily: FONTS.displayMed, fontSize: 18, color: THEME.text, paddingHorizontal: 12, paddingBottom: 10 },
  railItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 12 },
  railItemActive: { backgroundColor: THEME.accentSoft },
  railItemHover: { backgroundColor: "rgba(255,255,255,0.05)" },
  railLabel: { fontFamily: FONTS.bodyMed, fontSize: 16, color: THEME.textMuted, flexShrink: 1 },
  railLabelActive: { color: THEME.text },
  panel: { width: 320, flexGrow: 0, flexShrink: 0 },
  panelInner: { padding: 16, gap: 8 },
  panelTitle: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.text },
  panelGap: { marginTop: 16 },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.04)" },
  statLabel: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  statValue: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" },
  rowToken: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text, flex: 1, minWidth: 0 },
  rowValue: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  rowPnl: { fontFamily: FONTS.bodyMed, fontSize: 14, minWidth: 58, textAlign: "right" },
});
