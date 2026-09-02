/**
 * LeaderboardView — Top Traders scorecard.
 *
 *   1. AI Agent #9385 — Actual trades + Monitored (Hermes TA) books
 *   2. Community — Saga holders ranked by weekly gain
 *
 * Top Trader copy-book is NOT shown here (separate pipeline).
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, RefreshControl, ScrollView, Image, Pressable, Linking } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import {
  fetchTopTraders,
  isBotTrader,
  BOT_LEADERBOARD_PFP,
  BOT_LEADERBOARD_NAME,
  type TopTrader,
} from "@/lib/topTraders";
import { useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { WorldGlassFill } from "@/components/WorldGlassFill";
import { useAppStore } from "@/store/appStore";
import { CopyTradeToggle } from "@/components/CopyTradeToggle";
import { toast } from "sonner-native";

const TENSOR_SAGA_URL = "https://www.tensor.trade/trade/sagamonkes";

/** Genesis-only holders (no Saga Monke → `verified` false) can view the
 *  leaderboard but can't copy-trade or run AutonoMonke — those require a
 *  live Saga Monke ownership check the bot enforces server-side too.
 *  Explain the gate + link out rather than silently hiding the toggle. */
function explainCopyTradeGate() {
  toast(
    "Copy-Trades & AutonoMonke (MonkeBrain) require a Saga Monkes NFT — tap to get one on Tensor",
    {
      action: {
        label: "Open Tensor",
        onClick: () => Linking.openURL(TENSOR_SAGA_URL).catch(() => {}),
      },
      duration: 6000,
    },
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];
const PODIUM_BORDER = ["#FFD700", "#C0C0C0", "#CD7F32"]; // gold, silver, bronze
/** Shared green for both bot books (Actual + Monitored). */
const BOT_ACCENT = "#44DDBB";

function botBookTitle(t: TopTrader): string {
  if (t.kind === "bot_entered") return "Actual trades";
  if (t.kind === "bot_monitored") return "Monitored book";
  return "Bot book";
}

function botBookDetail(t: TopTrader): string {
  if (t.kind === "bot_entered") {
    return "AutonoMonke positions the bot opened & closed";
  }
  if (t.kind === "bot_monitored") {
    return "Hermes TA-alert outcomes the bot tracked (not Top Trader buys)";
  }
  return "";
}

function BotBookCard({
  t,
  worldId,
  cardStyle,
}: {
  t: TopTrader;
  worldId?: string;
  cardStyle: object;
}) {
  const isEntered = t.kind === "bot_entered";
  const badge = isEntered ? "ACTUAL" : "WATCH";
  const pfp = t.nftImage && t.nftImage.startsWith("http") ? t.nftImage : BOT_LEADERBOARD_PFP;

  return (
    <View style={[styles.row, styles.botRow, cardStyle, { borderColor: `${BOT_ACCENT}99` }]}>
      {worldId ? <WorldGlassFill worldId={worldId} blur={false} showHighlight={false} /> : null}
      <View style={[styles.botBadge, { backgroundColor: `${BOT_ACCENT}33` }]}>
        <Text style={[styles.botBadgeText, { color: BOT_ACCENT }]}>{badge}</Text>
      </View>
      <Image
        source={{ uri: pfp }}
        style={[styles.pfp, styles.botPfp, { borderColor: BOT_ACCENT }]}
      />
      <View style={styles.info}>
        <Text style={styles.username} numberOfLines={1}>
          {BOT_LEADERBOARD_NAME}
        </Text>
        <Text style={[styles.bookTitle, { color: BOT_ACCENT }]} numberOfLines={1}>
          {botBookTitle(t)}
        </Text>
        <Text style={styles.stats} numberOfLines={1}>
          {t.winRatePct}% all-time win rate
        </Text>
      </View>
      <View style={styles.scoreCol}>
        <Text style={[styles.score, t.weeklyGainPct < 0 && styles.scoreNegative]}>
          {t.weeklyGainPct >= 0 ? "+" : ""}
          {t.weeklyGainPct}%
        </Text>
        <Text style={styles.scoreCaption}>this week</Text>
        {typeof t.lifetimeGainPct === "number" ? (
          <Text style={styles.lifetimeCaption}>
            {t.lifetimeGainPct >= 0 ? "+" : ""}
            {t.lifetimeGainPct}% lifetime
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function HolderRow({
  t,
  worldId,
  cardStyle,
  copyTradeUnlocked,
}: {
  t: TopTrader;
  worldId?: string;
  cardStyle: object;
  copyTradeUnlocked: boolean;
}) {
  const rankLabel = t.rank <= 3 && t.rank >= 1 ? MEDALS[t.rank - 1] : `${t.rank}.`;
  const podium = t.rank >= 1 && t.rank <= 3 ? PODIUM_BORDER[t.rank - 1] : undefined;
  const isCopySlot = t.rank === 1 || t.rank === 3;
  const copyEnabled = useAppStore((s) => s.copyTradeSlots?.[t.rank as 1 | 3]?.enabled ?? false);

  return (
    <View
      style={[
        styles.row,
        styles.communityRow,
        cardStyle,
        podium
          ? { borderWidth: 1.5, borderColor: podium }
          : { borderWidth: 0.75, borderColor: "transparent" },
      ]}
    >
      {worldId ? <WorldGlassFill worldId={worldId} blur={false} showHighlight={false} /> : null}
      <Text style={styles.rank}>{rankLabel}</Text>
      {t.nftImage ? (
        <Image source={{ uri: t.nftImage }} style={[styles.pfp, styles.communityPfp]} />
      ) : (
        <View style={[styles.pfp, styles.communityPfp, styles.pfpFallback]}>
          <Text style={{ fontSize: 18 }}>🐒</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.username} numberOfLines={1}>
          {t.monkeName?.trim() || `Trader #${t.rank}`}
        </Text>
        <Text style={styles.stats}>{t.winRatePct}% win rate</Text>
      </View>
      <View style={styles.scoreCol}>
        <Text style={[styles.score, t.weeklyGainPct < 0 && styles.scoreNegative]}>
          {t.weeklyGainPct >= 0 ? "+" : ""}
          {t.weeklyGainPct}%
        </Text>
        {typeof t.lifetimeGainPct === "number" ? (
          <Text style={styles.lifetimeCaption}>
            {t.lifetimeGainPct >= 0 ? "+" : ""}
            {t.lifetimeGainPct}% lifetime
          </Text>
        ) : null}
      </View>
      {isCopySlot ? (
        <View style={styles.copyToggleCol}>
          {copyTradeUnlocked ? (
            <CopyTradeToggle slot={t.rank as 1 | 3} enabled={copyEnabled} />
          ) : (
            <Pressable onPress={explainCopyTradeGate} hitSlop={8}>
              <Text style={styles.lockIcon}>🔒</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function LeaderboardView() {
  const [traders, setTraders] = useState<TopTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cardStyle = useWorldGlassCardStyle();
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;
  // Genesis-only holders (no Saga Monke) can view this leaderboard but
  // can't copy-trade or run AutonoMonke — the bot's own gates enforce this
  // server-side too, this is just making the gate visible + actionable.
  const copyTradeUnlocked = useAppStore((s) => s.verified);

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
    const entered = bots.filter((t) => t.kind === "bot_entered");
    const monitored = bots.filter((t) => t.kind === "bot_monitored");
    const otherBots = bots.filter((t) => t.kind !== "bot_entered" && t.kind !== "bot_monitored");
    const orderedBots = [...entered, ...monitored, ...otherBots];
    const holders = traders.filter((t) => !isBotTrader(t) && t.rank > 0);
    return { botRows: orderedBots, holderRows: holders };
  }, [traders]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.textMuted} />}
    >
      {/* Single title bar — no duplicate "Leaderboard" */}
      <Text style={styles.header}>TOP TRADERS</Text>
      <Text style={styles.subheader}>
        Bot books · community ranked by weekly gain
      </Text>

      {!copyTradeUnlocked ? (
        <Pressable
          style={styles.gateBanner}
          onPress={() => Linking.openURL(TENSOR_SAGA_URL).catch(() => {})}
        >
          <Text style={styles.gateBannerText}>
            🔒 To activate Copy-Trades or AutonoMonke trades via MonkeBrain, you'll need a Saga Monkes NFT.{" "}
            <Text style={styles.gateBannerLink}>Get one on Tensor →</Text>
          </Text>
        </Pressable>
      ) : null}

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
              {botRows.map((t, i) => (
                <View key={t.kind ?? `bot-${i}`}>
                  <BotBookCard t={t} worldId={worldId} cardStyle={cardStyle} />
                  <Text style={styles.botHint}>{botBookDetail(t)}</Text>
                </View>
              ))}
            </>
          ) : null}

          {holderRows.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, botRows.length > 0 && styles.sectionLabelSpaced]}>
                COMMUNITY
              </Text>
              {holderRows.map((t) => (
                <HolderRow
                  key={`h-${t.rank}-${t.monkeName ?? ""}`}
                  t={t}
                  worldId={worldId}
                  cardStyle={cardStyle}
                  copyTradeUnlocked={copyTradeUnlocked}
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
            Actual = AutonoMonke · Monitored = Hermes TA alerts · Top Trader buys are a separate copy-book
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingTop: 0, paddingBottom: 16, gap: 0 },

  header: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#FFD54F",
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 4,
    marginTop: 0,
  },
  subheader: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    textAlign: "center",
    marginBottom: 12,
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
    textAlign: "left",
    marginBottom: 10,
    marginTop: -4,
    marginLeft: 4,
    paddingHorizontal: 8,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 0.75,
    marginBottom: 8,
    overflow: "hidden",
    minHeight: 64,
  },
  botRow: {
    borderWidth: 1.25,
  },
  communityRow: {
    minHeight: 64,
  },
  botBadge: {
    position: "absolute",
    top: 6,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 2,
  },
  botBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  communityPfp: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  pfpFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(153,69,255,0.15)",
  },
  info: { flex: 1, paddingRight: 4 },
  username: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  bookTitle: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
    letterSpacing: 0.3,
  },
  stats: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 1 },
  scoreCol: { alignItems: "flex-end", minWidth: 56 },
  score: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#44ff88",
    minWidth: 52,
    textAlign: "right",
  },
  scoreCaption: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: THEME.textFaint,
    marginTop: 1,
  },
  scoreNegative: { color: "#FF6B6B" },
  lifetimeCaption: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: THEME.textFaint,
    marginTop: 1,
    textAlign: "right",
  },
  copyToggleCol: {
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  lockIcon: {
    fontSize: 16,
    opacity: 0.6,
  },
  gateBanner: {
    marginHorizontal: 4,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.35)",
    backgroundColor: "rgba(255,213,79,0.08)",
  },
  gateBannerText: {
    fontFamily: FONTS.body,
    fontSize: 11.5,
    color: THEME.textMuted,
    lineHeight: 16,
  },
  gateBannerLink: {
    color: "#FFD54F",
    fontFamily: FONTS.bodySemi,
  },
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
