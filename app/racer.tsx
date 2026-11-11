/**
 * Monke RC — the 3D RC racer page (public/viewer/racer.html on the web-app branch)
 * inside the app, driven by the holder's own monke. Web: same-site iframe. Phone: the
 * WebView already in the binary, loading the page from onlymonkes.app (OTA-safe).
 * Hidden unless config/racer.json lets this user in. A finished daily race
 * ({ type: "racer", event: "clear" }) goes to the daily board + bananas
 * (src/lib/racer/run.ts); the reply comes back to the page as { type: "racerRun", ... }.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { WebView } from "react-native-webview";
import { FONTS, THEME } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { getRacerConfig, racerVisible } from "@/lib/racer/config";
import { submitRacerRun } from "@/lib/racer/run";

const GAME_URL = Platform.OS === "web" ? "/viewer/racer" : "https://onlymonkes.app/viewer/racer";

export default function RacerRoute() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const allNfts = useAppStore((s) => s.allNfts);
  const isAdmin = useAppStore((s) => s.isGroupAdmin);
  const wallet = useAppStore((s) => s.wallet?.address ?? null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    getRacerConfig().then((cfg) => setAllowed(racerVisible(cfg, isAdmin, wallet))).catch(() => setAllowed(false));
  }, [isAdmin, wallet]);
  useEffect(() => {
    if (allowed === false) router.back();
  }, [allowed]);
  const uri = useMemo(() => {
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null);
    return n ? `${GAME_URL}?n=${n}` : GAME_URL;
  }, [verifiedNft, allNfts]);
  const web = useRef<WebView>(null);
  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let d: any;
    try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d?.type !== "racer" || d.event !== "clear") return;
    void submitRacerRun(d).then((r) => { if (r) web.current?.postMessage(JSON.stringify({ type: "racerRun", ...r })); });
  }, []);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>← {t("menuDrawer.monkeCavesBack")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("menuDrawer.monkeRC")}</Text>
      </View>
      {allowed && (
        <WebView
          key={uri}
          ref={web}
          source={{ uri }}
          onMessage={onMessage}
          style={styles.viewer}
          bounces={false}
          overScrollMode="never"
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0b1a12" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  back: { paddingVertical: 4, paddingRight: 8 },
  backText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: THEME.accent },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  viewer: { flex: 1, backgroundColor: "#0b1a12" },
});
