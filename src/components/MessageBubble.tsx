/**
 * MessageBubble
 *
 * - Avatar left (others) / right (own, vertically centered)
 * - Username above bubble
 * - Reply preview strip
 * - Bubble with inline footer: timestamp + highlighted banana pill
 * - Long-press → reply
 */

import React, { memo, useCallback, useEffect, useState } from "react";
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
import { useAppStore } from "@/store/appStore";
import { getCachedProfile } from "@/lib/userProfile";
import { getOrExtractNftColor, readableTextColor } from "@/lib/nftColor";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";

const FALLBACK_BUBBLE = THEME.accent;

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onReact: (emoji: ReactionEmoji, messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  onPressUser?: (target: ProfileTarget) => void;
  onTip?: (message: ChatMessage) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReact,
  onReply,
  onPressUser,
  onTip,
}: MessageBubbleProps) {
  const { verifiedNft, myInboxId } = useAppStore();

  // ── PFP-derived bubble color ─────────────────────────────────────────────
  const cachedNftImageForColor = getCachedProfile(message.senderAddress)?.nftImage;
  const senderImageUrl = isOwn
    ? (verifiedNft?.image ?? null)
    : (message.senderNft?.image ?? cachedNftImageForColor ?? null);
  const colorCacheKey = isOwn ? (myInboxId ?? "own") : message.senderAddress;

  const [bubbleColor, setBubbleColor] = useState<string>(FALLBACK_BUBBLE);
  const [textColor, setTextColor] = useState<string>("#FFFFFF");

  useEffect(() => {
    let cancelled = false;
    getOrExtractNftColor(senderImageUrl, colorCacheKey).then((color) => {
      if (!cancelled) {
        setBubbleColor(color);
        setTextColor(readableTextColor(color));
      }
    });
    return () => { cancelled = true; };
  }, [senderImageUrl, colorCacheKey]);

  const bananaReaction = message.reactions["🍌"];
  const bananaCount    = bananaReaction?.count    ?? 0;
  const bananaByMe     = bananaReaction?.reactedByMe ?? false;

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReply(message);
  }, [onReply, message]);

  const handleBanana = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isOwn && onTip) {
      // Tap on others' messages → open tip sheet
      onTip(message);
    } else {
      // Own messages or no tip handler → classic reaction
      onReact("🍌", message.id);
    }
  }, [isOwn, onTip, onReact, message]);

  const handlePressName = useCallback(() => {
    if (!onPressUser) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nftFromCache = getCachedProfile(message.senderAddress)?.nftImage;
    onPressUser({
      senderAddress:  message.senderAddress,
      senderUsername: message.senderUsername,
      senderNft: message.senderNft
        ?? (nftFromCache ? { mint: "", name: "", image: nftFromCache } : null),
    });
  }, [onPressUser, message]);

  const displayName = message.senderUsername ?? shortenAddress(message.senderAddress);

  // ── Avatar helper — NFT image from message or profile cache ──────────────
  const cachedNft = cachedNftImageForColor;
  const avatarUri = message.senderNft?.image ?? cachedNft ?? null;
  const avatarEl  = avatarUri ? (
    <Image source={{ uri: avatarUri }} style={styles.avatar} />
  ) : (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarGlyph}>🐒</Text>
    </View>
  );

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>

      {/* Avatar — left for others (bottom-aligned), right for own (centered) */}
      <View style={isOwn ? styles.avatarContainerOwn : styles.avatarContainer}>
        {avatarEl}
      </View>

      {/* Bubble group */}
      <View style={[styles.bubbleGroup, isOwn && styles.bubbleGroupOwn]}>

        {/* Sender name */}
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

        {/* Main bubble — color from NFT PFP for both own and others */}
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={350}
          style={[
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            { backgroundColor: bubbleColor },
          ]}
        >
          <Text style={[styles.content, { color: textColor }]}>
            {message.content}
          </Text>

          {/* Footer: timestamp + banana pill */}
          <View style={styles.bubbleFooter}>
            <Text style={[styles.time, { color: textColor + "99" }]}>
              {format(message.sentAt, "HH:mm")}
              {message.status === "sending" && "  ···"}
            </Text>

            <Pressable
              onPress={handleBanana}
              hitSlop={8}
              style={[
                styles.bananaPill,
                bananaByMe && styles.bananaPillActive,
              ]}
            >
              <Text style={styles.bananaEmoji}>🍌</Text>
              {bananaCount > 0 && (
                <Text style={[styles.bananaCount, bananaByMe && styles.bananaCountActive]}>
                  {bananaCount}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // ── Row ────────────────────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "flex-end",   // others: avatar sits at bubble bottom
    marginVertical: 2,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowOwn: {
    flexDirection: "row-reverse",
    alignItems: "center",     // own: avatar vertically centered next to bubble
  },

  // ── Avatars ────────────────────────────────────────────────────────────────
  avatarContainer: {
    marginBottom: 20,         // nudge up to align with bubble body (past sender label)
  },
  avatarContainerOwn: {
    // no offset — centered by parent alignItems: "center"
  },
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

  // ── Bubble group ───────────────────────────────────────────────────────────
  bubbleGroup: {
    maxWidth: "75%",
    gap: 3,
    alignItems: "flex-start",
  },
  bubbleGroupOwn: { alignItems: "flex-end" },

  // ── Sender name ────────────────────────────────────────────────────────────
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

  // ── Reply preview ──────────────────────────────────────────────────────────
  replyPreview: {
    flexDirection: "row",
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 8,
    overflow: "hidden",
    maxWidth: "100%",
    marginBottom: 2,
  },
  replyPreviewOwn: {},
  replyBar: { width: 3, backgroundColor: THEME.accent },
  replyBarOwn: { backgroundColor: "rgba(255,255,255,0.5)" },
  replyContent: { padding: 8, gap: 2, flex: 1 },
  replySender: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.accent,
  },
  replySenderOwn: { color: "rgba(255,255,255,0.6)" },
  replyText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },

  // ── Bubble ─────────────────────────────────────────────────────────────────
  bubble: {
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  bubbleOwn: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
  },
  bubbleOther: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
  },
  content: {
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 22,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 4,
  },
  time: {
    fontFamily: FONTS.mono,
    fontSize: 10,
  },

  // ── Banana pill ────────────────────────────────────────────────────────────
  bananaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bananaPillOwn: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  bananaPillActive: {
    backgroundColor: "rgba(255,213,79,0.28)",
  },
  bananaEmoji: { fontSize: 12 },
  bananaCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  bananaCountActive: { color: "#FFD54F" },
});
