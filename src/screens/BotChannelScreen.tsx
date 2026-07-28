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
  Pressable,
  ActivityIndicator,
  Image,
  ImageBackground,
} from "react-native";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { useGroupChat } from "@/hooks/useGroupChat";
import { MessageBubble } from "@/components/MessageBubble";
import { triggerProfileRebroadcast } from "@/hooks/useXmtp";
import AutonoMonkeDisclaimerModal, { type AutonomyFeature } from "@/components/AutonoMonkeDisclaimerModal";
import AutonoMonkeSetupWizard from "@/components/AutonoMonkeSetupWizard";
import { getXmtpClient } from "@/hooks/useXmtp";
import { sendDmMessage } from "@/lib/xmtp";
import * as Haptics from "expo-haptics";
import { THEME, FONTS, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { BotChannelIcon } from "@/components/BotChannelIcon";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useThemeColor } from "@/lib/shopTheme";
import { WorldLayer } from "@/components/worlds/WorldLayer";
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
    // (v30 2026-05-09) PNG icons retired in favor of BotChannelIcon
    // (Skia vectors). The `banner` here is a separate larger artwork
    // (Bets.png / Trade.png / etc.) used elsewhere on the screen.
    banner: require("../../assets/Bets.png"),
    emptyText: "No sports bet alerts yet.",
  },
  trades: {
    name: "Monke Trades",
    banner: require("../../assets/Trade.png"),
    emptyText: "No trade alerts yet.",
  },
  sales: {
    name: "Monke Sales",
    banner: require("../../assets/Sales.png"),
    emptyText: "No sales alerts yet.",
  },
  predictions: {
    name: "Monke Predictions",
    banner: require("../../assets/Predictions.png"),
    emptyText: "No prediction alerts yet.",
  },
} as const;

interface BotChannelScreenProps {
  channelId: "bets" | "trades" | "sales" | "predictions";
}

