import React from "react";
import { View, Text, StyleSheet, Pressable, Linking, ScrollView, StatusBar } from "react-native";
import { router } from "expo-router";
import { THEME, FONTS, APP_NAME } from "@/lib/constants";

export default function AboutScreen() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>About</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ fontSize: 48, textAlign: "center" }}>🐒</Text>
        <Text style={styles.appName}>{APP_NAME}</Text>
        <Text style={styles.version}>v2.35 (build 35)</Text>
        <Text style={styles.tagline}>The Exclusive Social Hub for Saga Monkes NFT Holders</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Built With</Text>
          <Text style={styles.techText}>React Native + Expo SDK 53</Text>
          <Text style={styles.techText}>XMTP v5 MLS (E2E encrypted messaging)</Text>
          <Text style={styles.techText}>LiveKit WebRTC (audio/video rooms)</Text>
          <Text style={styles.techText}>Jupiter v2 (token swaps)</Text>
          <Text style={styles.techText}>Helius DAS (NFT verification)</Text>
          <Text style={styles.techText}>Solana Mobile Wallet Adapter</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Links</Text>
          <LinkRow label="GitHub" url="https://github.com/jumpstreet25/OnlyMonkes" />
          <LinkRow label="Privacy Policy" url="https://jumpstreet25.github.io/OnlyMonkes/privacy.html" />
          <LinkRow label="Terms of Service" url="https://jumpstreet25.github.io/OnlyMonkes/terms.html" />
          <LinkRow label="Report a Bug" url="https://github.com/jumpstreet25/OnlyMonkes/issues" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <Text style={styles.techText}>Jumpstreet25@icloud.com</Text>
        </View>

        <Text style={styles.copyright}>© 2026 OnlyMonkes. All rights reserved.</Text>
        <Text style={styles.madeWith}>Made with 🍌 on Solana Mobile</Text>
      </ScrollView>
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={styles.linkRow}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={styles.linkArrow}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  content: { padding: 24, alignItems: "center", gap: 8 },
  appName: { fontFamily: FONTS.display, fontSize: 28, color: THEME.text, marginTop: 8 },
  version: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.textMuted },
  tagline: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textDim, textAlign: "center", marginBottom: 16 },
  section: { width: "100%", marginTop: 20, gap: 8 },
  sectionTitle: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text, marginBottom: 4 },
  techText: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  linkRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: THEME.surface, borderRadius: 12,
    borderWidth: 1, borderColor: THEME.border,
  },
  linkText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  linkArrow: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted },
  copyright: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textFaint, marginTop: 32 },
  madeWith: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim, marginTop: 4, marginBottom: 40 },
});
