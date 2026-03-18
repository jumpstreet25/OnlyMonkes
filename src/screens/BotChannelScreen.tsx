/**
 * BotChannelScreen
 *
 * Read-only bot alert feed for categorized channels (Bets, Trades, Sales).
 * Same layout as DAppChatScreen but without ChatInput — users only read alerts.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Image,
  ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { useGroupChat } from "@/hooks/useGroupChat";
import { MessageBubble } from "@/components/MessageBubble";
import { triggerProfileRebroadcast } from "@/hooks/useXmtp";
import { THEME, FONTS } from "@/lib/constants";
import type { ChatMessage } from "@/types";

// No-ops for read-only channel — users can't react or reply to bot alerts
const noop = () => {};

const SPORTS_LIST = [
  { key: "nfl", label: "NFL 🏈" },
  { key: "ncaaf", label: "NCAAF 🏈" },
  { key: "nba", label: "NBA 🏀" },
  { key: "ncaab", label: "NCAAB 🏀" },
  { key: "mlb", label: "MLB ⚾" },
  { key: "nhl", label: "NHL 🏒" },
  { key: "epl", label: "EPL ⚽" },
  { key: "ucl", label: "UCL ⚽" },
  { key: "mma", label: "MMA 🥊" },
] as const;

// Map sport labels (as they appear in alert messages) → mute keys
const SPORT_LABEL_TO_KEY: Record<string, string> = {};
for (const s of SPORTS_LIST) {
  // Extract text before emoji, e.g. "NFL 🏈" → "NFL"
  const textOnly = s.label.replace(/\s*[\u{1F000}-\u{1FFFF}]/u, "").trim();
  SPORT_LABEL_TO_KEY[textOnly.toUpperCase()] = s.key;
  SPORT_LABEL_TO_KEY[s.label] = s.key; // full label match too
}

const CHANNEL_CONFIG = {
  bets: {
    name: "Monke Bets",
    img: require("../../assets/MonkeBets.png"),
    banner: require("../../assets/Bets.png"),
    emptyText: "No sports bet alerts yet.",
  },
  trades: {
    name: "Monke Trades",
    img: require("../../assets/MonkeTrades.png"),
    banner: require("../../assets/Trade.png"),
    emptyText: "No trade alerts yet.",
  },
  sales: {
    name: "Monke Sales",
    img: require("../../assets/MonkeSales.png"),
    banner: require("../../assets/Sales.png"),
    emptyText: "No sales alerts yet.",
  },
  predictions: {
    name: "Monke Predictions",
    img: require("../../assets/MonkePredictions.png"),
    banner: require("../../assets/Predictions.png"),
    emptyText: "No prediction alerts yet.",
  },
} as const;

interface BotChannelScreenProps {
  channelId: "bets" | "trades" | "sales" | "predictions";
}

export default function BotChannelScreen({ channelId }: BotChannelScreenProps) {
  const insets = useSafeAreaInsets();
  const { myInboxId, botChannelIds, mutedBotChannels, toggleBotChannelMute, mutedSports, toggleSportMute } = useAppStore();
  const groupId = botChannelIds[channelId];
  const isMuted = mutedBotChannels[channelId];
  const config = CHANNEL_CONFIG[channelId];

  const {
    messages,
    isLoading,
    isLoadingHistory,
    error,
    initialize,
    disconnect,
  } = useGroupChat(groupId, config.name);

  const flatListRef = useRef<FlatList>(null);
  const myAddress = myInboxId ?? "";

  // Client-side filter: hide alerts for muted sports in the Bets channel
  const filteredMessages = useMemo(() => {
    if (channelId !== "bets" || mutedSports.length === 0) return messages;
    return messages.filter((msg) => {
      const text = msg.content ?? "";
      // Sports alerts have "— SPORT_LABEL" on first line (e.g. "— NFL 🏈")
      const dashMatch = text.match(/—\s*(.+)/);
      if (!dashMatch) return true; // not a sports alert, keep it
      const sportPart = dashMatch[1].trim().split("\n")[0]; // first line only
      const key = SPORT_LABEL_TO_KEY[sportPart] ?? SPORT_LABEL_TO_KEY[sportPart.toUpperCase()];
      if (!key) return true; // unknown sport, keep it
      return !mutedSports.includes(key);
    });
  }, [messages, mutedSports, channelId]);

  useEffect(() => {
    if (groupId) initialize();
    return () => disconnect();
  }, [groupId]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={item.senderAddress === myAddress}
        onReact={noop}
        onReply={noop}
      />
    ),
    [myAddress]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // No groupId configured yet
  if (!groupId) {
    return (
      <View
        style={[styles.container, styles.centerState, { paddingTop: insets.top }]}
      >
        <Image source={config.img} style={styles.emptyImage} />
        <Text style={styles.centerText}>{config.name} channel not configured yet.</Text>
        <Pressable onPress={() => router.back()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header — black bar with centered banner PNG */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>{"\u2039"}</Text>
        </Pressable>

        {/* Center: banner image — contain so full PNG is visible, never cropped */}
        <View style={styles.headerCenter}>
          <Image source={config.banner} style={styles.headerBanner} resizeMode="contain" />
        </View>

        {/* Mute/Unmute toggle */}
        <Pressable
          onPress={() => {
            toggleBotChannelMute(channelId);
            triggerProfileRebroadcast(useAppStore.getState().expoPushToken ?? "").catch(() => {});
          }}
          style={[styles.muteBtn, isMuted && styles.muteBtnMuted]}
          hitSlop={8}
        >
          <Text style={[styles.muteBtnText, isMuted && styles.muteBtnTextMuted]}>
            {isMuted ? "🔇 Muted" : "🔔 On"}
          </Text>
        </Pressable>
      </View>

      {/* Bot Alerts · Live status bar */}
      <View style={styles.statusBar}>
        <View style={styles.liveDot} />
        <Text style={styles.statusText}>Bot Alerts · Live</Text>
      </View>

      {/* Loading / connecting state */}
      {isLoading && (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={THEME.accent} />
          <Text style={styles.centerText}>Connecting to {config.name}...</Text>
        </View>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={initialize} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Main content */}
      {!isLoading && !error && (
        <>
          {/* Sports filter strip — Bets channel only */}
          {channelId === "bets" && (
            <View style={styles.sportsStrip}>
              <Text style={styles.sportsLabel}>Filter:</Text>
              {SPORTS_LIST.map(({ key, label }) => {
                const muted = mutedSports.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      toggleSportMute(key);
                      triggerProfileRebroadcast(useAppStore.getState().expoPushToken ?? "").catch(() => {});
                    }}
                    style={[styles.sportPill, muted && styles.sportPillMuted]}
                  >
                    <Text style={[styles.sportPillText, muted && styles.sportPillTextMuted]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Loading history banner */}
          {isLoadingHistory && (
            <View style={styles.historyLoading}>
              <ActivityIndicator size="small" color={THEME.accent} />
              <Text style={styles.historyLoadingText}>Loading messages...</Text>
            </View>
          )}

          {/* Empty state */}
          {!isLoadingHistory && filteredMessages.length === 0 && (
            <View style={styles.emptyState}>
              <Image source={config.img} style={styles.emptyImage} />
              <Text style={styles.emptyTitle}>No alerts yet</Text>
              <Text style={styles.emptySubtitle}>{config.emptyText}</Text>
            </View>
          )}

          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={filteredMessages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={10}
          />
        </>
      )}

      <View style={{ height: insets.bottom }} />
    </View>
  );
}

const HEADER_BG = "#000000";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: HEADER_BG,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBanner: {
    width: "100%",
    height: 120,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  backIcon: {
    fontSize: 34,
    color: "#fff",
    lineHeight: 38,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.bg,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#44ff88",
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  muteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    minWidth: 44,
    alignItems: "center",
    zIndex: 1,
  },
  muteBtnMuted: {
    backgroundColor: "rgba(255, 80, 80, 0.15)",
  },
  muteBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: "#6CB4EE",
  },
  muteBtnTextMuted: {
    color: "#FF5050",
  },

  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 40,
  },
  centerText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.error,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: THEME.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#fff",
  },

  historyLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  historyLoadingText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.8,
  },
  emptyTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 18,
    color: THEME.textMuted,
  },
  emptySubtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
    textAlign: "center",
    lineHeight: 20,
  },

  sportsStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.bg,
  },
  sportsLabel: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textFaint,
    marginRight: 2,
  },
  sportPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
  },
  sportPillMuted: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    opacity: 0.45,
  },
  sportPillText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: "#6CB4EE",
  },
  sportPillTextMuted: {
    color: THEME.textFaint,
    textDecorationLine: "line-through",
  },

  listContent: {
    paddingVertical: 8,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
});
