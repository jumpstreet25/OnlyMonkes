/**
 * LeaderboardView — Activity + CloutScore leaderboard with Monke of the Week.
 *
 * Two tabs:
 *  - Activity: weekly message/reaction leaderboard (existing)
 *  - Clout: CloutScore leaderboard with Alpha Ape flair
 *
 * Monke of the Week card pinned at top (above tabs).
 */

import React, { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { getLeaderboard, getWeekLabel, type LeaderboardEntry } from "@/lib/activityTracker";
import { getCachedProfile, getDeduplicatedUsers } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { MiniChart } from "@/components/MiniChart";
import { getTopProfiles, getRankDisplay, type CloutProfile } from "@/lib/monkeClout";
import { pickMonkeOfTheWeek, type MonkeOfTheWeek } from "@/lib/monkeOfTheWeek";

const MEDALS = ["🥇", "🥈", "🥉"];

type Tab = "activity" | "clout";

export function LeaderboardView() {
  const myInboxId = useAppStore(s => s.myInboxId);
  const messages = useChatStore(s => s.messages);
  const [tab, setTab] = useState<Tab>("activity");
  const [entries, setEntries] = useState<(LeaderboardEntry & { username: string; nftImage?: string | null })[]>([]);
  const [cloutProfiles, setCloutProfiles] = useState<(CloutProfile & { nftImage?: string | null })[]>([]);
  const [motw, setMotw] = useState<MonkeOfTheWeek | null>(null);

  // Load activity leaderboard
  useEffect(() => {
    const raw = getLeaderboard(10);
    const allUsers = getDeduplicatedUsers();
    const enriched = raw.map(e => {
      const username = allUsers.get(e.inboxId) ?? 'Monke';
      const profile = getCachedProfile(e.inboxId);
      return { ...e, username, nftImage: profile?.nftImage };
    });
    setEntries(enriched);
  }, [messages.length]);

  // Load clout leaderboard + MOTW
  useEffect(() => {
    getTopProfiles(10).then(profiles => {
      const enriched = profiles.map(p => {
        const profile = getCachedProfile(p.inboxId);
        return { ...p, nftImage: profile?.nftImage ?? null };
      });
      setCloutProfiles(enriched);
    });
    pickMonkeOfTheWeek().then(({ motw: m }) => {
      if (m.inboxId) {
        const profile = getCachedProfile(m.inboxId);
        setMotw({ ...m, nftImage: profile?.nftImage ?? null });
      } else {
        setMotw(m);
      }
    });
  }, [messages.length]);

  const weekLabel = getWeekLabel();

  return (
    <View style={styles.root}>
      {/* Monke of the Week */}
      {motw && motw.inboxId && (
        <View style={styles.motwCard}>
          <Text style={styles.motwTitle}>MONKE OF THE WEEK</Text>
          <View style={styles.motwContent}>
            {motw.nftImage ? (
              <Image source={{ uri: motw.nftImage }} style={styles.motwPfp} />
            ) : (
              <View style={[styles.motwPfp, styles.pfpFallback]}>
                <Text style={{ fontSize: 24 }}>🐒</Text>
              </View>
            )}
            <View style={styles.motwInfo}>
              <Text style={styles.motwName}>{motw.username}</Text>
              <Text style={styles.motwReason}>{motw.reason}</Text>
              <Text style={styles.motwScore}>Clout: {motw.cloutScore}</Text>
            </View>
            <Text style={{ fontSize: 28 }}>🏆</Text>
          </View>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabPill, tab === "activity" && styles.tabPillActive]}
          onPress={() => setTab("activity")}
        >
          <Text style={[styles.tabText, tab === "activity" && styles.tabTextActive]}>Activity</Text>
        </Pressable>
        <Pressable
          style={[styles.tabPill, tab === "clout" && styles.tabPillActive]}
          onPress={() => setTab("clout")}
        >
          <Text style={[styles.tabText, tab === "clout" && styles.tabTextActive]}>Clout</Text>
        </Pressable>
      </View>

      {/* Activity Tab */}
      {tab === "activity" && (
        <>
          <Text style={styles.weekLabel}>Week of {weekLabel}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No activity yet this week</Text>
            </View>
          ) : (
            <>
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
              {entries.length >= 2 && (
                <View style={styles.chartSection}>
                  <Text style={styles.chartLabel}>Score Distribution</Text>
                  <MiniChart
                    data={entries.slice(0, 5).map(e => e.score)}
                    type="bar"
                    color="#FFD54F"
                    height={70}
                  />
                  <View style={styles.chartNames}>
                    {entries.slice(0, 5).map((e, i) => (
                      <Text key={e.inboxId} style={styles.chartName} numberOfLines={1}>
                        {i < 3 ? MEDALS[i] : `${i + 1}`}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              <Text style={styles.formula}>Score = msgs×3 + received×2 + given×1</Text>
            </>
          )}
        </>
      )}

      {/* Clout Tab */}
      {tab === "clout" && (
        <>
          {cloutProfiles.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No CloutScores yet — keep chatting, trading, and stacking bananas!</Text>
            </View>
          ) : (
            <>
              {cloutProfiles.map((p, i) => {
                const isMe = p.inboxId === myInboxId;
                return (
                  <View key={p.inboxId} style={[styles.row, isMe && styles.rowMe, p.flair ? styles.rowAlpha : null]}>
                    <Text style={styles.rank}>{getRankDisplay(p.rank)}</Text>
                    {p.nftImage ? (
                      <Image source={{ uri: p.nftImage }} style={styles.pfp} />
                    ) : (
                      <View style={[styles.pfp, styles.pfpFallback]} />
                    )}
                    <View style={styles.info}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={styles.username} numberOfLines={1}>
                          {p.username}{isMe ? " (you)" : ""}
                        </Text>
                        {p.flair && (
                          <View style={styles.flairBadge}>
                            <Text style={styles.flairText}>{p.flair}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.stats}>
                        {p.streakDays}d streak · {p.messagesThisWeek} msgs · {p.bananaBalance} 🍌
                      </Text>
                    </View>
                    <Text style={styles.score}>{p.cloutScore}</Text>
                  </View>
                );
              })}
              <Text style={styles.formula}>
                Clout = streaks 15% + trades 20% + predictions 10% + bets 10% + alpha 10% + activity 15% + bananas 20%
              </Text>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 4 },

  // MOTW
  motwCard: {
    backgroundColor: "rgba(255,213,79,0.06)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.2)",
    padding: 14,
    marginBottom: 10,
  },
  motwTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#FFD54F",
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 10,
  },
  motwContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  motwPfp: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "#FFD54F",
    alignItems: "center",
    justifyContent: "center",
  },
  motwInfo: { flex: 1, gap: 2 },
  motwName: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text },
  motwReason: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted },
  motwScore: { fontFamily: FONTS.mono, fontSize: 10, color: "#FFD54F" },

  // Tabs
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  tabPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
  },
  tabPillActive: {
    backgroundColor: "rgba(153,69,255,0.12)",
    borderColor: "rgba(153,69,255,0.3)",
  },
  tabText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
  tabTextActive: { color: "#9945FF" },

  // Rows
  weekLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginBottom: 6 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
  },
  rowMe: { borderColor: "rgba(124,58,237,0.3)", backgroundColor: "rgba(124,58,237,0.06)" },
  rowAlpha: { borderColor: "rgba(255,213,79,0.25)", backgroundColor: "rgba(255,213,79,0.04)" },
  rank: { fontFamily: FONTS.display, fontSize: 16, width: 28, textAlign: "center", color: THEME.text },
  pfp: { width: 34, height: 34, borderRadius: 17 },
  pfpFallback: { backgroundColor: "rgba(153,69,255,0.15)" },
  info: { flex: 1 },
  username: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  stats: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 1 },
  score: { fontFamily: FONTS.display, fontSize: 16, color: "#FFD54F", minWidth: 36, textAlign: "right" },
  formula: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textFaint, textAlign: "center", marginTop: 6 },

  // Flair badge
  flairBadge: {
    backgroundColor: "rgba(255,213,79,0.15)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  flairText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#FFD54F",
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Chart
  chartSection: {
    marginTop: 12,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    padding: 12,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
  },
  chartLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  chartNames: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 4,
  },
  chartName: {
    flex: 1,
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    textAlign: "center",
  },
  empty: { padding: 20, alignItems: "center" },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center" },
});
