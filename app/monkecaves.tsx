/**
 * MonkeCaves (preview) — the retro shooter page (public/viewer/caves.html on
 * the web-app branch) inside the app, played as the holder's own monke. Web:
 * same-site iframe. Phone: the WebView already in the binary, loading the page
 * from onlymonkes.app, so it ships without a new APK. Hidden unless
 * config/monkecaves.json lets this user in (src/lib/monkeCaves/config.ts).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { WebView } from "react-native-webview";
import { FONTS, THEME } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";
import { getMonkeCavesConfig, monkeCavesVisible } from "@/lib/monkeCaves/config";

const GAME_URL = Platform.OS === "web" ? "/viewer/caves" : "https://onlymonkes.app/viewer/caves";

export default function MonkeCavesRoute() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const allNfts = useAppStore((s) => s.allNfts);
  const isAdmin = useAppStore((s) => s.isGroupAdmin);
  const wallet = useAppStore((s) => s.wallet?.address ?? null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    getMonkeCavesConfig().then((cfg) => setAllowed(monkeCavesVisible(cfg, isAdmin, wallet))).catch(() => setAllowed(false));
  }, [isAdmin, wallet]);
  useEffect(() => {
    if (allowed === false) router.back();
  }, [allowed]);
  const uri = useMemo(() => {
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null);
    return n ? `${GAME_URL}?n=${n}` : GAME_URL;
  }, [verifiedNft, allNfts]);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>← {t("menuDrawer.monkeCavesBack")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("menuDrawer.monkeCaves")}</Text>
        <Text style={styles.beta}>preview</Text>
      </View>
      {allowed && (
        <WebView
          source={{ uri }}
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
  page: { flex: 1, backgroundColor: "#07070b" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  back: { paddingVertical: 4, paddingRight: 8 },
  backText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: THEME.accent },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  beta: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted, borderWidth: 1, borderColor: THEME.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  viewer: { flex: 1, backgroundColor: "#07070b" },
});
