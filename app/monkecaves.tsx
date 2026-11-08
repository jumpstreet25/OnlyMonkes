/**
 * MonkeCaves (preview) — the retro shooter page (public/viewer/caves.html on
 * the web-app branch) inside the app, played as the holder's own monke. Web:
 * same-site iframe. Phone: the WebView already in the binary, loading the page
 * from onlymonkes.app, so it ships without a new APK. Hidden unless
 * config/monkecaves.json lets this user in (src/lib/monkeCaves/config.ts).
 * The ROYALE button switches to Jungle Royale (versus); the page asks for a
 * holder proof ({ type: "caves", event: "royale-auth" }) and gets it back as
 * { type: "royaleProof", proof } (src/lib/royaleProof.ts). After a match the
 * server credits the bananas and the page says { event: "royale-paid" }: the
 * phone collects them (src/lib/royaleBananas.ts; the web never does). A cleared cave
 * ({ event: "clear" }) goes to the speed-run board (src/lib/cavesRun.ts); the reply comes
 * back to the page as { type: "cavesRun", ... }.
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
import { getMonkeCavesConfig, monkeCavesVisible } from "@/lib/monkeCaves/config";
import { royaleProof } from "@/lib/royaleProof";
import { collectRoyaleBananas } from "@/lib/royaleBananas";
import { submitCavesRun } from "@/lib/cavesRun";
import { MiniChat } from "@/components/MiniChat";

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
  const [royale, setRoyale] = useState(false);
  const uri = useMemo(() => {
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null);
    const q = [n ? `n=${n}` : "", royale ? "mode=royale" : ""].filter(Boolean).join("&");
    return q ? `${GAME_URL}?${q}` : GAME_URL;
  }, [verifiedNft, allNfts, royale]);
  const web = useRef<WebView>(null);
  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let d: any;
    try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d?.type !== "caves") return;
    if (d.event === "royale-paid") { void collectRoyaleBananas(true); return; }
    if (d.event === "clear") {
      void submitCavesRun(d).then((r) => { if (r) web.current?.postMessage(JSON.stringify({ type: "cavesRun", ...r })); });
      return;
    }
    if (d.event !== "royale-auth") return;
    const reply = (msg: object) => web.current?.postMessage(JSON.stringify({ type: "royaleProof", ...msg }));
    royaleProof().then((proof) => reply({ proof })).catch((err) => reply({ error: String(err?.message ?? "no holder proof").slice(0, 120) }));
  }, []);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>← {t("menuDrawer.monkeCavesBack")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("menuDrawer.monkeCaves")}</Text>
        <Text style={styles.beta}>preview</Text>
        <Pressable onPress={() => setRoyale((v) => !v)} hitSlop={8} style={[styles.mode, royale && styles.modeOn]} accessibilityRole="button">
          <Text style={[styles.modeText, royale && styles.modeTextOn]}>{royale ? "CAVES" : "ROYALE"}</Text>
        </Pressable>
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
      {allowed && <MiniChat top={insets.top} bottom={insets.bottom} />}
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
  mode: { marginLeft: "auto", borderWidth: 1, borderColor: THEME.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  modeOn: { backgroundColor: THEME.accent },
  modeText: { fontFamily: FONTS.bodySemi, fontSize: 11, color: THEME.accent, letterSpacing: 1 },
  modeTextOn: { color: "#07070b" },
});
