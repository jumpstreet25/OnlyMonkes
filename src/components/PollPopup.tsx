/**
 * PollPopup — app-wide pop-up shown when a fresh POLL_OPEN: broadcast
 * arrives while the user has the app open, mounted at the root layout
 * alongside BananaBetPopup. Votes are one-shot/locked bot-side (see
 * communityPoll.ts) — this popup dismisses immediately on vote, same
 * optimistic pattern as BananaBetPopup, no waiting for a bot ack.
 */

import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

export function PollPopup() {
  const activePoll = useAppStore((s) => s.activePoll);
  const setActivePoll = useAppStore((s) => s.setActivePoll);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    setActivePoll(null);
    setSubmittingId(null);
  }, [setActivePoll]);

  const handleVote = useCallback(async (optionId: string) => {
    if (!activePoll || submittingId) return;
    setSubmittingId(optionId);
    try {
      const { castVote } = await import("@/lib/poll");
      const { toast } = await import("sonner-native");
      await castVote(activePoll.id, optionId);
      // Same toast/Modal-close race fix as every other popup this session —
      // close first, defer the toast 350ms.
      dismiss();
      setTimeout(() => toast.success("🗳️ Vote recorded — results in ~30h"), 350);
    } catch (err: any) {
      const { toast } = await import("sonner-native");
      toast.error(err?.message ?? "Vote failed — try again");
      setSubmittingId(null);
    }
  }, [activePoll, submittingId, dismiss]);

  const visible = !!activePoll;
  if (!activePoll) return null;

  return (
    <GlassModal visible={visible} onClose={dismiss} cardStyle={styles.card}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.badge}>🗳️ COMMUNITY POLL</Text>
          <Image source={require('../../assets/watermark.png')} style={styles.watermark} resizeMode="contain" />
        </View>
        <Text style={styles.question}>{activePoll.question}</Text>

        <View style={styles.optionList}>
          {activePoll.options.map((opt) => (
            <Pressable
              key={opt.id}
              disabled={!!submittingId}
              onPress={() => handleVote(opt.id)}
              style={[styles.optionBtn, submittingId && submittingId !== opt.id && { opacity: 0.5 }]}
            >
              {submittingId === opt.id ? (
                <ActivityIndicator size="small" color={THEME.accent} />
              ) : (
                <Text style={styles.optionText}>{opt.label}</Text>
              )}
            </Pressable>
          ))}
        </View>

        <Pressable onPress={dismiss} style={styles.skipBtn} disabled={!!submittingId}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  content: { paddingHorizontal: 22, paddingVertical: 24, gap: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  watermark: { width: 38, height: 14, opacity: 0.7 },
  badge: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: THEME.accent,
    letterSpacing: 0.5,
  },
  question: {
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.text,
    textAlign: "center",
    lineHeight: 22,
  },
  optionList: { gap: 10 },
  optionBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "rgba(124,58,237,0.12)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.3)",
  },
  optionText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text, textAlign: "center" },
  skipBtn: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textFaint },
});
