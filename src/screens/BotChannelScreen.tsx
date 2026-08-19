/**
 * BotChannelScreen
 *
 * Read-only bot alert feed for the Trades channel (also carries NFT sale
 * alerts, merged in from the retired MonkeSales channel 2026-08-13).
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
import AutonoMonkeSetupWizard from "@/components/AutonoMonkeSetupWizard";
import { getXmtpClient } from "@/hooks/useXmtp";
import { sendDmMessage } from "@/lib/xmtp";
import * as Haptics from "expo-haptics";
import { BlurView } from "@sbaiahmed1/react-native-blur";
import { getBlurProps, GLASS_CHROME_BG } from "@/lib/glassTheme";
import { WorldGlassFill } from "@/components/WorldGlassFill";
import { THEME, FONTS, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { BotChannelIcon } from "@/components/BotChannelIcon";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useThemeColor } from "@/lib/shopTheme";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { markChannelRead } from "@/lib/messageCache";
import type { ChatMessage } from "@/types";
import { isMineInbox } from "@/lib/inboxLinking";

const BOT_INBOX_ID = "998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363";

/** Process-lifetime guard — MonkeTrades remount must not re-DM status. */
let _automonkeStatusCheckedThisSession = false;

const AUTONOMY_CONFIG: Record<string, { command: string; storageKey: string }> = {
  trades: { command: "/automonke start", storageKey: "automonke_enrolled" },
};

// No-ops for read-only channel — users can't react or reply to bot alerts
const noop = (..._args: any[]) => {};

const CHANNEL_CONFIG = {
  trades: {
    name: "Monke Trades",
    // (v30 2026-05-09) PNG icons retired in favor of BotChannelIcon
    // (Skia vectors). The `banner` here is a separate larger artwork
    // used elsewhere on the screen.
    banner: require("../../assets/Trade.png"),
    emptyText: "No trade or sale alerts yet.",
  },
} as const;

interface BotChannelScreenProps {
  channelId: "trades";
}

