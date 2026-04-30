/**
 * BotChannelScreen
 *
 * Read-only bot alert feed for categorized channels (Bets, Trades, Sales).
 * Same layout as DAppChatScreen but without ChatInput — users only read alerts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Image,
  ImageBackground,
  ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { useGroupChat } from "@/hooks/useGroupChat";
import { MessageBubble } from "@/components/MessageBubble";
import { triggerProfileRebroadcast } from "@/hooks/useXmtp";
import AutonoMonkeDisclaimerModal, { type AutonomyFeature } from "@/components/AutonoMonkeDisclaimerModal";
import { getXmtpClient } from "@/hooks/useXmtp";
import { sendDmMessage } from "@/lib/xmtp";
import { THEME, FONTS } from "@/lib/constants";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useThemeColor } from "@/lib/shopTheme";
import { markChannelRead } from "@/lib/messageCache";
import type { ChatMessage } from "@/types";

const BOT_INBOX_ID = "998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363";

const AUTONOMY_CONFIG: Record<string, { command: string; storageKey: string }> = {
  trades:      { command: "/automonke start",      storageKey: "automonke_enrolled" },
  bets:        { command: "/monkebets start",      storageKey: "monkebets_enrolled" },
  predictions: { command: "/monkepredictions start", storageKey: "monkepredictions_enrolled" },
};

// No-ops for read-only channel — users can't react or reply to bot alerts
const noop = (..._args: any[]) => {};

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
  const { myInboxId, botChannelIds, mutedBotChannels, toggleBotChannelMute, mutedSports, toggleSportMute, username } = useAppStore();
  const groupId = botChannelIds[channelId];
  const isMuted = mutedBotChannels[channelId];
  const config = CHANNEL_CONFIG[channelId];
  const [showAutonoMonkeModal, setShowAutonoMonkeModal] = useState(false);
  const [autonomyEnrolled, setAutonomyEnrolled] = useState(false);
  const [showAllOverride, setShowAllOverride] = useState(false);
  const hasAutonomy = channelId in AUTONOMY_CONFIG;

  const themeBg = useThemeColor('bg');
  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');
  const themeAccent = useThemeColor('accent');
  const hasThemeOverride = useAppStore(s => !!s.themeOverrides);

  // PFP Full Theme: tint channel headers with NFT color
  const shopStyles = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  const pfpFullThemeActive = !!(shopStyles?.pfpFullTheme && nftDominantColor);

  // Check enrollment on mount
  useEffect(() => {
    if (hasAutonomy) {
      const key = AUTONOMY_CONFIG[channelId].storageKey;
      AsyncStorage.getItem(key).then(v => {
        if (v === "1") setAutonomyEnrolled(true);
      }).catch(() => {});
    }
  }, [channelId]);

  const {
    messages,
    isLoading,
    isLoadingHistory,
    error,
    initialize,
    disconnect,
  } = useGroupChat(groupId, config.name);

  // Mark channel read using the channelId key (matches useXmtp.ts unread-count
  // lookup at getLastReadTimestamp(key) where key ∈ {bets,trades,sales,predictions}).
  // useGroupChat marks read under cacheKey="monke_trades" but the unread counter
  // reads "trades" — keys must match for the badge to clear.
  useEffect(() => {
    markChannelRead(channelId).catch(() => {});
    useAppStore.getState().clearBotChannelCount?.(channelId as any);
  }, [channelId]);

  // Re-mark on every new message arrival while screen is open
  useEffect(() => {
    if (messages.length > 0) {
      markChannelRead(channelId).catch(() => {});
      useAppStore.getState().clearBotChannelCount?.(channelId as any);
    }
  }, [channelId, messages.length]);

  const flatListRef = useRef<FlatList>(null);
  const myAddress = myInboxId ?? "";

  // Autonomy enrollment handler — works for trades, bets, predictions
  const handleAutonomyEnroll = useCallback(async () => {
    setShowAutonoMonkeModal(false);
    if (!hasAutonomy) return;
    const { command, storageKey } = AUTONOMY_CONFIG[channelId];
    try {
      const client = getXmtpClient();
      if (!client) return;
      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
      if (dm) {
        await sendDmMessage(dm, command, username);
      }
      await AsyncStorage.setItem(storageKey, "1");
      setAutonomyEnrolled(true);
      // Navigate to bot DM
      router.push(`/dm/${BOT_INBOX_ID}` as any);
    } catch (err) {
      if (__DEV__) console.warn(`[Autonomy:${channelId}] Failed to send enrollment DM:`, (err as Error).message);
    }
  }, [username, channelId, hasAutonomy]);

  // Reverse messages for inverted FlatList (newest first in array = bottom of screen)
  // Security: only show messages from the bot — prevents spoofed alerts from other XMTP clients
  const reversedMessages = useMemo(() =>
    [...messages].filter(m => m.senderAddress === BOT_INBOX_ID).reverse(),
    [messages],
  );

  // Client-side filter: hide alerts for muted sports in the Bets channel
  const filteredMessages = useMemo(() => {
    if (channelId !== "bets" || mutedSports.length === 0 || showAllOverride) return reversedMessages;
    return reversedMessages.filter((msg) => {
      const text = msg.content ?? "";
      const dashMatch = text.match(/—\s*(.+)/);
      if (!dashMatch) return true;
      const sportPart = dashMatch[1].trim().split("\n")[0];
      const key = SPORT_LABEL_TO_KEY[sportPart] ?? SPORT_LABEL_TO_KEY[sportPart.toUpperCase()];
      if (!key) return true;
      return !mutedSports.includes(key);
    });
  }, [reversedMessages, mutedSports, channelId, showAllOverride]);

  useEffect(() => {
    if (groupId) initialize().catch((err) => {
      if (__DEV__) console.warn(`[BotChannel:${channelId}] init failed:`, err?.message ?? err);
    });
    return () => disconnect();
  }, [groupId]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => {
      try {
        return (
          <MessageBubble
            message={item}
            isOwn={item.senderAddress === myAddress}
            onReact={noop}
            onReply={noop}
            isBotChannel
          />
        );
      } catch (err) {
        if (__DEV__) console.warn(`[BotChannel] Failed to render message ${item.id}:`, err);
        return null;
      }
    },
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
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: themeBg }]}>
      {/* Header — matches Main Chat header layout exactly */}
      <View style={[styles.header, { backgroundColor: themeSurface, borderBottomColor: themeBorder }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>{"\u2039"}</Text>
        </Pressable>

        {/* Center: banner image — matches Main Chat header layout */}
        <ImageBackground
          source={config.banner}
          style={styles.headerCenter}
          resizeMode="contain"
        >
          {pfpFullThemeActive && !hasThemeOverride && (
            <View style={[styles.bannerTintOverlay, { backgroundColor: nftDominantColor + "4D" }]} />
          )}
        </ImageBackground>

        {/* Right column: Alert bell + Autonomy button */}
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => {
              toggleBotChannelMute(channelId);
              triggerProfileRebroadcast(useAppStore.getState().expoPushToken ?? "").catch(() => {});
            }}
            style={[styles.muteBtn, isMuted && styles.muteBtnMuted, pfpFullThemeActive && !isMuted && { backgroundColor: nftDominantColor + "26" }]}
            hitSlop={8}
          >
            <Text style={[styles.muteBtnText, isMuted && styles.muteBtnTextMuted, pfpFullThemeActive && !isMuted && { color: nftDominantColor }]}>
              {isMuted ? "🔇 Muted" : "🔔 On"}
            </Text>
          </Pressable>

          {hasAutonomy && (
            <Pressable
              onPress={() => {
                if (autonomyEnrolled) {
                  router.push(`/dm/${BOT_INBOX_ID}` as any);
                } else {
                  setShowAutonoMonkeModal(true);
                }
              }}
              style={[styles.autonomyBtn, autonomyEnrolled && styles.autonomyBtnActive]}
              hitSlop={8}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {autonomyEnrolled && <View style={styles.blueCheck}><Text style={styles.blueCheckText}>✓</Text></View>}
                <Text style={[styles.autonomyBtnText, autonomyEnrolled && styles.autonomyBtnTextActive]}>
                  AutonoMonke
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      </View>

      {/* Bot Alerts · Live status bar */}
      <View style={[styles.statusBar, hasThemeOverride && { backgroundColor: themeSurface, borderBottomColor: themeBorder }]}>
        <View style={[styles.liveDot, hasThemeOverride && { backgroundColor: themeAccent }, pfpFullThemeActive && { backgroundColor: nftDominantColor }]} />
        <Text style={[styles.statusText, hasThemeOverride && { color: themeAccent }, pfpFullThemeActive && { color: nftDominantColor }]}>Bot Alerts · Live</Text>
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
          <ErrorMessage message={error} onRetry={initialize} />
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

          {/* Filtered-out notice — all messages hidden by sport filters */}
          {!isLoadingHistory && filteredMessages.length === 0 && messages.length > 0 && channelId === "bets" && (
            <Pressable
              style={styles.filteredNotice}
              onPress={() => setShowAllOverride(true)}
            >
              <Text style={styles.filteredNoticeText}>
                {messages.length} alerts hidden by sport filters
              </Text>
              <Text style={styles.filteredNoticeAction}>Tap to show all</Text>
            </Pressable>
          )}

          {/* Empty state */}
          {!isLoadingHistory && filteredMessages.length === 0 && (messages.length === 0 || channelId !== "bets") && (
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
            inverted
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={10}
          />
        </>
      )}

      <View style={{ height: insets.bottom }} />

      {/* Autonomy disclaimer modal (only for channels with autonomy features) */}
      {hasAutonomy && (
        <AutonoMonkeDisclaimerModal
          visible={showAutonoMonkeModal}
          onClose={() => setShowAutonoMonkeModal(false)}
          onConfirm={handleAutonomyEnroll}
          feature={channelId as AutonomyFeature}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 80,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: "transparent",
  },
  headerCenter: {
    flex: 1,
    height: 68,
    alignSelf: "center",
    overflow: "hidden",
  },
  bannerTintOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 4,
  },
  backBtn: {
    width: 58,
    height: 58,
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
  headerRight: {
    alignItems: "center",
    gap: 6,
    zIndex: 1,
  },
  muteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    minWidth: 44,
    alignItems: "center",
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

  filteredNotice: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    margin: 12,
    borderRadius: 12,
    backgroundColor: "rgba(108, 180, 238, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.2)",
  },
  filteredNoticeText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
  },
  filteredNoticeAction: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: THEME.accent,
    marginTop: 4,
  },

  listContent: {
    paddingVertical: 8,
  },

  autonomyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(124, 58, 237, 0.15)",
    minWidth: 44,
    alignItems: "center",
  },
  autonomyBtnActive: {
    backgroundColor: "rgba(124, 58, 237, 0.3)",
  },
  autonomyBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 10,
    color: "#A78BFA",
  },
  autonomyBtnTextActive: {
    color: "#C4B5FD",
  },
  blueCheck: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#1D9BF0",
    alignItems: "center",
    justifyContent: "center",
  },
  blueCheckText: {
    fontSize: 9,
    color: "#fff",
    fontWeight: "700",
    lineHeight: 13,
  },
});
