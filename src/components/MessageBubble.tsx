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
  PanResponder,
  Animated,
  ActivityIndicator,
  Keyboard,
  Linking,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SkiaGlowBubble, SkiaGlassFront, SkiaGlowPfp } from "@/components/SkiaGlowBubble";
import { CyberpunkGlitchBubble } from "@/components/CyberpunkGlitchBubble";
import { BananaGroveSignBubble } from "@/components/BananaGroveSignBubble";
import { TechNoirBubble } from "@/components/TechNoirBubble";
import { DeepSpaceBubble } from "@/components/DeepSpaceBubble";
import { BotAlertCard, parseTopSalesAlert } from "@/components/BotAlertCard";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
  Easing as REasing,
} from "react-native-reanimated";
import { getOrExtractNftColor } from "@/lib/nftColor";
import { setLatestBubbleHeight } from "@/lib/chatViewport";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, useProfileVersion, getDeduplicatedUsers, getPrimaryInboxId } from "@/lib/userProfile";
import { getEarnedBadges, getBadgeDef } from "@/lib/badges";
import { BadgeGlyph } from "./BadgeGlyph";
import { getFlairSync } from "@/lib/monkeClout";
// nftColor no longer needed — glass bubbles use fixed semi-transparent backgrounds
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { LinkPreviewCard } from "@/components/LinkPreviewCard";
import { BlinkCard } from "@/components/BlinkCard";
import { extractBlinkUrl } from "@/lib/blinkActions";
import { OnlineDot } from "@/components/OnlineDot";
import { isUserOnline } from "@/lib/presence";
import MarkdownContent from "@/components/MarkdownContent";

// ─── Pulse Frame — animated ring for Tier 3 PFP shop item ─────────────────
function PulseRing({ color }: { color: string }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.8, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.15, duration: 1200, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{
        position: "absolute",
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 2,
        borderColor: color,
        opacity: pulseAnim,
        transform: [{ scale: scaleAnim }],
      }}
      pointerEvents="none"
    />
  );
}
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

// ─── BananaBet Pill ───────────────────────────────────────────────────────────
// Content format: BANANA_BET_PILL:<json {id,category,question,resolvesAt}>

function parseBananaBetPill(content: string): { id: string; category: string; question: string; resolvesAt: number } | null {
  if (!content.startsWith("BANANA_BET_PILL:")) return null;
  try {
    return JSON.parse(content.slice("BANANA_BET_PILL:".length));
  } catch {
    return null;
  }
}

function parseBananaBetSettledPill(content: string): { betId: string; question: string; outcome: string; totalBets: number; totalBananasWon: number } | null {
  if (!content.startsWith("BANANA_BET_SETTLED_PILL:")) return null;
  try {
    return JSON.parse(content.slice("BANANA_BET_SETTLED_PILL:".length));
  } catch {
    return null;
  }
}

const BET_AMOUNT_CHIPS = [10, 25, 50, 100];
const BET_CATEGORY_EMOJI: Record<string, string> = { crypto: "📈", nft: "🖼️", sports: "🏆", news: "📰" };

