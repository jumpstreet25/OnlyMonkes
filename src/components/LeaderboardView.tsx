/**
 * LeaderboardView — Weekly activity leaderboard.
 * Shows top 10 users ranked by messages sent + reactions given/received.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { getLeaderboard, getWeekLabel, type LeaderboardEntry } from "@/lib/activityTracker";
import { getCachedProfile, getAllTimeUsers } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardView() {
  const myInboxId = useAppStore(s => s.myInboxId);
  const messages = useChatStore(s => s.messages); // trigger recalc on new messages
  const [entries, setEntries] = useState<(LeaderboardEntry & { username: string; nftImage?: string | null })[]>([]);

  useEffect(() => {
    const raw = getLeaderboard(10);
    const allUsers = getAllTimeUsers();
    const enriched = raw.map(e => {
      const username = allUsers.get(e.inboxId) ?? e.inboxId.slice(0, 8);
      const profile = getCachedProfile(e.inboxId);
      return { ...e, username, nftImage: profile?.nftImage };
    });
    setEntries(enriched);
  }, [messages.length]);

  const weekLabel = getWeekLabel();

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No activity yet this week</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.weekLabel}>Week of {weekLabel}</Text>
      {entries.map((e, i) => {
        const isMe = e.inboxId === myInboxId;
        return (
          <View key={e.inboxId} style={[styles.row, isMe && styles.rowMe]}>
            <Text style={styles.rank}>
              {i < 3 ? MEDALS[i] : `${i + 1}.`}
            </Text>
            {e.nftImage ? (
              <Image source={{ uri: e.nftImage }} style={styles.pfp} />
            ) : (
              <View style={[styles.pfp, styles.pfpFallback]} />
            )}
            <View style={styles.info}>
              <Text style={styles.username} numberOfLines={1}>
                {e.username}{isMe ? " (you)" : ""}
              </Text>
              <Text style={styles.stats}>
                {e.sent} msgs · {e.given} given · {e.received} received
              </Text>
            </View>
            <Text style={styles.score}>{e.score}</Text>
          </View>
        );
      })}
      <Text style={styles.formula}>Score = msgs×3 + received×2 + given×1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 4 },
  weekLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginBottom: 6 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
  },
  rowMe: { borderColor: "rgba(124,58,237,0.3)", backgroundColor: "rgba(124,58,237,0.06)" },
  rank: { fontFamily: FONTS.display, fontSize: 16, width: 28, textAlign: "center", color: THEME.text },
  pfp: { width: 34, height: 34, borderRadius: 17 },
  pfpFallback: { backgroundColor: "rgba(153,69,255,0.15)" },
  info: { flex: 1 },
  username: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  stats: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 1 },
  score: { fontFamily: FONTS.display, fontSize: 16, color: "#FFD54F", minWidth: 36, textAlign: "right" },
  formula: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textFaint, textAlign: "center", marginTop: 6 },
  empty: { padding: 20, alignItems: "center" },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
});
