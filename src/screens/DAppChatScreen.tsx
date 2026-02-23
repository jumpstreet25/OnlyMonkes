/**
 * DAppChatScreen
 *
 * Generic dApp community chat screen.
 * Same layout as the main ChatScreen but with a custom header showing
 * the dApp name + back button. Uses useGroupChat for isolated local state.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { useGroupChat } from "@/hooks/useGroupChat";
import { MessageBubble } from "@/components/MessageBubble";
import { ChatInput } from "@/components/ChatInput";
import { THEME, FONTS, DAPPS } from "@/lib/constants";
import type { ChatMessage, ReactionEmoji } from "@/types";

interface DAppChatScreenProps {
  dappId: string;
}

export default function DAppChatScreen({ dappId }: DAppChatScreenProps) {
  const insets = useSafeAreaInsets();
  const { myInboxId, username, verifiedNft } = useAppStore();

  const dapp = DAPPS.find((d) => d.id === dappId);

  const {
    messages,
    isLoading,
    isLoadingHistory,
    error,
    initialize,
    disconnect,
    send,
    reply,
    react,
    addMessageLocal,
    updateMessageStatus,
  } = useGroupChat(dapp?.groupId ?? dappId, dapp?.name ?? dappId);

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const myAddress = myInboxId ?? "";

  useEffect(() => {
    initialize();
    return () => disconnect();
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

    addMessageLocal(optimistic);
    setReplyingTo(null);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      if (currentReplyingTo) {
        await reply(currentReplyingTo, text);
      } else {
        await send(text);
      }
      updateMessageStatus(optimistic.id, "sent");
    } catch {
      updateMessageStatus(optimistic.id, "failed");
    } finally {
      setIsSending(false);
    }
  }, [
    inputText,
    myAddress,
    username,
    verifiedNft,
    replyingTo,
    send,
    reply,
    addMessageLocal,
    updateMessageStatus,
  ]);

  // ─── React ───────────────────────────────────────────────────────────────────

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

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderMessage: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={item.senderAddress === myAddress}
        onReact={handleReact}
        onReply={setReplyingTo}
      />
    ),
    [myAddress, handleReact]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  if (!dapp) {
    return (
      <View
        style={[
          styles.container,
          styles.centerState,
          { paddingTop: insets.top },
        ]}
      >
        <Text style={styles.centerText}>dApp not found</Text>
        <Pressable onPress={() => router.back()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.dappIconText}>{dapp.icon}</Text>
          <View>
            <Text style={styles.headerTitle}>{dapp.name}</Text>
            <View style={styles.headerStatus}>
              <View style={styles.liveDot} />
              <Text style={styles.headerSubtitle}>Community Chat · Live</Text>
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
          <Text style={styles.centerText}>Connecting to {dapp.name}…</Text>
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
              <Text style={styles.historyLoadingText}>Loading messages…</Text>
            </View>
          )}

          {/* Empty state */}
          {!isLoadingHistory && messages.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>{dapp.icon}</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>
                Be the first to start the {dapp.name} conversation!
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
        </>
      )}

      {/* Input — always visible so user can type once connected */}
      {!isLoading && !error && (
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          isSending={isSending}
        />
      )}

      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
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
  dappIconText: { fontSize: 26 },
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
