/**
 * GenesisChatScreen
 *
 * Home screen for Saga/Seeker Genesis Token holders. Same shape as
 * BotChannelScreen (Trades channel): FlashList of messages, BananaShop,
 * Leaderboard. No reactions, no replies, no drawer, no CAM/GIF — a plain
 * text-only message bar (2026-08-23: Genesis holders can post here now;
 * previously omitting ChatInput entirely was the enforcement mechanism for
 * "only the bot can post," per explicit product decision that Genesis
 * holders need to actually be able to chat, not just read the bot's posts).
 *
 * Entry point for the Genesis tier — reachable via app/genesis-chat.tsx.
 * Dual holders (also hold a Saga Monke) additionally get a Main/Genesis tab
 * bar + swipe gesture (ChatModeSwitch) to move to Main Chat.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, TextInput, Keyboard } from "react-native";
import { toast } from "sonner-native";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useMobileWallet, signBytesWithMwa } from "@/hooks/useMobileWallet";
import { getXmtpClient } from "@/hooks/useXmtp";
import { sendGenesisJoinRequestDM, prepareWalletBoundXmtp, XMTP_SIGNATURE_REQUIRED_ERROR } from "@/lib/xmtp";
import { fetchAppConfig } from "@/lib/remoteConfig";
import { MessageBubble } from "@/components/MessageBubble";
import { BananaShopModal } from "@/components/BananaShopModal";
import { LeaderboardView } from "@/components/LeaderboardView";
import { OnboardingCarousel } from "@/components/OnboardingCarousel";
import { GENESIS_CAROUSEL_KEY, GENESIS_CAROUSEL_SLIDES } from "@/lib/genesisCarouselSlides";
import { ChatModeTabs, SwipeToSwitchChat } from "@/components/ChatModeSwitch";
import { LiquidGlass as BlurView } from "@/components/LiquidGlass";
import { getBlurProps } from "@/lib/glassTheme";
import { WorldGlassFill } from "@/components/WorldGlassFill";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { THEME, FONTS, resolveBarTint, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { useThemeColor } from "@/lib/shopTheme";
import { markChannelRead } from "@/lib/messageCache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "@/types";
import { isMineInbox } from "@/lib/inboxLinking";
import { RewardedAdPill } from "@/components/RewardedAdPill";
import { AD_UNIT_IDS, AD_REWARD_BANANAS } from "@/lib/ads";

const noop = (..._args: any[]) => {};

export default function GenesisChatScreen() {
  const insets = useSafeAreaInsets();

  const { myInboxId, genesisGroupId, verified: isDualHolder, wallet, username, setGenesisGroupId } = useAppStore();
  const { disconnect } = useMobileWallet();

  // Genesis-only holders never mount ChatScreen/useXmtp() (which is where the
  // Main Chat path normally hydrates remote config into the store) — fetch it
  // directly here so genesisGroupId is populated even for a Genesis-only login.
  useEffect(() => {
    if (genesisGroupId) return;
    fetchAppConfig().then((config) => {
      if (config.genesisGroupId) setGenesisGroupId(config.genesisGroupId);
    }).catch(() => {});
  }, [genesisGroupId]);

  const [shopOpen, setShopOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [showCarousel, setShowCarousel] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(GENESIS_CAROUSEL_KEY).then((seen) => {
      if (!seen) setShowCarousel(true);
    }).catch(() => {});
  }, []);

  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;
  const hasThemeOverride = useAppStore((s) => !!s.themeOverrides);
  const themeSurface = useThemeColor('surface');
  const chromeBg = resolveBarTint(worldId, hasThemeOverride, themeSurface, 0.20);

  const groupId = genesisGroupId ?? "";
  const { messages, isLoading, initialize, disconnect: disconnectGroup, send } = useGroupChat(groupId, "Genesis Chat");

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;
    setInputText("");
    setIsSending(true);
    try {
      await send(text);
    } catch (err) {
      toast.error("Message didn't send — try again");
      if (__DEV__) console.warn("[GenesisChat] send failed:", (err as Error)?.message);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, send]);

  useEffect(() => {
    markChannelRead("genesis").catch(() => {});
  }, []);
  useEffect(() => {
    if (messages.length > 0) markChannelRead("genesis").catch(() => {});
  }, [messages.length]);

  // Not a member yet → send GENESIS_JOIN_REQUEST and retry periodically until
  // the bot (primary approver, always-on) or admin approves. Mirrors Main
  // Chat's join-request retry pattern (useXmtp.ts).
  useEffect(() => {
    if (!groupId || !wallet?.address) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const attempt = async () => {
      try {
        await initialize();
        setAwaitingApproval(false);
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      } catch (err) {
        if (cancelled) return;
        setAwaitingApproval(true);

        // A stuck-forever loop otherwise: initialize() keeps failing the
        // same way every 30s if the wallet-bound identity signature was
        // never completed (declined/dismissed). Re-prompt it here so the
        // next retry tick actually has a chance to succeed.
        if ((err as Error)?.message === XMTP_SIGNATURE_REQUIRED_ERROR) {
          try {
            await prepareWalletBoundXmtp(wallet.address, (bytes) => signBytesWithMwa(wallet.address, bytes));
          } catch (signErr) {
            if (__DEV__) console.warn("[GenesisChat] identity re-sign failed:", (signErr as Error)?.message);
          }
          return;
        }

        try {
          const client = getXmtpClient();
          if (!client) return;
          const config = await fetchAppConfig();
          await sendGenesisJoinRequestDM(
            client, config.adminInboxId, client.inboxId, wallet.address, username, config.botInboxId,
          );
        } catch (reqErr) {
          if (__DEV__) console.warn("[GenesisChat] join request failed:", (reqErr as Error)?.message);
        }
      }
    };

    attempt();
    retryTimer = setInterval(attempt, 30_000);

    return () => {
      cancelled = true;
      if (retryTimer) clearInterval(retryTimer);
      disconnectGroup();
    };
  }, [groupId, wallet?.address]);

  const myAddress = myInboxId ?? "";

  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);

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
      } catch {
        return null;
      }
    },
    [myAddress],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const handleDisconnect = () => {
    disconnect();
    router.replace("/");
  };

  const body = (
    <View style={[styles.container, { backgroundColor: THEME.bg }]}>
      <WorldLayer active={!isLoading} />

      <View style={[styles.header, { borderBottomColor: THEME.border, paddingTop: insets.top }]}>
        {worldId ? <WorldGlassFill worldId={worldId} /> : (
          <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: chromeBg }]} pointerEvents="none" />

        <View style={styles.headerRow}>
          <Pressable onPress={handleDisconnect} style={styles.iconBtn} hitSlop={8}>
            <Text style={styles.iconTxt}>⏻</Text>
          </Pressable>
          <Text style={styles.headerTitle}>🐒 Genesis Chat</Text>
          <View style={styles.headerRightBtns}>
            <RewardedAdPill adUnitId={AD_UNIT_IDS.rewardedGenesis} rewardBananas={AD_REWARD_BANANAS.genesis} />
            <Pressable onPress={() => setLeaderboardOpen(true)} style={styles.iconBtn} hitSlop={8}>
              <Text style={styles.iconTxt}>📈</Text>
            </Pressable>
            <Pressable onPress={() => setShopOpen(true)} style={styles.iconBtn} hitSlop={8}>
              <Text style={styles.iconTxt}>🍌</Text>
            </Pressable>
          </View>
        </View>

        {isDualHolder && <ChatModeTabs active="genesis" />}
      </View>

      {!groupId ? (
        <View style={[styles.container, styles.centerState]}>
          <Text style={styles.centerText}>Genesis Chat isn't set up yet — check back soon 🐒</Text>
        </View>
      ) : awaitingApproval && reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]}>
          <ActivityIndicator color={THEME.accent} style={{ marginBottom: 12 }} />
          <Text style={styles.centerText}>Verifying your Genesis Token and requesting access…</Text>
        </View>
      ) : isLoading && reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]}>
          <ActivityIndicator color={THEME.accent} />
        </View>
      ) : reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]}>
          <Text style={styles.centerText}>No messages yet — the bot posts a daily update here 🐒</Text>
        </View>
      ) : (
        <FlashList
          ref={flatListRef}
          data={reversedMessages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          inverted
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
        />
      )}

      {/* Plain text-only message bar — no CAM/GIF, no slash commands. */}
      <View style={[styles.inputBar, { paddingBottom: 8 + insets.bottom + keyboardHeight }]}>
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: chromeBg }]} pointerEvents="none" />
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Message Genesis Chat…"
          placeholderTextColor={THEME.textMuted}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
          editable={!isSending}
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
          style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnDisabled]}
          hitSlop={8}
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </Pressable>
      </View>

      {showCarousel && (
        <OnboardingCarousel
          slides={GENESIS_CAROUSEL_SLIDES}
          finalCtaLabel="⚡ Check Saga Monkes on Tensor"
          onDone={async () => {
            await AsyncStorage.setItem(GENESIS_CAROUSEL_KEY, "1").catch(() => {});
            setShowCarousel(false);
          }}
          onLoginNow={async () => {
            await AsyncStorage.setItem(GENESIS_CAROUSEL_KEY, "1").catch(() => {});
            setShowCarousel(false);
            Linking.openURL("https://www.tensor.trade/trade/sagamonkes").catch(() => {});
          }}
        />
      )}

      <BananaShopModal visible={shopOpen} onClose={() => setShopOpen(false)} />

      {leaderboardOpen && (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.leaderboardHeader, { paddingTop: insets.top + 8 }]}>
            <Pressable onPress={() => setLeaderboardOpen(false)} style={styles.iconBtn} hitSlop={8}>
              <Text style={styles.iconTxt}>{"‹"} Back</Text>
            </Pressable>
          </View>
          <LeaderboardView />
        </View>
      )}
    </View>
  );

  return isDualHolder ? <SwipeToSwitchChat from="genesis">{body}</SwipeToSwitchChat> : body;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerState: { alignItems: "center", justifyContent: "center", padding: 40 },
  centerText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, textAlign: "center" },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 6 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerRightBtns: { flexDirection: "row", gap: 4 },
  headerTitle: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text },
  iconBtn: { padding: 6 },
  iconTxt: { fontSize: 18, color: THEME.text },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.border,
    overflow: "hidden",
  },
  textInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  leaderboardHeader: {
    backgroundColor: THEME.bg,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.border,
  },
});
