/**
 * Wide web layout. Desktop browsers and a phone mirrored to a car screen in landscape used to
 * get the phone layout stretched edge to edge. From WIDE_MIN_PX the app gets an icon rail
 * (chats + menu screens) and one side column; from THREE_COL_MIN_PX a column on each side of
 * the open screen. Each column is the holder's choice (website only, saved per browser):
 * Messages, the MonkeTrades channel, their AutonoMonke bags, or hidden. Default (owner
 * 2026-10-29, "Trader"): Messages left, MonkeTrades right.
 * Below WIDE_MIN_PX, and before sign-in, it renders the phone layout unchanged.
 * Icons are emoji, not MenuIcon: a Skia canvas in the shell threw (PictureRecorder of
 * undefined) and blanked the page. Columns sit in error boundaries for the same reason.
 */
import React, { Suspense, useCallback, useState, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { useTradesStore } from "@/store/tradesStore";

/** The screens a column can hold, loaded on first use (replaceable in tests). */
export const paneScreens: { trades: React.ComponentType<{ channelId: "trades"; headerAccessory?: ReactNode }>; messages: React.ComponentType<{ headerAccessory?: ReactNode }> } = {
  trades: React.lazy(() => import("@/screens/BotChannelScreen")),
  messages: React.lazy(() => import("@/screens/DmInboxScreen")),
};

export const WIDE_MIN_PX = 760;
export const THREE_COL_MIN_PX = 1180;
const LEFT_W = 320;
const RIGHT_W = 380;
const PREFS_KEY = "om_web_columns_v1";

export type PaneKind = "messages" | "trades" | "bags" | "off";
export interface ColumnPrefs { left: PaneKind; right: PaneKind }
export const DEFAULT_COLUMNS: ColumnPrefs = { left: "messages", right: "trades" };
const KINDS: PaneKind[] = ["messages", "trades", "bags", "off"];

/** Pure: saved prefs, falling back to the default for anything missing or unknown. */
export function parseColumnPrefs(raw: string | null | undefined): ColumnPrefs {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const pick = (k: unknown, d: PaneKind) => (KINDS.includes(k as PaneKind) ? (k as PaneKind) : d);
    return { left: pick(v?.left, DEFAULT_COLUMNS.left), right: pick(v?.right, DEFAULT_COLUMNS.right) };
  } catch {
    return { ...DEFAULT_COLUMNS };
  }
}

/** Pure: which columns fit. Two-column widths show one side column (right, else left), on the right. */
export function visibleColumns(width: number, prefs: ColumnPrefs): { left: PaneKind | null; right: PaneKind | null } {
  const on = (k: PaneKind) => (k === "off" ? null : k);
  if (width < WIDE_MIN_PX) return { left: null, right: null };
  if (width >= THREE_COL_MIN_PX) return { left: on(prefs.left), right: on(prefs.right) };
  return { left: null, right: on(prefs.right) ?? on(prefs.left) };
}

/** Pure: the open screen already shows this column's content (one copy, not two). */
export function paneOpenInCenter(kind: PaneKind, pathname: string): boolean {
  if (kind === "trades") return pathname.startsWith("/bot-channel");
  if (kind === "messages") return pathname === "/dms";
  return false;
}

