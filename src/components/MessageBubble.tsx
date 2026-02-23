/**
 * MessageBubble
 *
 * Renders a single chat message:
 *  - Username above bubble (sender name or shortened inboxId)
 *  - Own messages: iMessage-style light blue bubble, right-aligned
 *  - Other messages: dark surface bubble, left-aligned with avatar
 *  - Reply preview strip when message is a reply
 *  - 🍌 banana like button below bubble (tap to toggle, shows count)
 *  - Long-press bubble → reply to that message
 */

import React, { memo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
} from "react-native";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";

// iMessage-style blue
const IMESSAGE_BLUE = "#1D8CF5";
const IMESSAGE_BLUE_TEXT = "#FFFFFF";

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onReact: (emoji: ReactionEmoji, messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  onPressUser?: (target: ProfileTarget) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReact,
  onReply,
  onPressUser,
}: MessageBubbleProps) {
  const bananaReaction = message.reactions["🍌"];
  const bananaCount = bananaReaction?.count ?? 0;
  const bananaByMe = bananaReaction?.reactedByMe ?? false;

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReply(message);
  }, [onReply, message]);

  const handleBanana = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReact("🍌", message.id);
  }, [onReact, message.id]);

  const handlePressName = useCallback(() => {
    if (!onPressUser) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPressUser({
      senderAddress: message.senderAddress,
      senderUsername: message.senderUsername,
      senderNft: message.senderNft,
    });
  }, [onPressUser, message]);

  const displayName =
    message.senderUsername ?? shortenAddress(message.senderAddress);

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {/* Avatar — only for others */}
      {!isOwn && (
        <View style={styles.avatarContainer}>
          {message.senderNft?.image ? (
            <Image
              source={{ uri: message.senderNft.image }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarGlyph}>🐒</Text>
            </View>
          )}
        </View>
      )}

      {/* Bubble group */}
      <View style={[styles.bubbleGroup, isOwn && styles.bubbleGroupOwn]}>
        {/* Sender name — tappable to open profile */}
        <Pressable onPress={handlePressName} hitSlop={6}>
          <Text style={[styles.sender, isOwn && styles.senderOwn]}>
            {isOwn ? "You" : displayName}
          </Text>
        </Pressable>

        {/* Reply preview */}
        {message.replyTo && (
          <View style={[styles.replyPreview, isOwn && styles.replyPreviewOwn]}>
            <View style={[styles.replyBar, isOwn && styles.replyBarOwn]} />
            <View style={styles.replyContent}>
              <Text style={[styles.replySender, isOwn && styles.replySenderOwn]}>
                {message.replyTo.senderUsername ??
                  shortenAddress(message.replyTo.senderAddress)}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {message.replyTo.content}
              </Text>
            </View>
          </View>
        )}

        {/* Main bubble */}
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={350}
          style={[styles.bubble, isOwn && styles.bubbleOwn]}
        >
          <Text style={[styles.content, isOwn && styles.contentOwn]}>
            {message.content}
          </Text>
          <Text style={[styles.time, isOwn && styles.timeOwn]}>
            {format(message.sentAt, "HH:mm")}
            {message.status === "sending" && "  ···"}
          </Text>
        </Pressable>

        {/* 🍌 banana like button */}
        <Pressable
          onPress={handleBanana}
          style={[styles.bananaBtn, bananaByMe && styles.bananaBtnActive]}
          hitSlop={6}
        >
          <Text style={styles.bananaEmoji}>🍌</Text>
          {bananaCount > 0 && (
            <Text style={[styles.bananaCount, bananaByMe && styles.bananaCountActive]}>
              {bananaCount}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginVertical: 4,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowOwn: { flexDirection: "row-reverse" },

  avatarContainer: { marginBottom: 20 }, // offset to align with bubble bottom
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: { fontSize: 16 },

  bubbleGroup: {
    maxWidth: "75%",
    gap: 3,
    alignItems: "flex-start",
  },
  bubbleGroupOwn: { alignItems: "flex-end" },

  sender: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.accent,
    marginLeft: 4,
  },
  senderOwn: {
    color: THEME.textMuted,
    marginLeft: 0,
    marginRight: 4,
  },

  replyPreview: {
    flexDirection: "row",
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 8,
    overflow: "hidden",
    maxWidth: "100%",
    marginBottom: 2,
  },
  replyPreviewOwn: {},
  replyBar: {
    width: 3,
    backgroundColor: THEME.accent,
  },
  replyBarOwn: {
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  replyContent: { padding: 8, gap: 2, flex: 1 },
  replySender: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.accent,
  },
  replySenderOwn: {
    color: "rgba(255,255,255,0.6)",
  },
  replyText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },

  bubble: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    gap: 4,
  },
  bubbleOwn: {
    backgroundColor: IMESSAGE_BLUE,
    borderColor: "transparent",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
  },
  content: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    lineHeight: 22,
  },
  contentOwn: {
    color: IMESSAGE_BLUE_TEXT,
  },
  time: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    alignSelf: "flex-end",
  },
  timeOwn: {
    color: "rgba(255,255,255,0.55)",
  },

  bananaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: THEME.surface,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  bananaBtnActive: {
    backgroundColor: "rgba(255,213,79,0.15)",
    borderColor: "#FFD54F",
  },
  bananaEmoji: { fontSize: 13 },
  bananaCount: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
  },
  bananaCountActive: {
    color: "#FFD54F",
  },
});
