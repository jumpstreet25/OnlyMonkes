/**
 * BananaBetResultPopup — app-wide pop-up shown when a BananaBet settles,
 * summarizing the outcome for everyone (not just participants): how many
 * bets were placed and how many bananas were won in total. Mounted at the
 * root layout, same pattern as BananaBetPopup.
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

export function BananaBetResultPopup() {
  const activeBananaBetResult = useAppStore((s) => s.activeBananaBetResult);
  const setActiveBananaBetResult = useAppStore((s) => s.setActiveBananaBetResult);

  const dismiss = useCallback(() => setActiveBananaBetResult(null), [setActiveBananaBetResult]);

  if (!activeBananaBetResult) return null;
  const { question, outcome, totalBets, totalBananasWon } = activeBananaBetResult;

  return (
    <GlassModal visible={!!activeBananaBetResult} onClose={dismiss} cardStyle={styles.card}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.badge}>🍌 BANANABETS — SETTLED</Text>
          <Image
            source={require('../../assets/watermark.png')}
            style={styles.watermark}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.question}>{question}</Text>
        <Text style={styles.outcome}>Outcome: {outcome.toUpperCase()}</Text>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalBets}</Text>
            <Text style={styles.statLabel}>bet{totalBets === 1 ? "" : "s"} placed</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalBananasWon} 🍌</Text>
            <Text style={styles.statLabel}>won total</Text>
          </View>
        </View>

        <Pressable onPress={dismiss} style={styles.okBtn}>
          <Text style={styles.okText}>Nice!</Text>
        </Pressable>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  content: { paddingHorizontal: 22, paddingVertical: 24, gap: 14, alignItems: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  watermark: { width: 38, height: 14, opacity: 0.7 },
  badge: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: "#FFCC00",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  question: {
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.text,
    textAlign: "center",
    lineHeight: 22,
  },
  outcome: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
  },
  statsRow: { flexDirection: "row", gap: 16, width: "100%" },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255, 204, 0, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.25)",
  },
  statValue: { fontFamily: FONTS.display, fontSize: 20, color: "#FFCC00" },
  statLabel: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted, marginTop: 2 },
  okBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  okText: { fontFamily: FONTS.displayMed, fontSize: 15, color: "#fff", fontWeight: "700" },
});
