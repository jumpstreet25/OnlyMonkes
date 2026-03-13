/**
 * ChatInput
 *
 * Message composer with:
 *  - Reply-to preview strip
 *  - Auto-growing text input (capped at 4 lines)
 *  - Character counter
 *  - Send button (gradient, disabled when empty)
 */

import React, { useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Keyboard,
  Image,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { THEME, FONTS, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { getAllTimeUsers, getCachedProfile } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import type { ChatMessage } from "@/types";

function getActiveMention(text: string): { start: number; query: string } | null {
  const match = text.match(/@(\w*)$/);
  if (!match) return null;
  return { start: text.length - match[0].length, query: match[1] };
}

const BOT_COMMANDS = [
  { cmd: "/price",     args: "$TOKEN",           desc: "Live price snapshot" },
  { cmd: "/ta",        args: "$TOKEN",           desc: "Technical analysis" },
  { cmd: "/watchlist", args: "",                 desc: "List tracked tokens" },
  { cmd: "/alerts",    args: "",                 desc: "Recent TA signals" },
  { cmd: "/sports",    args: "",                 desc: "Top sports betting setups" },
  { cmd: "/tip",       args: "@Username [amt]",  desc: "Tip $SKR to a Monke" },
  { cmd: "/buy",       args: "$TOKEN [SOL]",     desc: "Buy token via Jupiter" },
  { cmd: "/sell",      args: "$TOKEN [%]",       desc: "Sell token via Jupiter" },
  { cmd: "/swap",      args: "$A for $B",        desc: "Swap tokens via Jupiter" },
  { cmd: "/help",      args: "",                 desc: "Show all commands" },
];

function getSlashSuggestions(text: string) {
  if (!text.startsWith("/")) return [];
  const query = text.slice(1).toLowerCase();
  return BOT_COMMANDS.filter(c => c.cmd.slice(1).startsWith(query));
}

// ── Bot channel button with badge ─────────────────────────────────────────────
function ChannelButton({ channelId, image }: { channelId: 'bets' | 'trades' | 'sales' | 'predictions'; image: any }) {
  const count = useAppStore((s) => s.botChannelCounts[channelId]);
  const clearCount = useAppStore((s) => s.clearBotChannelCount);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        clearCount(channelId);
        router.push(`/bot-channel?channelId=${channelId}`);
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        clearCount(channelId);
      }}
      style={({ pressed }) => [styles.toolbarBtn, styles.toolbarChannel, pressed && { opacity: 0.7 }]}
    >
      <Image source={image} style={styles.toolbarChannelImg} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

interface TypingUser { inboxId: string; username?: string; }

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  replyingTo: ChatMessage | null;
  onCancelReply: () => void;
  isSending?: boolean;
  onGifPicker?: () => void;
  pfpUri?: string | null;
  onPfpGifPicker?: () => void;
  onTyping?: () => void;
  onCamera?: () => void;
  typingUsers?: TypingUser[];
  onLive?: () => void;
}