export default function BotChannelScreen({ channelId }: BotChannelScreenProps) {
  const insets = useSafeAreaInsets();
  // @sbaiahmed1/react-native-blur's native view snapshots its target
  // synchronously on the very first Fabric layout commit — that unstable
  // first commit can crash with IndexOutOfBoundsException in
  // eightbitlab.com.blurview.PreDrawBlurController (upstream-documented:
  // Dimezis/BlurView#176; same fix as ChatHeader/ChatInput/MenuDrawer).
  // Skipping the BlurView for one render defers its mount past that.
  const [blurReady, setBlurReady] = useState(false);
  useEffect(() => { setBlurReady(true); }, []);
  const { myInboxId, botChannelIds, mutedBotChannels, toggleBotChannelMute, username } = useAppStore();
  const groupId = botChannelIds[channelId];
  const isMuted = mutedBotChannels[channelId];
  const config = CHANNEL_CONFIG[channelId];
  const [showAutonoMonkeModal, setShowAutonoMonkeModal] = useState(false);
  const [autonomyEnrolled, setAutonomyEnrolled] = useState(false);
  // Per-user Limit Orders opt-in (T1/T2 as on-chain resting Jupiter orders).
  // Only shown when the user is already AutonoMonke-enrolled (Limit Orders
  // are meaningless without it). Persisted to AsyncStorage so the pill
  // reflects the right state on reopen without round-tripping the bot.
  const [limitOrdersEnabled, setLimitOrdersEnabled] = useState(false);
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
  const chromeBg = worldId ? getWorldBarTint(worldId) : GLASS_CHROME_BG;
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
    // 2026-08-07: was 30 min + no session guard — MonkeTrades remount + pill
    // taps + cold starts stacked into a flood of "/autonomonke status" DMs
    // (and push noise). Once-per-process + 6h disk cooldown is enough to
    // self-correct enrollment without spamming Hermes.
    if (_automonkeStatusCheckedThisSession) return;
    const STATUS_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
    const STATUS_CHECK_STORAGE_KEY = "automonke_last_status_check_v1";
    (async () => {
      try {
        // Already have bot ground truth this session — no need to re-ask.
        if (useAppStore.getState().automonkeStatus) {
          _automonkeStatusCheckedThisSession = true;
          return;
        }
        const lastCheckRaw = await AsyncStorage.getItem(STATUS_CHECK_STORAGE_KEY);
        const lastCheck = lastCheckRaw ? parseInt(lastCheckRaw, 10) : 0;
        if (Date.now() - lastCheck < STATUS_CHECK_COOLDOWN_MS) {
          _automonkeStatusCheckedThisSession = true;
          return;
        }
        const client = getXmtpClient();
        if (!client) return;
        const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
        if (dm) {
          _automonkeStatusCheckedThisSession = true; // claim before await to block remount races
          await sendDmMessage(dm, "/autonomonke status", username);
          await AsyncStorage.setItem(STATUS_CHECK_STORAGE_KEY, String(Date.now()));
        }
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

  // Reverse messages for inverted FlatList (newest first in array = bottom of screen)
  // Security: only show messages from the bot — prevents spoofed alerts from other XMTP clients
  const reversedMessages = useMemo(() =>
    [...messages].filter(m => m.senderAddress === BOT_INBOX_ID).reverse(),
    [messages],
  );

  const filteredMessages = reversedMessages;

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
            isOwn={isMineInbox(item.senderAddress, myAddress)}
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
      <View style={[styles.header, { borderBottomColor: themeBorder, paddingTop: insets.top }]}>
        {/* Same MonkeGlass as MainChat bubbles + light chrome bar tint */}
        {worldId ? <WorldGlassFill worldId={worldId} /> : (
          blurReady && <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: chromeBg }]} pointerEvents="none" />
        <View style={styles.headerRow1}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>{"\u2039"}</Text>
        </Pressable>

        <ImageBackground
          source={config.banner}
          style={styles.headerCenter}
          resizeMode="contain"
        >
          {pfpFullThemeActive && !hasThemeOverride && (
            <View style={[styles.bannerTintOverlay, { backgroundColor: nftDominantColor + "4D" }]} />
          )}
        </ImageBackground>

        {/* Right: Alert bell only */}
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
        </View>
        </View>

        {/* Pill row — Sports/Source filter (Bets only — Predictions' Source
            Filter stays in its own filterBand below, not moved), Limit
            Orders (Trades only), AutonoMonke (Trades/Bets/Predictions).
            2026-08-08: moved from the separate pillBand bar into this same
            header block so there's one glass surface, not a stack of bars. */}
        {hasAutonomy && (
          <View style={styles.headerPillRow}>
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

            <Pressable
              onPress={async () => {
                // 2026-08-07: enrolled users were dumped into bot DM, then typed
                // /autonomonke start and the bot said "use MonkeTrades" — loop.
                // Not enrolled -> wizard. Enrolled + paused -> resume. Enrolled +
                // active -> open DM. Long-press always reopens the wizard.
                if (!autonomyEnrolled) {
                  setShowAutonoMonkeModal(true);
                  return;
                }
                // 2026-08-07: was sending /autonomonke status whenever
                // automonkeStatus was null — every pill tap re-spammed Hermes.
                // Only auto-DM when we KNOW they're paused (resume). Otherwise
                // just open the bot DM; user can type /autonomonke status if needed.
                const paused = automonkeStatus?.enrolled && !automonkeStatus?.active;
                if (paused) {
                  try {
                    const client = getXmtpClient();
                    if (client) {
                      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
                      if (dm) await sendDmMessage(dm, "/autonomonke resume", username);
                    }
                  } catch (err) {
                    if (__DEV__) console.warn("[Autonomy:trades] resume DM failed:", (err as Error)?.message);
                  }
                }
                router.push(`/dm/${BOT_INBOX_ID}` as any);
              }}
              onLongPress={() => {
                // Always allow re-running the Activate wizard (reconfigure /
                // re-enroll after a wipe / fix stale check without DM limbo).
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                setShowAutonoMonkeModal(true);
              }}
              delayLongPress={400}
              style={[styles.autonomyBtn, autonomyEnrolled && styles.autonomyBtnActive]}
              hitSlop={8}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {autonomyEnrolled && <View style={styles.blueCheck}><Text style={styles.blueCheckText}>{"\u2713"}</Text></View>}
                <Text style={[styles.autonomyBtnText, autonomyEnrolled && styles.autonomyBtnTextActive]}>
                  AutonoMonke
                </Text>
              </View>
            </Pressable>
          </View>
        )}
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

      {hasAutonomy && (
        <AutonoMonkeSetupWizard
          visible={showAutonoMonkeModal}
          onClose={() => setShowAutonoMonkeModal(false)}
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
  // 2026-08-08: header is now a column of two rows (headerRow1 + optional
  // headerPillRow) sharing ONE glass surface (BlurView/WorldGlassFill +
  // chromeBg as absoluteFill children of THIS container), instead of the
  // banner row plus separate bordered pillBand/filterBand bars underneath —
  // those read as "extra headers" stacked on top of each other. Height is
  // content-driven now (no fixed height) so it grows by exactly one pill
  // row's worth when a channel has pills, nothing more.
  header: {
    overflow: "hidden",
    // No borderBottom — separator removed per design pass 2026-05-06.
  },
  headerRow1: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 100,
  },
  // Pill row — Sports/Source filter (bets) + Limit Orders (trades) +
  // AutonoMonke (trades/bets/predictions) all live here now, inside the
  // same header block instead of a separate pillBand/filterBand bar below.
  headerPillRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
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
  headerRight: {
    alignItems: "center",
    zIndex: 1,
  },
  // Pill band — sits below the header (see pillBand style further down)
  // with its own solid backing so the Limit Orders / AutonoMonke pills
  // read clearly over the busy World background instead of blending in.
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
    overflow: "hidden",
  },
  // Filter pills (Sports/Source) — restyled 2026-08-08 to match the
  // AutonoMonke/Limit Orders pill language (colored fill + border) instead
  // of the old thin-bordered dropdown-trigger look, per "match MonkeTrades
  // style". Blue family distinguishes filter pills from action pills
  // (purple = AutonoMonke, teal = Limit Orders).
  filterPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(108, 180, 238, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.45)",
    minWidth: 44,
    elevation: 2,
  },
  filterPillBtnActive: {
    backgroundColor: "rgba(108, 180, 238, 0.4)",
    borderColor: "rgba(108, 180, 238, 0.8)",
  },
  filterPillBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 10,
    color: "#BEE1FB",
  },
  filterPillBtnTextActive: {
    color: "#E4F2FD",
  },
  filterPillCaret: {
    fontSize: 9,
    color: "#BEE1FB",
    marginTop: 1,
  },
  // Dropdown panel — minimalist text list of options with a leading
  // dot indicator (● active, ○ muted). Tap a row to toggle.
  dropdownPanel: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: 1,
    overflow: "hidden",
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

  // Base fill bumped from 0.15→0.22 and a matching border added — at 0.15
  // with no border, the pills nearly disappeared against the busy World
  // background (grid lines, gradients). Active/enrolled state jumps to a
  // visibly heavier fill + brighter border ("shaded") so enrollment status
  // reads at a glance instead of only via the small checkmark badge.
  autonomyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(124, 58, 237, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.45)",
    minWidth: 44,
    alignItems: "center",
    elevation: 2,
  },
  autonomyBtnActive: {
    backgroundColor: "rgba(124, 58, 237, 0.4)",
    borderColor: "rgba(124, 58, 237, 0.8)",
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
    backgroundColor: "rgba(20, 184, 166, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(20, 184, 166, 0.45)",
    minWidth: 44,
    alignItems: "center",
    elevation: 2,
  },
  limitOrdersBtnActive: {
    backgroundColor: "rgba(20, 184, 166, 0.4)",
    borderColor: "rgba(20, 184, 166, 0.8)",
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
