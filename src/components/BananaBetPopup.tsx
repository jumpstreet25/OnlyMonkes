/**
 * BananaBetPopup — app-wide pop-up shown when a fresh BANANA_BET_OPEN:
 * signal arrives while the user has the app open, mounted at the root
 * layout so it can appear over any screen. Suppressed on the Main Chat
 * route itself (/chat) since that screen already shows the same bet as an
 * inline pill — showing both at once would be redundant.
 */

import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { usePathname } from "expo-router";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

const BET_AMOUNT_CHIPS = [10, 25, 50, 100];
const BET_CATEGORY_EMOJI: Record<string, string> = { crypto: "📈", nft: "🖼️", sports: "🏆", news: "📰" };

export function BananaBetPopup() {
  const pathname = usePathname();
  const activeBananaBet = useAppStore((s) => s.activeBananaBet);
  const setActiveBananaBet = useAppStore((s) => s.setActiveBananaBet);
  const [amount, setAmount] = useState(25);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const dismiss = useCallback(() => {
    setActiveBananaBet(null);
    setCustomMode(false);
    setCustomText("");
    setAmount(25);
  }, [setActiveBananaBet]);

  const handleCustomChange = useCallback((text: string) => {
    const digits = text.replace(/[^0-9]/g, "");
    setCustomText(digits);
    const n = parseInt(digits, 10);
    if (n > 0) setAmount(n);
  }, []);

  const handlePlace = useCallback(async (side: "yes" | "no") => {
    if (!activeBananaBet || submitting || amount <= 0) return;
    setSubmitting(true);
    try {
      const { placeBananaBet } = await import("@/lib/bananaBet");
      const { toast } = await import("sonner-native");
      await placeBananaBet(activeBananaBet.id, side, amount);
      // 2026-07-16: closing the Modal in the same tick as the toast
      // mounting raced the Android Dialog window teardown — grey-screen
      // freeze, same bug class as PnLCardModal.handleShareMainChat. Close
      // first, let the Modal's own dismissal clear, then toast.
      dismiss();
      setTimeout(() => toast.success(`🍌 Bet placed: ${amount} bananas on ${side.toUpperCase()}`), 350);
    } catch (err: any) {
      const { toast } = await import("sonner-native");
      toast.error(err?.message ?? "Bet failed — try again");
    } finally {
      setSubmitting(false);
    }
  }, [activeBananaBet, amount, submitting, dismiss]);

  // Suppress on Main Chat — the bet already shows there as an inline pill.
  const visible = !!activeBananaBet && pathname !== "/chat";
  if (!activeBananaBet) return null;

  return (
    <GlassModal visible={visible} onClose={dismiss} cardStyle={styles.card}>
      <View style={styles.content}>
        <Text style={styles.badge}>🍌 BANANABETS</Text>
        <Text style={styles.tagline}>Fake bananas only — zero real money, ever. Bragging rights on the line.</Text>
        <Text style={styles.question}>
          {BET_CATEGORY_EMOJI[activeBananaBet.category] ?? "🍌"} {activeBananaBet.question}
        </Text>

        <Text style={styles.wagerLabel}>Wager (🍌 bananas)</Text>
        <View style={styles.chipRow}>
          {BET_AMOUNT_CHIPS.map((c) => (
            <Pressable
              key={c}
              onPress={() => { setCustomMode(false); setAmount(c); }}
              style={[styles.chip, !customMode && amount === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, !customMode && amount === c && styles.chipTextActive]}>🍌 {c}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setCustomMode(true)}
            style={[styles.chip, customMode && styles.chipActive]}
          >
            <Text style={[styles.chipText, customMode && styles.chipTextActive]}>Custom</Text>
          </Pressable>
        </View>
        {customMode && (
          <TextInput
            value={customText}
            onChangeText={handleCustomChange}
            placeholder="Enter amount"
            placeholderTextColor={THEME.textFaint}
            keyboardType="number-pad"
            style={styles.customInput}
            autoFocus
          />
        )}

        <View style={styles.sideRow}>
          <Pressable
            disabled={submitting || amount <= 0}
            onPress={() => handlePlace("yes")}
            style={[styles.sideBtn, styles.yesBtn, (submitting || amount <= 0) && { opacity: 0.6 }]}
          >
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sideText}>YES</Text>}
          </Pressable>
          <Pressable
            disabled={submitting || amount <= 0}
            onPress={() => handlePlace("no")}
            style={[styles.sideBtn, styles.noBtn, (submitting || amount <= 0) && { opacity: 0.6 }]}
          >
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sideText}>NO</Text>}
          </Pressable>
        </View>

        <Pressable onPress={dismiss} style={styles.skipBtn} disabled={submitting}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  content: { paddingHorizontal: 22, paddingVertical: 24, gap: 14 },
  badge: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: "#FFCC00",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  tagline: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textFaint,
    textAlign: "center",
    lineHeight: 16,
    marginTop: -6,
  },
  question: {
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.text,
    textAlign: "center",
    lineHeight: 22,
  },
  wagerLabel: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textFaint, textAlign: "center" },
  chipRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  chipActive: { backgroundColor: "rgba(255, 204, 0, 0.25)", borderColor: "rgba(255, 204, 0, 0.6)" },
  chipText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
  chipTextActive: { color: "#FFCC00", fontWeight: "700" },
  customInput: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.4)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    textAlign: "center",
  },
  sideRow: { flexDirection: "row", gap: 10 },
  sideBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  yesBtn: { backgroundColor: "#2E9E5B" },
  noBtn: { backgroundColor: "#C0392B" },
  sideText: { fontFamily: FONTS.displayMed, fontSize: 15, color: "#fff", fontWeight: "700" },
  skipBtn: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textFaint },
});