function BananaBetPillBubble({ id, category, question, resolvesAt }: { id: string; category: string; question: string; resolvesAt: number }) {
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const hiddenBananaBetIds = useAppStore(s => s.hiddenBananaBetIds);
  const hideBananaBet = useAppStore(s => s.hideBananaBet);
  const [amount, setAmount] = useState(25);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placedSide, setPlacedSide] = useState<"yes" | "no" | null>(null);
  const expired = Date.now() > resolvesAt;
  const insufficientFunds = amount > bananaBalance;
  const hidden = hiddenBananaBetIds.includes(id);

  if (hidden) return null;

  const handleCustomChange = useCallback((text: string) => {
    const digits = text.replace(/[^0-9]/g, "");
    setCustomText(digits);
    const n = parseInt(digits, 10);
    if (n > 0) setAmount(n);
  }, []);

  const handlePlace = useCallback(async (side: "yes" | "no") => {
    if (submitting || placedSide || expired || amount <= 0 || amount > bananaBalance) return;
    setSubmitting(true);
    try {
      const { placeBananaBet } = await import("@/lib/bananaBet");
      const { toast } = await import("sonner-native");
      await placeBananaBet(id, side, amount);
      // 2026-07-16: setPlacedSide shrinks the bubble (wager UI → one-line
      // "you bet" text), which on the LAST card triggers ChatMessageList's
      // near-bottom auto-scrollTo in the same tick as the toast mounting —
      // same grey-screen bug class as BananaBetPopup.handlePlace. Let the
      // layout/scroll settle first, then toast.
      setPlacedSide(side);
      setTimeout(() => toast.success(`🍌 Bet placed: ${amount} bananas on ${side.toUpperCase()}`), 350);
    } catch (err: any) {
      const { toast } = await import("sonner-native");
      toast.error(err?.message ?? "Bet failed — try again");
    } finally {
      setSubmitting(false);
    }
  }, [id, amount, submitting, placedSide, expired, bananaBalance]);

  return (
    <View style={bananaBetStyles.container}>
      <View style={bananaBetStyles.card}>
        <View style={bananaBetStyles.headerRow}>
          <Text style={bananaBetStyles.badge}>🍌 BANANABETS</Text>
          <Pressable
            hitSlop={8}
            onPress={() => hideBananaBet(id)}
            style={bananaBetStyles.dismissBtn}
            accessibilityLabel="Not interested — clear this bet"
          >
            <Text style={bananaBetStyles.dismissText}>✕</Text>
          </Pressable>
        </View>
        <Text style={bananaBetStyles.tagline}>Real bananas from your stash — no real-world money, ever.</Text>
        <Text style={bananaBetStyles.question}>
          {BET_CATEGORY_EMOJI[category] ?? "🍌"} {question}
        </Text>

        {placedSide ? (
          <Text style={bananaBetStyles.placedText}>
            ✅ You bet {amount} bananas on {placedSide.toUpperCase()}
          </Text>
        ) : expired ? (
          <Text style={bananaBetStyles.placedText}>⏳ Betting closed</Text>
        ) : (
          <>
            <Text style={bananaBetStyles.wagerLabel}>Wager (🍌 bananas) — you have {bananaBalance} 🍌</Text>
            <View style={bananaBetStyles.chipRow}>
              {BET_AMOUNT_CHIPS.map((c) => {
                const affordable = c <= bananaBalance;
                return (
                  <Pressable
                    key={c}
                    disabled={!affordable}
                    onPress={() => { setCustomMode(false); setAmount(c); }}
                    style={[bananaBetStyles.chip, !customMode && amount === c && bananaBetStyles.chipActive, !affordable && { opacity: 0.35 }]}
                  >
                    <Text style={[bananaBetStyles.chipText, !customMode && amount === c && bananaBetStyles.chipTextActive]}>🍌 {c}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                disabled={bananaBalance <= 0}
                onPress={() => setCustomMode(true)}
                style={[bananaBetStyles.chip, customMode && bananaBetStyles.chipActive, bananaBalance <= 0 && { opacity: 0.35 }]}
              >
                <Text style={[bananaBetStyles.chipText, customMode && bananaBetStyles.chipTextActive]}>Custom</Text>
              </Pressable>
            </View>
            {customMode && (
              <TextInput
                value={customText}
                onChangeText={handleCustomChange}
                placeholder="Enter amount"
                placeholderTextColor={THEME.textFaint}
                keyboardType="number-pad"
                style={bananaBetStyles.customInput}
                autoFocus
              />
            )}
            {insufficientFunds && (
              <Text style={bananaBetStyles.insufficientText}>Not enough bananas for that wager</Text>
            )}
            <View style={bananaBetStyles.sideRow}>
              <Pressable
                disabled={submitting || amount <= 0 || insufficientFunds}
                onPress={() => handlePlace("yes")}
                style={[bananaBetStyles.sideBtn, bananaBetStyles.yesBtn, (submitting || amount <= 0 || insufficientFunds) && { opacity: 0.6 }]}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={bananaBetStyles.sideText}>YES</Text>}
              </Pressable>
              <Pressable
                disabled={submitting || amount <= 0 || insufficientFunds}
                onPress={() => handlePlace("no")}
                style={[bananaBetStyles.sideBtn, bananaBetStyles.noBtn, (submitting || amount <= 0 || insufficientFunds) && { opacity: 0.6 }]}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={bananaBetStyles.sideText}>NO</Text>}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function BananaBetSettledPillBubble({ question, outcome, totalBets, totalBananasWon }: { question: string; outcome: string; totalBets: number; totalBananasWon: number }) {
  return (
    <View style={bananaBetStyles.container}>
      <View style={bananaBetStyles.card}>
        <Text style={bananaBetStyles.badge}>🍌 BANANABETS — SETTLED</Text>
        <Text style={bananaBetStyles.question}>{question}</Text>
        <Text style={bananaBetStyles.placedText}>
          Outcome: {outcome.toUpperCase()} · {totalBets} bet{totalBets === 1 ? "" : "s"} placed · {totalBananasWon} 🍌 won total
        </Text>
      </View>
    </View>
  );
}

const bananaBetStyles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: 6, paddingHorizontal: 16 },
  card: {
    backgroundColor: "rgba(255, 204, 0, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.28)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: "100%",
    gap: 10,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { fontFamily: FONTS.displayMed, fontSize: 11, color: "#FFCC00", letterSpacing: 0.5 },
  dismissBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  dismissText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textFaint },
  tagline: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textFaint, lineHeight: 15 },
  question: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text, lineHeight: 19 },
  placedText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
  insufficientText: { fontFamily: FONTS.bodyMed, fontSize: 12, color: "#E67E22" },
  wagerLabel: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textFaint },
  customInput: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.4)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  chipActive: { backgroundColor: "rgba(255, 204, 0, 0.25)", borderColor: "rgba(255, 204, 0, 0.6)" },
  chipText: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.textMuted },
  chipTextActive: { color: "#FFCC00", fontWeight: "700" },
  sideRow: { flexDirection: "row", gap: 10 },
  sideBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  yesBtn: { backgroundColor: "#2E9E5B" },
  noBtn: { backgroundColor: "#C0392B" },
  sideText: { fontFamily: FONTS.displayMed, fontSize: 14, color: "#fff", fontWeight: "700" },
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
        transition={200}
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

