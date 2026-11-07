/**
 * Website middle pane: tabs for the full-screen pages (MonkeCaves, 3D Monke,
 * MonkeMeme) so they sit beside Main Chat instead of replacing it. Tabs stay
 * mounted while you switch, so a running game keeps its place.
 */
import React, { Suspense, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { useTranslation } from "react-i18next";
import { FONTS } from "@/lib/constants";
import { useThemeColor } from "@/lib/shopTheme";
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useWorkspace, type WorkspaceTab } from "@/lib/webWorkspace";

const MonkeMemeScreen = React.lazy(() => import("@/screens/MonkeMemeScreen"));

export function WorkspacePane({ cavesAllowed }: { cavesAllowed: boolean }) {
  const { t } = useTranslation();
  const bg = useThemeColor("surface");
  const border = useThemeColor("border");
  const text = useThemeColor("text");
  const muted = useThemeColor("textMuted");
  const hover = useThemeColor("surfaceHigh");
  const { tabs, active, open, close } = useWorkspace();
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const allNfts = useAppStore((s) => s.allNfts);
  const n = useMemo(
    () => parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null),
    [verifiedNft, allNfts],
  );
  const shown = tabs.filter((x) => x !== "caves" || cavesAllowed);
  const label: Record<WorkspaceTab, string> = { caves: t("menuDrawer.monkeCaves"), "3d": "3D Monke", meme: t("menuDrawer.monkeMeme") };

  return (
    <View style={[styles.pane, { backgroundColor: "#07070b" }]}>
      <View style={[styles.tabs, { backgroundColor: bg, borderBottomColor: border }]} accessibilityRole={"tablist" as any}>
        {shown.map((tab) => {
          const on = tab === active;
          return (
            <View key={tab} style={[styles.tab, { borderColor: border }, on && { backgroundColor: hover }]}>
              <Pressable onPress={() => open(tab)} accessibilityRole={"tab" as any} accessibilityState={{ selected: on }} style={styles.tabMain}>
                <Text style={[styles.tabText, { color: on ? text : muted }]} numberOfLines={1}>{label[tab]}</Text>
              </Pressable>
              <Pressable
                onPress={() => close(tab)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.closeTab", { name: label[tab] })}
                style={({ hovered }: any) => [styles.x, hovered && { backgroundColor: border }]}
              >
                <Text style={[styles.xText, { color: muted }]}>×</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={styles.body}>
        {shown.map((tab) => (
          <View key={tab} style={[StyleSheet.absoluteFill, tab !== active && styles.hidden]}>
            <ErrorBoundary silent>
              {tab === "caves" && <WebView source={{ uri: n ? `/viewer/caves?n=${n}` : "/viewer/caves" }} style={styles.view} />}
              {tab === "3d" && <WebView source={{ uri: n ? `/viewer/monke3d?n=${n}` : "/viewer/monke3d" }} style={styles.view} />}
              {tab === "meme" && (
                <Suspense fallback={<View style={styles.loading}><ActivityIndicator color={muted} /></View>}>
                  <MonkeMemeScreen onBack={() => close("meme")} />
                </Suspense>
              )}
            </ErrorBoundary>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1, minWidth: 0, height: "100%" },
  tabs: { height: 40, flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 8, borderBottomWidth: 1 },
  tab: { flexDirection: "row", alignItems: "center", height: 32, maxWidth: 200, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 8, borderTopRightRadius: 8, paddingLeft: 12, paddingRight: 4 },
  tabMain: { flexShrink: 1, height: "100%", justifyContent: "center", paddingRight: 6 },
  tabText: { fontFamily: FONTS.bodySemi, fontSize: 13 },
  x: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  xText: { fontSize: 16, lineHeight: 18 },
  body: { flex: 1, position: "relative" },
  hidden: { display: "none" },
  view: { flex: 1, backgroundColor: "#07070b" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
