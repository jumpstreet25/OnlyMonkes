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

import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Modal,
  PanResponder,
  Animated,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { THEME, FONTS, REACTIONS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, useProfileVersion, getAllTimeUsers } from "@/lib/userProfile";
import { getOrExtractNftColor, readableTextColor } from "@/lib/nftColor";
import { searchStickers, type GiphyItem } from "@/lib/giphy";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";

const FALLBACK_BUBBLE = THEME.accent;

function VideoBubble({ raw, mediaWidth, onPress }: {
  raw: string;
  mediaWidth: number;
  onPress?: (url: string) => void;
}) {
  const pipeIdx = raw.indexOf('|');
  const videoUrl = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  const thumbUrl = pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : raw;
  return (
    <Pressable
      onPress={() => onPress?.(videoUrl)}
      style={{ width: mediaWidth, borderRadius: 14, overflow: 'hidden' }}
    >
      <ExpoImage
        source={{ uri: thumbUrl }}
        style={{ width: mediaWidth, height: mediaWidth * (9 / 16) }}
        contentFit="cover"
        cachePolicy="disk"
      />
      <View style={videoStyles.playOverlay}>
        <View style={videoStyles.playBtn}>
          <Text style={videoStyles.playIcon}>▶</Text>
        </View>
      </View>
      <View style={videoStyles.watermarkShadow}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../assets/watermark.png')}
          style={videoStyles.watermark}
          resizeMode="contain"
        />
      </View>
    </Pressable>
  );
}

const videoStyles = StyleSheet.create({
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 20,
    color: '#fff',
    marginLeft: 3,
  },
  watermarkShadow: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 128,
    height: 64,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 6,
  },
  watermark: {
    width: 128,
    height: 64,
    opacity: 0.9,
  },
});

const MENTION_COLOR = "#6BC5F8"; // blue hyperlink for @username
const TOKEN_COLOR   = "#FFD700"; // gold for $TOKEN
const RICH_SPLIT    = /(@\w+|\$[A-Za-z]{1,15})/g;

