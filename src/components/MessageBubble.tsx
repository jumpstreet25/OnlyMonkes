/**
 * MessageBubble — Dark Glassmorphism
 *
 * Layout:
 *   Row: [Avatar(backlit)] [BubbleGroup] [Timestamp]
 *   - Own messages (row-reverse): [Timestamp] [BubbleGroup] [Avatar(backlit)]
 *   - Bot channel: centered bubbles
 *   BubbleGroup:
 *     [SenderName]
 *     ReplyPreview (if any)
 *     Bubble (frosted glass, inner gradient, soft glow)
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
  ScrollView,
  Linking,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, useProfileVersion, getAllTimeUsers } from "@/lib/userProfile";
// nftColor no longer needed — glass bubbles use fixed semi-transparent backgrounds
import { searchStickers, type GiphyItem } from "@/lib/giphy";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { LinkPreviewCard } from "@/components/LinkPreviewCard";
import { BlinkCard } from "@/components/BlinkCard";
import { extractBlinkUrl } from "@/lib/blinkActions";
import { OnlineDot } from "@/components/OnlineDot";
import { isUserOnline } from "@/lib/presence";
import { hasThread, getThreadMeta } from "@/lib/threads";
import { router } from "expo-router";

// ─── Glassmorphism constants ─────────────────────────────────────────────────
const GLASS_BLUE = "#6CB4EE";                    // OnlyMonkes blue
const SOLANA_PURPLE = "#9945FF";                  // Solana brand purple for PFP glow
// Unified bubble style — all bubbles use the same dark glass tint (rugdoctor 12:37 style)
const GLASS_OWN_BG = "rgba(26, 26, 40, 0.65)";    // Same as other — unified look
const GLASS_OTHER_BG = "rgba(26, 26, 40, 0.65)";   // Dark glass tint
const GLASS_BOT_BG = "rgba(26, 26, 40, 0.65)";     // Same for bot channels
const GLASS_BORDER_OWN = "rgba(248, 248, 255, 0.08)";
const GLASS_BORDER_OTHER = "rgba(248, 248, 255, 0.08)";

// Removed FALLBACK_BUBBLE — glass bubbles don't use solid NFT-derived colors

// ─── Live Room Pill ──────────────────────────────────────────────────────────
// Content format: LIVE_PILL:<audio|video>:<hostUsername>:<roomId>

function parseLivePill(content: string): { type: "audio" | "video"; host: string; roomId: string } | null {
  if (!content.startsWith("LIVE_PILL:")) return null;
  const parts = content.split(":");
  if (parts.length < 4) return null;
  return { type: parts[1] as "audio" | "video", host: parts[2], roomId: parts.slice(3).join(":") };
}

function LivePillBubble({ type, host, sentAt }: { type: "audio" | "video"; host: string; sentAt: Date }) {
  const icon = type === "video" ? "📹" : "🎙";
  const label = type === "video" ? "Live Video Chat" : "Live Audio Chat";
  const handleJoin = useCallback(async () => {
    const { myInboxId, username, activeLiveRoom, activeVideoRoom } = useAppStore.getState();
    if (!myInboxId || !username) return;
    try {
      if (type === "video" && activeVideoRoom) {
        const { joinVideoRoom } = require("@/lib/liveVideo");
        const token = await joinVideoRoom(activeVideoRoom.id, myInboxId, username);
        useAppStore.getState().setIsInVideoCall(true);
        router.push(`/video-room?token=${encodeURIComponent(token)}&isHost=0` as any);
      } else if (type === "audio" && activeLiveRoom) {
        const { createLivekitToken } = require("@/lib/livekit");
        const token = await createLivekitToken(activeLiveRoom.id, myInboxId, username);
        useAppStore.getState().setLiveRoomToken(token);
        router.push(`/live-room?token=${encodeURIComponent(token)}&isHost=0` as any);
      }
    } catch (err) {
      console.warn("[LivePill] Join failed:", err);
    }
  }, [type]);

  return (
    <View style={livePillStyles.container}>
      <View style={livePillStyles.pill}>
        <View style={livePillStyles.left}>
          <Text style={livePillStyles.icon}>{icon}</Text>
          <View>
            <Text style={livePillStyles.title}>
              @{host} started a {label}
            </Text>
            <Text style={livePillStyles.time}>{format(sentAt, "h:mm a")}</Text>
          </View>
        </View>
        <Pressable
          onPress={handleJoin}
          style={({ pressed }) => [livePillStyles.joinBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={livePillStyles.joinText}>JOIN</Text>
        </Pressable>
      </View>
    </View>
  );
}

const livePillStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(108, 180, 238, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.25)",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: "100%",
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  icon: {
    fontSize: 22,
  },
  title: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
  },
  time: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    marginTop: 2,
  },
  joinBtn: {
    backgroundColor: "#0096C7",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginLeft: 10,
  },
  joinText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#fff",
    fontWeight: "700",
  },
});

function VideoBubble({ raw, mediaWidth, onPress, onLongPress }: {
  raw: string;
  mediaWidth: number;
  onPress?: (url: string) => void;
  onLongPress?: () => void;
}) {
  const pipeIdx = raw.indexOf('|');
  const videoUrl = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  const thumbUrl = pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : raw;
  return (
    <Pressable
      onPress={() => onPress?.(videoUrl)}
      onLongPress={onLongPress}
      delayLongPress={350}
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
    bottom: 4,
    right: 0,
    width: 120,
    height: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 6,
  },
  watermark: {
    width: 120,
    height: 60,
    opacity: 0.9,
  },
});

const MENTION_COLOR = "#6CB4EE"; // blue hyperlink for @username
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
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onThread?: (message: ChatMessage) => void;
  isBotChannel?: boolean;
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
  onEdit,
  onPin,
  onThread,
  isBotChannel,
}: MessageBubbleProps) {
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const myInboxId = useAppStore(s => s.myInboxId);
  const { width: SCREEN_W } = useWindowDimensions();
  // Max bubble width is 72% of screen minus horizontal padding (14px each side)
  const mediaWidth = Math.round(SCREEN_W * 0.72 - 28);

  // Re-render instantly whenever any profile cache entry changes (PFP updates)
  useProfileVersion();

  // Glass bubbles use semi-transparent backgrounds; text is always light
  const textColor = THEME.text;

  // Dynamic aspect ratio for GIF / IMAGE — computed from actual image dimensions on load
  const [imgAspect, setImgAspect] = useState<number>(3 / 4); // sensible portrait default

  const [botExpanded, setBotExpanded] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [stickerItems, setStickerItems] = useState<GiphyItem[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);

  // Fetch SagaMonkes stickers when picker opens
  useEffect(() => {
    if (!pickerVisible) return;
    let cancelled = false;
    setStickersLoading(true);
    searchStickers("SagaMonkes", 30).then((items) => {
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

  // Determine displayed content (edited or original)
  const displayContent = message.editedContent ?? message.content;

  // Can edit own text messages within 1 minute of sending
  const isMediaContent =
    message.content.startsWith("GIF:") ||
    message.content.startsWith("IMAGE:") ||
    message.content.startsWith("VIDEO:") ||
    message.content.startsWith("STICKER:");
  const canEdit = isOwn && !isMediaContent
    && (Date.now() - message.sentAt.getTime()) < 60_000;

  const handleLongPress = useCallback(() => {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickerVisible(true);
  }, []);

  const handleCopy = useCallback(() => {
    setPickerVisible(false);
    const text = message.editedContent ?? message.content;
    // Strip media prefixes for copy
    const cleaned = text.startsWith("IMAGE:") ? "[Image]"
      : text.startsWith("GIF:") ? "[GIF]"
      : text.startsWith("VIDEO:") ? "[Video]"
      : text.startsWith("STICKER:") ? "[Sticker]"
      : text;
    Clipboard.setStringAsync(cleaned);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [message]);

  const handleEdit = useCallback(() => {
    setPickerVisible(false);
    onEdit?.(message);
  }, [onEdit, message]);

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

  // ── Live Room Pill — early return for LIVE_PILL: messages ──────────────────
  const livePill = parseLivePill(message.content);
  if (livePill) {
    return <LivePillBubble type={livePill.type} host={livePill.host} sentAt={message.sentAt} />;
  }

  // Re-read from cache on every render (re-render triggered by useProfileVersion above)
  const cachedSender = getCachedProfile(message.senderAddress);
  const displayName  = cachedSender?.username ?? message.senderUsername ?? shortenAddress(message.senderAddress);
  const isBot = message.senderUsername === "AI Agent #9385";
  // Show expand control when bot message likely exceeds 9 lines
  const showBotExpand = useMemo(
    () => isBot && (message.content.split("\n").length > 9 || message.content.length > 380),
    [isBot, message.content],
  );
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

  // ── Blink / Solana Action detection ─────────────────────────────────────
  const blinkUrl = useMemo(
    () => (isMedia ? null : extractBlinkUrl(displayContent)),
    [isMedia, displayContent],
  );

  // Center bot messages in bot channels
  const centerBubble = isBotChannel && isBot;

  return (
    <>
    <Animated.View
      style={[
        styles.row,
        isOwn && !centerBubble && styles.rowOwn,
        centerBubble && styles.rowCenter,
        { transform: [{ translateX: swipeAnim }] },
      ]}
      {...panResponder.panHandlers}
    >
      {/* ── PFP — always shown beside bubble/media ────────────────────── */}
      {!centerBubble && (
        <Pressable onPress={handlePressAvatar} hitSlop={6} style={styles.avatarOuter}>
          <View style={styles.avatarHue} />
          <View style={styles.avatarFloat}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            ) : isBot ? (
              <Image source={require('../../assets/ai_agent_avatar.png')} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarImg, styles.avatarFallback]} />
            )}
          </View>
        </Pressable>
      )}

      {/* ── Bubble column ────────────────────────────────────────────── */}
      <View style={[
        styles.bubbleGroup,
        isOwn && !centerBubble && styles.bubbleGroupOwn,
        centerBubble && styles.bubbleGroupCenter,
      ]}>

        {/* Sender name row (outside bubble, above it — for all message types) */}
        {(
          <View style={[
            styles.senderRow,
            isOwn && !centerBubble && styles.senderRowOwn,
            centerBubble && styles.senderRowCenter,
          ]}>
            <Text style={styles.sender}>
              {isOwn ? "You" : displayName}{isLegendarySender ? ' 🌟' : ''}
            </Text>
            {!isOwn && <OnlineDot online={isUserOnline(message.senderAddress)} />}
          </View>
        )}

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

        {/* ── Main glass bubble ─────────────────────────────────────── */}
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={350}
          onPress={showBotExpand ? () => setBotExpanded(e => !e) : undefined}
          style={isMedia ? styles.mediaBubble : undefined}
        >
          {!isMedia ? (
            /* Glow wrapper — shadow radiates BEHIND the bubble, no background */
            <View style={[
              styles.glassGlow,
              isOwn && !centerBubble ? styles.glassGlowOwn : null,
              !isOwn && !centerBubble ? styles.glassGlowOther : null,
              centerBubble && styles.glassGlowBot,
            ]}>
              {/* Actual bubble — background, border, gradient, content */}
              <View style={[
                styles.glassBubble,
                isOwn && !centerBubble ? styles.glassBubbleOwn : null,
                !isOwn && !centerBubble ? styles.glassBubbleOther : null,
                centerBubble && styles.glassBubbleBot,
              ]}>
                {/* Inner gradient overlay — top lighter, bottom darker */}
                <LinearGradient
                  colors={[
                    "rgba(248,248,255,0.08)",
                    "rgba(0,0,0,0.15)",
                  ]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
                />
                {/* Top-edge highlight — "backlit panel" effect */}
                <View style={styles.glassHighlight} />

              {/* Non-media content rendered inside glass bubble */}
              {message.content.startsWith("STICKER:") ? (
                <Image
                  source={{ uri: message.content.slice(8) }}
                  style={styles.stickerImage}
                  resizeMode="contain"
                />
              ) : message.content.startsWith("TIPLINK:") ? (
                (() => {
                  const parts = message.content.slice(8).split("|");
                  const url = parts[0];
                  const amount = parts[1] || "?";
                  const sender = parts[2] || "Monke";
                  return (
                    <Pressable
                      onPress={() => url && Linking.openURL(url).catch(() => {})}
                      onLongPress={handleLongPress}
                      delayLongPress={350}
                      style={styles.tipLinkBubble}
                    >
                      <Text style={styles.tipLinkEmoji}>💸</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tipLinkTitle}>{amount} SOL Tip</Text>
                        <Text style={styles.tipLinkHint}>from {sender} — tap to claim</Text>
                      </View>
                    </Pressable>
                  );
                })()
              ) : message.content.startsWith("ATTACHMENT:") ? (
                (() => {
                  const parts = message.content.slice(11).split("|");
                  const url = parts[0];
                  const filename = parts[1] || "file";
                  return (
                    <Pressable
                      onPress={() => url && Linking.openURL(url).catch(() => {})}
                      onLongPress={handleLongPress}
                      delayLongPress={350}
                      style={styles.attachmentBubble}
                    >
                      <Text style={styles.attachmentIcon}>📎</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.attachmentFilename} numberOfLines={1}>{filename}</Text>
                        <Text style={styles.attachmentHint}>Tap to open</Text>
                      </View>
                    </Pressable>
                  );
                })()
              ) : (
                <View style={{ gap: 4 }}>
                  <Text
                    style={[styles.content, { color: textColor }]}
                    numberOfLines={showBotExpand && !botExpanded ? 9 : undefined}
                    selectable
                  >
                    {renderRichContent(displayContent, handlePressMention)}
                  </Text>
                  {message.editedAt && (
                    <Text style={[styles.editedLabel, { color: textColor }]}>(edited)</Text>
                  )}
                  {showBotExpand && (
                    <Text style={styles.expandText}>
                      {botExpanded ? "collapse" : "expand"}
                    </Text>
                  )}
                </View>
              )}
              </View>
            </View>
          ) : (
            <>
              {/* GIF/IMAGE/VIDEO — rendered without glass bubble */}
              {message.content.startsWith("GIF:") ? (
                <Pressable
                  onPress={() => onPressImage?.(message.content.slice(4))}
                  onLongPress={handleLongPress}
                  delayLongPress={350}
                  style={{ width: mediaWidth, borderRadius: 22, overflow: "hidden" }}
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
                  <View style={styles.watermarkShadow}>
                    <Image
                      source={require("../../assets/watermark.png")}
                      style={styles.watermark}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={styles.gifBadge}>
                    <Text style={styles.gifBadgeText}>GIF</Text>
                  </View>
                </Pressable>
              ) : message.content.startsWith("IMAGE:") ? (
                <Pressable
                  onPress={() => onPressImage?.(message.content.slice(6))}
                  onLongPress={handleLongPress}
                  delayLongPress={350}
                  style={{ width: mediaWidth, borderRadius: 22, overflow: "hidden" }}
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
                  onLongPress={handleLongPress}
                />
              ) : null}
            </>
          )}
        </Pressable>

        {/* Blink / Solana Action card */}
        {!isMedia && blinkUrl && (
          <BlinkCard actionUrl={blinkUrl} />
        )}

        {/* Link preview card (skip when Blink card is shown) */}
        {!isMedia && !blinkUrl && !isBot && (
          <LinkPreviewCard content={message.editedContent ?? message.content} />
        )}

      </View>

      {/* ── Timestamp outside bubble ─────────────────────────────────── */}
      {(
        <View style={[
          styles.timestampOuter,
          centerBubble && styles.timestampOuterCenter,
        ]}>
          <Text style={styles.timeOutside}>
            {format(message.sentAt, "HH:mm")}
            {message.status === "sending" && " ···"}
            {message.status === "pending" && " 🕐"}
            {message.status === "failed" && " ⚠️"}
            {message.status === "sent" && isOwn && " ✓"}
            {message.status === "read" && isOwn && (
              <Text style={{ color: GLASS_BLUE }}> ✓✓</Text>
            )}
          </Text>
        </View>
      )}

    </Animated.View>

    {/* ── Reactions + extras: rendered OUTSIDE the row so PFP stays
         pinned to the bottom of the message bubble, not the reactions ── */}
    {hasThread(message.id) && (
      <View style={[styles.extrasRow, isOwn && !centerBubble && styles.extrasRowOwn]}>
        <Pressable
          style={styles.threadPill}
          onPress={() => onThread?.(message)}
        >
          <Text style={styles.threadPillText}>
            💬 {getThreadMeta(message.id)?.replyCount ?? 0} replies
          </Text>
        </Pressable>
      </View>
    )}

    {(message.stickerReactions ?? []).length > 0 && (
      <View style={[styles.extrasRow, isOwn && !centerBubble && styles.extrasRowOwn]}>
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
      </View>
    )}

    {/* ── Reaction picker Modal ──────────────────────────────────────── */}
    <Modal
      visible={pickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPickerVisible(false)}
    >
      <Pressable style={styles.pickerOverlay} onPress={() => setPickerVisible(false)}>
        <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.pickerActionRow}>
            <Pressable
              onPress={handlePickReply}
              style={({ pressed }) => [
                styles.pickerReplyBtn,
                pressed && styles.pickerReplyBtnPressed,
              ]}
            >
              <Text style={styles.pickerReplyText}>↩  Reply</Text>
            </Pressable>

            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [
                styles.pickerReplyBtn,
                pressed && styles.pickerReplyBtnPressed,
              ]}
            >
              <Text style={styles.pickerReplyText}>📋  Copy</Text>
            </Pressable>

            {canEdit && onEdit && (
              <Pressable
                onPress={handleEdit}
                style={({ pressed }) => [
                  styles.pickerReplyBtn,
                  pressed && styles.pickerReplyBtnPressed,
                ]}
              >
                <Text style={styles.pickerReplyText}>✏️  Edit</Text>
              </Pressable>
            )}

            {onPin && (
              <Pressable
                onPress={() => { setPickerVisible(false); onPin(message); }}
                style={({ pressed }) => [
                  styles.pickerReplyBtn,
                  pressed && styles.pickerReplyBtnPressed,
                ]}
              >
                <Text style={styles.pickerReplyText}>📌  Pin</Text>
              </Pressable>
            )}

            {onThread && (
              <Pressable
                onPress={() => { setPickerVisible(false); onThread(message); }}
                style={({ pressed }) => [
                  styles.pickerReplyBtn,
                  pressed && styles.pickerReplyBtnPressed,
                ]}
              >
                <Text style={styles.pickerReplyText}>🧵  Thread</Text>
              </Pressable>
            )}
          </View>

          {/* SagaMonkes sticker grid */}
          {onStickerReact && (
            <View style={styles.stickerSection}>
              {stickersLoading ? (
                <ActivityIndicator size="small" color={THEME.accent} style={{ marginVertical: 8 }} />
              ) : (
                <ScrollView style={styles.stickerScroll} showsVerticalScrollIndicator={false}>
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
                </ScrollView>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>

</>
  );
});

const styles = StyleSheet.create({
  // ── Row layout ─────────────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginVertical: 2,
    paddingHorizontal: 8,
    gap: 6,
  },
  rowOwn: {
    flexDirection: "row-reverse",
  },
  rowCenter: {
    justifyContent: "center",
  },

  // ── Avatar: diffused purple hue (from shadow) + floating PFP ───────────────
  avatarOuter: {
    alignSelf: "flex-end",
    marginBottom: 2,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  // Layer 1: NO solid shape — just a large diffused purple shadow blob on the chat layer
  avatarHue: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    // No backgroundColor, no border — purely a shadow diffusion
    shadowColor: SOLANA_PURPLE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 0,
  },
  // Layer 2: PFP image floating above with its own downward shadow for depth
  avatarFloat: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  avatarImg: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarOuterSmall: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHueSmall: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    shadowColor: SOLANA_PURPLE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 0,
  },
  avatarFloatSmall: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  avatarImgSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  avatarFallback: {
    backgroundColor: "transparent",
  },

  // ── Extras row (reactions, threads) — outside main row so PFP stays fixed ─
  extrasRow: {
    paddingLeft: 54, // avatar width (40) + gap (6) + padding (8)
    paddingRight: 8,
    marginTop: -1,
  },
  extrasRowOwn: {
    paddingLeft: 8,
    paddingRight: 54,
    alignItems: "flex-end",
  },

  // ── Bubble group ───────────────────────────────────────────────────────────
  bubbleGroup: {
    maxWidth: "78%",
    gap: 3,
    alignItems: "flex-start",
  },
  bubbleGroupOwn: {
    alignItems: "flex-end",
  },
  bubbleGroupCenter: {
    alignItems: "center",
    maxWidth: "85%",
  },

  // ── Sender name row (above bubble) ─────────────────────────────────────────
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 6,
    marginBottom: 1,
  },
  senderRowOwn: {
    flexDirection: "row-reverse",
    marginLeft: 0,
    marginRight: 6,
  },
  senderRowCenter: {
    justifyContent: "center",
    marginLeft: 0,
  },
  sender: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: GLASS_BLUE,
    textShadowColor: "rgba(108, 180, 238, 0.4)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },

  // ── Timestamp (outside bubble) ─────────────────────────────────────────────
  timestampOuter: {
    justifyContent: "flex-end",
    paddingBottom: 4,
    minWidth: 36,
  },
  timestampOuterCenter: {
    position: "absolute",
    right: 8,
    bottom: 4,
  },
  timeOutside: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
    letterSpacing: 0.3,
  },

  // ── Media header ───────────────────────────────────────────────────────────
  // Media footer — PFP beside media at bottom edge
  mediaFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -14,
    marginLeft: 4,
  },
  mediaFooterOwn: {
    flexDirection: "row-reverse",
    marginLeft: 0,
    marginRight: 4,
  },
  mediaFooterText: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  // Legacy msgHeader (kept for non-media usage)
  msgHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 4,
    marginTop: 4,
  },
  msgHeaderOwn: {
    flexDirection: "row-reverse",
    marginLeft: 0,
    marginRight: 4,
  },

  // ── Reply preview ──────────────────────────────────────────────────────────
  replyPreview: {
    flexDirection: "row",
    backgroundColor: "rgba(26, 26, 40, 0.6)",
    borderRadius: 16,
    overflow: "hidden",
    maxWidth: "100%",
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "rgba(248, 248, 255, 0.05)",
  },
  replyPreviewOwn: {},
  replyBar: { width: 3, backgroundColor: GLASS_BLUE },
  replyBarOwn: { backgroundColor: "rgba(108, 180, 238, 0.5)" },
  replyContent: { padding: 8, gap: 2, flex: 1 },
  replySender: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: GLASS_BLUE,
  },
  replySenderOwn: { color: "rgba(108, 180, 238, 0.7)" },
  replyText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },

  // ── Glow wrapper — subtle uniform glow behind all bubbles ──────────────────
  // iOS: shadowColor produces colored glow. Android: elevation only does grey
  // shadows, so we skip elevation and rely on the border + background tint instead.
  glassGlow: {
    borderRadius: 22,
    // iOS colored glow
    shadowColor: GLASS_BLUE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    // No elevation — Android elevation renders grey shadow ON TOP of content
  },
  glassGlowOwn: {
    // unified — same as base
  },
  glassGlowOther: {
    // unified — same as base
  },
  glassGlowBot: {
    // unified — same as base
  },

  // ── Glass Bubble — the actual visible bubble with background + content ────
  glassBubble: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
    overflow: "hidden",
  },
  glassBubbleOwn: {
    backgroundColor: GLASS_OWN_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER_OWN,
  },
  glassBubbleOther: {
    backgroundColor: GLASS_OTHER_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER_OTHER,
  },
  glassBubbleBot: {
    backgroundColor: GLASS_BOT_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER_OTHER,
  },

  // Top-edge highlight (backlit panel effect)
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 1,
  },

  content: {
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 22,
  },

  editedLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    opacity: 0.5,
    fontStyle: "italic",
  },

  // ── Bot expand text ────────────────────────────────────────────────────────
  expandText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontStyle: "italic",
    color: GLASS_BLUE,
    opacity: 0.75,
    fontWeight: "300",
    alignSelf: "flex-start",
  },

  // ── Media bubble (GIF / photo — no background or padding) ─────────────────
  mediaBubble: {},

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

  // ── Reaction pills ─────────────────────────────────────────────────────────
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  reactionPillActive: {
    backgroundColor: "rgba(255,213,79,0.2)",
    borderColor: "rgba(255,213,79,0.15)",
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
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    alignItems: "center",
  },
  pickerSheet: {
    backgroundColor: "rgba(18, 18, 26, 0.95)",
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.15)",
    minWidth: 280,
    maxHeight: "75%",
    // Glass glow on picker sheet
    shadowColor: GLASS_BLUE,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  pickerEmojiRow: {
    flexDirection: "row",
    gap: 8,
  },
  pickerEmojiBtn: {
    width: 52,
    height: 58,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  pickerEmojiBtnPressed: {
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    transform: [{ scale: 1.15 }],
  },
  pickerEmojiBtnActive: {
    backgroundColor: "rgba(255,213,79,0.18)",
    borderColor: "rgba(255,213,79,0.2)",
  },
  pickerEmoji: { fontSize: 26 },
  pickerEmojiCount: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
  },
  pickerActionRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  pickerReplyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  pickerReplyBtnPressed: {
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    borderColor: "rgba(108, 180, 238, 0.3)",
  },
  pickerReplyText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: THEME.text,
  },

  // ── GIF & Sticker in bubble ─────────────────────────────────────────────────
  gifImage: {
    borderRadius: 22,
  },
  watermarkShadow: {
    position: "absolute",
    bottom: 4,
    right: 0,
    width: 120,
    height: 60,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 6,
  },
  watermark: {
    width: 120,
    height: 60,
    opacity: 0.9,
  },
  gifBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
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

  // ── TipLink bubble ─────────────────────────────────────────────────────
  tipLinkBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(26, 58, 26, 0.7)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.2)",
  },
  tipLinkEmoji: {
    fontSize: 32,
  },
  tipLinkTitle: {
    color: "#4ade80",
    fontFamily: FONTS.displayMed,
    fontSize: 16,
    fontWeight: "700" as const,
  },
  tipLinkHint: {
    color: "#86efac",
    fontSize: 12,
    marginTop: 2,
  },

  // ── Attachment bubble ──────────────────────────────────────────────────
  attachmentBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  attachmentIcon: {
    fontSize: 28,
  },
  attachmentFilename: {
    color: THEME.text,
    fontFamily: FONTS.displayMed,
    fontSize: 14,
  },
  attachmentHint: {
    color: THEME.textDim ?? "#888",
    fontSize: 11,
    marginTop: 2,
  },

  // ── Thread pill ─────────────────────────────────────────────────────────
  threadPill: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(0, 150, 199, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 150, 199, 0.15)",
    alignSelf: "flex-start",
  },
  threadPillText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#0096C7",
    fontWeight: "600",
  },

  // ── Sticker reaction row (OUTSIDE bubble) ──────────────────────────────────
  stickerReactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: -6,
    marginLeft: 8,
  },
  stickerReactionRowOwn: {
    justifyContent: "flex-end",
    marginLeft: 0,
    marginRight: 8,
  },
  stickerReactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "transparent",
    borderRadius: 12,
    padding: 3,
  },
  stickerReactionPillActive: {
    backgroundColor: "transparent",
  },
  stickerReactionImg: {
    width: 32,
    height: 32,
    borderRadius: 6,
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
    backgroundColor: "rgba(108, 180, 238, 0.1)",
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.2)",
  },
  reactorToggleBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: GLASS_BLUE,
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
  stickerScroll: {
    maxHeight: 320,
    alignSelf: "stretch",
  },
  stickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    paddingBottom: 8,
  },
  stickerGridCell: {
    borderRadius: 12,
    overflow: "hidden",
  },
  stickerGridImg: {
    width: 72,
    height: 72,
  },
});
