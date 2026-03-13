/**
 * BotChannelScreen
 *
 * Read-only bot alert feed for categorized channels (Bets, Trades, Sales).
 * Same layout as DAppChatScreen but without ChatInput — users only read alerts.
 */

import React, { useCallback, useEffect, useRef } from "react";
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
import { THEME, FONTS } from "@/lib/constants";
import type { ChatMessage } from "@/types";

// No-ops for read-only channel — users can't react or reply to bot alerts
const noop = () => {};

const CHANNEL_CONFIG = {
  bets: {
    name: "Monke Bets",
    img: require("../../assets/MonkeBets.png"),
    emptyText: "No sports bet alerts yet.",
  },
  trades: {
    name: "Monke Trades",
    img: require("../../assets/MonkeTrades.png"),
    emptyText: "No trade alerts yet.",
  },
  sales: {
    name: "Monke Sales",
    img: require("../../assets/MonkeSales.png"),
    emptyText: "No sales alerts yet.",
  },
  predictions: {
    name: "Monke Predictions",
    img: require("../../assets/MonkePredictions.png"),
    emptyText: "No prediction alerts yet.",
  },
} as const;

interface BotChannelScreenProps {
  channelId: "bets" | "trades" | "sales" | "predictions";
}

export default function BotChannelScreen({ channelId }: BotChannelScreenProps) {
  const insets = useSafeAreaInsets();
  const { myInboxId, botChannelIds } = useAppStore();
  const groupId = botChannelIds[channelId];
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>{"\u2039"}</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <Image source={config.img} style={styles.headerImage} />
          <View>
            <Text style={styles.headerTitle}>{config.name}</Text>
            <View style={styles.headerStatus}>
              <View style={styles.liveDot} />
              <Text style={styles.headerSubtitle}>Bot Alerts · Live</Text>
            </View>
          </View>
        </View>

        {/* Spacer to balance back button */}
        <View style={styles.backBtn} />
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
          {/* Loading history banner */}
          {isLoadingHistory && (
            <View style={styles.historyLoading}>
              <ActivityIndicator size="small" color={THEME.accent} />
              <Text style={styles.historyLoadingText}>Loading messages...</Text>
            </View>
          )}

          {/* Empty state */}
          {!isLoadingHistory && messages.length === 0 && (
            <View style={styles.emptyState}>
              <Image source={config.img} style={styles.emptyImage} />
              <Text style={styles.emptyTitle}>No alerts yet</Text>
              <Text style={styles.emptySubtitle}>{config.emptyText}</Text>
            </View>
          )}

          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={messages}
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

const HEADER_BG = "#20203A";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: HEADER_BG,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    fontSize: 34,
    color: THEME.textMuted,
    lineHeight: 38,
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  headerTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 15,
    color: THEME.text,
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#44ff88",
  },
  headerSubtitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
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

  listContent: {
    paddingVertical: 8,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
});
