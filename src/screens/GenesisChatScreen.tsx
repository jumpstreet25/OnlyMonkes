/**
 * GenesisChatScreen
 *
 * Home screen for Saga/Seeker Genesis Token holders. FlashList of messages,
 * BananaShop, Leaderboard. No reactions, no replies (2026-08-23: Genesis
 * holders can post here now; previously omitting ChatInput entirely was the
 * enforcement mechanism for "only the bot can post," per explicit product
 * decision that Genesis holders need to actually be able to chat, not just
 * read the bot's posts).
 *
 * 2026-08-25: header and toolbar rebuilt to reuse the exact same
 * ChatHeader/ChatInput components Main Chat uses (own logo via
 * GenesisChatHeader.png, no bot-command ticker) instead of a bespoke
 * layout — CAM/LIVE/GIF/MonkeTrades render greyed-out and inert
 * (ChatInput's `disabledButtons` prop) rather than omitted, so the chrome
 * visually matches Main Chat throughout, not just the parts Genesis
 * supports. No dedicated header icons anymore for support/leaderboard/
 * disconnect — those moved inside BananaShopModal (opened by the banana
 * pill, same as Main Chat's menu drawer does for that content).
 *
 * Entry point for the Genesis tier — reachable via app/genesis-chat.tsx.
 * Dual holders (also hold a Saga Monke) additionally get a Main/Genesis tab
 * bar + swipe gesture (ChatModeSwitch) to move to Main Chat.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Keyboard } from "react-native";
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
import { ChatHeader, CHAT_HEADER_HEIGHT } from "@/components/ChatHeader";
import { ChatInput } from "@/components/ChatInput";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { THEME, FONTS, SKR_MINT, DEV_WALLET } from "@/lib/constants";
import { useThemeColor } from "@/lib/shopTheme";
import { markChannelRead } from "@/lib/messageCache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "@/types";
import { isMineInbox } from "@/lib/inboxLinking";
import { SupportOptionsModal } from "@/components/SupportOptionsModal";
import { captureError } from "@/lib/sentry";

const GENESIS_DISABLED_MESSAGE = "Not available in Genesis Chat";

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
  const [supportOptionsOpen, setSupportOptionsOpen] = useState(false);
  const [showCarousel, setShowCarousel] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(GENESIS_CAROUSEL_KEY).then((seen) => {
      if (!seen) setShowCarousel(true);
    }).catch(() => {});
  }, []);

  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');
  const bananaBalance = useAppStore((s) => s.bananaBalance);
  // Measured via onLayout below — the FlashList is `inverted`, so clearing
  // the absolutely-positioned ChatInput at the visual bottom means padding
  // the list's paddingTop (see ChatMessageList.tsx's bottomInset for the
  // same established pattern — inverted flips which side paddingTop lands
  // on). Without this, the newest message renders underneath the input bar
  // instead of above it (confirmed on-device 2026-08-25).
  const [bottomBarHeight, setBottomBarHeight] = useState(0);

  const groupId = genesisGroupId ?? "";
  const { messages, isLoading, initialize, disconnect: disconnectGroup, send, addMessageLocal } = useGroupChat(groupId, "Genesis Chat");

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
      // 2026-08-24: real bug, confirmed via live device logcat — the
      // native XMTP send genuinely succeeds (own envelope processed,
      // "Application message published successfully"), but the message
      // never appeared in Genesis Chat's UI. Root cause: this screen
      // relied entirely on the live message-subscription stream echoing
      // the send back before it'd show up, and that stream visibly gets
      // torn down and restarted around navigation/foreground events
      // (JobCancellationException on the messages subscription, seen in
      // the same logcat window) — a locally-sent message published during
      // that gap is genuinely on the network but never reaches this
      // screen's React state. useDm.ts already solves this correctly for
      // DMs with an optimistic local insert; useGroupChat.ts's
      // addMessageLocal exists for exactly this but was never wired up
      // here (or anywhere — first real caller).
      addMessageLocal({
        id: `optimistic-${Date.now()}`,
        senderAddress: myInboxId ?? "",
        senderUsername: username ?? "",
        content: text,
        sentAt: new Date(),
        reactions: {},
        status: "sent",
      });
    } catch (err) {
      toast.error("Message didn't send — try again");
      // 2026-08-24: was `if (__DEV__) console.warn(...)` — invisible in a
      // release build, so a real reported send failure had zero trace
      // anywhere to diagnose from. captureError runs in production
      // (sentry.ts's `enabled: !__DEV__`) and dev alike.
      captureError(err, { screen: "GenesisChat", action: "send" });
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, send, addMessageLocal, myInboxId, username]);

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

      {/* Header — matches Main Chat's ChatHeader exactly (globe / logo /
          banana pill), just with Genesis's own wordmark and no bot-command
          ticker (Genesis has no slash commands). Absolute overlay so the
          message list can extend full-bleed behind it, same as Main. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, elevation: 100 }}>
        <ChatHeader
          themeSurface={themeSurface}
          themeBorder={themeBorder}
          bananaBalance={bananaBalance}
          totalDmUnread={0}
          communityBadges={{ events: 0, links: 0 }}
          isGroupMember
          onOpenDrawer={() => setShopOpen(true)}
          onDmNavigation={() => router.push("/dms" as any)}
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          logoSource={require("../../assets/GenesisChatHeader.png")}
          // header.png's 1.35 default is tuned for its square aspect ratio —
          // GenesisChatHeader.png is a wide banner (2173x724), which the
          // same multiplier blew up disproportionately (confirmed on-device
          // 2026-08-25). Plain "contain" (scale 1) was still ~20% too large
          // per on-device feedback — 0.8 is the user-calibrated size to
          // visually match Main Chat's header.png. Main's own 1.35 is
          // untouched (a separate "could be 15% bigger" note, deferred).
          logoScale={0.8}
          showTicker={false}
        />
      </View>

      <View style={{ flex: 1, marginTop: CHAT_HEADER_HEIGHT, zIndex: 50 }} pointerEvents="box-none">
      {!groupId ? (
        // pointerEvents="none" on every center-state below: these are plain
        // non-interactive Views but without this they still absorb taps
        // meant for the elevated ChatInput underneath them (confirmed
        // on-device 2026-08-25 — this was the actual cause of the message
        // input not focusing during testing, not a coordinate issue).
        <View style={[styles.container, styles.centerState]} pointerEvents="none">
          <Text style={styles.centerText}>Genesis Chat isn't set up yet — check back soon 🐒</Text>
        </View>
      ) : awaitingApproval && reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]} pointerEvents="none">
          <ActivityIndicator color={THEME.accent} style={{ marginBottom: 12 }} />
          <Text style={styles.centerText}>Verifying your Genesis Token and requesting access…</Text>
        </View>
      ) : isLoading && reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]} pointerEvents="none">
          <ActivityIndicator color={THEME.accent} />
        </View>
      ) : reversedMessages.length === 0 ? (
        <View style={[styles.container, styles.centerState]} pointerEvents="none">
          <Text style={styles.centerText}>No messages yet — the bot posts a daily update here 🐒</Text>
        </View>
      ) : (
        <FlashList
          ref={flatListRef}
          data={reversedMessages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          inverted
          // Inverted flips which side paddingTop lands on — this clears the
          // visual BOTTOM (the ChatInput bar) so the newest message renders
          // above it instead of hidden underneath (see ChatMessageList.tsx's
          // bottomInset for the same established pattern; that's the shared
          // wrapper Main Chat uses, this screen uses FlashList directly).
          contentContainerStyle={{
            paddingTop: 12 + bottomBarHeight + (keyboardHeight > 0 ? keyboardHeight : insets.bottom),
            paddingBottom: 12,
          }}
        />
      )}
      </View>

      {/* Toolbar — same ChatInput Main Chat uses, so the bottom bar matches
          exactly. CAM/LIVE/GIF/MonkeTrades render greyed-out and inert
          (Genesis doesn't have those) instead of being hidden; Messages and
          the Main/Genesis switcher stay fully functional. */}
      <View
        // ChatInput has no built-in safe-area handling (Main Chat's support
        // banner normally carries that padding below it) — Genesis has no
        // equivalent banner, so fall back to insets.bottom directly when the
        // keyboard isn't up (the keyboard itself already clears that area
        // when it is).
        style={{ position: "absolute", bottom: keyboardHeight > 0 ? keyboardHeight : insets.bottom, left: 0, right: 0, zIndex: 100, elevation: 100 }}
        onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
      >
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          replyingTo={null}
          onCancelReply={noop}
          isSending={isSending}
          disabledButtons={{ cam: true, live: true, gif: true, trades: true }}
          disabledMessage={GENESIS_DISABLED_MESSAGE}
          chatModeTabs={isDualHolder ? <ChatModeTabs active="genesis" /> : undefined}
        />
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

      <BananaShopModal
        visible={shopOpen}
        onClose={() => setShopOpen(false)}
        onLeaderboardPress={() => { setShopOpen(false); setLeaderboardOpen(true); }}
        onSupportPress={() => { setShopOpen(false); setSupportOptionsOpen(true); }}
        onDisconnectPress={isDualHolder ? undefined : handleDisconnect}
      />

      <SupportOptionsModal
        visible={supportOptionsOpen}
        onClose={() => setSupportOptionsOpen(false)}
        onOpenTip={() => {
          // No dedicated tip flow in Genesis Chat — open the same Solana
          // Pay SKR link MenuDrawer's "Support OnlyMonkes" card uses.
          const uri = `solana:${DEV_WALLET}?spl-token=${SKR_MINT}&label=${encodeURIComponent("Support OnlyMonkes")}&message=${encodeURIComponent("Help build the future of OnlyMonkes 🐒")}`;
          Linking.openURL(uri).catch(() => toast.error("No Solana wallet found to handle this link"));
        }}
        variant="genesis"
      />

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

  iconBtn: { padding: 6 },
  iconTxt: { fontSize: 18, color: THEME.text },

  leaderboardHeader: {
    backgroundColor: THEME.bg,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.border,
  },
});