/** Render text with @mention (blue, tappable) and $TOKEN (gold) highlighting. */
function renderRichContent(
  content: string,
  onPressMention?: (username: string) => void,
): React.ReactNode[] {
  const parts = content.split(RICH_SPLIT);
  return parts.map((part, i) => {
    if (/^@\w+$/.test(part)) {
      return (
        <Text
          key={i}
          style={{ color: MENTION_COLOR }}
          onPress={() => onPressMention?.(part.slice(1))}
        >
          {part}
        </Text>
      );
    }
    if (/^\$[A-Za-z]{1,15}$/.test(part)) {
      return (
        <Text key={i} style={{ color: TOKEN_COLOR }}>{part}</Text>
      );
    }
    return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;
  });
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onReact: (emoji: ReactionEmoji, messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  onPressUser?: (target: ProfileTarget) => void;
  onTip?: (message: ChatMessage) => void;
  onStickerReact?: (url: string, messageId: string) => void;
  onPressImage?: (url: string) => void;
  onPressVideo?: (url: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReact,
  onReply,
  onPressUser,
  onTip,
  onStickerReact,
  onPressImage,
  onPressVideo,
}: MessageBubbleProps) {
  const { verifiedNft, myInboxId } = useAppStore();
  const { width: SCREEN_W } = useWindowDimensions();
  // Max bubble width is 72% of screen minus horizontal padding (14px each side)
  const mediaWidth = Math.round(SCREEN_W * 0.72 - 28);

  // Re-render instantly whenever any profile cache entry changes (PFP updates)
  useProfileVersion();

  // ── Bubble color: own messages use NFT-derived color, others use flat surface ─
  // Others get THEME.surfaceHigh so the chat doesn't look like a purple rainbow.
  const senderImageUrl = isOwn ? (verifiedNft?.image ?? null) : null;
  const colorCacheKey  = myInboxId ?? "own";

  const [bubbleColor, setBubbleColor] = useState<string>(
    isOwn ? FALLBACK_BUBBLE : THEME.surfaceHigh
  );
  const [textColor, setTextColor] = useState<string>(
    isOwn ? "#FFFFFF" : THEME.text
  );

  useEffect(() => {
    if (!isOwn) {
      setBubbleColor(THEME.surfaceHigh);
      setTextColor(THEME.text);
      return;
    }
    let cancelled = false;
    getOrExtractNftColor(senderImageUrl, colorCacheKey).then((color) => {
      if (!cancelled) {
        setBubbleColor(color);
        setTextColor(readableTextColor(color));
      }
    });
    return () => { cancelled = true; };
  }, [isOwn, senderImageUrl, colorCacheKey]);

  // Dynamic aspect ratio for GIF / IMAGE — computed from actual image dimensions on load
  const [imgAspect, setImgAspect] = useState<number>(3 / 4); // sensible portrait default

  const [botExpanded, setBotExpanded] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [stickerItems, setStickerItems] = useState<GiphyItem[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);
  const [reactorsFor, setReactorsFor] = useState<ReactionEmoji | null>(null);

  // Fetch stickers when picker opens
  useEffect(() => {
    if (!pickerVisible) return;
    let cancelled = false;
    setStickersLoading(true);
    searchStickers("sagamonkes", 12).then((items) => {
      if (!cancelled) {
        setStickerItems(items);
        setStickersLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setStickersLoading(false);
    });
    return () => { cancelled = true; };
  }, [pickerVisible]);

  // Look up @mentioned username → open their profile
  const handlePressMention = useCallback((mentionedUsername: string) => {
    if (!onPressUser) return;
    const allUsers = getAllTimeUsers(); // Map<inboxId, username>
    let foundInboxId: string | null = null;
    for (const [inboxId, uname] of allUsers.entries()) {
      if (uname.toLowerCase() === mentionedUsername.toLowerCase()) {
        foundInboxId = inboxId;
        break;
      }
    }
    if (!foundInboxId) return;
    const profile = getCachedProfile(foundInboxId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPressUser({
      senderAddress:  foundInboxId,
      senderUsername: mentionedUsername,
      senderNft: profile?.nftImage ? { mint: "", name: "", image: profile.nftImage } : null,
    });
  }, [onPressUser]);

  const handleLongPress = useCallback(() => {
    Keyboard.dismiss();
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

  // Re-read from cache on every render (re-render triggered by useProfileVersion above)
  const cachedSender = getCachedProfile(message.senderAddress);
  const displayName  = cachedSender?.username ?? message.senderUsername ?? shortenAddress(message.senderAddress);
  const isBot = message.senderUsername === "AI Agent #9385";
  // Show expand control when bot message likely exceeds 9 lines
  const showBotExpand = isBot && (message.content.split("\n").length > 9 || message.content.length > 380);
  const isLegendarySender = isOwn
    ? useAppStore.getState().isLegendary
    : !!(cachedSender?.legendary);

  // ── Avatar ────────────────────────────────────────────────────────────────
  // Own: use live verifiedNft. Others: always prefer fresh profile cache.
  const avatarUri = isOwn
    ? (verifiedNft?.image ?? null)
    : (cachedSender?.nftImage ?? message.senderNft?.image ?? null);

  // ── Media detection (GIF / photo — rendered without bubble background) ───
  const isMedia =
    message.content.startsWith("GIF:") ||
    message.content.startsWith("IMAGE:") ||
    message.content.startsWith("VIDEO:");

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
        ) : isBot ? (
          <Image source={require('../../assets/ai_agent_avatar.png')} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarGlyph}>🐒</Text>
          </View>
        )}
      </Pressable>

      {/* Bubble group */}
      <View style={[styles.bubbleGroup, isOwn && styles.bubbleGroupOwn]}>

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

        {/* Main bubble — no background/padding for GIF/IMAGE */}
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={350}
          onPress={showBotExpand ? () => setBotExpanded(e => !e) : undefined}
          style={isMedia ? styles.mediaBubble : [
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            { backgroundColor: bubbleColor },
          ]}
        >
          {/* GIF content */}
          {message.content.startsWith("GIF:") ? (
            <Pressable
              onPress={() => onPressImage?.(message.content.slice(4))}
              style={{ width: mediaWidth, borderRadius: 14, overflow: "hidden" }}
            >
              <ExpoImage
                source={{ uri: message.content.slice(4) }}
                style={{ width: mediaWidth, height: mediaWidth * imgAspect }}
                contentFit="contain"
                cachePolicy="disk"
                priority="normal"
                onLoad={(e: any) => {
                  const { width: w, height: h } = e.source;
                  if (w > 0) setImgAspect(h / w);
                }}
              />
              <View style={styles.gifBadge}>
                <Text style={styles.gifBadgeText}>GIF</Text>
              </View>
            </Pressable>
          ) : message.content.startsWith("IMAGE:") ? (
            <Pressable
              onPress={() => onPressImage?.(message.content.slice(6))}
              style={{ width: mediaWidth, borderRadius: 14, overflow: "hidden" }}
            >
              <ExpoImage
                source={{ uri: message.content.slice(6) }}
                style={{ width: mediaWidth, height: mediaWidth * imgAspect }}
                contentFit="contain"
                cachePolicy="disk"
                priority="normal"
                onLoad={(e: any) => {
                  const { width: w, height: h } = e.source;
                  if (w > 0) setImgAspect(h / w);
                }}
              />
              <View style={styles.watermarkShadow}>
                <Image
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require("../../assets/watermark.png")}
                  style={styles.watermark}
                  resizeMode="contain"
                />
              </View>
            </Pressable>
          ) : message.content.startsWith("VIDEO:") ? (
            <VideoBubble
              raw={message.content.slice(6)}
              mediaWidth={mediaWidth}
              onPress={onPressVideo}
            />
          ) : message.content.startsWith("STICKER:") ? (
            <Image
              source={{ uri: message.content.slice(8) }}
              style={styles.stickerImage}
              resizeMode="contain"
            />
          ) : (
            <View style={{ gap: 4 }}>
              <Text
                style={[styles.content, { color: textColor }]}
                numberOfLines={showBotExpand && !botExpanded ? 9 : undefined}
              >
                {renderRichContent(message.content, handlePressMention)}
              </Text>
              {showBotExpand && (
                <Text style={styles.expandText}>
                  {botExpanded ? "collapse" : "expand"}
                </Text>
              )}
            </View>
          )}
        </Pressable>

        {/* Header: sender name + timestamp — BELOW bubble, ABOVE reactions */}
        <View style={[styles.msgHeader, isOwn && styles.msgHeaderOwn]}>
          <Text style={[styles.sender, isOwn && styles.senderOwn]}>
            {isOwn ? "You" : displayName}{isLegendarySender ? ' 🌟' : ''}
          </Text>
          <Text style={[styles.time, { color: THEME.textFaint }]}>
            {format(message.sentAt, "HH:mm")}
            {message.status === "sending" && "  ···"}
          </Text>
        </View>

        {/* Reaction pills — OUTSIDE bubble, below name */}
        {(REACTIONS as readonly ReactionEmoji[]).some((e) => e !== "🍌" && (message.reactions[e]?.count ?? 0) > 0) && (
          <View style={[styles.bubbleFooter, isOwn && styles.bubbleFooterOwn]}>
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
                  onLongPress={() => setReactorsFor(emoji)}
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

        {/* Sticker reaction thumbnails — OUTSIDE bubble, below reaction pills */}
        {(message.stickerReactions ?? []).length > 0 && (
          <View style={[styles.stickerReactionRow, isOwn && styles.stickerReactionRowOwn]}>
            {(message.stickerReactions ?? []).map((sr) => (
              <Pressable
                key={sr.url}
                onPress={() => onStickerReact?.(sr.url, message.id)}
                hitSlop={6}
                style={[styles.stickerReactionPill, sr.reactedByMe && styles.stickerReactionPillActive]}
              >
                <Image source={{ uri: sr.url }} style={styles.stickerReactionImg} />
                {sr.count > 1 && (
                  <Text style={styles.stickerReactionCount}>{sr.count}</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

      </View>


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
          {/* Emoji reaction row */}
          <View style={styles.pickerEmojiRow}>
            {(REACTIONS as readonly ReactionEmoji[])
              .filter(e => e !== "🍌")
              .map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => handlePickReaction(emoji)}
                  style={({ pressed }) => [
                    styles.pickerEmojiBtn,
                    pressed && styles.pickerEmojiBtnPressed,
                    message.reactions[emoji]?.reactedByMe && styles.pickerEmojiBtnActive,
                  ]}
                >
                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                  {(message.reactions[emoji]?.count ?? 0) > 0 && (
                    <Text style={styles.pickerEmojiCount}>
                      {message.reactions[emoji]!.count}
                    </Text>
                  )}
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

          {/* Sticker grid */}
          {onStickerReact && (
            <View style={styles.stickerSection}>
              <Text style={styles.stickerSectionLabel}>🐒 Saga Stickers</Text>
              {stickersLoading ? (
                <ActivityIndicator size="small" color={THEME.accent} style={{ marginVertical: 8 }} />
              ) : (
                <View style={styles.stickerGrid}>
                  {stickerItems.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setPickerVisible(false);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onStickerReact(item.displayUrl, message.id);
                      }}
                      style={({ pressed }) => [styles.stickerGridCell, pressed && { opacity: 0.7 }]}
                    >
                      <Image source={{ uri: item.previewUrl }} style={styles.stickerGridImg} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>

    {/* ── Who-Reacted Modal ──────────────────────────────────────────── */}
    <Modal
      visible={!!reactorsFor}
      transparent
      animationType="slide"
      onRequestClose={() => setReactorsFor(null)}
    >
      <Pressable style={styles.pickerOverlay} onPress={() => setReactorsFor(null)}>
        <Pressable style={styles.pickerSheet} onPress={e => e.stopPropagation()}>
          <Text style={styles.reactorTitle}>{reactorsFor}  Reacted</Text>
          {(reactorsFor ? (message.reactions[reactorsFor]?.reactors ?? []) : []).map(inboxId => {
            const p = getCachedProfile(inboxId);
            const name = p?.username ?? shortenAddress(inboxId);
            return (
              <View key={inboxId} style={styles.reactorRow}>
                {p?.nftImage
                  ? <Image source={{ uri: p.nftImage }} style={styles.reactorAvatar} />
                  : <View style={[styles.reactorAvatar, styles.reactorAvatarFallback]} />}
                <Text style={styles.reactorName}>{name}</Text>
              </View>
            );
          })}
          <Pressable
            style={styles.reactorToggleBtn}
            onPress={() => { const e = reactorsFor!; setReactorsFor(null); onReact(e, message.id); }}
          >
            <Text style={styles.reactorToggleBtnText}>
              {reactorsFor && message.reactions[reactorsFor]?.reactedByMe ? 'Remove' : 'Add'} {reactorsFor}
            </Text>
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
    alignSelf: "center",
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
  },
  bubbleGroupOwn: { alignItems: "flex-end" },

  // ── Header row: sender name + timestamp ───────────────────────────────────
  msgHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 4,
    marginTop: 3,
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

  // ── Bot expand text ────────────────────────────────────────────────────────
  expandText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontStyle: "italic",
    color: THEME.accent,
    opacity: 0.75,
    fontWeight: "300",
    alignSelf: "flex-start",
  },

  // ── Media bubble (GIF / photo — no background or padding) ─────────────────
  mediaBubble: {
    // No background, no padding — just the image with rounded corners applied
    // directly on the inner View wrapping each media type.
  },

  // ── Bubble footer (reaction pills — now OUTSIDE bubble) ───────────────────
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
    marginLeft: 4,
  },
  bubbleFooterOwn: {
    justifyContent: "flex-end",
    marginLeft: 0,
    marginRight: 4,
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
    width: 52,
    height: 58,
    borderRadius: 14,
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pickerEmojiBtnPressed: {
    backgroundColor: THEME.accentSoft,
    transform: [{ scale: 1.15 }],
  },
  pickerEmojiBtnActive: {
    backgroundColor: "rgba(255,213,79,0.22)",
    borderColor: "#FFD54F55",
  },
  pickerEmoji: { fontSize: 26 },
  pickerEmojiCount: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
  },
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

  // ── GIF & Sticker in bubble ─────────────────────────────────────────────────
  gifImage: {
    borderRadius: 12,
  },
  watermarkShadow: {
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 128,
    height: 64,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 6,
  },
  watermark: {
    width: 128,
    height: 64,
    opacity: 0.9,
  },
  gifBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  gifBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    letterSpacing: 0.5,
  },
  stickerImage: {
    width: 120,
    height: 120,
  },

  // ── Sticker reaction row (OUTSIDE bubble, below reaction pills) ───────────
  stickerReactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
    marginLeft: 4,
  },
  stickerReactionRowOwn: {
    justifyContent: "flex-end",
    marginLeft: 0,
    marginRight: 4,
  },
  stickerReactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 3,
  },
  stickerReactionPillActive: {
    backgroundColor: "rgba(255,213,79,0.28)",
  },
  stickerReactionImg: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  stickerReactionCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    marginRight: 2,
  },

  // ── Who-Reacted sheet ──────────────────────────────────────────────────────
  reactorTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 15,
    color: THEME.text,
    marginBottom: 8,
  },
  reactorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    alignSelf: "stretch",
  },
  reactorAvatar: { width: 30, height: 30, borderRadius: 15 },
  reactorAvatarFallback: { backgroundColor: THEME.border },
  reactorName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
  },
  reactorToggleBtn: {
    marginTop: 10,
    alignSelf: "stretch",
    backgroundColor: THEME.accentSoft,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.accent + "55",
  },
  reactorToggleBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.accent,
  },

  // ── Sticker picker inside long-press sheet ─────────────────────────────────
  stickerSection: {
    alignSelf: "stretch",
    marginTop: 4,
    gap: 8,
  },
  stickerSectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
  },
  stickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
  },
  stickerGridCell: {
    borderRadius: 10,
    overflow: "hidden",
  },
  stickerGridImg: {
    width: 72,
    height: 72,
  },
});
