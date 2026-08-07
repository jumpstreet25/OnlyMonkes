/**
 * LeaderboardView — Top Traders scorecard.
 *
 * Two sections:
 *   1. AI Agent #9385 — pinned bot books (Entered vs Monitored), with bot PFP
 *   2. Community — Saga Monkes holders active this week (smart-money pipeline)
 *
 * Anonymous ranks + win rate + weekly gain %; optional public NFT/bot pfp
 * (never a wallet address).
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, RefreshControl, ScrollView, Image } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { fetchTopTraders, isBotTrader, type TopTrader } from "@/lib/topTraders";
import { useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { WorldGlassFill } from "@/components/WorldGlassFill";
import { useAppStore } from "@/store/appStore";

const MEDALS = ["🥇", "🥈", "🥉"];

function botBookLabel(t: TopTrader): string {
  if (t.kind === "bot_entered") return "Entered trades";
  if (t.kind === "bot_monitored") return "Monitored book";
  return "Bot";
}

function botBookHint(t: TopTrader): string {
  if (t.kind === "bot_entered") {
    return "AutonoMonke positions the bot opened";
  }
  if (t.kind === "bot_monitored") {
    return "Round-trips on wallets the bot tracks";
  }
  return "";
}

function TraderRow({
  t,
  worldId,
  cardStyle,
  rankLabel,
  subtitle,
}: {
  t: TopTrader;
  worldId?: string;
  cardStyle: object;
  rankLabel: string;
  subtitle: string;
}) {
  const bot = isBotTrader(t);
  return (
    <View style={[styles.row, cardStyle, bot && styles.botRow]}>
      {worldId ? <WorldGlassFill worldId={worldId} blur={false} showHighlight={false} /> : null}
      <Text style={styles.rank}>{rankLabel}</Text>
      {t.nftImage ? (
        <Image source={{ uri: t.nftImage }} style={[styles.pfp, bot && styles.botPfp]} />
      ) : (
        <View style={[styles.pfp, styles.pfpFallback]}>
          <Text style={{ fontSize: 16 }}>{bot ? "🤖" : "🐒"}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.username} numberOfLines={1}>
          {t.monkeName?.trim() || (bot ? "AI Agent #9385" : `Trader #${t.rank}`)}
        </Text>
        <Text style={styles.stats} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.score, t.weeklyGainPct < 0 && styles.scoreNegative]}>
        {t.weeklyGainPct >= 0 ? "+" : ""}
        {t.weeklyGainPct}%
      </Text>
    </View>
  );
}

export function LeaderboardView() {
  const [traders, setTraders] = useState<TopTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cardStyle = useWorldGlassCardStyle();
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  const load = useCallback(async (forceRefresh = false) => {
    const entries = await fetchTopTraders(forceRefresh);
    setTraders(entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const { botRows, holderRows } = useMemo(() => {
    const bots = traders.filter(isBotTrader);
    const holders = traders.filter((t) => !isBotTrader(t));
    return { botRows: bots, holderRows: holders };
  }, [traders]);

  return (
    <ScrollView
      style={styles.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.textMuted} />}
    >
      <Text style={styles.header}>TOP TRADERS</Text>
      <Text style={styles.subheader}>
        Bot books + Saga Monkes holders — win rate & weekly gain
      </Text>

      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      ) : traders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No active traders this week yet — check back after the next refresh 🐒
          </Text>
        </View>
      ) : (
        <>
          {botRows.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>AI AGENT #9385</Text>
              {botRows.map((t) => (
                <TraderRow
                  key={t.kind ?? t.monkeName ?? "bot"}
                  t={t}
                  worldId={worldId}
                  cardStyle={cardStyle}
                  rankLabel={t.kind === "bot_entered" ? "⚡" : "👁"}
                  subtitle={`${t.winRatePct}% win rate · ${botBookLabel(t)}`}
                />
              ))}
              <Text style={styles.botHint}>
                {botRows.map(botBookHint).filter(Boolean).join(" · ")}
              </Text>
            </>
          ) : null}

          {holderRows.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, botRows.length > 0 && styles.sectionLabelSpaced]}>
                COMMUNITY
              </Text>
              {holderRows.map((t) => (
                <TraderRow
                  key={`h-${t.rank}-${t.monkeName ?? ""}`}
                  t={t}
                  worldId={worldId}
                  cardStyle={cardStyle}
                  rankLabel={t.rank <= 3 ? MEDALS[t.rank - 1] : `${t.rank}.`}
                  subtitle={`${t.winRatePct}% win rate`}
                />
              ))}
            </>
          ) : botRows.length > 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No community traders with closed trades this week yet
              </Text>
            </View>
          ) : null}

          <Text style={styles.formula}>
            Bot: all-time win rate · weekly avg gain when available · Community: active this week,
            ranked by weekly gain
          </Text>
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

  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 2,
  },
  sectionLabelSpaced: {
    marginTop: 14,
  },
  botHint: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
    textAlign: "center",
    marginBottom: 4,
    marginTop: -2,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 0.75,
    marginBottom: 8,
    overflow: "hidden",
  },
  botRow: {
    borderColor: "rgba(153,69,255,0.45)",
  },
  rank: {
    fontFamily: FONTS.display,
    fontSize: 16,
    width: 28,
    textAlign: "center",
    color: THEME.text,
  },
  pfp: { width: 34, height: 34, borderRadius: 17 },
  botPfp: {
    borderWidth: 1.5,
    borderColor: "rgba(153,69,255,0.7)",
  },
  pfpFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(153,69,255,0.15)",
  },
  info: { flex: 1 },
  username: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  stats: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 1 },
  score: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#44ff88",
    minWidth: 52,
    textAlign: "right",
  },
  scoreNegative: { color: "#FF6B6B" },
  formula: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
    textAlign: "center",
    marginTop: 6,
  },

  empty: { padding: 20, alignItems: "center" },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
  },
});
