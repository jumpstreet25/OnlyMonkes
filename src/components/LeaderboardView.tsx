/**
 * LeaderboardView — Top Traders scorecard.
 *
 * 2026-07-31: replaced the old Activity/Clout leaderboard (community
 * engagement metrics) with a leaderboard of the top Saga Monkes holders
 * who are ALSO consistently profitable traders — sourced from
 * Monke_Eliza's smart-money pipeline (holder discovery -> on-chain vet ->
 * weekly refresh) via the onlymonkes-actions worker's /api/top-traders.
 *
 * Privacy: entries are anonymous ranks only — win rate % and this week's
 * gain % — never a wallet address, never a $/SOL amount. The bot-side
 * payload validator enforces this before it ever reaches the worker, and
 * this screen has no wallet identity to attach even if it wanted to (these
 * are external holder wallets, not necessarily OnlyMonkes app users).
 */

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, RefreshControl, ScrollView } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { fetchTopTraders, type TopTrader } from "@/lib/topTraders";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardView() {
  const [traders, setTraders] = useState<TopTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (forceRefresh = false) => {
    const entries = await fetchTopTraders(forceRefresh);
    setTraders(entries);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.textMuted} />}
    >
      <Text style={styles.header}>TOP TRADERS</Text>
      <Text style={styles.subheader}>Saga Monkes holders with the best trading track record</Text>

      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      ) : traders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No data yet — check back soon 🐒</Text>
        </View>
      ) : (
        <>
          {traders.map((t) => (
            <View key={t.rank} style={styles.row}>
              <Text style={styles.rank}>
                {t.rank <= 3 ? MEDALS[t.rank - 1] : `${t.rank}.`}
              </Text>
              <View style={[styles.pfp, styles.pfpFallback]}>
                <Text style={{ fontSize: 16 }}>🐒</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.username}>Trader #{t.rank}</Text>
                <Text style={styles.stats}>{t.winRatePct}% win rate</Text>
              </View>
              <Text style={[styles.score, t.weeklyGainPct < 0 && styles.scoreNegative]}>
                {t.weeklyGainPct >= 0 ? "+" : ""}{t.weeklyGainPct}%
              </Text>
            </View>
          ))}
          <Text style={styles.formula}>Weekly gain % · ranked by this week's performance · refreshed weekly</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { gap: 4 },

  header: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#FFD54F",
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 4,
  },
  subheader: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    textAlign: "center",
    marginBottom: 14,
  },

  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  rank: { fontFamily: FONTS.display, fontSize: 16, width: 28, textAlign: "center", color: THEME.text },
  pfp: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  pfpFallback: { backgroundColor: "rgba(153,69,255,0.15)" },
  info: { flex: 1 },
  username: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  stats: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 1 },
  score: { fontFamily: FONTS.display, fontSize: 16, color: "#44ff88", minWidth: 52, textAlign: "right" },
  scoreNegative: { color: "#FF6B6B" },
  formula: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textFaint, textAlign: "center", marginTop: 6 },

  empty: { padding: 20, alignItems: "center" },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center" },
});