function loadPrefs(): ColumnPrefs {
  try { return parseColumnPrefs(globalThis.localStorage?.getItem(PREFS_KEY)); } catch { return { ...DEFAULT_COLUMNS }; }
}
function savePrefs(p: ColumnPrefs): void {
  try { globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: layout resets next visit */ }
}
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
      <View style={styles.brand}><Text style={styles.brandText}>OM</Text></View>
      {items.map((it) => {
        const active = isRailActive(it, pathname);
        return (
          <Pressable
            key={it.path}
            accessibilityRole="link"
            accessibilityLabel={it.label}
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

function BagsPanel({ headerAccessory }: { headerAccessory?: ReactNode }) {
  const { t } = useTranslation();
  const portfolio = useTradesStore((s) => s.portfolioResponse);
  const openTrades = useTradesStore((s) => s.openTrades);
  const closed = useTradesStore((s) => s.closedTrades);
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const recent = (Array.isArray(closed) ? closed : []).slice(0, 6);
  const open = Array.isArray(openTrades) ? openTrades : [];

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.panelInner}>
      <View style={styles.paneHead}>{headerAccessory}<Text style={styles.panelTitle}>{t("wide.bags")}</Text></View>
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

/** The rail and columns are extras: if one throws, it disappears and the app keeps running. */
class Optional extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("[WideShell] column hidden after an error:", err); }
  render() { return this.state.failed ? null : this.props.children; }
}

const Loading = () => <View style={styles.centerFill}><ActivityIndicator color={THEME.accent} /></View>;

function Pane({ side, kind, pathname, onChange }: { side: "left" | "right"; kind: PaneKind; pathname: string; onChange: (k: PaneKind) => void }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const label = (k: PaneKind) => (k === "trades" ? "MonkeTrades" : t(`wide.pane.${k}`));
  const switcher = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("wide.changeColumn")}
      onPress={() => setMenu((m) => !m)}
      style={({ hovered }: any) => [styles.switchBtn, (hovered || menu) && styles.switchBtnOn]}
    >
      <Text style={styles.switchIcon}>⇄</Text>
    </Pressable>
  );

  let body: ReactNode;
  if (paneOpenInCenter(kind, pathname)) {
    body = (
      <View style={styles.fill}>
        <View style={styles.paneHead}>{switcher}<Text style={styles.panelTitle}>{label(kind)}</Text></View>
        <View style={styles.centerFill}><Text style={styles.muted}>{t("wide.openInMiddle", { name: label(kind) })}</Text></View>
      </View>
    );
  } else if (kind === "trades") {
    body = <paneScreens.trades channelId="trades" headerAccessory={switcher} />;
  } else if (kind === "messages") {
    body = <paneScreens.messages headerAccessory={switcher} />;
  } else {
    body = <BagsPanel headerAccessory={switcher} />;
  }

  return (
    <View style={[styles.pane, side === "left" ? styles.paneLeft : styles.paneRight]}>
      <Optional key={kind}><Suspense fallback={<Loading />}>{body}</Suspense></Optional>
      {menu && (
        <View style={styles.menu} accessibilityRole="menu">
          <Text style={styles.menuTitle}>{t("wide.showInColumn")}</Text>
          {KINDS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="menuitem"
              onPress={() => { setMenu(false); onChange(k); }}
              style={({ hovered }: any) => [styles.menuItem, hovered && styles.railItemHover]}
            >
              <Text style={[styles.menuText, k === kind && styles.menuTextOn]}>{k === "off" ? t("wide.pane.off") : label(k)}</Text>
              {k === kind && <Text style={styles.menuCheck}>✓</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function WideShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { t } = useTranslation();
  const wallet = useAppStore((s) => s.wallet);
  const monke = useAppStore((s) => s.verified);
  const genesis = useAppStore((s) => s.isGenesisHolder);
  const [prefs, setPrefs] = useState<ColumnPrefs>(loadPrefs);
  const setSide = useCallback((side: "left" | "right", k: PaneKind) => {
    setPrefs((p) => { const next = { ...p, [side]: k }; savePrefs(next); return next; });
  }, []);

  // Same tree in every mode: the navigator below never remounts when the window is resized or
  // the holder signs in; only the rail and columns come and go.
  const wide = width >= WIDE_MIN_PX && !!wallet && (monke || genesis) && !NO_SHELL.has(pathname);
  const cols = wide && monke ? visibleColumns(width, prefs) : { left: null, right: null };
  // Two-column width shows one column; its menu then edits whichever side it came from.
  const rightSide: "left" | "right" = width >= THREE_COL_MIN_PX || prefs.right !== "off" ? "right" : "left";
  return (
    <View style={styles.shell}>
      {wide && <Optional><Rail items={railItems(t, monke, genesis)} pathname={pathname} /></Optional>}
      {cols.left && <Pane side="left" kind={cols.left} pathname={pathname} onChange={(k) => setSide("left", k)} />}
      <View style={[styles.center, wide && styles.centerWide]}>{children}</View>
      {cols.right && <Pane side="right" kind={cols.right} pathname={pathname} onChange={(k) => setSide(rightSide, k)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: THEME.bg },
  center: { flex: 1, minWidth: 0, overflow: "hidden" },
  centerWide: { borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  fill: { flex: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  rail: { width: 84, flexGrow: 0, flexShrink: 0, backgroundColor: THEME.bg },
  railInner: { paddingVertical: 14, alignItems: "center", gap: 4 },
  brand: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#FFD24A", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  brandText: { fontFamily: FONTS.displayMed, fontSize: 15, color: "#1A1408" },
  railItem: { width: 72, minHeight: 58, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 6 },
  railItemActive: { backgroundColor: THEME.accentSoft },
  railItemHover: { backgroundColor: "rgba(255,255,255,0.05)" },
  railIcon: { fontSize: 21, textAlign: "center" },
  railIconIdle: { opacity: 0.75 },
  railLabel: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted, maxWidth: 68 },
  railLabelActive: { color: THEME.text },
  pane: { flexGrow: 0, flexShrink: 0, backgroundColor: THEME.bg, overflow: "hidden" },
  paneLeft: { width: LEFT_W, borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  paneRight: { width: RIGHT_W, borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  paneHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52 },
  switchBtn: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.04)" },
  switchBtnOn: { backgroundColor: THEME.accentSoft },
  switchIcon: { fontSize: 18, color: THEME.text },
  menu: { position: "absolute", top: 56, left: 10, width: 230, zIndex: 50, padding: 6, borderRadius: 14, backgroundColor: "#16161F", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  menuTitle: { fontFamily: FONTS.body, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: THEME.textMuted, paddingHorizontal: 10, paddingVertical: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 10, borderRadius: 10 },
  menuText: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.textMuted },
  menuTextOn: { color: THEME.text },
  menuCheck: { fontSize: 15, color: THEME.accent },
  panelInner: { padding: 16, paddingTop: 6, gap: 8 },
  panelTitle: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.text },
  panelGap: { marginTop: 16 },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center" },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.04)" },
  statLabel: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  statValue: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" },
  rowToken: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text, flex: 1, minWidth: 0 },
  rowValue: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  rowPnl: { fontFamily: FONTS.bodyMed, fontSize: 14, minWidth: 58, textAlign: "right" },
});
