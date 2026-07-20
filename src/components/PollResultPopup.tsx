/**
 * PollResultPopup — app-wide pop-up shown when a community poll resolves,
 * summarizing the winning option + full tally for everyone (not just
 * voters). Mounted at the root layout, same pattern as
 * BananaBetResultPopup — minus Share-to-X (deliberately skipped for v1).
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

export function PollResultPopup() {
  const activePollResult = useAppStore((s) => s.activePollResult);
  const setActivePollResult = useAppStore((s) => s.setActivePollResult);

  const dismiss = useCallback(() => setActivePollResult(null), [setActivePollResult]);

  if (!activePollResult) return null;
  const { question, winningOption, tally, myVote } = activePollResult;
  const won = myVote ? myVote === winningOption.id : null;
  const myOption = myVote ? tally.find((o) => o.id === myVote) : null;

  return (
    <GlassModal visible={!!activePollResult} onClose={dismiss} cardStyle={styles.card}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.badge}>🗳️ POLL RESULTS</Text>
          <Image source={require('../../assets/watermark.png')} style={styles.watermark} resizeMode="contain" />
        </View>
        <Text style={styles.question}>{question}</Text>
        <Text style={styles.winner}>🏆 {winningOption.label}</Text>

        {myOption && (
          <Text style={won ? styles.myVoteWon : styles.myVoteLost}>
            {won ? "✅ Your vote won!" : `You voted for ${myOption.label} — not this time`}
          </Text>
        )}

        <View style={styles.tallyList}>
          {tally.map((opt) => (
            <View key={opt.id} style={styles.tallyRow}>
              <Text style={[styles.tallyLabel, opt.id === winningOption.id && styles.tallyLabelWinner]} numberOfLines={1}>
                {opt.label}
              </Text>
              <Text style={[styles.tallyVotes, opt.id === winningOption.id && styles.tallyVotesWinner]}>
                {opt.votes}
              </Text>
            </View>
          ))}
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
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 8 },
  watermark: { width: 38, height: 14, opacity: 0.7 },
  badge: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: THEME.accent,
    letterSpacing: 0.5,
  },
  question: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  winner: {
    fontFamily: FONTS.display,
    fontSize: 17,
    color: THEME.text,
    textAlign: "center",
  },
  myVoteWon: { fontFamily: FONTS.bodyMed, fontSize: 13, color: "#2E9E5B", textAlign: "center" },
  myVoteLost: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted, textAlign: "center" },
  tallyList: { width: "100%", gap: 8 },
  tallyRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tallyLabel: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, flex: 1, marginRight: 8 },
  tallyLabelWinner: { color: THEME.text, fontFamily: FONTS.bodyMed },
  tallyVotes: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.textMuted },
  tallyVotesWinner: { color: THEME.accent },
  okBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  okText: { fontFamily: FONTS.displayMed, fontSize: 15, color: "#fff", fontWeight: "700" },
});
