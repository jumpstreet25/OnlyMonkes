/**
 * Wide web layout (2026-10-29): desktop browsers and a phone mirrored to a car screen in
 * landscape used to get the phone layout stretched edge to edge. From WIDE_MIN_PX the app gets
 * a left rail (chats + menu screens) beside the open screen, and from PANEL_MIN_PX a right
 * panel with the holder's own AutonoMonke bags and recent closes (read from tradesStore —
 * whatever the bot last sent this inbox; nothing is fetched or signed here).
 * Below WIDE_MIN_PX, and before sign-in, it renders the phone layout unchanged.
 * Icons are emoji, not MenuIcon: Skia's CanvasKit isn't loaded when the shell first draws on the
 * web, and a Skia canvas there threw (PictureRecorder of undefined) and blanked the page.
 */
import React, { type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { useTradesStore } from "@/store/tradesStore";

export const WIDE_MIN_PX = 760;
export const PANEL_MIN_PX = 1180;
const NO_SHELL = new Set(["/", "/verify", "/pair"]);

interface RailItem { path: string; icon: string; label: string; match?: (p: string) => boolean }

/** Pure: which rail entries a holder sees (Genesis-only holders reach Genesis Chat only). */
export function railItems(t: (k: string) => string, monke: boolean, genesis: boolean): RailItem[] {
  if (!monke) return genesis ? [{ path: "/genesis-chat", icon: "✨", label: t("wide.genesis") }] : [];
  const items: RailItem[] = [
    { path: "/chat", icon: "💬", label: t("wide.mainChat") },
    { path: "/bot-channel?channelId=trades", icon: "📈", label: "MonkeTrades", match: (p) => p.startsWith("/bot-channel") },
    { path: "/dms", icon: "✉️", label: t("wide.messages"), match: (p) => p === "/dms" || p.startsWith("/dm/") || p.startsWith("/group-dm") },
  ];
  if (genesis) items.splice(1, 0, { path: "/genesis-chat", icon: "✨", label: t("wide.genesis") });
  items.push(
    { path: "/portfolio", icon: "💼", label: t("menuDrawer.portfolio") },
    { path: "/watchlist", icon: "👀", label: t("menuDrawer.watchlist") },
    { path: "/marketplace", icon: "🛒", label: "MonkeMarkets" },
    { path: "/treasury", icon: "🍌", label: "OnlyTreasury" },
    { path: "/globe", icon: "🌍", label: t("menuDrawer.globe") },
    { path: "/settings", icon: "⚙️", label: t("menuDrawer.settings") },
  );
  return items;
}

export function isRailActive(item: RailItem, pathname: string): boolean {
  return item.match ? item.match(pathname) : pathname === item.path;
}

const sol = (v: unknown) => { const n = num(v); return n == null ? "—" : `${n.toFixed(3)} SOL`; };
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const pct = (v: unknown) => { const n = num(v); return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; };
const pnlColor = (v: unknown) => { const n = num(v) ?? 0; return n > 0 ? THEME.success : n < 0 ? THEME.error : THEME.textMuted; };

function ago(ts: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  const at = num(ts);
  if (at == null) return "—";
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
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
            <Text style={[styles.railIcon, !active && styles.railIconIdle]}>{it.icon}</Text>
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
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const recent = (Array.isArray(closed) ? closed : []).slice(0, 6);
  const open = Array.isArray(openTrades) ? openTrades : [];

  return (
    <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
      <Text style={styles.panelTitle}>{t("wide.bags")}</Text>
      {portfolio ? (
        <>
          <Text style={styles.muted}>{t("wide.snapshot", { when: ago(portfolio.ts, t) })}</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}><Text style={styles.statLabel}>{t("wide.wallet")}</Text><Text style={styles.statValue}>{sol(portfolio.walletBalanceSOL)}</Text></View>
            <View style={styles.stat}><Text style={styles.statLabel}>{t("wide.winRate")}</Text><Text style={styles.statValue}>{num(portfolio.winRate) == null ? "—" : `${Math.round(portfolio.winRate)}%`}</Text></View>
          </View>
          {positions.length === 0 && <Text style={styles.muted}>{t("wide.noBags")}</Text>}
          {positions.map((p, i) => (
            <View key={p.positionId ?? i} style={styles.row}>
              <Text style={styles.rowToken} numberOfLines={1}>${p.token}</Text>
              <Text style={styles.rowValue}>{sol(p.currentSolValue)}</Text>
              <Text style={[styles.rowPnl, { color: pnlColor(p.pnlPct) }]}>{pct(p.pnlPct)}</Text>
            </View>
          ))}
        </>
      ) : open.length > 0 ? (
        open.map((o) => (
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
      {recent.map((c, i) => (
        <View key={c.id ?? i} style={styles.row}>
          <Text style={styles.rowToken} numberOfLines={1}>${c.token}</Text>
          <Text style={styles.rowValue}>{ago(c.closedAt, t)}</Text>
          <Text style={[styles.rowPnl, { color: pnlColor(c.pnlPct) }]}>{pct(c.pnlPct)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

/** The rail and panel are extras: if either throws, it disappears and the app keeps running. */
class Optional extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("[WideShell] side column hidden after an error:", err); }
  render() { return this.state.failed ? null : this.props.children; }
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
      {wide && <Optional><Rail items={railItems(t, monke, genesis)} pathname={pathname} /></Optional>}
      <View style={[styles.center, wide && styles.centerWide]}>{children}</View>
      {wide && width >= PANEL_MIN_PX && monke && <Optional><BagsPanel /></Optional>}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: THEME.bg },
  center: { flex: 1, minWidth: 0, overflow: "hidden" },
  centerWide: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  rail: { width: 210, flexGrow: 0, flexShrink: 0, backgroundColor: THEME.bg },
  railInner: { paddingVertical: 14, paddingHorizontal: 10, gap: 4 },
  brand: { fontFamily: FONTS.displayMed, fontSize: 18, color: THEME.text, paddingHorizontal: 12, paddingBottom: 10 },
  railItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 12 },
  railItemActive: { backgroundColor: THEME.accentSoft },
  railItemHover: { backgroundColor: "rgba(255,255,255,0.05)" },
  railIcon: { fontSize: 20, width: 26, textAlign: "center" },
  railIconIdle: { opacity: 0.7 },
  railLabel: { fontFamily: FONTS.bodyMed, fontSize: 16, color: THEME.textMuted, flexShrink: 1 },
  railLabelActive: { color: THEME.text },
  panel: { width: 320, flexGrow: 0, flexShrink: 0, backgroundColor: THEME.bg },
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