export default function BotChannelScreen({ channelId }: BotChannelScreenProps) {
  const insets = useSafeAreaInsets();
  const { myInboxId, botChannelIds, mutedBotChannels, toggleBotChannelMute, mutedSports, toggleSportMute, mutedAlertSources, username } = useAppStore();
  const groupId = botChannelIds[channelId];
  const isMuted = mutedBotChannels[channelId];
  const config = CHANNEL_CONFIG[channelId];
  const [showAutonoMonkeModal, setShowAutonoMonkeModal] = useState(false);
  const [autonomyEnrolled, setAutonomyEnrolled] = useState(false);
  // Per-user Limit Orders opt-in (T1/T2 as on-chain resting Jupiter orders).
  // Only shown when channelId === "trades" AND user is already AutonoMonke-
  // enrolled (Limit Orders are meaningless without it). Persisted to
  // AsyncStorage so the pill reflects the right state on reopen without
  // round-tripping the bot.
  const [limitOrdersEnabled, setLimitOrdersEnabled] = useState(false);
  const [showAllOverride, setShowAllOverride] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"sports" | "sources" | null>(null);
  const hasAutonomy = channelId in AUTONOMY_CONFIG;
  const LIMIT_ORDERS_STORAGE_KEY = "autonomonke_limit_orders_v1";

  const themeBg = useThemeColor('bg');
  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');
  const themeAccent = useThemeColor('accent');
  // Equipped Chat World propagates to bot channels too — purchasers get
  // their world's backdrop everywhere they read alerts. Chrome bars get
  // the same WORLD_BAR_BG translucent treatment as the main chat so the
  // world reads through them.
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;
  const chromeBg = worldId ? getWorldBarTint(worldId) : themeSurface;
  const hasThemeOverride = useAppStore(s => !!s.themeOverrides);

  // PFP Full Theme: tint channel headers with NFT color
  const shopStyles = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  const pfpFullThemeActive = !!(shopStyles?.pfpFullTheme && nftDominantColor);

  // Ground truth from the bot's AUTOMONKE_STATUS: DM (useXmtp.ts stream
  // handler), sent after every /autonomonke command. The AsyncStorage flag
  // below is only ever set locally by THIS install completing enrollment,
  // so it silently reads OFF on a fresh app install/build even when the
  // bot never stopped trading — this corrects it the moment a status DM
  // lands.
  const automonkeStatus = useAppStore(s => s.automonkeStatus);

  // Check enrollment on mount — AsyncStorage first (fast, no round-trip),
  // then actively ask the bot for real status so a stale/missing local flag
  // self-corrects without the user having to run a command manually.
  useEffect(() => {
    if (!hasAutonomy) return;
    const key = AUTONOMY_CONFIG[channelId].storageKey;
    AsyncStorage.getItem(key).then(v => {
      if (v === "1") setAutonomyEnrolled(true);
    }).catch(() => {});

    if (channelId !== "trades") return;
    (async () => {
      try {
        const client = getXmtpClient();
        if (!client) return;
        const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
        if (dm) await sendDmMessage(dm, "/autonomonke status", username);
      } catch (err) {
        if (__DEV__) console.warn("[Autonomy:trades] status refresh DM failed:", (err as Error).message);
      }
    })();
  }, [channelId]);

  // React to the bot's answer whenever it arrives this session.
  useEffect(() => {
    if (!automonkeStatus || channelId !== "trades") return;
    setAutonomyEnrolled(automonkeStatus.enrolled);
    setLimitOrdersEnabled(automonkeStatus.limitOrdersEnabled);
  }, [automonkeStatus, channelId]);

  // Limit Orders opt-in flag — only relevant on the trades channel.
  useEffect(() => {
    if (channelId !== "trades") return;
    AsyncStorage.getItem(LIMIT_ORDERS_STORAGE_KEY).then(v => {
      if (v === "1") setLimitOrdersEnabled(true);
    }).catch(() => {});
  }, [channelId]);

  // Toggle handler — sends the DM command + optimistically flips the local
  // state. Bot DMs back confirmation; if AutonoMonke isn't enrolled the bot
  // rejects and the user sees the rejection DM. We don't roll back the
  // local flag on rejection — the pill state matches what the user asked
  // for, and the bot's reply is the authoritative source.
  const handleLimitOrdersToggle = useCallback(async () => {
    if (!autonomyEnrolled) {
      // No point toggling Limits if AutonoMonke isn't on — open the
      // enrollment modal instead.
      setShowAutonoMonkeModal(true);
      return;
    }
    const next = !limitOrdersEnabled;
    setLimitOrdersEnabled(next);
    AsyncStorage.setItem(LIMIT_ORDERS_STORAGE_KEY, next ? "1" : "0").catch(() => {});
    try {
      const client = getXmtpClient();
      if (!client) return;
      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
      if (dm) {
        await sendDmMessage(dm, `/autonomonke limits ${next ? "on" : "off"}`, username);
      }
    } catch (err) {
      if (__DEV__) console.warn("[Autonomy:trades] limits toggle DM failed:", (err as Error).message);
    }
  }, [autonomyEnrolled, limitOrdersEnabled, username]);

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

  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
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

  // Client-side filter: hide alerts for muted sports in the Bets channel,
  // AND hide alerts for muted sources (Polymarket / Drift / Kalshi) in either lane.
  // Source label is appended to alert header line 1 as " · Polymarket",
  // " · Drift", or " · Kalshi 🇺🇸" (see Monke_Eliza formatter.ts).
  const filteredMessages = useMemo(() => {
    if (showAllOverride) return reversedMessages;
    const sportFilterActive = channelId === "bets" && mutedSports.length > 0;
    const sourceFilterActive = mutedAlertSources.length > 0;
    if (!sportFilterActive && !sourceFilterActive) return reversedMessages;
    return reversedMessages.filter((msg) => {
      const text = msg.content ?? "";
      const firstLine = text.split("\n")[0] ?? "";

      if (sourceFilterActive) {
        const srcMatch = firstLine.match(/·\s*(Polymarket|Drift|Kalshi)\b/i);
        if (srcMatch) {
          const src = srcMatch[1].toLowerCase();
          if (mutedAlertSources.includes(src)) return false;
        }
      }
      if (sportFilterActive) {
        const dashMatch = firstLine.match(/—\s*(.+)/);
        if (dashMatch) {
          // Sport label is the first segment after — and before any · source tag.
          const sportPart = dashMatch[1].trim().split("·")[0].trim();
          const key = SPORT_LABEL_TO_KEY[sportPart] ?? SPORT_LABEL_TO_KEY[sportPart.toUpperCase()];
          if (key && mutedSports.includes(key)) return false;
        }
      }
      return true;
    });
  }, [reversedMessages, mutedSports, mutedAlertSources, channelId, showAllOverride]);

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
            onOpenActions={noop}
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
        <BotChannelIcon channel={channelId} size={80} color={getWorldAccent(worldId)} />
        <Text style={styles.centerText}>{config.name} channel not configured yet.</Text>
        <Pressable onPress={() => router.back()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeBg }]}>
      {/* Chat World background — same equipped world as main chat. Renders
          behind all bot-channel chrome when a world is purchased. */}
      <WorldLayer active={!isLoading} />

      {/* Header — matches Main Chat header layout exactly. Status-bar safe-
          area lives inside so the bg extends edge-to-edge behind the
          status bar (no themeBg gap above the chrome). */}
      <View style={[styles.header, { backgroundColor: chromeBg, borderBottomColor: themeBorder, paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>{"\u2039"}</Text>
        </Pressable>

        {/* Fixed-width slot \u2014 always reserved so the center banner gets the
            same available width on every channel, whether or not this
            channel actually shows the Limit Orders pill (trades only).
            Mirrors the AutonoMonke pill slot on the right. */}
        <View style={styles.headerLeftExtra}>
          {channelId === "trades" && hasAutonomy && (
            <Pressable
              onPress={handleLimitOrdersToggle}
              style={[styles.limitOrdersBtn, limitOrdersEnabled && styles.limitOrdersBtnActive]}
              hitSlop={8}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {limitOrdersEnabled && <View style={styles.blueCheck}><Text style={styles.blueCheckText}>{"\u2713"}</Text></View>}
                <Text style={[styles.limitOrdersBtnText, limitOrdersEnabled && styles.limitOrdersBtnTextActive]}>
                  Limit Orders
                </Text>
              </View>
            </Pressable>
          )}
        </View>

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
              onLongPress={() => {
                // v2.38: long-press re-opens the wizard so enrolled users can
                // change funding currency / sliders without going through the
                // DM. Setup is idempotent on the bot side — re-running updates
                // state in place, never creates a second hot wallet.
                if (autonomyEnrolled) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  setShowAutonoMonkeModal(true);
                }
              }}
              delayLongPress={400}
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

      {/* Bot Alerts · Live status bar removed 2026-05-07 — redundant chrome.
          Filter band sits directly below the header now. */}

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
          {/* Filter band — two minimalist dropdown triggers (Sports + Source).
              Tap either to open a text-list panel below. Tapping the open
              one again closes it; tapping the other swaps content. Sports
              shows for Bets only; Source shows for Bets + Predictions. */}
          {(channelId === "bets" || channelId === "predictions") && (
            <View style={[styles.filterBand, { backgroundColor: chromeBg, borderBottomColor: themeBorder }]}>
              {channelId === "bets" && (
                <Pressable
                  onPress={() => setOpenDropdown(d => d === "sports" ? null : "sports")}
                  style={[styles.filterTrigger, openDropdown === "sports" && styles.filterTriggerActive]}
                >
                  <Text style={styles.filterTriggerText}>Sports Filter</Text>
                  <Text style={styles.filterCaret}>{openDropdown === "sports" ? "▴" : "▾"}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setOpenDropdown(d => d === "sources" ? null : "sources")}
                style={[styles.filterTrigger, openDropdown === "sources" && styles.filterTriggerActive]}
              >
                <Text style={styles.filterTriggerText}>Source Filter</Text>
                <Text style={styles.filterCaret}>{openDropdown === "sources" ? "▴" : "▾"}</Text>
              </Pressable>
            </View>
          )}

          {/* Sports dropdown panel */}
          {openDropdown === "sports" && channelId === "bets" && (
            <View style={[styles.dropdownPanel, { backgroundColor: chromeBg, borderBottomColor: themeBorder }]}>
              {SPORTS_LIST.map(({ key, label }) => {
                const muted = mutedSports.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      toggleSportMute(key);
                      triggerProfileRebroadcast(useAppStore.getState().expoPushToken ?? "").catch(() => {});
                    }}
                    style={styles.dropdownRow}
                  >
                    <Text style={styles.dropdownDot}>{muted ? "○" : "●"}</Text>
                    <Text style={[styles.dropdownLabel, muted && styles.dropdownLabelMuted]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Source dropdown panel */}
          {openDropdown === "sources" && (channelId === "bets" || channelId === "predictions") && (
            <View style={[styles.dropdownPanel, { backgroundColor: chromeBg, borderBottomColor: themeBorder }]}>
              {(["polymarket", "kalshi", "drift"] as const).map((src) => {
                const muted = mutedAlertSources.includes(src);
                const label = src === "drift" ? "Drift"
                            : src === "kalshi" ? "Kalshi 🇺🇸"
                            : "Polymarket";
                return (
                  <Pressable
                    key={src}
                    onPress={() => useAppStore.getState().toggleAlertSourceMute(src)}
                    style={styles.dropdownRow}
                  >
                    <Text style={styles.dropdownDot}>{muted ? "○" : "●"}</Text>
                    <Text style={[styles.dropdownLabel, muted && styles.dropdownLabelMuted]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
              {mutedAlertSources.includes("drift") && (
                <Text style={styles.dropdownNote}>
                  Drift Predictions UI is under construction — bot will announce here when it's back.
                </Text>
              )}
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
              <BotChannelIcon channel={channelId} size={80} color={getWorldAccent(worldId)} />
              <Text style={styles.emptyTitle}>No alerts yet</Text>
              <Text style={styles.emptySubtitle}>{config.emptyText}</Text>
            </View>
          )}

          {/* Messages — FlashList for cell recycling (3-5x fewer frame drops
              vs. FlatList on long bot-alert histories). Mirrors the migration
              done in ChatScreen. `inverted` keeps newest at the bottom. */}
          <FlashList
            ref={flatListRef}
            data={filteredMessages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            inverted
          />
        </>
      )}

      <View style={{ height: insets.bottom }} />

      {/* Autonomy entry — trades channel uses the new wizard, others still
          use the legacy single-screen disclaimer + DM enrollment flow. */}
      {hasAutonomy && channelId === "trades" && (
        <AutonoMonkeSetupWizard
          visible={showAutonoMonkeModal}
          onClose={() => setShowAutonoMonkeModal(false)}
        />
      )}
      {hasAutonomy && channelId !== "trades" && (
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
  // Header geometry matched to ChatHeader.tsx (Main Chat) so the banner
  // image renders at the same visible size and is centered the same way.
  // Bot channels' headerRight is wider (mute pill + AutonoMonke pill stacked
  // vertically) than Main Chat's banana pill, so the centered banner has
  // slightly less horizontal room — but the height + scale + margin all
  // match, which is what the community feedback was about.
  //
  // headerLeftExtra / headerRight both have a fixed width (not
  // minWidth/content-hugging) and are ALWAYS present in the layout, whether
  // or not this channel actually renders a pill inside them. That's what
  // keeps headerCenter's flex:1 share — and therefore the banner's
  // rendered size/position — identical across bets/trades/sales/predictions
  // instead of shifting based on which optional pills a channel has.
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 100,
    backgroundColor: "transparent",
    // No borderBottom — separator removed per design pass 2026-05-06.
  },
  headerCenter: {
    flex: 1,
    height: 96,
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: -8,
    // No 1.35 scale here — main chat (ChatHeader) uses scale(1.35) because
    // its source asset is 1:1 square (header.png 2084×2084). Bot channel
    // banners are wide rectangles (~1.7-2.05 aspect), so the same scale
    // makes them extend 230-266px wide vs main's 130×130, which read as
    // "way too big" in user testing 2026-05-07. At scale 1.0 they cap at
    // ~96 height x (aspect × 96) wide, comparable visual weight to main.
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
  headerLeftExtra: {
    width: 90,
    marginLeft: 4,
    alignItems: "center",
  },
  headerRight: {
    width: 90,
    alignItems: "center",
    gap: 6,
    zIndex: 1,
  },
  muteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    width: 90,
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
    // No borderBottom — separator removed per design pass 2026-05-06.
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

  // Filter band — two dropdown triggers (Sports / Source) sit directly
  // below the header. The "Bot Alerts · Live" status bar was removed
  // 2026-05-07; redundant chrome.
  filterBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  filterTriggerActive: {
    backgroundColor: "rgba(108,180,238,0.12)",
    borderColor: "rgba(108,180,238,0.30)",
  },
  filterTriggerText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.text,
  },
  filterCaret: {
    fontSize: 9,
    color: THEME.textMuted,
    marginTop: 1,
  },
  // Dropdown panel — minimalist text list of options with a leading
  // dot indicator (● active, ○ muted). Tap a row to toggle.
  dropdownPanel: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: 1,
  },
  dropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
  },
  dropdownDot: {
    fontSize: 14,
    color: "#6CB4EE",
    width: 14,
    textAlign: "center",
  },
  dropdownLabel: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.text,
  },
  dropdownLabelMuted: {
    color: THEME.textFaint,
    textDecorationLine: "line-through",
  },
  dropdownNote: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    fontStyle: "italic",
    paddingTop: 4,
    paddingBottom: 4,
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
    width: 90,
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
  // Limit Orders pill — left-side counterpart to autonomyBtn.
  // Distinct tint (cyan/teal) so it's visually distinguishable from the
  // AutonoMonke pill even though the layout/sizing is identical.
  limitOrdersBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(20, 184, 166, 0.15)",
    width: 90,
    alignItems: "center",
  },
  limitOrdersBtnActive: {
    backgroundColor: "rgba(20, 184, 166, 0.3)",
  },
  limitOrdersBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 10,
    color: "#5EEAD4",
  },
  limitOrdersBtnTextActive: {
    color: "#99F6E4",
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
