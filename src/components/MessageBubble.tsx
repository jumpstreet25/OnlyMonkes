/**
 * MessageBubble
 *
 * Layout:
 *   Row: [Avatar] [BubbleGroup] [BananaPill]
 *   - For own messages (row-reverse): [BananaPill] [BubbleGroup] [Avatar]
 *   BubbleGroup:
 *     [SenderName ────── Timestamp]  ← header row
 *     ReplyPreview (if any)
 *     Bubble (content + non-banana reaction pills)
 *
 * Interactions:
 *   - Long-press → emoji picker modal
 *   - Swipe right → reply
 *   - Tap avatar → open profile
 *   - Tap banana pill → tip (others) / react (own)
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Modal,
  PanResponder,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { THEME, FONTS, REACTIONS } from "@/lib/constants";
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

  const [pickerVisible, setPickerVisible] = useState(false);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickerVisible(true);
  }, []);

  const handlePickReaction = useCallback((emoji: ReactionEmoji) => {
    setPickerVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReact(emoji, message.id);
  }, [onReact, message.id]);

  const handlePickReply = useCallback(() => {
    setPickerVisible(false);
    onReply(message);
  }, [onReply, message]);

  // Banana pill — outside the bubble on the opposite side from avatar
  const bananaRxn = message.reactions["🍌"];
  const bananaCount = bananaRxn?.count ?? 0;
  const bananaByMe = bananaRxn?.reactedByMe ?? false;

  const handleBananaPill = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isOwn && onTip) {
      onTip(message);
    } else {
      onReact("🍌", message.id);
    }
  }, [isOwn, onTip, onReact, message]);

  const handlePressAvatar = useCallback(() => {
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

  // ── Swipe-right to reply ──────────────────────────────────────────────────
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const didTrigger = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        dx > 8 && Math.abs(dx) > Math.abs(dy) * 2,
      onPanResponderMove: (_, { dx }) => {
        if (dx > 0) swipeAnim.setValue(Math.min(dx * 0.55, 70));
      },
      onPanResponderRelease: (_, { dx }) => {
        if (dx > 52 && !didTrigger.current) {
          didTrigger.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onReply(message);
        }
        Animated.spring(swipeAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 200,
          friction: 20,
        }).start(() => { didTrigger.current = false; });
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true }).start(() => {
          didTrigger.current = false;
        });
      },
    })
  ).current;

  const displayName =
    getCachedProfile(message.senderAddress)?.username ??
    message.senderUsername ??
    shortenAddress(message.senderAddress);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const cachedNft = cachedNftImageForColor;
  const avatarUri = message.senderNft?.image ?? cachedNft ?? null;

  return (
    <>
    <Animated.View
      style={[styles.row, isOwn && styles.rowOwn, { transform: [{ translateX: swipeAnim }] }]}
      {...panResponder.panHandlers}
    >
      {/* Avatar — tappable → opens profile */}
      <Pressable
        style={styles.avatarContainer}
        onPress={handlePressAvatar}
        hitSlop={6}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarGlyph}>🐒</Text>
          </View>
        )}
      </Pressable>

      {/* Bubble group */}
      <View style={[styles.bubbleGroup, isOwn && styles.bubbleGroupOwn]}>

        {/* Header: sender name + timestamp */}
        <View style={[styles.msgHeader, isOwn && styles.msgHeaderOwn]}>
          <Text style={[styles.sender, isOwn && styles.senderOwn]}>
            {isOwn ? "You" : displayName}
          </Text>
          <Text style={[styles.time, { color: THEME.textFaint }]}>
            {format(message.sentAt, "HH:mm")}
            {message.status === "sending" && "  ···"}
          </Text>
        </View>

        {/* Reply preview */}
        {message.replyTo && (
          <View style={[styles.replyPreview, isOwn && styles.replyPreviewOwn]}>
            <View style={[styles.replyBar, isOwn && styles.replyBarOwn]} />
            <View style={styles.replyContent}>
              <Text style={[styles.replySender, isOwn && styles.replySenderOwn]}>
                {getCachedProfile(message.replyTo.senderAddress)?.username ??
                  message.replyTo.senderUsername ??
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
          style={[
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            { backgroundColor: bubbleColor },
          ]}
        >
          <Text style={[styles.content, { color: textColor }]}>
            {message.content}
          </Text>

          {/* Footer: non-banana reaction pills only */}
          {(REACTIONS as readonly ReactionEmoji[]).some((e) => e !== "🍌" && (message.reactions[e]?.count ?? 0) > 0) && (
            <View style={styles.bubbleFooter}>
              {(REACTIONS as readonly ReactionEmoji[]).map((emoji) => {
                if (emoji === "🍌") return null;
                const rxn = message.reactions[emoji];
                const count = rxn?.count ?? 0;
                const byMe = rxn?.reactedByMe ?? false;
                if (count === 0) return null;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => onReact(emoji, message.id)}
                    hitSlop={8}
                    style={[styles.reactionPill, byMe && styles.reactionPillActive]}
                  >
                    <Text style={styles.pillEmoji}>{emoji}</Text>
                    <Text style={[styles.pillCount, byMe && styles.pillCountActive]}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Pressable>
      </View>

      {/* Banana pill — outside bubble, opposite side from avatar */}
      <Pressable
        onPress={handleBananaPill}
        hitSlop={8}
        style={[styles.bananaPill, bananaByMe && styles.bananaPillActive]}
      >
        <Text style={styles.bananaEmoji}>🍌</Text>
        {bananaCount > 0 && (
          <Text style={[styles.bananaCount, bananaByMe && styles.bananaCountActive]}>
            {bananaCount}
          </Text>
        )}
      </Pressable>

    </Animated.View>

    {/* ── Reaction picker Modal ──────────────────────────────────────── */}
    <Modal
      visible={pickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPickerVisible(false)}
    >
      <Pressable style={styles.pickerOverlay} onPress={() => setPickerVisible(false)}>
        <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.pickerEmojiRow}>
            {(REACTIONS as readonly ReactionEmoji[]).map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => handlePickReaction(emoji)}
                style={({ pressed }) => [
                  styles.pickerEmojiBtn,
                  pressed && styles.pickerEmojiBtnPressed,
                ]}
              >
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={handlePickReply}
            style={({ pressed }) => [
              styles.pickerReplyBtn,
              pressed && styles.pickerReplyBtnPressed,
            ]}
          >
            <Text style={styles.pickerReplyText}>↩  Reply</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  // ── Row ────────────────────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 1,
    paddingHorizontal: 12,
    gap: 6,
  },
  rowOwn: {
    flexDirection: "row-reverse",
  },

  // ── Avatars ────────────────────────────────────────────────────────────────
  avatarContainer: {
    alignSelf: "flex-end",
    marginBottom: 2,
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
    maxWidth: "72%",
    gap: 2,
    alignItems: "flex-start",
    flex: 1,
  },
  bubbleGroupOwn: { alignItems: "flex-end" },

  // ── Header row: sender name + timestamp ───────────────────────────────────
  msgHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 4,
    marginBottom: 1,
  },
  msgHeaderOwn: {
    flexDirection: "row-reverse",
    marginLeft: 0,
    marginRight: 4,
  },
  sender: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.accent,
  },
  senderOwn: {
    color: THEME.textMuted,
  },
  time: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
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

  // ── Bubble footer (non-banana reactions only) ──────────────────────────────
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },

  // ── Reaction pills (non-banana, inside bubble) ─────────────────────────────
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionPillActive: {
    backgroundColor: "rgba(255,213,79,0.28)",
  },
  pillEmoji: { fontSize: 12 },
  pillCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  pillCountActive: { color: "#FFD54F" },

  // ── Banana pill (outside bubble, opposite avatar) ─────────────────────────
  bananaPill: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    minWidth: 34,
  },
  bananaPillActive: {
    backgroundColor: "rgba(255,213,79,0.22)",
    borderColor: "#FFD54F44",
  },
  bananaEmoji: { fontSize: 18 },
  bananaCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  bananaCountActive: { color: "#FFD54F" },

  // ── Reaction picker Modal ──────────────────────────────────────────────────
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    alignItems: "center",
  },
  pickerSheet: {
    backgroundColor: THEME.surface,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    minWidth: 280,
  },
  pickerEmojiRow: {
    flexDirection: "row",
    gap: 8,
  },
  pickerEmojiBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerEmojiBtnPressed: {
    backgroundColor: THEME.accentSoft,
    transform: [{ scale: 1.15 }],
  },
  pickerEmoji: { fontSize: 26 },
  pickerReplyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  pickerReplyBtnPressed: {
    backgroundColor: THEME.accentSoft,
    borderColor: THEME.accent,
  },
  pickerReplyText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: THEME.text,
  },
});
