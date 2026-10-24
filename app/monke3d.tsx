/**
 * 3D Monke (beta) — the voxel viewer page (public/viewer/monke3d.html) inside
 * the app, opened on the holder's own monke. Web: same-site iframe. Phone:
 * the WebView already in the binary, loading the page from onlymonkes.app,
 * so it ships without a new APK.
 */
import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { FONTS, THEME } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { parseMonkeNumber } from "@/lib/monkeMeme/monkeNumbers";

const VIEWER_URL = Platform.OS === "web" ? "/viewer/monke3d" : "https://onlymonkes.app/viewer/monke3d";

export default function Monke3DRoute() {
  const insets = useSafeAreaInsets();
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const allNfts = useAppStore((s) => s.allNfts);
  const uri = useMemo(() => {
    const n = parseMonkeNumber(verifiedNft?.name) ?? allNfts.map((x) => parseMonkeNumber(x.name)).find((x) => x != null);
    return n ? `${VIEWER_URL}?n=${n}` : VIEWER_URL;
  }, [verifiedNft, allNfts]);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>3D Monke</Text>
        <Text style={styles.beta}>beta</Text>
      </View>
      <WebView
        source={{ uri }}
        style={styles.viewer}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: THEME.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  back: { paddingVertical: 4, paddingRight: 8 },
  backText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: THEME.accent },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  beta: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted, borderWidth: 1, borderColor: THEME.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  viewer: { flex: 1, backgroundColor: THEME.bg },
});
