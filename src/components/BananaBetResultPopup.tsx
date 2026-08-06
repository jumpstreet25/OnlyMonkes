/**
 * BananaBetResultPopup — app-wide pop-up shown when a BananaBet settles,
 * summarizing the outcome for everyone (not just participants): how many
 * bets were placed and how many bananas were won in total. Mounted at the
 * root layout, same pattern as BananaBetPopup.
 */

import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

const getViewShot = () => import("react-native-view-shot");
const getImageManipulator = () => import("expo-image-manipulator");

export function BananaBetResultPopup() {
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const activeBananaBetResult = useAppStore((s) => s.activeBananaBetResult);
  const setActiveBananaBetResult = useAppStore((s) => s.setActiveBananaBetResult);

  const dismiss = useCallback(() => setActiveBananaBetResult(null), [setActiveBananaBetResult]);

  const handleShareX = useCallback(async () => {
    if (!activeBananaBetResult || sharing) return;
    setSharing(true);
    try {
      const { captureRef } = await getViewShot();
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const uri = await captureRef(cardRef as any, { format: "png", quality: 1, result: "tmpfile" });
      const IM = await getImageManipulator();
      const compressed = await IM.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
        compress: 0.85,
        format: IM.SaveFormat.JPEG,
      });
      const { shareImageToX, pickBananaBetResultCaption } = await import("@/lib/shareToX");
      const { toast } = await import("sonner-native");
      // Prefer the bot-generated (Ollama-first) caption when present —
      // only available via the push-tap path (per-user win/lose needs a
      // recipient, which the anonymous group broadcast doesn't carry).
      const { saved } = await shareImageToX(
        compressed.uri,
        activeBananaBetResult.shareCaption ?? pickBananaBetResultCaption(activeBananaBetResult.question, activeBananaBetResult.outcome, activeBananaBetResult.myBet),
      );
      if (saved) toast.success("Image saved — tap the image icon in X to attach it 📸");
    } catch (err: any) {
      const { toast } = await import("sonner-native");
      if (err?.message && !/dismiss/i.test(err.message)) toast.error(err.message);
    } finally {
      setSharing(false);
    }
  }, [activeBananaBetResult, sharing]);

  if (!activeBananaBetResult) return null;
  const { question, outcome, totalBets, totalBananasWon, myBet } = activeBananaBetResult;
  const won = myBet ? myBet.side === outcome : null;

  return (
    <GlassModal visible={!!activeBananaBetResult} onClose={dismiss} cardStyle={styles.card}>
      <View style={styles.content}>
        <View ref={cardRef} collapsable={false} style={styles.shareableArea}>
          <View style={styles.headerRow}>
            <Text style={styles.badge}>🍌 BANANABETS — SETTLED</Text>
            <View style={styles.headerRight}>
              <Image
                source={require('../../assets/watermark.png')}
                style={styles.watermark}
                resizeMode="contain"
              />
              <Pressable onPress={handleShareX} disabled={sharing} hitSlop={8}>
                {sharing ? <ActivityIndicator size="small" color={THEME.textFaint} /> : <Text style={styles.shareIcon}>𝕏</Text>}
              </Pressable>
            </View>
          </View>
          <Text style={styles.question}>{question}</Text>
          <Text style={styles.outcome}>Outcome: {outcome.toUpperCase()}</Text>

          {myBet && (
            <Text style={won ? styles.myBetWon : styles.myBetLost}>
              {won ? `✅ You bet ${myBet.amount} on ${myBet.side.toUpperCase()} — WON!` : `You bet ${myBet.amount} on ${myBet.side.toUpperCase()} — no win this time`}
            </Text>
          )}

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
  shareableArea: { gap: 14, alignItems: "center", width: "100%" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  watermark: { width: 38, height: 14, opacity: 0.7 },
  shareIcon: { fontFamily: FONTS.displayMed, fontSize: 15, color: THEME.textFaint },
  myBetWon: { fontFamily: FONTS.bodyMed, fontSize: 13, color: "#2E9E5B", textAlign: "center" },
  myBetLost: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted, textAlign: "center" },
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