/** Render text with @mention (blue, tappable) and $TOKEN (gold, tappable) highlighting. */
function renderRichContent(
  content: string,
  onPressMention?: (username: string) => void,
  onPressToken?: (symbol: string) => void,
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
        <Text
          key={i}
          style={{ color: TOKEN_COLOR }}
          onPress={() => onPressToken?.(part.slice(1))}
        >
          {part}
        </Text>
      );
    }
    return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;
  });
}

// ── Cyberpunk glitch bubble accent helpers ────────────────────────────────
// Bot's cyberpunk-world glitch bubble color — dark neon pink matching the
// bot's hair. Distinct from BOT_THEME_COLOR (#00C9A7 teal) which still
// drives the bot's identity in non-cyberpunk contexts.
const BOT_GLITCH_COLOR = "#FF1493";

// Curated neon palette for stable per-user fallback colors before the
// async PFP-color extraction completes. Hashed off inboxId so each user
// always lands on the same vibrant color. Once getOrExtractNftColor()
// resolves, the bubble updates to the actual PFP-derived color.
const NEON_FALLBACK_PALETTE = [
  "#FF3DFF", "#00D4FF", "#14F195", "#FFE066",
  "#9945FF", "#FF6B6B", "#7DFF6B", "#FF8FAB",
  "#FFB000", "#3DFFB0", "#FF3D8F", "#3D8FFF",
];
function stableNeonFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return NEON_FALLBACK_PALETTE[Math.abs(h) % NEON_FALLBACK_PALETTE.length];
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onReact: (emoji: ReactionEmoji, messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  /** Opens the lifted MessageActionSheet (react/reply/copy/edit/delete/pin/
   * thread) for this message — rendered once at the screen level, not per
   * bubble. See MessageActionSheet.tsx for why. */
  onOpenActions: (message: ChatMessage) => void;
  onPressUser?: (target: ProfileTarget) => void;
  onTip?: (message: ChatMessage) => void;
  onStickerReact?: (url: string, messageId: string) => void;
  onPressImage?: (url: string) => void;
  onPressVideo?: (url: string) => void;
  onTokenPress?: (symbol: string) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onThread?: (message: ChatMessage) => void;
  isGroupAdmin?: boolean;
  isBotChannel?: boolean;
  /** True for the bottommost (newest) bubble in main chat. Triggers an
   * onLayout pulse to chatViewport.latestBubbleHeightSV so background world
   * layers (Banana Grove pile) can size + reset against this bubble. */
  isLatest?: boolean;
  /** True when the message just arrived (not part of the initial history
   * load). Drives the float-in entry animation. Set by ChatMessageList
   * via the initialMsgIdsRef pre-seeded after history loads. */
  isNew?: boolean;
}

