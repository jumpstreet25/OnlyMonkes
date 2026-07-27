/**
 * ChatScreen
 *
 * The main global chatroom. Rendered only when NFT verified + XMTP connected.
 *
 * Header layout:
 *   Left  — NFT avatar + username stacked vertically
 *   Center — OnlyMonkes logo (transparent background)
 *   Right  — banana pill + hamburger
 *
 * Features:
 *  - UsernameModal on first visit
 *  - FlashList of MessageBubbles (oldest at top, newest at bottom)
 *  - Optimistic message sending
 *  - Reply-to support (long press to reply)
 *  - Banana reaction dispatch
 *  - MenuDrawer for dApp side chats
 *  - UserProfileModal when username tapped
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Alert,
  Linking,
  AppState,
  Share,
  type AppStateStatus,
} from "react-native";
import type { FlashListRef } from "@shopify/flash-list";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OnboardingChecklist, markOnboardingStep } from "@/components/OnboardingChecklist";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useXmtp, triggerProfileRebroadcast, _streamHealth, getXmtpClient } from "@/hooks/useXmtp";
import { startHealthBeacon, stopHealthBeacon } from "@/lib/healthBeacon";
import { BOT_INBOX_IDS } from "@/lib/constants";
import { useAbortableFetch } from "@/hooks/useAbortableFetch";
import { playSound } from "@/lib/sounds";
import { useNetInfo } from "@react-native-community/netinfo";
import { ChatInput } from "@/components/ChatInput";
import { ChatSkeleton } from "@/components/SkeletonLoader";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { router } from "expo-router";
import { THEME, FONTS, SKR_MINT, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { loadUserProfile, getCachedProfile, getDeduplicatedUsers, cacheProfile } from "@/lib/userProfile";
import { checkAndUpdateStreak } from "@/lib/streaks";
import { claimDailyBananas, type ClaimResult } from "@/lib/bananaRewards";
import { getEquippedStyles } from "@/lib/bananaShop";
import { getOrExtractNftColor } from "@/lib/nftColor";
import { useThemeColor } from "@/lib/shopTheme";
import { checkBananaNotifications } from "@/lib/bananaNotifications";
import { hasCompletedOnboarding } from "@/components/OnboardingOverlay";
import { txError, networkError } from "@/lib/monkeCopy";
import { toast } from "sonner-native";
import { updateStats, type Badge } from "@/lib/activityBadges";
import { loadBananaState } from "@/lib/bananaRewards";
import { updateStreak as updateBadgeStreak } from "@/lib/badges";
import { registerForPushNotifications, setNotificationReplyHandler } from "@/lib/notifications";
import { loadEvents } from "@/lib/calendar";
import { loadThemeId, loadCustomColor } from "@/lib/theme";
import { sendSkrTip, sendDevTip, parseTipCommand } from "@/lib/solana";
import { createLivekitToken, createRoomName } from "@/lib/livekit";
import { LiveRoomBanner } from "@/components/LiveRoomBanner";
import { EdgePullDetector } from "@/components/drawer/EdgePullDetector";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { BananaMowerOverlay } from "@/components/worlds/BananaMowerOverlay";
import { VideoRoomBanner } from "@/components/VideoRoomBanner";
import { VideoCallPip } from "@/components/VideoCallPip";
import { AvatarRoomPill } from "@/components/AvatarRoomPill";
import { VideoReactionOverlay } from "@/components/VideoReactionOverlay";
import { addReactionListener as addAvatarReactionListener, disconnectFromAvatarRoom, type AvatarRoomData } from "@/lib/avatarRoom";
import type { VideoRoomData } from "@/lib/liveVideo";
import { showLocalNotification, CH_LIVE } from "@/lib/notifications";
import { registerNetworkSync, unregisterNetworkSync, setOfflineQueueFlusher, isOnline } from "@/lib/backgroundSync";
import { enqueueMessage, flushOfflineQueue } from "@/lib/offlineQueue";
import { appendCachedMessage } from "@/lib/messageCache";
import { flushPendingWrites } from "@/lib/debouncedStorage";
import { PinnedBar } from "@/components/PinnedBar";
import { loadPinnedMessages, getPinnedMessages, buildPinMessage, onPinnedMessagesChange, type PinnedMessage } from "@/lib/pinnedMessages";
import { loadThreadMetadata } from "@/lib/threads";
import { loadListings } from "@/lib/marketplace";
import { updateCloutProfile, loadFlairCache } from "@/lib/monkeClout";

// ── Lazy imports — heavy modules loaded on first use, not at startup ────────
import type { SwapQuote } from "@/lib/jupiterSwap";

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

// ── Extracted sub-components ────────────────────────────────────────────────
import { ChatHeader } from "@/components/ChatHeader";
import { ChatModals } from "@/components/ChatModals";
import { MonkeGlass, MonkeGlassActionButton } from "@/components/MonkeGlass";
import { ChatMessageList } from "@/components/ChatMessageList";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;
  const fetchAbortable = useAbortableFetch();
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
  const myShopStyles     = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  const headerAuraColor  = myShopStyles?.pfpAuraEnabled
    ? (myShopStyles.glowColor as string | undefined) ?? nftDominantColor ?? null
    : null;
  const isLoading        = useAppStore(s => s.isLoading);
  const error            = useAppStore(s => s.error);
  const communityBadges  = useAppStore(s => s.communityBadges);
  const dmUnreadCounts   = useAppStore(s => s.dmUnreadCounts);
  const totalDmUnread    = useMemo(() => Object.values(dmUnreadCounts).reduce((a, b) => a + b, 0), [dmUnreadCounts]);
  const themeBg          = useThemeColor('bg');
  const themeSurface     = useThemeColor('surface');
  const themeBorder      = useThemeColor('border');
  const themeAccent      = useThemeColor('accent');
  const hasThemeOverride = useAppStore(s => !!s.themeOverrides);
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

  // Store keeps messages oldest-first. The chat uses an inverted FlashList
  // (newest at the visual bottom + native pull-to-refresh-at-newest UX), so
  // we feed it newest-first.
  const messagesAsc      = useChatStore(s => s.messages);
  const messages         = useMemo(() => messagesAsc.slice().reverse(), [messagesAsc]);
  // Bumped on every reaction/sticker update — passed to FlashList as
  // extraData so live reaction inserts re-render the visible cell.
  const reactionVersion  = useChatStore(s => s._reactionVersion);
  const replyingTo       = useChatStore(s => s.replyingTo);
  const isLoadingHistory = useChatStore(s => s.isLoadingHistory);
  const setReplyingTo    = useChatStore(s => s.setReplyingTo);
  const typingUsers      = useChatStore(s => s.typingUsers);
  const { initialize, disconnect, logout, streamAlive, send, reply, react, edit, deleteMessage, stickerReact, sendFile, sendTyping, forceAdminInit, broadcastProfile, broadcastEvent, broadcastVideoRoom, broadcastAvatarRoom, syncMessages, checkStreamLiveness, loadOlderMessages } = useXmtp();
  const [inputText, setInputTextRaw] = useState("");
  // Draft auto-save — persist input text so it survives navigation/restart
  const _draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setInputText = useCallback((text: string) => {
    setInputTextRaw(text);
    if (_draftTimer.current) clearTimeout(_draftTimer.current);
    _draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem("draft_main_chat", text).catch(() => {});
    }, 500);
  }, []);
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
  const [xShareMessageId, setXShareMessageId] = useState<string | null>(null);
  const [skrPrice, setSkrPrice] = useState<string | null>(null);
  const [floorPrice, setFloorPrice] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
  const initialMsgIdsRef = useRef<Set<string>>(new Set());
  const isNearBottomRef = useRef(true);
  // Photo review — shown after capture, before send. Holds the pending
  // photo's data until the user picks a caption (AI, their own, or none)
  // and taps Send; see handleCamera/handlePhotoReviewSend below.
  const [photoReviewVisible, setPhotoReviewVisible] = useState(false);
  const [photoReviewRequestId, setPhotoReviewRequestId] = useState<string | null>(null);
  const pendingPhotoRef = useRef<{ compressedUri: string; b64: string; dataUri: string } | null>(null);
  // 2026-07-26: grey/frozen-screen bug on return from X-share. Launching
  // the native share intent backgrounds the app; shareImageToX()'s promise
  // resolves (dispatching the intent) almost immediately, well before the
  // user actually returns, so the "Image saved" toast used to fire right
  // then. RN JS timers pause while backgrounded, so that toast's own
  // mount/dismiss animation can still be mid-flight exactly when the
  // AppState 'active' handler below kicks off its heavy XMTP resync on
  // resume — same "toast mounts while a heavy operation tears down/redraws"
  // race as prior grey-screen fixes, just triggered by the OS AppState
  // transition instead of an in-app Modal close. Fix: queue the toast text
  // here instead of calling toast.success directly; the AppState handler
  // fires it only after its own resync work has fully settled.
  const pendingResumeToastRef = useRef<string | null>(null);
  // Synchronous double-tap guard for the send button. The React `isSending`
  // state is async — a fast tap-tap on Seeker can fire two onPress events
  // before the state commit, both passing the canSend gate. This ref blocks
  // re-entry within the same JS task.
  const sendingRef = useRef(false);

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

  // Restore draft on mount
  useEffect(() => {
    AsyncStorage.getItem("draft_main_chat").then(d => { if (d) setInputTextRaw(d); }).catch(() => {});
  }, []);

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
      const { loginStreak, bestStreak } = useAppStore.getState();
      updateBadgeStreak(loginStreak, bestStreak);
      if (justHitLegendary) {
        setShowConfetti(true);
        broadcastProfile();
        toast.success("7-day streak — Legendary!");
      }
      const claim = await claimDailyBananas();
      useAppStore.getState().setBananaBalance(claim.balance);
      if (claim.claimed) setBananaClaim(claim);
      getEquippedStyles().then(s => {
        if (s.pfpAuraEnabled) {
          s.pfpAuraColor = (s.glowColor as string) ?? useAppStore.getState().nftDominantColor ?? undefined;
        }
        useAppStore.getState().setShopStyles(s);
        if (Object.keys(s).length > 0) {
          triggerProfileRebroadcast("").catch(() => {});
        }
      }).catch(() => {});
      const nft = useAppStore.getState().verifiedNft;
      if (nft?.image) {
        getOrExtractNftColor(nft.image, nft.mint ?? "nft").then(c => {
          useAppStore.getState().setNftDominantColor(c);
        }).catch(() => {});
      }
      loadFlairCache().catch(() => {});
      const myId = useAppStore.getState().myInboxId;
      const myName = useAppStore.getState().username;
      if (myId && myName) {
        updateCloutProfile(myId, myName, {
          streakDays: loginStreak,
          totalCycles: Math.floor(bestStreak / 7),
          bananaBalance: claim.balance,
        }).catch(() => {});
      }
      checkBananaNotifications().catch(() => {});
      const bananaState = await loadBananaState();
      const { newBadges } = await updateStats({
        totalDaysActive: bananaState.totalCycles * 7 + bananaState.streakDay,
        currentStreak: bananaState.streakDay,
        totalCycles: bananaState.totalCycles,
        bananaBalance: bananaState.balance,
      });
      if (newBadges.length > 0) setEarnedBadge(newBadges[0]);
      const onboarded = await hasCompletedOnboarding();
      if (!onboarded) setShowOnboarding(true);
    }).catch((err) => {
      // This catch covers BOTH initialize() and the post-init banana/streak/
      // onboarding chain. The auto-retry effect (isGroupMember/remoteGroupId)
      // already handles real connection failures silently; useXmtp's own catch
      // surfaces the toast for genuine XMTP init errors. Don't double-surface.
      if (__DEV__) console.warn("[ChatScreen] post-init chain error:", err);
    });

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

  // ─── Re-check streak + banana claim when app returns to foreground ──────────
  useEffect(() => {
    let lastFgCheck = 0;
    let backgroundedAt = 0;
    const handleAppState = async (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (nextState === 'background') {
          backgroundedAt = Date.now();
          flushPendingWrites().catch(() => {});
        }
        return;
      }
      if (nextState !== 'active') return;

      // Android suspends the XMTP WebSocket in background; streamAlive() can't
      // detect this (the unsub handle stays valid). If we were backgrounded long
      // enough that the OS likely killed the socket, force a full re-init.
      const wasBgFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
      backgroundedAt = 0;
      try {
        if (wasBgFor > 30_000 || !streamAlive()) {
          _streamHealth.foregroundReconnects++;
          await initialize();
        } else {
          await syncMessages();
        }
      } catch {
        _streamHealth.foregroundReconnects++;
        initialize().catch(() => {});
      }

      // Flush any toast queued while backgrounded (e.g. X-share "Image
      // saved") now that the resync above has settled — see
      // pendingResumeToastRef's comment for why this can't just fire
      // immediately from the code that queues it.
      if (pendingResumeToastRef.current) {
        toast.success(pendingResumeToastRef.current);
        pendingResumeToastRef.current = null;
      }

      const now = Date.now();
      if (now - lastFgCheck < 60_000) return;
      lastFgCheck = now;
      try {
        const { justHitLegendary } = await checkAndUpdateStreak();
        const { loginStreak, bestStreak } = useAppStore.getState();
        updateBadgeStreak(loginStreak, bestStreak);
        if (justHitLegendary) {
          setShowConfetti(true);
          broadcastProfile();
          toast.success("7-day streak — Legendary!");
        }
        const claim = await claimDailyBananas();
        useAppStore.getState().setBananaBalance(claim.balance);
        if (claim.claimed) setBananaClaim(claim);
      } catch { /* non-critical */ }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  // ─── In-foreground stream liveness heartbeat ────────────────────────────────
  // The AppState handler above only fires on background/foreground transitions.
  // While the screen is mounted and the app stays active, the XMTP WebSocket
  // can still die silently (Android doze, WiFi blips, server-side disconnects)
  // and the SDK doesn't notify us. We need to periodically verify liveness.
  //
  // IMPORTANT: this must be CHEAP — `syncMessages()` was too heavy (it also
  // re-syncs all 4 bot channels and refetches 100 msgs each, blocking the JS
  // thread and causing glitchy scroll). `checkStreamLiveness()` is just the
  // 90s window check; throws iff the stream is actually dead. Full re-sync
  // (`syncMessages`) only runs on AppState foreground transitions, where the
  // user is already paused.
  useEffect(() => {
    if (!isGroupMember) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      try {
        checkStreamLiveness();
      } catch {
        _streamHealth.foregroundReconnects++;
        initialize().catch(() => {});
      }
    };
    timer = setInterval(tick, 60_000);
    return () => { if (timer) clearInterval(timer); };
  }, [isGroupMember, checkStreamLiveness, initialize]);

  // ─── HEALTH: beacon → bot/Hermes (Fix #4) ────────────────────────────────────
  // Emits a structured DM to the bot every ~10min carrying stream-health
  // counters. The bot persists these to ~/.hermes_memory/client_health.json
  // so Hermes/Monke can flag patterns (high stale_reconnects, missing beacons,
  // etc.) without us needing to ship Grafana/Prometheus. See healthBeacon.ts.
  useEffect(() => {
    if (!isGroupMember) return;
    const botInboxId = BOT_INBOX_IDS[0];
    startHealthBeacon({
      getClient: () => getXmtpClient(),
      botInboxId,
      getMessageCount: () => useChatStore.getState().messages.length,
    });
    return () => stopHealthBeacon();
  }, [isGroupMember]);

  // ─── Auto-retry until approved ───────────────────────────────────────────────
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
    }).catch(() => {});
  }, [isGroupMember]);

  // ─── Wire notification inline-reply ───────────────────────────────────────
  useEffect(() => {
    if (!isGroupMember) return;
    setNotificationReplyHandler((text) => {
      send(text).catch((err) => console.warn("[Notifications] Reply send failed:", err));
    });
  }, [isGroupMember, send]);

  // ─── Aggressive re-sync on sparse history ──────────────────────────────────
  useEffect(() => {
    if (!isGroupMember) return;
    if (messages.length >= 10) return;
    let count = 0;
    const id = setInterval(() => {
      syncMessages();
      count++;
      if (count >= 15) clearInterval(id);
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
      const { myInboxId: id, verifiedNft: nft } = useAppStore.getState();
      if (id) cacheProfile(id, { username: saved ?? undefined, nftImage: nft?.image ?? null, location: savedLoc ?? undefined });
    });
    loadThemeId().then(setThemeId);
    loadCustomColor().then((c) => { if (c) setCustomBubbleColor(c); });
    loadEvents().then(setCalendarEvents);
    loadPinnedMessages().then(setPinnedMessages);
    loadThreadMetadata();
    loadListings();
  }, []);

  // Subscribe to pinned messages changes from stream
  useEffect(() => onPinnedMessagesChange(setPinnedMessages), []);

  // ─── Fetch $SKR price + Saga Monkes floor price (live, every 5 min) ─────────
  useEffect(() => {
    let mounted = true;
    // Load cached floor price immediately so it shows while API warms up
    AsyncStorage.getItem('cached_floor_price').then(cached => {
      if (mounted && cached) setFloorPrice(cached);
    }).catch(() => {});
    const fetchPrices = () => {
      fetchAbortable(`https://api.dexscreener.com/latest/dex/tokens/${SKR_MINT}`)
        .then(r => r.json())
        .then(d => {
          if (!mounted) return;
          const p = d?.pairs?.[0]?.priceUsd;
          if (p) setSkrPrice(Number(p) < 0.01 ? `$${Number(p).toFixed(6)}` : `$${Number(p).toFixed(4)}`);
        })
        .catch(() => {});
      fetchAbortable('https://api-mainnet.magiceden.dev/v2/collections/sagamonkes/stats')
        .then(r => r.json())
        .then(d => {
          if (!mounted) return;
          if (d?.floorPrice) {
            const fp = `${(d.floorPrice / 1e9).toFixed(2)} SOL`;
            setFloorPrice(fp);
            AsyncStorage.setItem('cached_floor_price', fp).catch(() => {});
          }
        })
        .catch(() => {});
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 5 * 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ─── Keep own NFT in profile cache in sync ──────────────────────────────────
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
    // Synchronous re-entry guard — catches Seeker double-taps that race
    // ahead of the `isSending` state commit and would otherwise send twice.
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      await runSend();
    } finally {
      sendingRef.current = false;
    }

    async function runSend() {
    const text = inputText.trim();
    if (!text) return;

    // Intercept /buy, /sell, /swap commands
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
          const balance = await getTokenBalance(walletAddr, inputToken.mint, inputToken.decimals);
          if (balance <= 0) { Alert.alert("No balance", `You have no ${inputToken.symbol} to sell.`); return; }
          const sellAmount = balance * (swapCmd.amount / 100);
          amountRaw = Math.floor(sellAmount * Math.pow(10, inputToken.decimals)).toString();
        } else {
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

    // Intercept /tip @username [amount]
    const tipCmd = parseTipCommand(text);
    if (tipCmd) {
      setInputText("");
      const dedupedUsers = getDeduplicatedUsers();
      let targetInboxId: string | null = null;
      dedupedUsers.forEach((name, inboxId) => {
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

    // Intercept /tiplink <amount>
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
      playSound("send");
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
      markOnboardingStep("sentMessage");
      appendCachedMessage("main_chat", { ...optimistic, status: "sent" }).catch(() => {});
    } catch {
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
        toast("Queued — will send when online");
      } else {
        useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
        toast.error("Failed to send message");
      }
    } finally {
      setIsSending(false);
    }
    }
  }, [inputText, myAddress, username, verifiedNft, replyingTo, send, reply, setReplyingTo]);

  // ─── React (banana) ──────────────────────────────────────────────────────────
  const handleReact = useCallback(
    async (emoji: ReactionEmoji, messageId: string) => {
      try {
        playSound("reaction");
        await react(emoji, messageId);
        markOnboardingStep("reactedToMessage");
      } catch (err) {
        if (__DEV__) console.warn("Reaction failed:", err);
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
      if (__DEV__) console.warn("GIF send failed:", err);
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
    }
  }, [send, myAddress, username, verifiedNft]);

  // ─── Camera capture ────────────────────────────────────────────────────────
  // 2026-07-26: capture no longer auto-sends. Photo is held in
  // pendingPhotoRef until PhotoReviewModal resolves with a caption
  // decision (AI-generated, user-written, or none) — see
  // handlePhotoReviewSend/Cancel below.
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
      const { compressImage } = await getVideoUpload();
      const compressedUri = await compressImage(asset.uri);
      const FS = await getFileSystem();
      const b64 = await FS.readAsStringAsync(compressedUri, { encoding: FS.EncodingType.Base64 });
      const dataUri = `data:image/jpeg;base64,${b64}`;
      pendingPhotoRef.current = { compressedUri, b64, dataUri };
      const requestId = `review-${Date.now()}`;
      setPhotoReviewRequestId(requestId);
      setPhotoReviewVisible(true);
      // Fire the caption request as early as possible — same "fire early,
      // ready by the time it's needed" pattern as before, just now feeding
      // the review modal live (via photoReviewStore) instead of a silent
      // background cache the user never sees until Share to X.
      import("@/lib/imageCaption").then(({ requestImageCaption }) => {
        requestImageCaption(requestId, b64).catch(() => {});
      });
    } catch (err: any) {
      Alert.alert("Camera error", err?.message ?? "Could not open camera.");
    }
  }, []);

  // ─── Photo send (after review modal resolves) ──────────────────────────────
  const sendPhotoWithCaption = useCallback(async (dataUri: string, b64: string, caption: string) => {
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
      setXShareImageUri(dataUri);
      setXShareMessageId(optimistic.id);
      if (caption) {
        // Cache under the REAL sent message's id — handleShareToX looks
        // caption up by xShareMessageId, regardless of whether it came
        // from the bot or was hand-typed in the review modal.
        const { storeCaptionResponse } = await import("@/lib/imageCaption");
        await storeCaptionResponse(optimistic.id, caption);
        // Same Monke-voiced caption shown in-chat as a follow-up message —
        // Share to X appends @xOnlyMonkes on top of this, never the other
        // way around (see handleShareToX).
        const capMsg: ChatMessage = {
          id: `opt-${Date.now()}-cap`,
          senderAddress: myAddress,
          senderUsername: username ?? undefined,
          senderNft: verifiedNft ?? undefined,
          content: caption,
          sentAt: new Date(),
          reactions: {} as ChatMessage["reactions"],
          status: "sending",
        };
        useChatStore.getState().addMessage(capMsg);
        try {
          await send(caption);
          useChatStore.getState().updateMessageStatus(capMsg.id, "sent");
          appendCachedMessage("main_chat", { ...capMsg, status: "sent" }).catch(() => {});
        } catch {
          useChatStore.getState().updateMessageStatus(capMsg.id, "failed");
        }
      }
    } catch (err: any) {
      Alert.alert("Camera error", err?.message ?? "Could not send photo.");
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
    }
  }, [send, myAddress, username, verifiedNft]);

  const handlePhotoReviewSend = useCallback(async (caption: string) => {
    const pending = pendingPhotoRef.current;
    setPhotoReviewVisible(false);
    pendingPhotoRef.current = null;
    if (!pending) return;
    await sendPhotoWithCaption(pending.dataUri, pending.b64, caption);
  }, [sendPhotoWithCaption]);

  const handlePhotoReviewCancel = useCallback(() => {
    setPhotoReviewVisible(false);
    pendingPhotoRef.current = null;
  }, []);

  // ─── File picker (RemoteAttachment) ──────────────────────────────────────────
  const handleFilePicker = useCallback(async () => {
    try {
      const DP = await import('expo-document-picker');
      const result = await DP.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      const { uploadFile } = await import('@/lib/videoUpload');
      const url = await uploadFile(file.uri, file.name ?? 'file', file.mimeType ?? 'application/octet-stream');
      await sendFile(url, file.name ?? 'file', file.size ?? 0);
    } catch (err: any) {
      Alert.alert('File error', err?.message ?? 'Could not send file.');
    }
  }, [sendFile]);

  // ─── Camera button — MonkeGlass sheet for Photo vs Video vs File ───────────
  // 2026-07-27: was Alert.alert — a native OS dialog that renders as a flat
  // grey system rectangle and can't be styled at all in React Native (no
  // custom background/blur/font, full stop). Replaced with a real
  // MonkeGlass sheet so this picker actually reads as glass like the rest
  // of the app.
  const [shareMediaSheetOpen, setShareMediaSheetOpen] = useState(false);
  const handleCameraButtonPress = useCallback(() => {
    setShareMediaSheetOpen(true);
  }, []);

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
      if (__DEV__) console.warn("Sticker react failed:", err);
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
      if (__DEV__) console.warn("Edit failed:", err);
    }
    setEditTarget(null);
    setEditText("");
  }, [edit, editTarget, editText]);

  // ─── X / Twitter share for own images ─────────────────────────────────────────
  // Twitter's web intent (https://x.com/intent/tweet?text=…) is text-only by
  // design — there's no image param. shareImageToX() (shareToX.ts) saves the
  // image to the gallery + attaches it via react-native-share's shareSingle()
  // targeting the X app directly, falling back to clipboard + web-intent if
  // that's not available. User's only remaining step is tapping X's
  // image-picker icon on the fallback path.
  const handleShareToX = useCallback(async () => {
    const fallbackCaption = "I snapped this using @xOnlyMonkes via Solana Mobile, The Future is Monke! 🐒";
    const imageUri = xShareImageUri;
    const messageId = xShareMessageId;
    setXShareImageUri(null);
    setXShareMessageId(null);
    // Bot-generated (Ollama vision) caption, if it arrived in time — the
    // SAME Monke-voiced text already shown in-chat as a follow-up message
    // (see sendPhotoWithCaption). @xOnlyMonkes is appended HERE, for the X
    // post specifically — never stored back into the chat message itself.
    // Falls back to the generic (already-tagged) caption if nothing was
    // cached (not ready yet, or generation failed).
    let caption = fallbackCaption;
    if (messageId) {
      try {
        const { getCachedCaption } = await import("@/lib/imageCaption");
        const cached = await getCachedCaption(messageId);
        if (cached) caption = `${cached} @xOnlyMonkes`;
      } catch { /* fall back to generic */ }
    }
    // Defer launching the native share/intent until after this Modal's
    // fade-out finishes — starting another native Activity while the
    // Modal's Android Dialog window is mid-teardown left a stuck grey
    // screen in the past (same class of race fixed for reaction toasts).
    setTimeout(async () => {
      if (!imageUri) {
        Linking.openURL(`https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`).catch(() => {});
        return;
      }
      try {
        const { shareImageToX } = await import("@/lib/shareToX");
        const { saved } = await shareImageToX(imageUri, caption);
        // Queued, not shown directly — see pendingResumeToastRef's comment.
        // Fallback timer covers the (unlikely) case AppState 'active' never
        // fires to flush it, so the toast still shows eventually either way.
        if (saved) {
          pendingResumeToastRef.current = 'Image saved — tap the image icon in X to attach it 📸';
          setTimeout(() => {
            if (pendingResumeToastRef.current) {
              toast.success(pendingResumeToastRef.current);
              pendingResumeToastRef.current = null;
            }
          }, 4000);
        }
      } catch {
        /* non-fatal */
      }
    }, 350);
  }, [xShareImageUri, xShareMessageId, setXShareImageUri]);

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
      await showLocalNotification(`${username} started a Video Call`, "Live Video in OnlyMonkes", CH_LIVE);
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
      await showLocalNotification(`${username} started a Live`, "Avatar Room in OnlyMonkes", CH_LIVE);
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

  // ─── Stable callbacks for message list ──────────────────────────────────────
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

  const handleDelete = useCallback(async (msg: ChatMessage) => {
    Alert.alert("Delete Message", "Are you sure you want to delete this message?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          // Optimistic removal
          useChatStore.getState().removeMessage(msg.id);
          try {
            await deleteMessage(msg.id);
          } catch (e: any) {
            if (__DEV__) console.warn("[XMTP] deleteMessage failed:", e);
          }
        },
      },
    ]);
  }, [deleteMessage]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary fallbackMessage="Chat hit an error. Tap below to reload.">
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: themeBg }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Chat World background (renders behind everything when equipped) */}
        <WorldLayer active={!drawerOpen} />

        {/* Header */}
        <ChatHeader
          themeSurface={themeSurface}
          themeBorder={themeBorder}
          bananaBalance={bananaBalance}
          totalDmUnread={totalDmUnread}
          communityBadges={communityBadges}
          isGroupMember={isGroupMember}
          onOpenDrawer={() => setDrawerOpen(true)}
          onDmNavigation={() => {
            useAppStore.getState().clearCommunityBadge('dms');
            router.push("/dms" as any);
          }}
        />

        {/* Offline indicator */}
        {isOffline && (
          <View style={{ backgroundColor: '#EF4444', paddingVertical: 6, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: FONTS.mono, fontSize: 11 }}>No internet connection</Text>
          </View>
        )}

        {/* Onboarding checklist (first-time users) */}
        {isGroupMember && <OnboardingChecklist />}

        {/* Connecting spinner (before group state is known) */}
        {isLoading && !isGroupMember && (
          <View style={styles.pendingContainer}>
            <ActivityIndicator size="large" color={THEME.accent} />
            <Text style={styles.pendingSubtitle}>Connecting to chat…</Text>
          </View>
        )}

        {/* Init error — network / XMTP failure */}
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

        {/* Not yet a member — auto-joining in progress */}
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
                  placeholder="ghp_..."
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
          <ChatSkeleton count={6} />
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
        {isGroupMember && (
          <ChatMessageList
            messages={messages}
            reactionVersion={reactionVersion}
            myAddress={myAddress}
            isGroupAdmin={isGroupAdmin}
            isLoadingHistory={isLoadingHistory}
            refreshingChat={refreshingChat}
            initialMsgIdsRef={initialMsgIdsRef}
            flatListRef={flatListRef}
            handleReact={handleReact}
            setReplyingTo={setReplyingTo}
            handlePressUser={handlePressUser}
            handleTip={handleTip}
            handleStickerReact={handleStickerReact}
            setLightboxUrl={setLightboxUrl}
            setVideoLightboxUrl={setVideoLightboxUrl}
            setChartSymbol={setChartSymbol}
            handleEditMessage={handleEditMessage}
            handleDelete={handleDelete}
            handlePin={isGroupAdmin ? handlePin : undefined}
            handleThread={handleThread}
            handleRefreshChat={handleRefreshChat}
            loadOlderMessages={loadOlderMessages}
            setShowScrollFab={setShowScrollFab}
            setUnreadWhileScrolled={setUnreadWhileScrolled}
            isNearBottomRef={isNearBottomRef}
          />
        )}

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

        {/* Support banner — 3-column: [SKR] [Support] [Floor] */}
        {/* Match the chat header / input bar bg when a Chat World is equipped
            so all three bars read as one unified frame around the world.
            Bottom safe-area padding lives INSIDE the bar so its bg extends
            edge-to-edge behind the Android nav bar / iOS home indicator —
            no black themeBg gap below. */}
        {isGroupMember && (() => {
          // Per-world tappable accent (v29). When no PFP theme override,
          // tappable chrome (SKR price btn, Floor btn, Help Support text)
          // adopts the world's accent — warm honey gold for Banana Grove,
          // neon pink for Cyberpunk, gold for Trading Floor. PFP theme
          // override (if user has an NFT-color theme equipped) still
          // takes precedence.
          const worldId = myShopStyles?.worldId as string | undefined;
          const worldAccent = worldId ? getWorldAccent(worldId) : null;
          const useWorldAccent = !hasThemeOverride && worldAccent;
          const accent = hasThemeOverride ? themeAccent : (worldAccent ?? null);
          const accentBtnStyle = accent ? { backgroundColor: accent + '1A', borderColor: accent + '33' } : null;
          const accentTextStyle = accent ? { color: accent } : null;
          const accentSupportTextStyle = accent ? { color: accent + '99' } : null;
          return (
          <View style={[
            styles.supportBanner,
            { borderTopColor: themeBorder, paddingBottom: 9 + insets.bottom },
            worldId ? { backgroundColor: getWorldBarTint(worldId) } : null,
          ]}>
            <View style={{ minWidth: 70, alignItems: 'flex-start' }}>
              {skrPrice && (
                <Pressable
                  onPress={() => Linking.openURL(`https://jup.ag/swap/SOL-${SKR_MINT}`)}
                  style={({ pressed }) => [styles.floorBtn, accentBtnStyle, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                >
                  <Text style={[styles.floorBtnText, accentTextStyle]}>$SKR {skrPrice}</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => setDevTipOpen(true)}
              style={({ pressed }) => [{ flex: 1, alignItems: 'center' }, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.supportBannerText, accentSupportTextStyle]} numberOfLines={1}>
                Help Support OnlyMonkes
              </Text>
            </Pressable>
            <View style={{ minWidth: 70, alignItems: 'flex-end' }}>
              {floorPrice && (
                <Pressable
                  onPress={() => router.push('/marketplace')}
                  style={({ pressed }) => [styles.floorBtn, accentBtnStyle, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                >
                  <Text style={[styles.floorBtnText, accentTextStyle]}>Floor {floorPrice}</Text>
                </Pressable>
              )}
            </View>
          </View>
          );
        })()}

        {/* Non-members don't render the support banner (which carries the
            bottom safe-area padding for group members), so add a transparent
            fallback spacer here. World layer still shows through. */}
        {!isGroupMember && insets.bottom > 0 && (
          <View pointerEvents="none" style={{ height: insets.bottom }} />
        )}
        <EdgePullDetector
          onTrigger={() => setDrawerOpen(true)}
          disabled={drawerOpen}
        />
        {/* MonkeMower overlay — renders ABOVE chat content during a cleanup
            cycle (which is triggered from inside BananaGroveWorld but must
            sit in the foreground to be visible). Renders nothing when the
            mower isn't active. */}
        <BananaMowerOverlay />
      </KeyboardAvoidingView>
      <MonkeGlass
        visible={shareMediaSheetOpen}
        onClose={() => setShareMediaSheetOpen(false)}
        position="bottom"
        animationType="slide"
      >
        <Text style={{ fontFamily: FONTS.display, fontSize: 18, color: THEME.text, textAlign: "center", marginBottom: 8 }}>
          Share media
        </Text>
        <MonkeGlassActionButton
          label="📷 Photo"
          onPress={() => { setShareMediaSheetOpen(false); handleCamera(); }}
        />
        <MonkeGlassActionButton
          label="🎥 Video"
          onPress={() => { setShareMediaSheetOpen(false); setVideoModalOpen(true); }}
        />
        <MonkeGlassActionButton
          label="📎 File"
          onPress={() => { setShareMediaSheetOpen(false); handleFilePicker(); }}
        />
        <MonkeGlassActionButton
          label="Cancel"
          variant="cancel"
          onPress={() => setShareMediaSheetOpen(false)}
        />
      </MonkeGlass>
      <ChatModals
        showConfetti={showConfetti}
        setShowConfetti={setShowConfetti}
        bananaClaim={bananaClaim}
        setBananaClaim={setBananaClaim}
        showOnboarding={showOnboarding}
        setShowOnboarding={setShowOnboarding}
        earnedBadge={earnedBadge}
        setEarnedBadge={setEarnedBadge}
        showScrollFab={showScrollFab}
        unreadWhileScrolled={unreadWhileScrolled}
        flatListRef={flatListRef}
        setShowScrollFab={setShowScrollFab}
        setUnreadWhileScrolled={setUnreadWhileScrolled}
        showUsernameModal={showUsernameModal}
        setShowUsernameModal={setShowUsernameModal}
        editingProfile={editingProfile}
        setEditingProfile={setEditingProfile}
        username={username}
        bio={bio}
        xAccount={xAccount}
        tipWallet={tipWallet}
        userLocation={userLocation}
        broadcastProfile={broadcastProfile}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        handleStartAvatarRoom={handleStartAvatarRoom}
        handleStartVideoCall={handleStartVideoCall}
        handleConfirmDevTip={handleConfirmDevTip}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        calendarOpen={calendarOpen}
        setCalendarOpen={setCalendarOpen}
        broadcastEvent={broadcastEvent}
        tipTarget={tipTarget}
        setTipTarget={setTipTarget}
        handleConfirmTip={handleConfirmTip}
        devTipOpen={devTipOpen}
        setDevTipOpen={setDevTipOpen}
        swapConfirmOpen={swapConfirmOpen}
        swapQuote={swapQuote}
        swapExecuting={swapExecuting}
        handleConfirmSwap={handleConfirmSwap}
        handleCancelSwap={handleCancelSwap}
        gifPickerOpen={gifPickerOpen}
        setGifPickerOpen={setGifPickerOpen}
        pfpGifPickerOpen={pfpGifPickerOpen}
        setPfpGifPickerOpen={setPfpGifPickerOpen}
        handleSendGif={handleSendGif}
        pfpPickerOpen={pfpPickerOpen}
        setPfpPickerOpen={setPfpPickerOpen}
        allNfts={allNfts}
        setVerified={setVerified}
        lightboxUrl={lightboxUrl}
        setLightboxUrl={setLightboxUrl}
        chartSymbol={chartSymbol}
        setChartSymbol={setChartSymbol}
        profileTarget={profileTarget}
        setProfileTarget={setProfileTarget}
        myAddress={myAddress}
        logout={logout}
        videoModalOpen={videoModalOpen}
        setVideoModalOpen={setVideoModalOpen}
        handleVideoSend={handleVideoSend}
        videoLightboxUrl={videoLightboxUrl}
        setVideoLightboxUrl={setVideoLightboxUrl}
        handleDownloadVideo={handleDownloadVideo}
        editTarget={editTarget}
        setEditTarget={setEditTarget}
        editText={editText}
        setEditText={setEditText}
        handleEditSubmit={handleEditSubmit}
        xShareImageUri={xShareImageUri}
        setXShareImageUri={setXShareImageUri}
        handleShareToX={handleShareToX}
        photoReviewVisible={photoReviewVisible}
        photoReviewImageUri={pendingPhotoRef.current?.compressedUri ?? null}
        photoReviewRequestId={photoReviewRequestId}
        handlePhotoReviewSend={handlePhotoReviewSend}
        handlePhotoReviewCancel={handlePhotoReviewCancel}
      />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },

  // History / Empty
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

  // Pending / not yet a member
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

  // Access Key box (pending screen)
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
  // Admin recovery (pending screen)
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

  supportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    // No borderTop — separator removed per design pass 2026-05-06.
  },
  supportBannerText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 0.4,
    textAlign: 'center',
    flex: 1,
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