export function ChatInput({
  value,
  onChangeText,
  onSend,
  replyingTo,
  onCancelReply,
  isSending,
  onGifPicker,
  pfpUri,
  onPfpGifPicker,
  onTyping,
  onCamera,
  typingUsers,
  onLive,
}: ChatInputProps) {
  const inputRef = useRef<TextInput>(null);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const hasTypers = !!(typingUsers && typingUsers.length > 0);
  const { myInboxId } = useAppStore();

  const slashSuggestions = useMemo(() => getSlashSuggestions(value), [value]);

  const activeMention = getActiveMention(value);
  const suggestions: { inboxId: string; username: string }[] = useMemo(() => {
    if (!activeMention) return [];
    const q = activeMention.query.toLowerCase();
    const results: { inboxId: string; username: string }[] = [];
    getAllTimeUsers().forEach((name, inboxId) => {
      if (name && name.toLowerCase().startsWith(q) && inboxId !== myInboxId) {
        results.push({ inboxId, username: name });
      }
    });
    return results.slice(0, 6);
  }, [activeMention?.query, value]);

  const insertSlashCommand = useCallback((cmd: string, args: string) => {
    onChangeText(args ? `${cmd} ` : cmd);
  }, [onChangeText]);

  const insertMention = useCallback((username: string) => {
    const match = value.match(/@(\w*)$/);
    if (!match) return;
    const newText = value.slice(0, value.length - match[0].length) + `@${username} `;
    onChangeText(newText);
  }, [value, onChangeText]);

  // Bounce animation — runs while any remote user is typing
  useEffect(() => {
    if (!hasTypers) {
      bounceAnim.stopAnimation();
      bounceAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -5, duration: 280, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0,  duration: 280, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hasTypers]);

  const canSend = value.trim().length > 0 && value.length <= MAX_MESSAGE_LENGTH && !isSending;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend();
    inputRef.current?.focus();
  }, [canSend, onSend]);

  const handleChangeText = useCallback((text: string) => {
    onChangeText(text);
    if (text.length > 0) onTyping?.();
  }, [onChangeText, onTyping]);

  const charsLeft = MAX_MESSAGE_LENGTH - value.length;
  const isNearLimit = charsLeft <= 50;

  return (
    <View style={styles.container}>
      {/* Slash command suggestions */}
      {slashSuggestions.length > 0 && (
        <View style={styles.mentionList}>
          {slashSuggestions.map(({ cmd, args, desc }) => (
            <Pressable key={cmd} style={styles.mentionRow} onPress={() => insertSlashCommand(cmd, args)}>
              <View style={styles.slashCmdIcon}>
                <Text style={styles.slashCmdSlash}>/</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.slashCmdName}>{cmd}{args ? ` ${args}` : ""}</Text>
                <Text style={styles.slashCmdDesc}>{desc}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Mention suggestions */}
      {suggestions.length > 0 && (
        <View style={styles.mentionList}>
          {suggestions.map(({ inboxId, username }) => {
            const avatar = getCachedProfile(inboxId)?.nftImage;
            return (
              <Pressable key={inboxId} style={styles.mentionRow} onPress={() => insertMention(username)}>
                {avatar
                  ? <Image source={{ uri: avatar }} style={styles.mentionAvatar} />
                  : <View style={[styles.mentionAvatar, styles.mentionAvatarFallback]} />
                }
                <Text style={styles.mentionUsername}>@{username}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Typing indicator */}
      {hasTypers && (
        <Animated.View
          style={[styles.typingRow, { transform: [{ translateY: bounceAnim }] }]}
          pointerEvents="none"
        >
          <Text style={styles.typingDots}>●●●</Text>
          <Text style={styles.typingText}>
            {typingUsers!.length === 1 ? "A Monke is Typing" : "Many Monkes are Typing"}
          </Text>
        </Animated.View>
      )}

      {/* Reply preview */}
      {replyingTo && (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerBar} />
          <View style={styles.replyBannerContent}>
            <Text style={styles.replyBannerLabel}>
              Replying to {shortenAddress(replyingTo.senderAddress)}
            </Text>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              {replyingTo.content}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} style={styles.cancelReply} hitSlop={8}>
            <Text style={styles.cancelReplyText}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* PFP button — opens sagaMonkes GIF picker */}
        {onPfpGifPicker && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPfpGifPicker(); }}
            hitSlop={6}
            style={({ pressed }) => [styles.pfpBtn, pressed && { opacity: 0.7 }]}
          >
            {pfpUri ? (
              <Image source={{ uri: pfpUri }} style={styles.pfpImg} />
            ) : (
              <View style={styles.pfpFallback}>
                <Text style={styles.pfpGlyph}>🐒</Text>
              </View>
            )}
          </Pressable>
        )}

        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={handleChangeText}
            placeholder="Message…"
            placeholderTextColor={THEME.textFaint}
            multiline
            maxLength={MAX_MESSAGE_LENGTH + 10} // soft limit via UI
            returnKeyType="default"
            blurOnSubmit={false}
          />
          {isNearLimit && (
            <Text style={[styles.charCount, charsLeft < 0 && styles.charCountOver]}>
              {charsLeft}
            </Text>
          )}
        </View>

        <Pressable onPress={handleSend} disabled={!canSend}
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.sendButtonPressed,
            !canSend && styles.sendButtonDisabled,
          ]}
        >
          <LinearGradient
            colors={canSend ? ["#9c7cff", "#7c5cfc"] : [THEME.surfaceHigh, THEME.surfaceHigh]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendGradient}
          >
            <Text style={[styles.sendArrow, !canSend && styles.sendArrowDisabled]}>↑</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Toolbar row — Camera, Live, GIF + Bot channels */}
      <View style={styles.toolbarRow}>
        {onCamera && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCamera(); }}
            style={({ pressed }) => [styles.toolbarBtn, styles.toolbarCamera, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.toolbarCameraText}>📷</Text>
          </Pressable>
        )}

        {onLive && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLive(); }}
            style={({ pressed }) => [styles.toolbarBtn, styles.toolbarLive, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.liveDot} />
            <Text style={styles.toolbarLiveText}>LIVE</Text>
          </Pressable>
        )}

        {onGifPicker && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onGifPicker(); }}
            style={({ pressed }) => [styles.toolbarBtn, styles.toolbarGif, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.toolbarGifText}>GIF</Text>
          </Pressable>
        )}

        <ChannelButton channelId="bets" image={require("../../assets/MonkeBets.png")} />
        <ChannelButton channelId="trades" image={require("../../assets/MonkeTrades.png")} />
        <ChannelButton channelId="sales" image={require("../../assets/MonkeSales.png")} />
        <ChannelButton channelId="predictions" image={require("../../assets/MonkePredictions.png")} />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: THEME.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    paddingBottom: 8,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  replyBannerBar: {
    width: 3,
    height: 36,
    backgroundColor: THEME.accent,
    borderRadius: 2,
  },
  replyBannerContent: { flex: 1, gap: 2 },
  replyBannerLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.accent,
  },
  replyBannerText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },
  cancelReply: { padding: 4 },
  cancelReplyText: {
    fontSize: 14,
    color: THEME.textFaint,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    maxHeight: 100,
    padding: 0,
    margin: 0,
  },
  charCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    alignSelf: "flex-end",
    marginTop: 2,
  },
  charCountOver: { color: "#ff4444" },

  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 13,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  sendButtonPressed: { opacity: 0.8, transform: [{ scale: 0.95 }] },
  sendButtonDisabled: { shadowOpacity: 0, elevation: 0 },
  sendGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sendArrow: {
    fontSize: 20,
    color: "#fff",
    fontWeight: "700",
  },
  sendArrowDisabled: { color: THEME.textFaint },

  // ── Typing indicator ──────────────────────────────────────────────────────
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  typingDots: {
    fontSize: 8,
    color: THEME.accent,
    letterSpacing: 2,
  },
  typingText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
    fontStyle: "italic",
  },

  // ── PFP button (left of input) ─────────────────────────────────────────────
  pfpBtn: {
    alignSelf: "flex-end",
    marginBottom: 2,
  },
  pfpImg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  pfpFallback: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  pfpGlyph: { fontSize: 16 },

  // ── Toolbar row (below input) ──────────────────────────────────────────────
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  toolbarBtn: {
    height: 31,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarCamera: {
    width: 31,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  toolbarCameraText: {
    fontSize: 16,
  },
  toolbarLive: {
    borderWidth: 1,
    borderColor: "#FF4C4C55",
    backgroundColor: "rgba(255,76,76,0.08)",
    paddingHorizontal: 7,
    flexDirection: "row",
    gap: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#FF4C4C",
  },
  toolbarLiveText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#FF4C4C",
    letterSpacing: 0.5,
  },
  toolbarGif: {
    borderWidth: 1,
    borderColor: "#FFD700",
    paddingHorizontal: 7,
  },
  toolbarGifText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#FFD700",
    letterSpacing: 0.5,
  },
  toolbarChannel: {
    width: 34,
    height: 34,
    overflow: "hidden",
  },
  toolbarChannelImg: {
    width: 34,
    height: 34,
    borderRadius: 9,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FF4C4C",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    fontWeight: "700",
  },

  // ── Slash command suggestion list ─────────────────────────────────────────
  slashCmdIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: THEME.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  slashCmdSlash: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: THEME.accent,
    fontWeight: "700",
  },
  slashCmdName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
  },
  slashCmdDesc: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 1,
  },

  // ── @mention suggestion list ────────────────────────────────────────────────
  mentionList: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    marginHorizontal: 8,
    marginBottom: 6,
    overflow: "hidden",
  },
  mentionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  mentionAvatar: { width: 28, height: 28, borderRadius: 14 },
  mentionAvatarFallback: { backgroundColor: THEME.border },
  mentionUsername: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text },
});
