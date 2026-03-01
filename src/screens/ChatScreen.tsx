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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  ImageBackground,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ListRenderItem,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  AppState,
  type AppStateStatus,
} from "react-native";
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
import { THEME, FONTS } from "@/lib/constants";
import { loadUserProfile, getCachedProfile, saveSelectedNftMint, cacheProfile } from "@/lib/userProfile";
import { registerForPushNotifications } from "@/lib/notifications";
import { loadEvents } from "@/lib/calendar";
import { loadThemeId, loadCustomColor } from "@/lib/theme";
import { sendSkrTip } from "@/lib/solana";
import { TipModal } from "@/components/TipModal";
import { SearchModal } from "@/components/SearchModal";
import { CalendarModal } from "@/components/CalendarModal";
import { GifPickerModal } from "@/components/GifPickerModal";
import * as ImagePicker from "expo-image-picker";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { TipAmount } from "@/lib/constants";

const HEADER_BG = "transparent";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const {
    verifiedNft, allNfts, myInboxId, username, bio, xAccount, tipWallet,
    setUsername, setBio, setXAccount, setTipWallet, setVerified,
    isGroupMember, isGroupAdmin, joinRequests, remoteGroupId,
    setThemeId, setCustomBubbleColor, setCalendarEvents,
  } = useAppStore();
  const { messages, replyingTo, isLoadingHistory, setReplyingTo, typingUsers } =
    useChatStore();
  const { initialize, disconnect, logout, streamAlive, send, reply, react, stickerReact, sendTyping, addMember, loadJoinRequests, approveJoinRequest, publishGroupId, forceAdminInit, broadcastProfile, broadcastEvent, syncMessages } = useXmtp();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [tipTarget, setTipTarget] = useState<ChatMessage | null>(null);
  const [tipSending, setTipSending] = useState(false);
  const [pfpPickerOpen, setPfpPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [patInput, setPatInput] = useState("");
  const [patSaving, setPatSaving] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [addByIdInput, setAddByIdInput] = useState("");
  const [addByIdBusy, setAddByIdBusy] = useState(false);
  const [refreshingRequests, setRefreshingRequests] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pfpGifPickerOpen, setPfpGifPickerOpen] = useState(false);
  const [adminRecoveryOpen, setAdminRecoveryOpen] = useState(false);
  const [adminRecoveryPat, setAdminRecoveryPat] = useState("");
  const [adminRecoveryBusy, setAdminRecoveryBusy] = useState(false);
  const [adminRecoveryError, setAdminRecoveryError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const myAddress = myInboxId ?? "";

  // ─── XMTP connect + foreground sync ──────────────────────────────────────────
  useEffect(() => {
    initialize();

    // Sync messages when app comes back to foreground (fixes missed msgs on Android)
    let lastState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (lastState !== "active" && next === "active") {
        syncMessages();
      }
      lastState = next;
    });

    return () => {
      sub.remove();
      disconnect();
    };
  }, []);

  // ─── Auto-retry until approved ───────────────────────────────────────────────
  // Retries every 5s — any online group member's device auto-approves the request.
  useEffect(() => {
    if (isGroupMember || !remoteGroupId) return;
    const interval = setInterval(() => {
      initialize();
    }, 5_000);
    return () => clearInterval(interval);
  }, [isGroupMember, remoteGroupId]);

  // ─── Register for push notifications once member is confirmed ────────────────
  useEffect(() => {
    if (!isGroupMember) return;
    registerForPushNotifications().catch(() => {/* silently ignore */});
  }, [isGroupMember]);

  // ─── Stream heartbeat ─────────────────────────────────────────────────────────
  // Every 15s: if stream is dead → reconnect; if alive → sync missed messages.
  useEffect(() => {
    if (!isGroupMember) return;
    const id = setInterval(() => {
      if (!streamAlive()) { initialize(); }
      else { syncMessages(); }
    }, 15_000);
    return () => clearInterval(id);
  }, [isGroupMember]);

  // ─── Load saved profile, show modal if no username yet ───────────────────

  useEffect(() => {
    loadUserProfile().then(({ username: saved, bio, xAccount: savedX, tipWallet: savedTip }) => {
      if (saved) {
        setUsername(saved);
        if (bio) setBio(bio);
        if (savedX) setXAccount(savedX);
        const effectiveTip = savedTip || useAppStore.getState().wallet?.address || null;
        if (effectiveTip) setTipWallet(effectiveTip);
      } else {
        setShowUsernameModal(true);
      }
      // Always keep own entry in the profile cache so PFP shows everywhere
      const { myInboxId: id, verifiedNft: nft } = useAppStore.getState();
      if (id) cacheProfile(id, { username: saved ?? undefined, nftImage: nft?.image ?? null });
    });
    // Load persisted theme
    loadThemeId().then(setThemeId);
    loadCustomColor().then((c) => { if (c) setCustomBubbleColor(c); });
    // Load persisted calendar events
    loadEvents().then(setCalendarEvents);
  }, []);

  // ─── Keep own NFT in profile cache in sync whenever verifiedNft changes ──────
  useEffect(() => {
    if (myInboxId && verifiedNft?.image) {
      cacheProfile(myInboxId, { nftImage: verifiedNft.image });
    }
  }, [myInboxId, verifiedNft]);

  // ─── Send ────────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

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

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      if (currentReplyingTo) {
        await reply(currentReplyingTo, text);
      } else {
        await send(text);
      }
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
    } catch {
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
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
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      await send(content);
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
    } catch (err) {
      console.warn("GIF send failed:", err);
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
    }
  }, [send, myAddress, username, verifiedNft]);

  // ─── Camera capture ────────────────────────────────────────────────────────

  const handleCamera = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera permission required", "Please allow camera access in your device settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.25,
        allowsEditing: false,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Embed as data URI so all users can display it (no backend upload needed)
      const dataUri = asset.base64
        ? `data:image/jpeg;base64,${asset.base64}`
        : asset.uri;
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
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      try {
        await send(content);
        useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
      } catch (err: any) {
        Alert.alert("Camera error", err?.message ?? "Could not send photo.");
        useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
      }
    } catch (err: any) {
      Alert.alert("Camera error", err?.message ?? "Could not open camera.");
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
      Alert.alert("Tip failed", err?.message ?? "Transaction could not be sent.");
    } finally {
      setTipSending(false);
    }
  }, [tipTarget]);


  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={item.senderAddress === myAddress}
        onReact={handleReact}
        onReply={setReplyingTo}
        onPressUser={handlePressUser}
        onTip={handleTip}
        onStickerReact={handleStickerReact}
      />
    ),
    [myAddress, handleReact, setReplyingTo, handlePressUser, handleTip, handleStickerReact]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <>
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
      />

      <MenuDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateEvent={() => setCalendarOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onMonkeTools={() => setToolsOpen(true)}
      />

      <SearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} />

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

      <MonkeToolsModal visible={toolsOpen} onClose={() => setToolsOpen(false)} />

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

      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Left: avatar (tappable — opens own profile) */}
          <Pressable
            style={styles.headerLeft}
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

          {/* Center: decorative banner image */}
          <ImageBackground
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../assets/header.png")}
            style={styles.headerCenter}
            resizeMode="cover"
          />

          {/* Right: admin badge (admin only) + ☰ menu */}
          <View style={styles.headerRight}>
            {isGroupAdmin && (
              <Pressable
                onPress={() => { loadJoinRequests(); setAdminOpen(true); }}
                style={[styles.iconBtn, joinRequests.length > 0 && styles.iconBtnAlert]}
                hitSlop={8}
              >
                <Text style={styles.iconBtnText}>
                  {joinRequests.length > 0 ? `👥 ${joinRequests.length}` : "👥"}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => setDrawerOpen(true)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <Text style={styles.menuIcon}>☰</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Admin Panel Modal ─────────────────────────────────────────────── */}
        <Modal
          visible={adminOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setAdminOpen(false)}
          statusBarTranslucent
        >
          <Pressable style={styles.adminOverlay} onPress={() => setAdminOpen(false)} />
          <View style={styles.adminSheet}>
            <View style={styles.adminSheetHandle} />
            <Text style={styles.adminTitle}>Admin Panel</Text>

            {/* Publish group ID section */}
            <Text style={styles.adminSectionLabel}>PUBLISH GROUP TO GITHUB</Text>
            <Text style={styles.adminHint}>
              Enter a GitHub PAT (classic, repo scope) once to let testers find this group.
            </Text>
            <TextInput
              style={styles.adminInput}
              placeholder="ghp_…"
              placeholderTextColor={THEME.textFaint}
              value={patInput}
              onChangeText={setPatInput}
              secureTextEntry
              autoCapitalize="none"
            />
            <Pressable
              style={[styles.adminPrimaryBtn, patSaving && styles.adminBtnDisabled]}
              onPress={async () => {
                if (!patInput.trim()) return;
                setPatSaving(true);
                try {
                  await publishGroupId(patInput.trim());
                  setPatSaved(true);
                  setPatInput("");
                  setTimeout(() => setPatSaved(false), 3000);
                } catch (err: any) {
                  Alert.alert("Publish failed", err?.message ?? String(err));
                } finally {
                  setPatSaving(false);
                }
              }}
            >
              <Text style={styles.adminPrimaryBtnText}>
                {patSaving ? "Publishing…" : patSaved ? "✓ Published!" : "Publish Group ID"}
              </Text>
            </Pressable>

            {/* Pending join requests section */}
            <Text style={[styles.adminSectionLabel, { marginTop: 20 }]}>
              PENDING JOIN REQUESTS ({joinRequests.length})
            </Text>
            {joinRequests.length === 0 ? (
              <Text style={styles.adminHint}>No pending requests. Tap "Refresh" below to check again.</Text>
            ) : (
              <ScrollView style={styles.adminRequestList}>
                {joinRequests.map((req) => (
                  <View key={req.inboxId} style={styles.adminRequestRow}>
                    <View style={styles.adminRequestInfo}>
                      <Text style={styles.adminRequestUsername}>
                        {req.username ?? "Unknown"}
                      </Text>
                      <Text style={styles.adminRequestInboxId} numberOfLines={1}>
                        {req.inboxId}
                      </Text>
                    </View>
                    <Pressable
                      style={[
                        styles.adminAddBtn,
                        approvingId === req.inboxId && styles.adminBtnDisabled,
                      ]}
                      onPress={async () => {
                        setApprovingId(req.inboxId);
                        try {
                          await approveJoinRequest(req.inboxId);
                        } catch (err: any) {
                          Alert.alert("Error", err?.message ?? String(err));
                        } finally {
                          setApprovingId(null);
                        }
                      }}
                    >
                      <Text style={styles.adminAddBtnText}>
                        {approvingId === req.inboxId ? "Adding…" : "Add"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable
              style={styles.adminRefreshBtn}
              disabled={refreshingRequests}
              onPress={async () => {
                setRefreshingRequests(true);
                try {
                  await loadJoinRequests();
                } finally {
                  setRefreshingRequests(false);
                }
              }}
            >
              {refreshingRequests ? (
                <ActivityIndicator size="small" color={THEME.textMuted} />
              ) : (
                <Text style={styles.adminRefreshBtnText}>↻ Refresh Requests</Text>
              )}
            </Pressable>

            {/* Add user manually by inbox ID */}
            <Text style={[styles.adminSectionLabel, { marginTop: 20 }]}>
              ADD USER MANUALLY
            </Text>
            <Text style={styles.adminHint}>
              Paste the user's Access Key (XMTP inbox ID) shown on their pending screen.
            </Text>
            <TextInput
              style={styles.adminInput}
              placeholder="Paste inbox ID…"
              placeholderTextColor={THEME.textFaint}
              value={addByIdInput}
              onChangeText={setAddByIdInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[
                styles.adminPrimaryBtn,
                (!addByIdInput.trim() || addByIdBusy) && styles.adminBtnDisabled,
              ]}
              onPress={async () => {
                const id = addByIdInput.trim();
                if (!id) return;
                setAddByIdBusy(true);
                try {
                  await addMember(id);
                  Alert.alert("✓ Added!", `User has been added to the group.`);
                  setAddByIdInput("");
                } catch (err: any) {
                  Alert.alert("Error", err?.message ?? String(err));
                } finally {
                  setAddByIdBusy(false);
                }
              }}
              disabled={!addByIdInput.trim() || addByIdBusy}
            >
              <Text style={styles.adminPrimaryBtnText}>
                {addByIdBusy ? "Adding…" : "Add User"}
              </Text>
            </Pressable>
          </View>
        </Modal>

        {/* ── Not yet a member — show Access Key so admin can add them ─── */}
        {remoteGroupId && !isGroupMember && (
          <View style={styles.pendingContainer}>
            <Text style={styles.pendingIcon}>🐒</Text>
            <Text style={styles.pendingTitle}>Access Pending</Text>
            <ActivityIndicator color={THEME.accent} style={{ marginTop: 4 }} />
            <Text style={styles.pendingSubtitle}>
              Share your Access Key with the admin to get added to the chat.
            </Text>
            <View style={styles.accessKeyBox}>
              <Text style={styles.accessKeyLabel}>YOUR ACCESS KEY</Text>
              <Text style={styles.accessKeyValue} selectable numberOfLines={3}>
                {myAddress}
              </Text>
              <Text style={styles.accessKeyHint}>
                Long-press the key above to copy it, then send it to the admin.
              </Text>
            </View>

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
        {isGroupMember && <FlatList
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
          onCamera={handleCamera}
          typingUsers={typingUsers}
        />}

        <View style={{ height: insets.bottom }} />
      </KeyboardAvoidingView>
    </>
  );
}

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
  headerCenter: {
    flex: 1,
    alignSelf: "stretch",
  },
  headerLeft: {
    alignItems: "flex-start",
  },
  headerNft: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.accent + "66",
  },
  headerNftFallback: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  headerNftGlyph: { fontSize: 24 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
    flexGrow: 1,
    justifyContent: "flex-end",
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
  accessKeyBox: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    padding: 16,
    alignSelf: "stretch",
    gap: 8,
    marginTop: 8,
  },
  accessKeyLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  accessKeyValue: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.accent,
    lineHeight: 18,
  },
  accessKeyHint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    fontStyle: "italic",
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

  // ── Admin Panel ───────────────────────────────────────────────────────────────
  adminOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  adminSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: THEME.surfaceHigh,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: THEME.border,
    padding: 20,
    paddingBottom: 36,
    maxHeight: "80%",
  },
  adminSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  adminTitle: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
    marginBottom: 16,
  },
  adminSectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  adminHint: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    marginBottom: 10,
    lineHeight: 18,
  },
  adminInput: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.text,
    marginBottom: 10,
  },
  adminPrimaryBtn: {
    backgroundColor: THEME.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  adminBtnDisabled: { opacity: 0.5 },
  adminPrimaryBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#fff",
  },
  adminRequestList: {
    maxHeight: 200,
  },
  adminRequestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  adminRequestInfo: { flex: 1, gap: 2 },
  adminRequestUsername: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.text,
  },
  adminRequestInboxId: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  adminAddBtn: {
    backgroundColor: THEME.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  adminAddBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#fff",
  },
  adminRefreshBtn: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 10,
  },
  adminRefreshBtnText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
  },
});
