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
  Clipboard,
  Modal,
  ScrollView,
  TextInput,
  Alert,
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
  const {
    verifiedNft, myInboxId, username, setUsername, setBio,
    isGroupMember, isGroupAdmin, joinRequests, remoteGroupId,
  } = useAppStore();
  const { messages, replyingTo, isLoadingHistory, setReplyingTo } =
    useChatStore();
  const { initialize, disconnect, send, reply, react, loadJoinRequests, approveJoinRequest, publishGroupId } = useXmtp();
  const [copied, setCopied] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [patInput, setPatInput] = useState("");
  const [patSaving, setPatSaving] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
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
        <View style={styles.header}>
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

          {/* Center: decorative banner image */}
          <ImageBackground
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../assets/header.png")}
            style={styles.headerCenter}
            resizeMode="cover"
          />

          {/* Right: 🔧 + admin badge + ☰ */}
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => setToolsOpen(true)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <Text style={styles.iconBtnText}>🔧</Text>
            </Pressable>

            {/* Admin join-requests button — only visible to group admin */}
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
              <Text style={styles.adminHint}>No pending requests. Pull down to refresh.</Text>
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
              onPress={() => loadJoinRequests()}
            >
              <Text style={styles.adminRefreshBtnText}>Refresh Requests</Text>
            </Pressable>
          </View>
        </Modal>

        {/* ── Not yet a member ─────────────────────────────────────────────── */}
        {remoteGroupId && !isGroupMember && (
          <View style={styles.pendingContainer}>
            <Text style={styles.pendingIcon}>⏳</Text>
            <Text style={styles.pendingTitle}>Join request sent</Text>
            <Text style={styles.pendingSubtitle}>
              Your request has been sent to the admin. You'll be added shortly.
              If it's been a while, share your Inbox ID directly.
            </Text>
            <View style={styles.inboxIdBox}>
              <Text style={styles.inboxIdText} selectable numberOfLines={1}>
                {myInboxId ?? "Loading…"}
              </Text>
            </View>
            <Pressable
              style={styles.copyBtn}
              onPress={() => {
                if (myInboxId) {
                  Clipboard.setString(myInboxId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              <Text style={styles.copyBtnText}>{copied ? "✓ Copied!" : "Copy Inbox ID"}</Text>
            </Pressable>
            <Pressable style={styles.retryBtn} onPress={initialize}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
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

  // ── Pending / not yet a member ───────────────────────────────────────────────
  pendingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  pendingIcon: { fontSize: 48 },
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
  inboxIdBox: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: "100%",
  },
  inboxIdText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
  },
  copyBtn: {
    backgroundColor: THEME.accent,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: "100%",
    alignItems: "center",
  },
  copyBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#fff",
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
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
