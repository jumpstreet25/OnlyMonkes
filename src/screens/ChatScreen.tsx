/**
 * ChatScreen
 *
 * The main global chatroom. Rendered only when NFT verified + XMTP connected.
 *
 * Header layout:
 *   Left  — NFT avatar + username stacked vertically
 *   Center — OnlyMonkes logo (transparent background)
 *   Right  — 🔧 wrench + ☰ hamburger
 *
 * Features:
 *  - UsernameModal on first visit
 *  - FlatList of MessageBubbles (oldest at top, newest at bottom)
 *  - Optimistic message sending
 *  - Reply-to support (long press to reply)
 *  - 🍌 banana reaction dispatch
 *  - MenuDrawer for dApp side chats (☰)
 *  - MonkeToolsModal for ecosystem links + notification settings (🔧)
 *  - UserProfileModal when username tapped
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ImageBackground,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ListRenderItem,
  Modal,
  TextInput,
  Alert,
  Linking,
  FlatList,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { useXmtp } from "@/hooks/useXmtp";
import { MessageBubble } from "@/components/MessageBubble";
import { ChatInput } from "@/components/ChatInput";
import { UsernameModal } from "@/components/UsernameModal";
import { MenuDrawer } from "@/components/MenuDrawer";
import { MonkeToolsModal } from "@/components/MonkeToolsModal";
import { UserProfileModal, type ProfileTarget } from "@/components/UserProfileModal";
import { NftPickerModal } from "@/components/NftPickerModal";
import { router } from "expo-router";
import { THEME, FONTS, SKR_MINT } from "@/lib/constants";
import { loadUserProfile, getCachedProfile, getAllTimeUsers, saveSelectedNftMint, cacheProfile } from "@/lib/userProfile";
import { checkAndUpdateStreak } from "@/lib/streaks";
import { claimDailyBananas, addBananas, type ClaimResult } from "@/lib/bananaRewards";
import { getEquippedStyles } from "@/lib/bananaShop";
import { getOrExtractNftColor } from "@/lib/nftColor";
import { applyThemeFromShop } from "@/lib/shopTheme";
import { BananaClaimModal } from "@/components/BananaClaimModal";
import { checkBananaNotifications } from "@/lib/bananaNotifications";
import { OnboardingOverlay, hasCompletedOnboarding } from "@/components/OnboardingOverlay";
import { txError, networkError, llmError } from "@/lib/monkeCopy";
import { BadgeNotificationBanner } from "@/components/BadgeNotificationBanner";
import { ScrollToBottomFab } from "@/components/ScrollToBottomFab";
import { updateStats, type Badge } from "@/lib/activityBadges";
import { loadBananaState } from "@/lib/bananaRewards";
import { updateStreak as updateBadgeStreak } from "@/lib/badges";
import { ConfettiView } from "@/components/ConfettiView";
import { registerForPushNotifications, setNotificationReplyHandler } from "@/lib/notifications";
import { loadEvents } from "@/lib/calendar";
import { loadThemeId, loadCustomColor } from "@/lib/theme";
import { sendSkrTip, sendDevTip, parseTipCommand } from "@/lib/solana";
import { TipModal } from "@/components/TipModal";
import { SearchModal } from "@/components/SearchModal";
import { CalendarModal } from "@/components/CalendarModal";
import { GifPickerModal } from "@/components/GifPickerModal";
import { VideoCameraModal } from "@/components/VideoCameraModal";
import { LiveRoomBanner } from "@/components/LiveRoomBanner";
import { createLivekitToken, createRoomName } from "@/lib/livekit";
import { VideoRoomBanner } from "@/components/VideoRoomBanner";
import { VideoCallPip } from "@/components/VideoCallPip";
import { AvatarRoomPill } from "@/components/AvatarRoomPill";
import { VideoReactionOverlay } from "@/components/VideoReactionOverlay";
import { addReactionListener as addAvatarReactionListener, disconnectFromAvatarRoom, type AvatarRoomData } from "@/lib/avatarRoom";
import { ChartModal } from "@/components/ChartModal";
import type { VideoRoomData } from "@/lib/liveVideo";
import { BotCommandTicker } from "@/components/BotCommandTicker";
import { showLocalNotification, CH_ALL } from "@/lib/notifications";
import { registerNetworkSync, unregisterNetworkSync, setOfflineQueueFlusher, isOnline } from "@/lib/backgroundSync";
import { enqueueMessage, flushOfflineQueue } from "@/lib/offlineQueue";
import { appendCachedMessage } from "@/lib/messageCache";
import { SwapConfirmModal } from "@/components/SwapConfirmModal";
import { PinnedBar } from "@/components/PinnedBar";
import { loadPinnedMessages, getPinnedMessages, buildPinMessage, type PinnedMessage } from "@/lib/pinnedMessages";
import { loadThreadMetadata } from "@/lib/threads";
import { loadListings } from "@/lib/marketplace";

// ── Lazy imports — heavy modules loaded on first use, not at startup ────────
import type { SwapQuote } from "@/lib/jupiterSwap";
import ImageLightbox from "@/components/ImageLightbox";

const getExpoAv = () => import("expo-av");
const getMediaLibrary = () => import("expo-media-library");
const getFileSystem = () => import("expo-file-system");
const getImagePicker = () => import("expo-image-picker");
const getVideoUpload = () => import("@/lib/videoUpload");
const getJupiterSwap = () => import("@/lib/jupiterSwap");
const getLiveVideo = () => import("@/lib/liveVideo");
const getCreateVideoRoom = async () => (await getLiveVideo()).createVideoRoom;
const getJoinVideoRoom = async () => (await getLiveVideo()).joinVideoRoom;
const getDisconnectVideoRoom = async () => (await getLiveVideo()).disconnectFromVideoRoom;
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { TipAmount } from "@/lib/constants";

const HEADER_BG = "rgba(10, 10, 15, 0.85)";

/** Lazy-loaded Video player — avoids importing expo-av at startup */
function LazyVideo({ uri }: { uri: string }) {
  const [Mod, setMod] = useState<{ Video: any; ResizeMode: any } | null>(null);
  useEffect(() => { getExpoAv().then(m => setMod(m)); }, []);
  if (!Mod) return <ActivityIndicator style={{ flex: 1 }} color="#fff" />;
  return (
    <Mod.Video
      source={{ uri }}
      style={{ flex: 1 }}
      useNativeControls
      shouldPlay
      resizeMode={Mod.ResizeMode.CONTAIN}
    />
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  // ── Zustand selectors — subscribe only to fields this screen reads ──────────
  const verifiedNft      = useAppStore(s => s.verifiedNft);
  const allNfts          = useAppStore(s => s.allNfts);
  const myInboxId        = useAppStore(s => s.myInboxId);
  const username         = useAppStore(s => s.username);
  const bio              = useAppStore(s => s.bio);
  const xAccount         = useAppStore(s => s.xAccount);
  const tipWallet        = useAppStore(s => s.tipWallet);
  const userLocation     = useAppStore(s => s.location);
  const bananaBalance    = useAppStore(s => s.bananaBalance);
  const setUsername       = useAppStore(s => s.setUsername);
  const setBio           = useAppStore(s => s.setBio);
  const setXAccount      = useAppStore(s => s.setXAccount);
  const setTipWallet     = useAppStore(s => s.setTipWallet);
  const setVerified      = useAppStore(s => s.setVerified);
  const isGroupMember    = useAppStore(s => s.isGroupMember);
  const isGroupAdmin     = useAppStore(s => s.isGroupAdmin);
  const remoteGroupId    = useAppStore(s => s.remoteGroupId);
  const setThemeId       = useAppStore(s => s.setThemeId);
  const setCustomBubbleColor = useAppStore(s => s.setCustomBubbleColor);
  const setCalendarEvents = useAppStore(s => s.setCalendarEvents);
  const loginStreak      = useAppStore(s => s.loginStreak);
  const isLoading        = useAppStore(s => s.isLoading);
  const error            = useAppStore(s => s.error);
  const communityBadges  = useAppStore(s => s.communityBadges);
  const activeVideoRoom  = useAppStore(s => s.activeVideoRoom);
  const setActiveVideoRoom = useAppStore(s => s.setActiveVideoRoom);
  const isInVideoCall    = useAppStore(s => s.isInVideoCall);
  const setIsInVideoCall = useAppStore(s => s.setIsInVideoCall);
  const activeAvatarRoom   = useAppStore(s => s.activeAvatarRoom);
  const setActiveAvatarRoom = useAppStore(s => s.setActiveAvatarRoom);
  const isInAvatarRoom     = useAppStore(s => s.isInAvatarRoom);
  const setIsInAvatarRoom  = useAppStore(s => s.setIsInAvatarRoom);
  const avatarRoomToken    = useAppStore(s => s.avatarRoomToken);
  const setAvatarRoomToken = useAppStore(s => s.setAvatarRoomToken);

  const messagesAsc      = useChatStore(s => s.messages);
  const messages         = useMemo(() => [...messagesAsc].reverse(), [messagesAsc]);
  const replyingTo       = useChatStore(s => s.replyingTo);
  const isLoadingHistory = useChatStore(s => s.isLoadingHistory);
  const setReplyingTo    = useChatStore(s => s.setReplyingTo);
  const typingUsers      = useChatStore(s => s.typingUsers);
  const { initialize, disconnect, logout, streamAlive, send, reply, react, edit, stickerReact, sendFile, sendTyping, forceAdminInit, broadcastProfile, broadcastEvent, broadcastVideoRoom, broadcastAvatarRoom, syncMessages } = useXmtp();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [tipTarget, setTipTarget] = useState<ChatMessage | null>(null);
  const [tipSending, setTipSending] = useState(false);
  const [devTipOpen, setDevTipOpen] = useState(false);
  const [pfpPickerOpen, setPfpPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [refreshingChat, setRefreshingChat] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bananaClaim, setBananaClaim] = useState<ClaimResult | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [earnedBadge, setEarnedBadge] = useState<Badge | null>(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pfpGifPickerOpen, setPfpGifPickerOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoLightboxUrl, setVideoLightboxUrl] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [adminRecoveryOpen, setAdminRecoveryOpen] = useState(false);
  const [adminRecoveryPat, setAdminRecoveryPat] = useState("");
  const [adminRecoveryBusy, setAdminRecoveryBusy] = useState(false);
  const [adminRecoveryError, setAdminRecoveryError] = useState<string | null>(null);
  const [videoCallToken, setVideoCallToken] = useState<string | null>(null);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapConfirmOpen, setSwapConfirmOpen] = useState(false);
  const [swapExecuting, setSwapExecuting] = useState(false);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [xShareImageUri, setXShareImageUri] = useState<string | null>(null);
  const [skrPrice, setSkrPrice] = useState<string | null>(null);
  const [floorPrice, setFloorPrice] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const initialMsgIdsRef = useRef<Set<string>>(new Set());

  const handleDownloadVideo = async (uri: string) => {
    const ML = await getMediaLibrary();
    const { status } = await ML.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow gallery access to save videos.");
      return;
    }
    try {
      const FS = await getFileSystem();
      const dest = `${FS.cacheDirectory}om_video_${Date.now()}.mp4`;
      const dl = await FS.downloadAsync(uri, dest);
      await ML.saveToLibraryAsync(dl.uri);
      Alert.alert("Saved", "Video saved to your gallery.");
    } catch {
      Alert.alert("Error", "Could not save video.");
    }
  };

  const myAddress = myInboxId ?? "";

  // ─── Pull-to-refresh handler ──────────────────────────────────────────────────
  const handleRefreshChat = useCallback(async () => {
    setRefreshingChat(true);
    await syncMessages();
    setRefreshingChat(false);
  }, [syncMessages]);

  // ─── XMTP connect + network-aware sync ───────────────────────────────────────
  useEffect(() => {
    initialize().then(async () => {
      const { justHitLegendary } = await checkAndUpdateStreak();
      // Sync streak into badge progress so streak badges auto-earn
      const { loginStreak, bestStreak } = useAppStore.getState();
      updateBadgeStreak(loginStreak, bestStreak);
      if (justHitLegendary) {
        setShowConfetti(true);
        broadcastProfile();
      }
      // Banana daily reward
      const claim = await claimDailyBananas();
      useAppStore.getState().setBananaBalance(claim.balance);
      if (claim.claimed) setBananaClaim(claim);
      // Load equipped Banana Shop styles for MessageBubble rendering
      getEquippedStyles().then(s => {
        useAppStore.getState().setShopStyles(s);
        // Apply Tier 4 theme overrides if a theme is equipped
        applyThemeFromShop(s);
      }).catch(() => {});
      // Extract NFT dominant color for Tier 3 PFP styles
      const nft = useAppStore.getState().verifiedNft;
      if (nft?.image) {
        getOrExtractNftColor(nft.image, nft.mint ?? "nft").then(c => {
          useAppStore.getState().setNftDominantColor(c);
        }).catch(() => {});
      }
      // Schedule banana-related push notifications
      checkBananaNotifications().catch(() => {});
      // Check for new badges
      const bananaState = await loadBananaState();
      const { newBadges } = await updateStats({
        totalDaysActive: bananaState.totalCycles * 7 + bananaState.streakDay,
        currentStreak: bananaState.streakDay,
        totalCycles: bananaState.totalCycles,
        bananaBalance: bananaState.balance,
      });
      if (newBadges.length > 0) setEarnedBadge(newBadges[0]);
      // Show onboarding for first-time users
      const onboarded = await hasCompletedOnboarding();
      if (!onboarded) setShowOnboarding(true);
    });

    // Wire offline queue flusher so it fires when network comes back
    setOfflineQueueFlusher(async () => {
      const { updateMessageStatus } = useChatStore.getState();
      await flushOfflineQueue(
        (text) => send(text),
        (replyTo, text) => {
          if (!replyTo) return send(text);
          return reply(replyTo as ChatMessage, text);
        },
        updateMessageStatus,
      );
    });

    // Register network-aware heartbeat (replaces manual AppState + setInterval)
    const syncOrReconnect = async () => {
      if (!streamAlive()) await initialize();
      else await syncMessages();
    };
    registerNetworkSync(syncOrReconnect, initialize);

    return () => {
      unregisterNetworkSync();
      disconnect();
    };
  }, []);

  // ─── Auto-retry until approved ───────────────────────────────────────────────
  // Retries with exponential backoff (5s → 10s → 20s → cap 30s).
  useEffect(() => {
    if (isGroupMember || !remoteGroupId) return;
    let delay = 3_000;
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      timer = setTimeout(() => {
        initialize();
        delay = Math.min(delay * 2, 30_000);
        retry();
      }, delay);
    };
    retry();
    return () => clearTimeout(timer);
  }, [isGroupMember, remoteGroupId]);

  // ─── Register for push notifications once member is confirmed ────────────────
  useEffect(() => {
    if (!isGroupMember) return;
    registerForPushNotifications().then(token => {
      if (token) useAppStore.getState().setExpoPushToken(token);
    }).catch(() => {/* silently ignore */});
  }, [isGroupMember]);

  // ─── Wire notification inline-reply → XMTP send ───────────────────────────
  useEffect(() => {
    if (!isGroupMember) return;
    setNotificationReplyHandler((text) => {
      send(text).catch((err) => console.warn("[Notifications] Reply send failed:", err));
    });
  }, [isGroupMember, send]);

  // ─── Aggressive re-sync on sparse history (fresh install / epoch update) ──────
  // After a fresh install the new installation key won't see old messages until
  // the group epoch updates. Re-sync every 8s for the first 2 minutes so new
  // messages appear as soon as the epoch is current.
  useEffect(() => {
    if (!isGroupMember) return;
    if (messages.length >= 10) return; // history looks healthy, skip
    let count = 0;
    const id = setInterval(() => {
      syncMessages();
      count++;
      if (count >= 15) clearInterval(id); // stop after 2 min
    }, 8_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroupMember, messages.length >= 10 ? 1 : 0]);

  // ─── Load saved profile, show modal if no username yet ───────────────────

  useEffect(() => {
    loadUserProfile().then(({ username: saved, bio, xAccount: savedX, tipWallet: savedTip, location: savedLoc }) => {
      if (saved) {
        setUsername(saved);
        if (bio) setBio(bio);
        if (savedX) setXAccount(savedX);
        const effectiveTip = savedTip || useAppStore.getState().wallet?.address || null;
        if (effectiveTip) setTipWallet(effectiveTip);
        if (savedLoc) useAppStore.getState().setLocation(savedLoc);
      } else {
        setShowUsernameModal(true);
      }
      // Always keep own entry in the profile cache so PFP shows everywhere
      const { myInboxId: id, verifiedNft: nft } = useAppStore.getState();
      if (id) cacheProfile(id, { username: saved ?? undefined, nftImage: nft?.image ?? null, location: savedLoc ?? undefined });
    });
    // Load persisted theme
    loadThemeId().then(setThemeId);
    loadCustomColor().then((c) => { if (c) setCustomBubbleColor(c); });
    // Load persisted calendar events
    loadEvents().then(setCalendarEvents);
    // Load pinned messages, thread metadata, marketplace listings
    loadPinnedMessages().then(setPinnedMessages);
    loadThreadMetadata();
    loadListings();
  }, []);

  // ─── Fetch $SKR price + Saga Monkes floor price (live, every 60s) ───────────
  useEffect(() => {
    let mounted = true;
    const fetchPrices = () => {
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${SKR_MINT}`)
        .then(r => r.json())
        .then(d => {
          if (!mounted) return;
          const p = d?.pairs?.[0]?.priceUsd;
          if (p) setSkrPrice(Number(p) < 0.01 ? `$${Number(p).toFixed(6)}` : `$${Number(p).toFixed(4)}`);
        })
        .catch(() => {});
      fetch('https://api-mainnet.magiceden.dev/v2/collections/sagamonkes/stats')
        .then(r => r.json())
        .then(d => {
          if (!mounted) return;
          if (d?.floorPrice) setFloorPrice(`${(d.floorPrice / 1e9).toFixed(2)} SOL`);
        })
        .catch(() => {});
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ─── Keep own NFT in profile cache in sync whenever verifiedNft changes ──────
  useEffect(() => {
    if (myInboxId && verifiedNft?.image) {
      cacheProfile(myInboxId, { nftImage: verifiedNft.image, location: useAppStore.getState().location ?? undefined });
    }
  }, [myInboxId, verifiedNft]);

  // ─── Record initial message IDs so only new arrivals get FadeIn animation ────
  useEffect(() => {
    if (!isLoadingHistory && messages.length > 0 && initialMsgIdsRef.current.size === 0) {
      initialMsgIdsRef.current = new Set(messages.map(m => m.id));
    }
  }, [isLoadingHistory, messages.length]);


  // ─── Send ────────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    // ── Intercept /buy, /sell, /swap commands ──────────────────────────────────
    const { parseSwapCommand, resolveToken, getSwapQuote, getTokenBalance } = await getJupiterSwap();
    const swapCmd = parseSwapCommand(text);
    if (swapCmd) {
      setInputText("");
      setIsSending(true);
      try {
        const walletAddr = useAppStore.getState().wallet?.address;
        if (!walletAddr) { Alert.alert("No wallet", "Connect your wallet first."); return; }

        const inputToken = await resolveToken(swapCmd.inputSymbol);
        const outputToken = await resolveToken(swapCmd.outputSymbol);
        if (!inputToken) { Alert.alert("Unknown token", `Could not find token: ${swapCmd.inputSymbol}`); return; }
        if (!outputToken) { Alert.alert("Unknown token", `Could not find token: ${swapCmd.outputSymbol}`); return; }

        let amountRaw: string;
        if (swapCmd.type === "sell") {
          // /sell: amount is a percentage of holdings
          const balance = await getTokenBalance(walletAddr, inputToken.mint, inputToken.decimals);
          if (balance <= 0) { Alert.alert("No balance", `You have no ${inputToken.symbol} to sell.`); return; }
          const sellAmount = balance * (swapCmd.amount / 100);
          amountRaw = Math.floor(sellAmount * Math.pow(10, inputToken.decimals)).toString();
        } else {
          // /buy and /swap: amount is in input token units
          amountRaw = Math.floor(swapCmd.amount * Math.pow(10, inputToken.decimals)).toString();
        }

        const quote = await getSwapQuote(
          inputToken.mint, outputToken.mint, amountRaw,
          inputToken.decimals, outputToken.decimals,
          inputToken.symbol, outputToken.symbol
        );
        setSwapQuote(quote);
        setSwapConfirmOpen(true);
      } catch (err: any) {
        Alert.alert("Swap error", txError());
      } finally {
        setIsSending(false);
      }
      return;
    }

    // ── Intercept /tip @username [amount] ────────────────────────────────────
    const tipCmd = parseTipCommand(text);
    if (tipCmd) {
      setInputText("");
      // Resolve @username → inboxId → wallet
      const allUsers = getAllTimeUsers();
      let targetInboxId: string | null = null;
      allUsers.forEach((name, inboxId) => {
        if (name?.toLowerCase() === tipCmd.username.toLowerCase()) {
          targetInboxId = inboxId;
        }
      });
      if (!targetInboxId) {
        Alert.alert("User not found", `Could not find @${tipCmd.username}. They may not have chatted yet.`);
        return;
      }
      const cached = getCachedProfile(targetInboxId);
      const recipientWallet = cached?.tipWallet || cached?.walletAddress;
      if (!recipientWallet) {
        Alert.alert("No wallet", `@${tipCmd.username} hasn't linked a wallet yet.`);
        return;
      }
      // Open TipModal with pre-filled target
      setTipTarget({
        id: `tip-cmd-${Date.now()}`,
        senderAddress: targetInboxId,
        senderUsername: tipCmd.username,
        content: "",
        sentAt: new Date(),
        reactions: {} as ChatMessage["reactions"],
      });
      return;
    }

    // ── Intercept /tiplink <amount> — claimable SOL link ─────────────────────
    const tipLinkMatch = text.match(/^\/tiplink\s+([\d.]+)/i);
    if (tipLinkMatch) {
      setInputText("");
      const amount = parseFloat(tipLinkMatch[1]);
      if (!amount || amount <= 0 || amount > 10) {
        Alert.alert("Invalid amount", "Tip link amount must be between 0.001 and 10 SOL.");
        return;
      }
      setIsSending(true);
      try {
        const { createTipLink } = await import("@/lib/tipLink");
        const result = await createTipLink(amount);
        await send(`TIPLINK:${result.claimUrl}|${amount}|${username ?? "Monke"}`);
      } catch (err: any) {
        Alert.alert("TipLink failed", txError());
      } finally {
        setIsSending(false);
      }
      return;
    }

    setInputText("");
    setIsSending(true);

    const currentReplyingTo = replyingTo;

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      senderAddress: myAddress,
      senderUsername: username ?? undefined,
      senderNft: verifiedNft ?? undefined,
      content: text,
      sentAt: new Date(),
      reactions: {} as ChatMessage["reactions"],
      replyTo: currentReplyingTo
        ? {
            id: currentReplyingTo.id,
            content: currentReplyingTo.content,
            senderAddress: currentReplyingTo.senderAddress,
            senderUsername: currentReplyingTo.senderUsername,
          }
        : undefined,
      status: "sending",
    };

    useChatStore.getState().addMessage(optimistic);
    setReplyingTo(null);

    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);

    try {
      if (currentReplyingTo) {
        await reply(currentReplyingTo, text);
      } else {
        await send(text);
      }
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
      // Persist own message to cache — stream handler skips own messages,
      // so without this they're lost on force close + reopen
      appendCachedMessage("main_chat", { ...optimistic, status: "sent" }).catch(() => {});
    } catch {
      // If offline, queue for auto-retry when back online
      if (!isOnline()) {
        await enqueueMessage({
          id: optimistic.id,
          content: text,
          replyTo: currentReplyingTo
            ? { id: currentReplyingTo.id, content: currentReplyingTo.content, senderAddress: currentReplyingTo.senderAddress, senderUsername: currentReplyingTo.senderUsername }
            : undefined,
          queuedAt: Date.now(),
          retryCount: 0,
        });
        useChatStore.getState().updateMessageStatus(optimistic.id, "pending");
      } else {
        useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
      }
    } finally {
      setIsSending(false);
    }
  }, [inputText, myAddress, username, verifiedNft, replyingTo, send, reply, setReplyingTo]);

  // ─── React (banana) ──────────────────────────────────────────────────────────

  const handleReact = useCallback(
    async (emoji: ReactionEmoji, messageId: string) => {
      try {
        await react(emoji, messageId);
      } catch (err) {
        console.warn("Reaction failed:", err);
      }
    },
    [react]
  );

  // ─── Send GIF ─────────────────────────────────────────────────────────────────

  const handleSendGif = useCallback(async (url: string) => {
    const content = `GIF:${url}`;
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      senderAddress: myAddress,
      senderUsername: username ?? undefined,
      senderNft: verifiedNft ?? undefined,
      content,
      sentAt: new Date(),
      reactions: {} as ChatMessage["reactions"],
      status: "sending",
    };
    useChatStore.getState().addMessage(optimistic);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
    try {
      await send(content);
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
      appendCachedMessage("main_chat", { ...optimistic, status: "sent" }).catch(() => {});
    } catch (err) {
      console.warn("GIF send failed:", err);
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
    }
  }, [send, myAddress, username, verifiedNft]);

  // ─── Camera capture ────────────────────────────────────────────────────────

  const handleCamera = useCallback(async () => {
    try {
      const IP = await getImagePicker();
      const { status } = await IP.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera permission required", "Please allow camera access in your device settings.");
        return;
      }
      const result = await IP.launchCameraAsync({
        mediaTypes: IP.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: false,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Compress to max 1200px wide, JPEG 70% then convert to base64 data URI
      const { compressImage } = await getVideoUpload();
      const compressedUri = await compressImage(asset.uri);
      const FS = await getFileSystem();
      const b64 = await FS.readAsStringAsync(compressedUri, { encoding: FS.EncodingType.Base64 });
      const dataUri = `data:image/jpeg;base64,${b64}`;
      const content = `IMAGE:${dataUri}`;
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        senderAddress: myAddress,
        senderUsername: username ?? undefined,
        senderNft: verifiedNft ?? undefined,
        content,
        sentAt: new Date(),
        reactions: {} as ChatMessage["reactions"],
        status: "sending",
      };
      useChatStore.getState().addMessage(optimistic);
      setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
      try {
        await send(content);
        useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
        appendCachedMessage("main_chat", { ...optimistic, status: "sent" }).catch(() => {});
        // Prompt to share on X
        setXShareImageUri(dataUri);
      } catch (err: any) {
        Alert.alert("Camera error", err?.message ?? "Could not send photo.");
        useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
      }
    } catch (err: any) {
      Alert.alert("Camera error", err?.message ?? "Could not open camera.");
    }
  }, [send, myAddress, username, verifiedNft]);

  // ─── File picker (RemoteAttachment) ──────────────────────────────────────────

  const handleFilePicker = useCallback(async () => {
    try {
      const DP = await import('expo-document-picker');
      const result = await DP.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      // Upload to Cloudinary as raw file
      const { uploadFile } = await import('@/lib/videoUpload');
      const url = await uploadFile(file.uri, file.name ?? 'file', file.mimeType ?? 'application/octet-stream');
      await sendFile(url, file.name ?? 'file', file.size ?? 0);
    } catch (err: any) {
      Alert.alert('File error', err?.message ?? 'Could not send file.');
    }
  }, [sendFile]);

  // ─── Camera button — alert for Photo vs Video vs File ──────────────────────

  const handleCameraButtonPress = useCallback(() => {
    Alert.alert('Share media', 'Choose an option', [
      { text: '📷 Photo', onPress: handleCamera },
      { text: '🎥 Video', onPress: () => setVideoModalOpen(true) },
      { text: '📎 File', onPress: handleFilePicker },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleCamera, handleFilePicker]);

  // ─── Video send (from VideoCameraModal) ──────────────────────────────────────

  const handleVideoSend = useCallback(async (content: string) => {
    setVideoModalOpen(false);
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      senderAddress: myAddress,
      senderUsername: username ?? undefined,
      senderNft: verifiedNft ?? undefined,
      content,
      sentAt: new Date(),
      reactions: {} as ChatMessage['reactions'],
      status: 'sending',
    };
    useChatStore.getState().addMessage(optimistic);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
    try {
      await send(content);
      useChatStore.getState().updateMessageStatus(optimistic.id, 'sent');
    } catch (err: any) {
      Alert.alert('Video error', err?.message ?? 'Could not send video.');
      useChatStore.getState().updateMessageStatus(optimistic.id, 'failed');
    }
  }, [send, myAddress, username, verifiedNft]);

  // ─── Sticker react ────────────────────────────────────────────────────────────

  const handleStickerReact = useCallback(async (url: string, messageId: string) => {
    try {
      await stickerReact(url, messageId);
    } catch (err) {
      console.warn("Sticker react failed:", err);
    }
  }, [stickerReact]);

  // ─── Edit message ──────────────────────────────────────────────────────────────

  const handleEditMessage = useCallback((msg: ChatMessage) => {
    setEditTarget(msg);
    setEditText(msg.editedContent ?? msg.content);
  }, []);

  const handleEditSubmit = useCallback(async () => {
    if (!editTarget || !editText.trim()) return;
    try {
      await edit(editTarget.id, editText.trim());
    } catch (err) {
      console.warn("Edit failed:", err);
    }
    setEditTarget(null);
    setEditText("");
  }, [edit, editTarget, editText]);

  // ─── X / Twitter share for own images ─────────────────────────────────────────

  const handleShareToX = useCallback(() => {
    const caption = encodeURIComponent("I snapped this using @xOnlyMonkes via Solana Mobile, The Future is Monke! 🐒");
    const url = `https://x.com/intent/tweet?text=${caption}`;
    Linking.openURL(url);
    setXShareImageUri(null);
  }, []);

  // ─── Profile popup ────────────────────────────────────────────────────────────

  const handlePressUser = useCallback((target: ProfileTarget) => {
    setProfileTarget(target);
  }, []);

  // ─── Tipping ─────────────────────────────────────────────────────────────────

  const handleTip = useCallback((message: ChatMessage) => {
    setTipTarget(message);
  }, []);

  const handleConfirmTip = useCallback(async (amount: TipAmount) => {
    if (!tipTarget) return;
    const cached = getCachedProfile(tipTarget.senderAddress);
    // Prefer dedicated tip wallet; fall back to connected wallet address
    const recipientWallet = cached?.tipWallet || cached?.walletAddress;
    if (!recipientWallet) {
      Alert.alert(
        "No wallet found",
        `${tipTarget.senderUsername ?? "This user"} hasn't linked a wallet yet. Ask them to set one in their profile.`
      );
      return;
    }
    setTipSending(true);
    try {
      await sendSkrTip(recipientWallet, amount);
      Alert.alert("🍌 Tip sent!", `${amount} SKR sent to ${tipTarget.senderUsername ?? "this user"}`);
      setTipTarget(null);
    } catch (err: any) {
      Alert.alert("Tip failed", txError());
    } finally {
      setTipSending(false);
    }
  }, [tipTarget]);

  // ─── Live audio room handlers ───────────────────────────────────────────────

  // ── Video call handlers ─────────────────────────────────────────────────────

  const handleStartVideoCall = useCallback(async () => {
    if (!myInboxId || !username) {
      Alert.alert("Set a username first", "Go to your profile and set a username before starting a video call.");
      return;
    }
    try {
      const createVR = await getCreateVideoRoom();
      const { roomData, token } = await createVR(myInboxId, username);
      setActiveVideoRoom(roomData);
      setIsInVideoCall(true);
      setVideoCallToken(token);
      await broadcastVideoRoom(roomData);
      await showLocalNotification(`${username} started a Video Call`, "Live Video in OnlyMonkes", CH_ALL);
      router.push(`/video-room?token=${encodeURIComponent(token)}&isHost=1`);
    } catch (err: any) {
      Alert.alert("Failed to start video call", err?.message ?? "Unknown error");
    }
  }, [myInboxId, username, broadcastVideoRoom, setActiveVideoRoom, setIsInVideoCall]);

  const handleJoinVideoCall = useCallback(async () => {
    if (!myInboxId || !username || !activeVideoRoom) return;
    try {
      const joinVR = await getJoinVideoRoom();
      const token = await joinVR(activeVideoRoom.id, myInboxId, username);
      setIsInVideoCall(true);
      setVideoCallToken(token);
      router.push(`/video-room?token=${encodeURIComponent(token)}&isHost=0`);
    } catch (err: any) {
      Alert.alert("Failed to join", networkError());
    }
  }, [myInboxId, username, activeVideoRoom, setIsInVideoCall]);

  const handleLeaveVideoCall = useCallback(async () => {
    setIsInVideoCall(false);
    setVideoCallToken(null);
    await getDisconnectVideoRoom().then(fn => fn()).catch(() => {});
  }, [setIsInVideoCall]);

  const handleEndVideoCall = useCallback(async () => {
    if (!activeVideoRoom) return;
    const data: VideoRoomData = { ...activeVideoRoom, active: false };
    setActiveVideoRoom(null);
    setIsInVideoCall(false);
    setVideoCallToken(null);
    await getDisconnectVideoRoom().then(fn => fn()).catch(() => {});
    await broadcastVideoRoom(data).catch(() => {});
  }, [activeVideoRoom, broadcastVideoRoom, setActiveVideoRoom, setIsInVideoCall]);

  // ── Avatar room handlers ────────────────────────────────────────────────────

  const handleStartAvatarRoom = useCallback(async () => {
    if (!myInboxId || !username) {
      Alert.alert("Set a username first", "Go to your profile and set a username before starting a live.");
      return;
    }
    try {
      const roomId = createRoomName(myInboxId);
      const data: AvatarRoomData = {
        id: roomId,
        host: username,
        hostId: myInboxId,
        ts: Date.now(),
        active: true,
      };
      setActiveAvatarRoom(data);
      await broadcastAvatarRoom(data);
      await showLocalNotification(`${username} started a Live`, "Avatar Room in OnlyMonkes", CH_ALL);
      const token = await createLivekitToken(roomId, myInboxId, username);
      setAvatarRoomToken(token);
      setIsInAvatarRoom(true);
      router.push(`/avatar-room?token=${encodeURIComponent(token)}&isHost=true`);
    } catch {
      Alert.alert("Failed to start", "Could not create the avatar room.");
    }
  }, [myInboxId, username, broadcastAvatarRoom, setActiveAvatarRoom, setAvatarRoomToken, setIsInAvatarRoom]);

  const handleJoinAvatarRoom = useCallback(async () => {
    if (!myInboxId || !username || !activeAvatarRoom) return;
    try {
      const token = await createLivekitToken(activeAvatarRoom.id, myInboxId, username);
      setAvatarRoomToken(token);
      setIsInAvatarRoom(true);
      router.push(`/avatar-room?token=${encodeURIComponent(token)}&isHost=false`);
    } catch {
      Alert.alert("Failed to join", "Could not join the avatar room.");
    }
  }, [myInboxId, username, activeAvatarRoom, setAvatarRoomToken, setIsInAvatarRoom]);

  const handleLeaveAvatarRoom = useCallback(async () => {
    await disconnectFromAvatarRoom();
    setIsInAvatarRoom(false);
    setAvatarRoomToken(null);
  }, [setIsInAvatarRoom, setAvatarRoomToken]);

  const handleEndAvatarRoom = useCallback(async () => {
    if (!activeAvatarRoom) return;
    const data: AvatarRoomData = { ...activeAvatarRoom, active: false };
    setActiveAvatarRoom(null);
    setIsInAvatarRoom(false);
    setAvatarRoomToken(null);
    await disconnectFromAvatarRoom();
    await broadcastAvatarRoom(data).catch(() => {});
  }, [activeAvatarRoom, broadcastAvatarRoom, setActiveAvatarRoom, setIsInAvatarRoom, setAvatarRoomToken]);

  const handleConfirmDevTip = useCallback(async (amount: TipAmount) => {
    setDevTipOpen(false);
    try {
      await sendDevTip(amount);
      Alert.alert("Thank you!", `${amount} SKR sent to Jump.skr. Your support keeps OnlyMonkes alive!`);
    } catch (err: any) {
      Alert.alert("Tip failed", txError());
    }
  }, []);

  // ─── Swap execution ──────────────────────────────────────────────────────────

  const handleConfirmSwap = useCallback(async () => {
    if (!swapQuote) return;
    setSwapExecuting(true);
    try {
      const { executeSwap } = await getJupiterSwap();
      const result = await executeSwap(swapQuote);
      setSwapConfirmOpen(false);
      setSwapQuote(null);
      // Announce the trade in chat
      const tradeMsg = `Swapped ${result.inputAmount.toFixed(4)} ${result.inputSymbol} for ${result.outputAmount.toFixed(4)} ${result.outputSymbol}`;
      await send(tradeMsg).catch(() => {});
      Alert.alert("Swap complete!", tradeMsg);
    } catch (err: any) {
      Alert.alert("Swap failed", err?.message ?? "Transaction could not be sent.");
    } finally {
      setSwapExecuting(false);
    }
  }, [swapQuote, send]);

  const handleCancelSwap = useCallback(() => {
    setSwapConfirmOpen(false);
    setSwapQuote(null);
  }, []);

  // ─── Stable callbacks for FlatList renderItem (avoids re-creating on every render) ──

  const handlePin = useCallback(async (msg: ChatMessage) => {
    if (!isGroupAdmin) return;
    const { pinMessage: doPin, buildPinMessage: buildPin } = require("@/lib/pinnedMessages");
    await doPin(msg, myAddress);
    setPinnedMessages(getPinnedMessages());
    send(buildPin(msg.id, "pin")).catch(() => {});
  }, [isGroupAdmin, myAddress, send]);

  const handleThread = useCallback((msg: ChatMessage) => {
    router.push(
      `/thread?parentId=${msg.id}&parentContent=${encodeURIComponent(msg.content)}&parentSender=${encodeURIComponent(msg.senderUsername ?? "")}`,
    );
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isNew = !initialMsgIdsRef.current.has(item.id);
      return (
        <Animated.View entering={isNew ? FadeIn.duration(220) : undefined}>
          <MessageBubble
            message={item}
            isOwn={item.senderAddress === myAddress}
            onReact={handleReact}
            onReply={setReplyingTo}
            onPressUser={handlePressUser}
            onTip={handleTip}
            onStickerReact={handleStickerReact}
            onPressImage={setLightboxUrl}
            onPressVideo={setVideoLightboxUrl}
            onTokenPress={setChartSymbol}
            onEdit={handleEditMessage}
            onPin={isGroupAdmin ? handlePin : undefined}
            onThread={handleThread}
          />
        </Animated.View>
      );
    },
    [myAddress, isGroupAdmin, handleReact, setReplyingTo, handlePressUser, handleTip, handleStickerReact, setVideoLightboxUrl, handleEditMessage, handlePin, handleThread]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // ── FlatList performance helpers ──────────────────────────────────────────
  // NOTE: getItemLayout omitted — messages have variable heights (text, images, videos)
  // and estimated heights cause visual glitches with overlapping/gaps.
  const SCROLL_THRESHOLD = 270; // ~3 message heights

  // Only auto-scroll if user is already near the bottom (within ~3 messages)
  const isNearBottomRef = useRef(true);
  const handleContentSizeChange = useCallback(() => {
    if (isNearBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);

  return (
    <>
      {showConfetti && <ConfettiView onDone={() => setShowConfetti(false)} />}

      <BananaClaimModal
        visible={!!bananaClaim}
        claim={bananaClaim}
        onDismiss={() => setBananaClaim(null)}
      />

      <OnboardingOverlay
        visible={showOnboarding}
        onComplete={async (bonus) => {
          setShowOnboarding(false);
          // Persist bonus to AsyncStorage + update Zustand
          const newBalance = await addBananas(bonus);
          useAppStore.getState().setBananaBalance(newBalance);
        }}
      />

      <BadgeNotificationBanner
        badge={earnedBadge}
        onDismiss={() => setEarnedBadge(null)}
      />

      <ScrollToBottomFab
        visible={showScrollFab}
        unreadCount={unreadWhileScrolled}
        onPress={() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          setShowScrollFab(false);
          setUnreadWhileScrolled(0);
        }}
      />

      <UsernameModal
        visible={showUsernameModal || editingProfile}
        onDone={async () => {
          setShowUsernameModal(false);
          setEditingProfile(false);
          await broadcastProfile();
        }}
        editMode={editingProfile}
        initialUsername={editingProfile ? (username ?? "") : ""}
        initialBio={editingProfile ? (bio ?? "") : ""}
        initialXAccount={editingProfile ? (xAccount ?? "") : ""}
        initialTipWallet={editingProfile ? (tipWallet ?? "") : ""}
        initialLocation={editingProfile ? (userLocation ?? "") : ""}
      />

      <MenuDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateEvent={() => setCalendarOpen(true)}
        onStartLive={handleStartAvatarRoom}
        onStartVideo={handleStartVideoCall}
        onSearch={() => setSearchOpen(true)}
        onPressUser={(target) => { setDrawerOpen(false); setTimeout(() => setProfileTarget(target), 300); }}
        broadcastProfile={broadcastProfile}
        onDevTip={(amount) => {
          setDrawerOpen(false);
          handleConfirmDevTip(amount);
        }}
      />

      <SearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} />

      <ChartModal
        visible={!!chartSymbol}
        symbol={chartSymbol ?? ''}
        onClose={() => setChartSymbol(null)}
      />

      <CalendarModal
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        onBroadcast={broadcastEvent}
      />

      <TipModal
        visible={!!tipTarget}
        recipientName={tipTarget?.senderUsername ?? "this monke"}
        onConfirm={handleConfirmTip}
        onClose={() => setTipTarget(null)}
      />

      <TipModal
        visible={devTipOpen}
        recipientName="Jump.skr"
        onConfirm={handleConfirmDevTip}
        onClose={() => setDevTipOpen(false)}
      />


      <SwapConfirmModal
        visible={swapConfirmOpen}
        quote={swapQuote}
        isExecuting={swapExecuting}
        onConfirm={handleConfirmSwap}
        onCancel={handleCancelSwap}
      />

      <GifPickerModal
        visible={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={handleSendGif}
      />

      <GifPickerModal
        visible={pfpGifPickerOpen}
        onClose={() => setPfpGifPickerOpen(false)}
        onSelect={handleSendGif}
        sagaMonkesOnly
      />

      <UserProfileModal
        visible={!!profileTarget}
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
        onEditProfile={() => setEditingProfile(true)}
        onChangePfp={allNfts.length > 0 ? () => setPfpPickerOpen(true) : undefined}
        onLogout={async () => { await logout(); router.replace("/"); }}
        onSwitchWallet={async () => { await logout(); router.replace("/"); }}
        onMessage={profileTarget && profileTarget.senderAddress !== myAddress
          ? () => router.push(`/dm/${profileTarget.senderAddress}`)
          : undefined
        }
      />

      <NftPickerModal
        visible={pfpPickerOpen}
        nfts={allNfts}
        onCancel={() => setPfpPickerOpen(false)}
        onSelect={async (nft) => {
          setVerified(true, nft);
          await saveSelectedNftMint(nft.mint);
          setPfpPickerOpen(false);
          await broadcastProfile();
        }}
      />

      {/* ── Image Lightbox (pinch-to-zoom, swipe dismiss, watermark) ─── */}
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />

      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Left: avatar + banana count */}
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => setProfileTarget({
                senderAddress: myAddress,
                senderUsername: username ?? undefined,
                senderNft: verifiedNft ?? undefined,
              })}
              hitSlop={6}
            >
              {verifiedNft?.image ? (
                <Image
                  source={{ uri: verifiedNft.image }}
                  style={styles.headerNft}
                />
              ) : (
                <View style={styles.headerNftFallback}>
                  <Text style={styles.headerNftGlyph}>🐒</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Center: decorative banner image */}
          <ImageBackground
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../assets/header.png")}
            style={styles.headerCenter}
            resizeMode="cover"
          />

          {/* Right: globe + banana pill (opens community popup) */}
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push("/globe" as any)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <Text style={styles.iconBtnText}>🌍</Text>
            </Pressable>

            <Pressable
              style={styles.bananaHeaderPill}
              onPress={() => setDrawerOpen(true)}
              hitSlop={6}
            >
              <Text style={styles.bananaHeaderText}>{bananaBalance} 🍌</Text>
              {(communityBadges.dms + communityBadges.events + communityBadges.links) > 0 && (
                <View style={styles.communityBadge}>
                  <Text style={styles.communityBadgeText}>
                    {communityBadges.dms + communityBadges.events + communityBadges.links}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Bot command ticker — overlaid at bottom of header, under the logo */}
          {isGroupMember && (
            <View style={styles.tickerWrap}>
              <BotCommandTicker />
            </View>
          )}
        </View>

        {/* ── Connecting… spinner (before group state is known) ──────────── */}
        {isLoading && !isGroupMember && (
          <View style={styles.pendingContainer}>
            <ActivityIndicator size="large" color={THEME.accent} />
            <Text style={styles.pendingSubtitle}>Connecting to chat…</Text>
          </View>
        )}

        {/* ── Init error — network / XMTP failure ─────────────────────────── */}
        {!isLoading && !isGroupMember && !!error && (
          <View style={styles.pendingContainer}>
            <Text style={styles.pendingIcon}>⚠️</Text>
            <Text style={styles.pendingTitle}>Connection Failed</Text>
            <Text style={[styles.pendingSubtitle, { color: THEME.error }]}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => initialize()}>
              <Text style={styles.retryBtnText}>↻ Retry</Text>
            </Pressable>
            <Pressable onPress={async () => { await logout(); router.replace("/"); }} hitSlop={8}>
              <Text style={styles.pendingLogoutLink}>Log out</Text>
            </Pressable>
          </View>
        )}

        {/* ── Not yet a member — auto-joining in progress ─────────────── */}
        {!isLoading && !isGroupMember && !error && (
          <View style={styles.pendingContainer}>
            <Text style={styles.pendingIcon}>🐒</Text>
            <Text style={styles.pendingTitle}>Joining OnlyMonkes…</Text>
            <ActivityIndicator color={THEME.accent} style={{ marginTop: 8 }} />
            <Text style={styles.pendingSubtitle}>
              NFT verified — joining the group automatically. Hang tight!
            </Text>
            <Pressable onPress={async () => { await logout(); router.replace("/"); }} hitSlop={8}>
              <Text style={styles.pendingLogoutLink}>Log out</Text>
            </Pressable>

            {/* Admin recovery — shown after tapping "Are you the admin?" */}
            {!adminRecoveryOpen ? (
              <Pressable onPress={() => setAdminRecoveryOpen(true)} hitSlop={8}>
                <Text style={styles.adminRecoveryLink}>Are you the admin?</Text>
              </Pressable>
            ) : (
              <View style={styles.adminRecoveryBox}>
                <Text style={styles.adminRecoveryTitle}>Admin Recovery</Text>
                <Text style={styles.adminRecoveryHint}>
                  Enter your GitHub PAT (repo scope) to create a new group and re-claim admin.
                </Text>
                <TextInput
                  style={styles.adminRecoveryInput}
                  placeholder="ghp_…"
                  placeholderTextColor={THEME.textFaint}
                  value={adminRecoveryPat}
                  onChangeText={(t) => { setAdminRecoveryPat(t); setAdminRecoveryError(null); }}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {adminRecoveryError && (
                  <Text style={styles.adminRecoveryError}>{adminRecoveryError}</Text>
                )}
                <Pressable
                  style={[styles.adminRecoveryBtn, (!adminRecoveryPat.trim() || adminRecoveryBusy) && { opacity: 0.5 }]}
                  disabled={!adminRecoveryPat.trim() || adminRecoveryBusy}
                  onPress={async () => {
                    setAdminRecoveryBusy(true);
                    setAdminRecoveryError(null);
                    try {
                      await forceAdminInit(adminRecoveryPat.trim());
                      setAdminRecoveryOpen(false);
                      setAdminRecoveryPat("");
                    } catch (e) {
                      setAdminRecoveryError(e instanceof Error ? e.message : "Failed — check your PAT and try again.");
                    } finally {
                      setAdminRecoveryBusy(false);
                    }
                  }}
                >
                  {adminRecoveryBusy
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.adminRecoveryBtnText}>Claim Admin</Text>
                  }
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Video room banner — pinned at top of chat */}
        {isGroupMember && activeVideoRoom && (
          <VideoRoomBanner
            room={activeVideoRoom}
            isHost={activeVideoRoom.hostId === myInboxId}
            isInCall={isInVideoCall}
            onJoin={handleJoinVideoCall}
            onLeave={handleLeaveVideoCall}
            onEnd={handleEndVideoCall}
          />
        )}

        {/* Avatar room banner — pinned at top of chat, below video room */}
        {isGroupMember && activeAvatarRoom && !isInAvatarRoom && (
          <LiveRoomBanner
            room={{ ...activeAvatarRoom, participantCount: 0 }}
            isHost={activeAvatarRoom.hostId === myInboxId}
            onEnd={handleEndAvatarRoom}
            onJoin={handleJoinAvatarRoom}
          />
        )}

        {/* Pinned message bar */}
        {isGroupMember && pinnedMessages.length > 0 && (
          <PinnedBar
            pinnedMessages={pinnedMessages}
            onScrollToMessage={(msgId) => {
              const idx = messages.findIndex(m => m.id === msgId);
              if (idx !== -1) flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
            }}
            onUnpin={isGroupAdmin ? async (msgId) => {
              const { unpinMessage: doUnpin } = require("@/lib/pinnedMessages");
              await doUnpin(msgId);
              setPinnedMessages(getPinnedMessages());
              // Broadcast unpin to group
              if (send) {
                send(buildPinMessage(msgId, 'unpin')).catch(() => {});
              }
            } : undefined}
            isAdmin={isGroupAdmin}
          />
        )}

        {/* Avatar room pill — shown when user is in an avatar room but on chat screen */}
        {isGroupMember && isInAvatarRoom && activeAvatarRoom && (
          <>
            <AvatarRoomPill
              hostName={activeAvatarRoom.host}
              isHost={activeAvatarRoom.hostId === myInboxId}
              onExpand={() => avatarRoomToken && router.push(`/avatar-room?token=${encodeURIComponent(avatarRoomToken)}&isHost=${activeAvatarRoom.hostId === myInboxId ? "true" : "false"}`)}
              onEnd={handleEndAvatarRoom}
              onLeave={handleLeaveAvatarRoom}
              onReaction={() => {/* TODO: open sticker tray above pill */}}
            />
            <VideoReactionOverlay reactionSource={addAvatarReactionListener} />
          </>
        )}

        {/* iOS-style PiP bubble — shown when user is in a video call but on the chat screen */}
        {isGroupMember && isInVideoCall && activeVideoRoom && videoCallToken && (
          <VideoCallPip
            onExpand={() => router.push(`/video-room?token=${encodeURIComponent(videoCallToken)}&isHost=${activeVideoRoom.hostId === myInboxId ? "1" : "0"}`)}
          />
        )}

        {/* Loading history */}
        {isGroupMember && isLoadingHistory && (
          <View style={styles.historyLoading}>
            <ActivityIndicator size="small" color={THEME.accent} />
            <Text style={styles.historyLoadingText}>Loading messages…</Text>
          </View>
        )}

        {/* Empty state */}
        {isGroupMember && !isLoadingHistory && messages.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🍌</Text>
            <Text style={styles.emptyTitle}>The chat is empty</Text>
            <Text style={styles.emptySubtitle}>
              Be the first holder to send a message!
            </Text>
          </View>
        )}

        {/* Messages */}
        {isGroupMember && <FlashList
          ref={flatListRef as any}
          data={messages}
          renderItem={renderMessage as any}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          inverted
          onContentSizeChange={handleContentSizeChange}
          refreshing={refreshingChat}
          onRefresh={handleRefreshChat}
          onScroll={({ nativeEvent }: any) => {
            // Inverted list: offset 0 = newest messages (bottom of chat)
            const nearBottom = nativeEvent.contentOffset.y <= SCROLL_THRESHOLD;
            isNearBottomRef.current = nearBottom;
            setShowScrollFab(!nearBottom);
            if (nearBottom) setUnreadWhileScrolled(0);
          }}
          scrollEventThrottle={200}
          estimatedItemSize={80}
        />}

        {/* Input */}
        {isGroupMember && <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          isSending={isSending}
          onGifPicker={() => setGifPickerOpen(true)}
          pfpUri={verifiedNft?.image ?? null}
          onPfpGifPicker={() => setPfpGifPickerOpen(true)}
          onTyping={sendTyping}
          onCamera={handleCameraButtonPress}
          typingUsers={typingUsers}
          onLiveVideo={!activeVideoRoom ? handleStartVideoCall : undefined}
          onAvatarRoom={!activeAvatarRoom ? handleStartAvatarRoom : undefined}
        />}

        {/* Support banner */}
        {isGroupMember && (
          <View style={styles.supportBanner}>
            {skrPrice && (
              <Pressable
                onPress={() => Linking.openURL(`https://jup.ag/swap/SOL-${SKR_MINT}`)}
                style={({ pressed }) => [styles.floorBtn, pressed && { opacity: 0.7 }]}
                hitSlop={6}
              >
                <Text style={styles.floorBtnText}>$SKR {skrPrice}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setDevTipOpen(true)}
              style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.supportBannerText}>
                Help Support OnlyMonkes
              </Text>
            </Pressable>
            {floorPrice && (
              <Pressable
                onPress={() => router.push('/marketplace')}
                style={({ pressed }) => [styles.floorBtn, pressed && { opacity: 0.7 }]}
                hitSlop={6}
              >
                <Text style={styles.floorBtnText}>Floor {floorPrice}</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={{ height: insets.bottom }} />
      </KeyboardAvoidingView>

      <VideoCameraModal
        visible={videoModalOpen}
        onClose={() => setVideoModalOpen(false)}
        onSend={handleVideoSend}
      />

      {/* ── Video Lightbox (expo-av loaded on demand) ────────────────── */}
      <Modal
        visible={!!videoLightboxUrl}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setVideoLightboxUrl(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <LazyVideo uri={videoLightboxUrl!} />
          {/* Watermark overlay */}
          <View style={{ position: 'absolute', bottom: 72, right: 16, opacity: 0.7 }} pointerEvents="none">
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../assets/watermark.png')}
              style={{ width: 120, height: 40 }}
              resizeMode="contain"
            />
          </View>
          {/* Close button */}
          <Pressable
            onPress={() => setVideoLightboxUrl(null)}
            style={{ position: 'absolute', top: 52, right: 20, width: 36, height: 36,
                     borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)',
                     alignItems: 'center', justifyContent: 'center' }}
            hitSlop={10}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
          </Pressable>
          {/* Download button */}
          <Pressable
            onPress={() => videoLightboxUrl && handleDownloadVideo(videoLightboxUrl)}
            style={{ position: 'absolute', top: 52, right: 66, width: 36, height: 36,
                     borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)',
                     alignItems: 'center', justifyContent: 'center' }}
            hitSlop={10}
          >
            <Text style={{ color: '#fff', fontSize: 16 }}>⬇</Text>
          </Pressable>
        </View>
      </Modal>
      {/* ── Edit Message Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <Pressable style={modalStyles.overlay} onPress={() => setEditTarget(null)}>
          <Pressable style={modalStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={modalStyles.title}>Edit Message</Text>
            <TextInput
              style={modalStyles.input}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              multiline
              maxLength={2000}
              placeholderTextColor={THEME.textFaint}
            />
            <View style={modalStyles.btnRow}>
              <Pressable onPress={() => setEditTarget(null)} style={modalStyles.cancelBtn}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleEditSubmit} style={modalStyles.confirmBtn}>
                <Text style={modalStyles.confirmText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Share on X Popup ──────────────────────────────────────────────── */}
      <Modal
        visible={!!xShareImageUri}
        transparent
        animationType="fade"
        onRequestClose={() => setXShareImageUri(null)}
      >
        <Pressable style={modalStyles.overlay} onPress={() => setXShareImageUri(null)}>
          <Pressable style={modalStyles.sheet} onPress={(e) => e.stopPropagation()}>
            {/* Close X button */}
            <Pressable
              onPress={() => setXShareImageUri(null)}
              style={modalStyles.closeX}
              hitSlop={10}
            >
              <Text style={modalStyles.closeXText}>✕</Text>
            </Pressable>

            <Text style={modalStyles.title}>Share this Image on X?</Text>
            {xShareImageUri && (
              <View style={modalStyles.previewWrap}>
                <Image
                  source={{ uri: xShareImageUri }}
                  style={modalStyles.previewImg}
                  resizeMode="cover"
                />
                <Image
                  source={require("../../assets/watermark.png")}
                  style={modalStyles.previewWatermark}
                  resizeMode="contain"
                />
              </View>
            )}
            <Text style={modalStyles.caption}>Shot Using @xOnlyMonkes</Text>

            <Pressable onPress={handleShareToX} style={modalStyles.xBtn}>
              <Text style={modalStyles.xBtnText}>Share this Image on X</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#000",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: "#333",
    gap: 12,
    alignItems: "center",
  },
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 17,
    color: "#6CB4EE",
    textAlign: "center",
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: "#6CB4EE",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    maxHeight: 140,
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: "#333",
    textAlignVertical: "top",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    alignSelf: "stretch",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  cancelText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#6CB4EE",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#6CB4EE",
    alignItems: "center",
  },
  confirmText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#fff",
  },
  closeX: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#6CB4EE",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  closeXText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  previewWrap: {
    width: 220,
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
    alignSelf: "center",
  },
  previewImg: {
    width: 220,
    height: 220,
  },
  previewWatermark: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 135,
    height: 68,
    opacity: 0.9,
  },
  caption: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#6CB4EE",
    textAlign: "center",
  },
  xBtn: {
    backgroundColor: "#6CB4EE",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: "stretch",
    alignItems: "center",
  },
  xBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
    color: "#000",
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },

  // ── Header ───────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: HEADER_BG,
  },
  tickerWrap: {
    position: "absolute",
    bottom: 2,
    left: 12,
    right: 12,
    height: 18,
    overflow: "hidden",
  },
  headerCenter: {
    flex: 1,
    alignSelf: "stretch",
    transform: [{ scale: 0.9 }],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerNft: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  headerNftFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  headerNftGlyph: { fontSize: 28 },
  streakPill: {
    position: "absolute",
    bottom: -6,
    right: -6,
    backgroundColor: THEME.surface,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  streakPillText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.text,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bananaHeaderPill: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.15)",
  },
  bananaHeaderText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#FFD54F",
    fontWeight: "600",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { fontSize: 15 },
  menuIcon: {
    fontSize: 15,
    color: THEME.text,
  },
  communityBadge: {
    position: "absolute" as const,
    top: -4,
    right: -6,
    backgroundColor: "#fff",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 4,
  },
  communityBadgeText: {
    color: "#0096C7",
    fontSize: 10,
    fontWeight: "700" as const,
  },

  // ── History / Empty ──────────────────────────────────────────────────────────
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
  emptyIcon: { fontSize: 48 },
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
  },

  // ── Pending / not yet a member ───────────────────────────────────────────────
  pendingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
  },
  pendingIcon: { fontSize: 52 },
  pendingTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  pendingSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },

  // ── Access Key box (pending screen) ──────────────────────────────────────────
  retryBtn: {
    marginTop: 12,
    backgroundColor: THEME.accent,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  retryBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#fff",
  },
  pendingLogoutLink: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
    textDecorationLine: "underline",
    marginTop: 16,
  },
  // ── Admin recovery (pending screen) ──────────────────────────────────────────
  adminRecoveryLink: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
    textDecorationLine: "underline",
    marginTop: 8,
  },
  adminRecoveryBox: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 16,
    gap: 10,
    marginTop: 8,
  },
  adminRecoveryTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.text,
  },
  adminRecoveryHint: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    lineHeight: 18,
  },
  adminRecoveryInput: {
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.text,
  },
  adminRecoveryError: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.error,
  },
  adminRecoveryBtn: {
    backgroundColor: THEME.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  adminRecoveryBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: "#fff",
  },

  // ── Header admin badge ────────────────────────────────────────────────────────
  iconBtnAlert: {
    borderColor: THEME.accent + "88",
    backgroundColor: THEME.accentSoft,
  },

  supportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  supportBannerText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 0.4,
    textAlign: 'center',
    flex: 1,
  },
  supportPriceText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  floorBtn: {
    backgroundColor: 'rgba(108, 180, 238, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(108, 180, 238, 0.2)',
  },
  floorBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: '#6CB4EE',
    fontWeight: '700',
  },
});