/** Custom comparator — only re-render when message content actually changed */
function arePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  // Fast path: if the message object reference changed, always re-render
  if (prev.message !== next.message) return false;
  if (prev.isOwn !== next.isOwn) return false;
  if (prev.isBotChannel !== next.isBotChannel) return false;
  if (prev.isLatest !== next.isLatest) return false;
  if (prev.isNew !== next.isNew) return false;
  // onPin presence changes when admin status toggles
  if (!!prev.onPin !== !!next.onPin) return false;
  if (prev.isGroupAdmin !== next.isGroupAdmin) return false;
  return true;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReact,
  onReply,
  onOpenActions,
  onPressUser,
  onTip,
  onStickerReact,
  onPressImage,
  onPressVideo,
  onTokenPress,
  onEdit,
  onDelete,
  onPin,
  onThread,
  isGroupAdmin,
  isBotChannel,
  isLatest,
  isNew,
}: MessageBubbleProps) {
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const myInboxId = useAppStore(s => s.myInboxId);
  const myShopStyles = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  // Use own shop styles for own messages, sender's cached styles for others
  // Use primary inbox ID to merge multi-device users (same wallet, different inbox IDs)
  const senderPrimaryInbox = !isOwn ? getPrimaryInboxId(message.senderAddress) : null;
  const senderProfile = senderPrimaryInbox ? getCachedProfile(senderPrimaryInbox) : null;
  const shopStyles = isOwn ? myShopStyles : (senderProfile?.shopStyles ?? {});
  const { width: SCREEN_W } = useWindowDimensions();
  const [bubbleSize, setBubbleSize] = useState<{ w: number; h: number } | null>(null);
  // World bubble skin: viewer wins, sender is fallback (per
  // `feedback_world_bubble_ownership`). If the viewer owns a world, every
  // bubble is themed in the viewer's world — owners get a clean, uniform
  // immersive view. If the viewer owns no world, fall back to the sender's
  // world theme — non-owners see themed bubbles from owners as a "show off"
  // / sales pitch. Non-owner ↔ non-owner = default. Bot has no world
  // purchase, so it falls through to viewer's world automatically.
  const effectiveWorld = (myShopStyles?.worldId as string | undefined)
    ?? (shopStyles.worldId as string | undefined);
  const useGlitchBubble      = effectiveWorld === "world_solana_cyberpunk";
  const useBananaGroveBubble = effectiveWorld === "world_banana_grove";
  const useTechNoirBubble    = effectiveWorld === "world_tech_noir";
  const useDeepSpaceBubble   = effectiveWorld === "world_deep_space";
  const hasWorldChrome = useGlitchBubble || useBananaGroveBubble || useTechNoirBubble || useDeepSpaceBubble;
  const hasSkiaGlow =
    !!(shopStyles.hasBubbleCosmetic && shopStyles.glowColor) && !hasWorldChrome;

  // ── Float-in entry + latest-bubble hover bob (Cyberpunk world only) ──
  // floatY drives the bubble column's translateY:
  //   - On mount of a NEW message (post history-load arrival): animates
  //     from +12 to 0 over 400ms — the "drift up + settle" entry.
  //   - When isLatest && useGlitchBubble (the newest bubble in a chat
  //     where the world bubble skin is active): continuous ±2.5px bob
  //     on a 3.5s loop after the entry settles. Stops + returns to 0
  //     when the bubble is no longer the latest.
  // floatOpacity pairs with the entry slide for a subtle fade-in.
  // 2026-05-23 DISABLED entry animation. Reanimated 3.19 (bumped from 3.17
  // in v2.38 APK) appears to leave cells stuck with opacity=0 when FlashList
  // v2 recycles them mid-animation — user reported chat going 80% blank
  // permanently after a few scroll cycles, specifically on v2.38 and not
  // v2.37. Cells start at full opacity, no entry animation. We lose the
  // float-in visual polish; we gain stability. Restore as a single
  // commented unit once Reanimated has a v3.20+ fix or we swap recycler.
  const floatY = useSharedValue(0);
  const floatOpacity = useSharedValue(1);

  // Aggressively cancel any in-flight float animation on every render so a
  // stuck-mid-animation shared value can never strand a recycled cell at
  // opacity=0. Cheap no-op when there's no active animation.
  useEffect(() => {
    cancelAnimation(floatOpacity);
    cancelAnimation(floatY);
    floatOpacity.value = 1;
    floatY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  useEffect(() => {
    // Only the latest bubble bobs, and only inside a Cyberpunk-world chat.
    // No `else` branch here — the entry animation in the other effect
    // owns the floatY value when isNew. Adding an else with cancelAnimation
    // would kill non-Cyberpunk entries (Banana Grove drop+bounce, default
    // float-in) the moment they start. The cleanup function handles the
    // case where this bubble stops being the latest (newer message
    // arrived) — that's when we want to cancel the bob and settle to 0.
    if (isLatest && useGlitchBubble) {
      const startBob = () => {
        floatY.value = withRepeat(
          withSequence(
            withTiming(-2.5, { duration: 1750, easing: REasing.inOut(REasing.sin) }),
            withTiming(2.5, { duration: 1750, easing: REasing.inOut(REasing.sin) }),
          ),
          -1,
          true,
        );
      };
      // If isNew, give the entry animation room before bobbing kicks in.
      const t = setTimeout(startBob, isNew ? 460 : 10);
      return () => {
        clearTimeout(t);
        cancelAnimation(floatY);
        floatY.value = withTiming(0, { duration: 200 });
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLatest, useGlitchBubble]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
    opacity: floatOpacity.value,
  }));
  // Max bubble width is 72% of screen minus horizontal padding (14px each side)
  const mediaWidth = Math.round(SCREEN_W * 0.72 - 28);

  // NOTE: removed global useProfileVersion() — it re-rendered ALL visible bubbles
  // when ANY user's PFP changed. Profile data is now read via getCachedProfile()
  // which updates on the next natural re-render (message arrival, scroll, etc.).

  // Glass bubbles use semi-transparent backgrounds; text is always light
  const textColor = (shopStyles.customTextColor && shopStyles.customTextColorValue)
    ? shopStyles.customTextColorValue as string
    : THEME.text;

  // Dynamic aspect ratio for GIF / IMAGE — computed from actual image dimensions on load
  const [imgAspect, setImgAspect] = useState<number>(3 / 4); // sensible portrait default

  const [botExpanded, setBotExpanded] = useState(false);

  // Look up @mentioned username → open their profile
  const handlePressMention = useCallback((mentionedUsername: string) => {
    if (!onPressUser) return;
    // Sanitize: strip non-printable Unicode, normalize for comparison
    const sanitized = mentionedUsername.replace(/[^\w\s.-]/g, "").trim();
    if (!sanitized) return;
    const allUsers = getDeduplicatedUsers();
    let foundInboxId: string | null = null;
    for (const [inboxId, uname] of allUsers.entries()) {
      if (uname.toLowerCase() === sanitized.toLowerCase()) {
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

  const handleLongPress = useCallback(() => {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onOpenActions(message);
  }, [onOpenActions, message]);

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

  // Re-read from cache on every render — use primary inbox ID to merge multi-device users
  const primarySenderInbox = isOwn ? message.senderAddress : getPrimaryInboxId(message.senderAddress);
  const cachedSender = getCachedProfile(primarySenderInbox);
  const displayName  = cachedSender?.username ?? message.senderUsername ?? 'Monke';
  const isBot = message.senderUsername === "AI Agent #9385";
  // Bot PFP theme — teal from the bot's pixel art visor/eyes
  const BOT_THEME_COLOR = "#00C9A7";
  // Glitch bubble accent — sender's PFP dominant color so each user wears
  // their own color around their bubbles. Bot uses fixed teal. Falls back
  // to a stable per-inboxId hashed neon while the async PFP extraction
  // resolves, so bubbles never flash a default color.
  const accentFallback = useMemo(
    () => (isBot ? BOT_GLITCH_COLOR : stableNeonFromString(primarySenderInbox || "monke")),
    [isBot, primarySenderInbox],
  );
  const [glitchAccent, setGlitchAccent] = useState<string>(() => {
    if (isBot) return BOT_GLITCH_COLOR;
    if (isOwn && nftDominantColor) return nftDominantColor;
    return accentFallback;
  });
  // Show expand control when bot message likely exceeds 9 lines
  const showBotExpand = useMemo(
    () => isBot && (message.content.split("\n").length > 9 || message.content.length > 380),
    [isBot, message.content],
  );
  const isLegendarySender = isOwn
    ? useAppStore.getState().isLegendary
    : !!(cachedSender?.legendary);

  // (v41 2026-05-09) Keep badge emojis as an array — splitting a joined
  // string by codepoint is unreliable for multi-codepoint emojis like ✉️.
  // BadgeGlyph maps each entry to a Skia glyph (or falls through to Text
  // for any emoji without a Skia counterpart yet).
  const badgeEmojiArray = useMemo(() => {
    const earned = isOwn
      ? getEarnedBadges()
      : (cachedSender?.badges ?? []);
    if (earned.length === 0) return [] as string[];
    // Show up to 3 most recent badge emojis after the name
    const defs = earned.slice(-3).map(id => getBadgeDef(id)).filter(Boolean);
    return defs.map(d => d!.emoji);
  }, [isOwn, cachedSender?.badges]);

  // Alpha Ape flair from CloutScore (top 3)
  const cloutFlair = useMemo(() => getFlairSync(primarySenderInbox), [primarySenderInbox]);

  // Active emoji reactions (count > 0)
  const activeReactions = useMemo(() => {
    return Object.values(message.reactions).filter(r => r && r.count > 0);
  }, [message.reactions]);

  // ── Avatar ────────────────────────────────────────────────────────────────
  // Own: use live verifiedNft. Others: always prefer fresh profile cache.
  const avatarUri = isOwn
    ? (verifiedNft?.image ?? null)
    : (cachedSender?.nftImage ?? message.senderNft?.image ?? null);

  // ── Cyberpunk glitch accent — extract sender's PFP VIBRANT color ──────
  // Only runs when the glitch bubble is active. Bot uses fixed teal.
  // For everyone else (own + others alike) we extract VIBRANT via the
  // Palette API — that's the saturated POP color humans associate with
  // the image (e.g., a green Saga Monke gives green), as opposed to
  // "dominant" which often returns a shadow/background tone and so the
  // bubble didn't visually match the user's PFP.
  // Cached on disk by inboxId so it's free after first extraction across
  // the whole app. Updates state once resolved.
  useEffect(() => {
    if (!hasWorldChrome) return;
    if (isBot) {
      setGlitchAccent(BOT_GLITCH_COLOR);
      return;
    }
    if (!avatarUri || !primarySenderInbox) return;
    let cancelled = false;
    getOrExtractNftColor(avatarUri, primarySenderInbox, accentFallback, "vibrant")
      .then((c) => {
        if (!cancelled && c) setGlitchAccent(c);
      })
      .catch(() => { /* keep fallback on failure */ });
    return () => { cancelled = true; };
  }, [hasWorldChrome, isBot, avatarUri, primarySenderInbox, accentFallback]);

  // PFP Aura color — uses equipped bubble glow color, falls back to NFT dominant color
  const pfpAuraColor = shopStyles.pfpAuraEnabled
    ? (shopStyles.glowColor as string | undefined) ?? (isOwn ? nftDominantColor : (shopStyles.pfpAuraColor as string | undefined)) ?? null
    : null;

  // Shop customer badge (purchased any Banana Shop item)
  const isShopCustomer = isOwn
    ? !!useAppStore.getState().shopStyles?.isShopCustomer
    : !!shopStyles.isShopCustomer;

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

  // ── Live Room Pill — early return for LIVE_PILL: messages ──────────────────
  const livePill = parseLivePill(message.content);
  if (livePill) {
    return <LivePillBubble type={livePill.type} host={livePill.host} sentAt={message.sentAt} />;
  }

  const bananaBetPill = parseBananaBetPill(message.content);
  if (bananaBetPill) {
    return (
      <BananaBetPillBubble
        id={bananaBetPill.id}
        category={bananaBetPill.category}
        question={bananaBetPill.question}
        resolvesAt={bananaBetPill.resolvesAt}
      />
    );
  }

  const bananaBetSettledPill = parseBananaBetSettledPill(message.content);
  if (bananaBetSettledPill) {
    return (
      <BananaBetSettledPillBubble
        question={bananaBetSettledPill.question}
        outcome={bananaBetSettledPill.outcome}
        totalBets={bananaBetSettledPill.totalBets}
        totalBananasWon={bananaBetSettledPill.totalBananasWon}
      />
    );
  }

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
        <Pressable onPress={handlePressAvatar} hitSlop={6} style={styles.avatarOuter} accessibilityLabel={`${displayName} avatar`} accessibilityRole="button">
          {/* Default purple hue — hidden when Skia PFP Aura is active */}
          {!pfpAuraColor && !isBot && <View style={styles.avatarHue} />}
          {/* Bot PFP Aura — always teal glow */}
          {isBot && <SkiaGlowPfp glowColor={BOT_THEME_COLOR} size={34} />}
          {/* Tier 3: PFP Aura — Skia glow using NFT dominant color */}
          {pfpAuraColor && !isBot && <SkiaGlowPfp glowColor={pfpAuraColor} size={34} />}
          {/* Tier 3: Pulse Frame — animated ring around PFP */}
          {isOwn && shopStyles.pfpFrame === "pulse" && (
            <PulseRing color={nftDominantColor ?? SOLANA_PURPLE} />
          )}
          {isOwn && shopStyles.pfpFrame === "glow" && (
            <View style={{
              position: "absolute", width: 42, height: 42, borderRadius: 21,
              borderWidth: 2, borderColor: (nftDominantColor ?? SOLANA_PURPLE) + "80",
              shadowColor: nftDominantColor ?? SOLANA_PURPLE,
              shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
            }} />
          )}
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

      {/* ── Bubble column ──────────────────────────────────────────────
          Reanimated.View so it can carry the float-in entry + latest-
          bubble hover bob (Cyberpunk world). Bubble alone floats; the
          PFP stays anchored. */}
      <Reanimated.View style={[
        styles.bubbleGroup,
        isOwn && !centerBubble && styles.bubbleGroupOwn,
        centerBubble && styles.bubbleGroupCenter,
        floatStyle,
      ]}>

        {/* Sender name moved below bubble for all users */}

        {/* Reply preview */}
        {message.replyTo && (
          <View style={[styles.replyPreview, isOwn && styles.replyPreviewOwn]}>
            <View style={[styles.replyBar, isOwn && styles.replyBarOwn]} />
            <View style={styles.replyContent}>
              <Text style={[styles.replySender, isOwn && styles.replySenderOwn]}>
                {getCachedProfile(message.replyTo.senderAddress)?.username ??
                  message.replyTo.senderUsername ??
                  'Monke'}
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
          accessibilityLabel={`Message from ${displayName}`}
          accessibilityRole="text"
        >
          {!isMedia ? (
            /* Glow wrapper — Skia renders the glow + glass, RN View holds content */
            <View style={[
              styles.glassGlow,
              { overflow: "visible" },
              isOwn && !centerBubble ? styles.glassGlowOwn : null,
              !isOwn && !centerBubble ? styles.glassGlowOther : null,
              centerBubble && styles.glassGlowBot,
            ]}>
              {/* ── Skia GPU glow — real Gaussian blur behind the bubble ── */}
              {hasSkiaGlow && bubbleSize ? (
                <SkiaGlowBubble
                  glowColor={shopStyles.glowColor as string}
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  radius={24}
                  glassOpacity={shopStyles.glassOpacity as number | undefined}
                />
              ) : null}
              {/* ── Cyberpunk world glitch chrome — neon HUD frame ── */}
              {useGlitchBubble && bubbleSize ? (
                <CyberpunkGlitchBubble
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  color={glitchAccent}
                  radius={14}
                  tailSide={centerBubble ? "none" : isOwn ? "right" : "left"}
                />
              ) : null}
              {/* ── Banana Grove world chrome — wooden Sign */}
              {useBananaGroveBubble && bubbleSize ? (
                <BananaGroveSignBubble
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  color={glitchAccent}
                  radius={14}
                  tailSide={centerBubble ? "none" : isOwn ? "right" : "left"}
                />
              ) : null}
              {/* ── Tech Noir world chrome — steel case-file frame */}
              {useTechNoirBubble && bubbleSize ? (
                <TechNoirBubble
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  color={glitchAccent}
                  radius={5}
                  tailSide={centerBubble ? "none" : isOwn ? "right" : "left"}
                />
              ) : null}
              {/* ── Deep Space world chrome — comm-panel HUD frame */}
              {useDeepSpaceBubble && bubbleSize ? (
                <DeepSpaceBubble
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  color={glitchAccent}
                  radius={14}
                  tailSide={centerBubble ? "none" : isOwn ? "right" : "left"}
                />
              ) : null}
              {/* Glass bubble — dark glass with glow-tinted border */}
              <View
                // Always attach onLayout. If we gate this prop on the world
                // flags, RN won't refire onLayout when shopStyles hydrates
                // late — the layout is already settled by then. That race
                // left useGlitchBubble=true with bubbleSize=null, painting
                // a transparent surface and no glitch overlay (missing
                // bubble on cold load). Guarding setBubbleSize inside is
                // free; an unattached layout pass is what costs us.
                onLayout={(e) => {
                  const { width: bw, height: bh } = e.nativeEvent.layout;
                  if (hasSkiaGlow || hasWorldChrome) {
                    if (!bubbleSize || Math.abs(bubbleSize.w - bw) > 1 || Math.abs(bubbleSize.h - bh) > 1) {
                      setBubbleSize({ w: bw, h: bh });
                    }
                  }
                  if (isLatest) {
                    setLatestBubbleHeight(bh);
                  }
                }}
                style={[
                styles.glassBubble,
                isOwn && !centerBubble ? styles.glassBubbleOwn : null,
                !isOwn && !centerBubble ? styles.glassBubbleOther : null,
                centerBubble && styles.glassBubbleBot,
                // Skia / world-chrome overlay handles bubble surface — make RN View transparent
                (hasSkiaGlow || hasWorldChrome) ? {
                  borderRadius: 22,
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  backgroundColor: "transparent",
                  borderWidth: 0,
                } : null,
                // Non-Skia shop overrides
                !hasSkiaGlow && !hasWorldChrome && shopStyles.bgColor ? { backgroundColor: shopStyles.bgColor as string } : null,
                !hasSkiaGlow && !hasWorldChrome && shopStyles.bgOpacity != null ? { backgroundColor: `rgba(26, 26, 40, ${shopStyles.bgOpacity})` } : null,
                !hasSkiaGlow && !hasWorldChrome && shopStyles.borderOpacity != null ? { borderColor: `rgba(248, 248, 255, ${shopStyles.borderOpacity})` } : null,
                isOwn && !hasWorldChrome && shopStyles.pfpThemeEnabled && nftDominantColor && !shopStyles.glowColor ? { borderColor: nftDominantColor + "30" } : null,
                isBot ? { borderColor: BOT_THEME_COLOR + "35", backgroundColor: "rgba(0, 201, 167, 0.06)" } : null,
                // World-aware bubble transparency: when MY world is equipped,
                // drop bubble bg from 0.65 → 0.32 so the world layer (bananas,
                // candles, cyberpunk grid) shows through both my OWN and OTHER
                // bubbles. Bot bubbles already use rgba(0,201,167,0.06) above
                // so this skips them. Skips when a Skia bubble is rendering
                // (it owns its own surface). Skips when shopStyles.bgColor is
                // explicitly set by an equipped Bubble cosmetic — the user
                // chose that color and we shouldn't override it. Also skips
                // when world chrome is active — overlay paints its own body.
                !hasSkiaGlow && !hasWorldChrome && !isBot && myShopStyles?.worldId && !shopStyles.bgColor
                  ? { backgroundColor: "rgba(26, 26, 40, 0.32)" }
                  : null,
              ]}>
                {/* Glass gradient — only for non-Skia, non-world-chrome bubbles */}
                {!hasSkiaGlow && !hasWorldChrome ? (
                  <LinearGradient
                    colors={["rgba(248,248,255,0.08)", "rgba(0,0,0,0.15)"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
                  />
                ) : null}
                {!hasSkiaGlow && !hasWorldChrome ? <View style={styles.glassHighlight} /> : null}

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
                  {(() => {
                    // (v33 2026-05-09) Top Sales card — bot's structured
                    // "Top Sales (24h)" alert renders as a compact list
                    // instead of a wall of carved text. Detected via the
                    // /Top Sales/ pattern; if parsing fails the IIFE falls
                    // through to default routing.
                    if (isBot && /Top Sales/i.test(displayContent)) {
                      const parsed = parseTopSalesAlert(displayContent);
                      if (parsed) {
                        const card = <BotAlertCard content={displayContent} />;
                        if (showBotExpand && !botExpanded) {
                          return (
                            <View style={{ maxHeight: 9 * 22, overflow: "hidden" }}>
                              {card}
                            </View>
                          );
                        }
                        return card;
                      }
                    }
                    // Bot in non-Banana-Grove worlds → MarkdownContent.
                    if (isBot && !useBananaGroveBubble) {
                      return (
                        <View style={showBotExpand && !botExpanded ? { maxHeight: 9 * 22, overflow: "hidden" } : undefined}>
                          <MarkdownContent
                            content={displayContent}
                            style={{ fontSize: 15 * (useAppStore.getState().textScale ?? 1) }}
                          />
                        </View>
                      );
                    }
                    // (v35 2026-05-09) Single RN Text path for all
                    // remaining cases. Banana Grove uses Fredoka-Bold
                    // (loaded via expo-font in app/_layout.tsx) with
                    // carved-shadow styling. Skia carve dropped — chat
                    // text is too small for cinematic carving, and Skia
                    // can't fall back to system emoji fonts so emoji
                    // rendered as tofu. RN Text gives proper emoji
                    // fallback automatically.
                    const baseFontSize = 15 * (useAppStore.getState().textScale ?? 1);
                    return (
                      <Text
                        style={[
                          styles.content,
                          { color: textColor, fontSize: baseFontSize },
                          shopStyles.fontWeight === "bold" ? { fontWeight: "bold" } : null,
                          shopStyles.fontFamily === "mono" ? { fontFamily: FONTS.mono } : null,
                          shopStyles.hasBubbleCosmetic ? { textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } : null,
                          shopStyles.textGlow ? { textShadowColor: "rgba(255,255,255,0.6)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 } : null,
                          // Banana Grove (v37 2026-05-09): clean fresh-cut
                          // wood color, no burnt shadow. Burnt-shadow
                          // recipe was an attempt to fake "carved" depth
                          // in v11 fallback; user wants it dropped — just
                          // the chunky Fredoka in cream wood tone.
                          useBananaGroveBubble ? {
                            fontFamily: 'Fredoka-Bold',
                            color: "#F0DBB0",
                            fontWeight: "700",
                            letterSpacing: 0.5,
                          } : null,
                        ]}
                        selectable={false}
                      >
                        {renderRichContent(displayContent, handlePressMention, onTokenPress)}
                      </Text>
                    );
                  })()}
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
              {/* ── Footer: sender name + reaction pills — below bubble ── */}
              {(!isOwn || activeReactions.length > 0) && (
                <View style={[
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 8,
                    marginTop: -3,
                  },
                  centerBubble && { justifyContent: "center" as const },
                  isOwn && { justifyContent: "flex-end" as const },
                ]}>
                  {/* Sender name — below bubble for all non-own messages.
                      Skipped for bot messages in bot channels: every
                      message there is from the same bot, so the username
                      ("AI Agent #9385") is redundant noise. */}
                  {!isOwn && !(isBotChannel && isBot) ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
                      <Text
                        style={{
                          fontFamily: FONTS.body,
                          fontSize: 11,
                          color: isBot
                            ? BOT_THEME_COLOR + "CC"
                            : shopStyles.glowColor
                              ? (shopStyles.glowColor as string) + "AA"
                              : "rgba(108, 180, 238, 0.55)",
                          ...(shopStyles.nameColor && !isBot ? { color: shopStyles.nameColor as string } : {}),
                        }}
                        numberOfLines={1}
                      >
                        {displayName}
                      </Text>
                      {/* (v41) Flair + badges as Skia glyphs.
                          Order: clout 🦍 → shop 🍌 → legendary 🌟 → up to 3 badges. */}
                      {cloutFlair ? <BadgeGlyph emoji="🦍" size={12} /> : null}
                      {isShopCustomer ? <BadgeGlyph emoji="🍌" size={12} /> : null}
                      {isLegendarySender ? <BadgeGlyph emoji="🌟" size={12} /> : null}
                      {badgeEmojiArray.map((e, i) => (
                        <BadgeGlyph key={`${e}-${i}`} emoji={e} size={12} />
                      ))}
                      <OnlineDot online={isUserOnline(message.senderAddress)} />
                    </View>
                  ) : null}
                  {/* Reaction pills + sticker reactions — unified row */}
                  {(activeReactions.length > 0 || (message.stickerReactions ?? []).length > 0) && (
                    <View style={[styles.reactionRow, isOwn && styles.reactionRowOwn]}>
                      {activeReactions.map((r) => (
                        <Pressable
                          key={r.emoji}
                          onPress={() => onReact(r.emoji, message.id)}
                          hitSlop={4}
                          style={[styles.reactionPill, r.reactedByMe && styles.reactionPillActive]}
                          accessibilityLabel={`React ${r.emoji}, ${r.count} reactions`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.pillEmoji}>{r.emoji}</Text>
                          {r.count > 1 && (
                            <Text style={[styles.pillCount, r.reactedByMe && styles.pillCountActive]}>
                              {r.count}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                      {(message.stickerReactions ?? []).map((sr) => (
                        <Pressable
                          key={`sticker-${sr.url}`}
                          onPress={() => onStickerReact?.(sr.url, message.id)}
                          hitSlop={4}
                          style={[styles.stickerPill, sr.reactedByMe && styles.reactionPillActive]}
                        >
                          <ExpoImage source={{ uri: sr.url }} style={{ width: 26, height: 26 }} contentFit="contain" />
                          {sr.count > 1 && (
                            <Text style={[styles.pillCount, sr.reactedByMe && styles.pillCountActive]}>
                              {sr.count}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}
              {/* ── Glass dome overlay — specular glare ON TOP of text ── */}
              {hasSkiaGlow && bubbleSize ? (
                <SkiaGlassFront
                  glowColor={shopStyles.glowColor as string}
                  width={bubbleSize.w}
                  height={bubbleSize.h}
                  radius={24}
                />
              ) : null}
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
                    priority="high"
                    transition={200}
                    recyclingKey={message.id}
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
                    priority="high"
                    transition={200}
                    recyclingKey={message.id}
                    onLoad={(e: any) => {
                      const { width: w, height: h } = e.source;
                      if (w > 0) setImgAspect(h / w);
                    }}
                    onError={() => setImgAspect(0.5)}
                    placeholder={require("../../assets/icon.png")}
                    placeholderContentFit="contain"
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

      </Reanimated.View>

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

    {/* Sticker reactions now rendered inline with emoji reactions above */}
    {/* Long-press action sheet (react/reply/copy/edit/delete/pin/thread) is
        rendered once at the screen level — see MessageActionSheet.tsx. */}
</>
  );
}, arePropsEqual);

const styles = StyleSheet.create({
  // ── Row layout ─────────────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginVertical: 6,
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
    color: THEME.text,
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

  // ── Reaction row + pills ────────────────────────────────────────────────────
  reactionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    flexShrink: 0,
  },
  reactionRowOwn: {
    justifyContent: "flex-start" as const,
  },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "transparent",
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 0,
    borderColor: "transparent",
  },
  reactionPillActive: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  stickerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "transparent",
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  pillEmoji: { fontSize: 14 },
  pillCount: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
  },
  pillCountActive: { color: "#FFD54F" },


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

});
