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
import { THEME, FONTS } from "@/lib/constants";
import { loadUserProfile } from "@/lib/userProfile";
import type { ChatMessage, ReactionEmoji } from "@/types";

const HEADER_BG = "transparent";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { verifiedNft, myInboxId, username, setUsername, setBio } =
    useAppStore();
  const { messages, replyingTo, isLoadingHistory, setReplyingTo } =
    useChatStore();
  const { initialize, disconnect, send, reply, react } = useXmtp();

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const myAddress = myInboxId ?? "";

  // ─── XMTP connect — must live here so send/react/reply share the same instance ─
  useEffect(() => {
    initialize();
    return () => { disconnect(); };
  }, []);

  // ─── Load saved profile, show modal if no username yet ───────────────────

  useEffect(() => {
    loadUserProfile().then(({ username: saved, bio }) => {
      if (saved) {
        setUsername(saved);
        if (bio) setBio(bio);
      } else {
        setShowUsernameModal(true);
      }
    });
  }, []);

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

  // ─── Profile popup ────────────────────────────────────────────────────────────

  const handlePressUser = useCallback((target: ProfileTarget) => {
    setProfileTarget(target);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={item.senderAddress === myAddress}
        onReact={handleReact}
        onReply={setReplyingTo}
        onPressUser={handlePressUser}
      />
    ),
    [myAddress, handleReact, setReplyingTo, handlePressUser]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <>
      <UsernameModal
        visible={showUsernameModal}
        onDone={() => setShowUsernameModal(false)}
      />

      <MenuDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <MonkeToolsModal visible={toolsOpen} onClose={() => setToolsOpen(false)} />

      <UserProfileModal
        visible={!!profileTarget}
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
      />

      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <ImageBackground
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require("../../assets/header.png")}
          style={styles.header}
          resizeMode="cover"
        >
          {/* Left: avatar + username stacked */}
          <View style={styles.headerLeft}>
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
            <Text style={styles.headerUsername} numberOfLines={1}>
              {username ?? "Monke"}
            </Text>
          </View>

          {/* Right: 🔧 + ☰ */}
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => setToolsOpen(true)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <Text style={styles.iconBtnText}>🔧</Text>
            </Pressable>
            <Pressable
              onPress={() => setDrawerOpen(true)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <Text style={styles.menuIcon}>☰</Text>
            </Pressable>
          </View>
        </ImageBackground>

        {/* Loading history */}
        {isLoadingHistory && (
          <View style={styles.historyLoading}>
            <ActivityIndicator size="small" color={THEME.accent} />
            <Text style={styles.historyLoadingText}>Loading messages…</Text>
          </View>
        )}

        {/* Empty state */}
        {!isLoadingHistory && messages.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🍌</Text>
            <Text style={styles.emptyTitle}>The chat is empty</Text>
            <Text style={styles.emptySubtitle}>
              Be the first holder to send a message!
            </Text>
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

        {/* Input */}
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          isSending={isSending}
        />

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
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: HEADER_BG,
  },
  headerLeft: {
    alignItems: "flex-start",
    gap: 4,
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
  headerUsername: {
    fontFamily: FONTS.display,
    fontSize: 15,
    color: THEME.text,
    maxWidth: 100,
  },
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
});
