/**
 * ChatInput
 *
 * Message composer with:
 *  - Reply-to preview strip
 *  - Auto-growing text input (capped at 4 lines)
 *  - Character counter
 *  - Send button (gradient, disabled when empty)
 */

import React, { useRef, useCallback, useEffect } from "react";
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
import { THEME, FONTS, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import type { ChatMessage } from "@/types";

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
}: ChatInputProps) {
  const inputRef = useRef<TextInput>(null);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const hasTypers = !!(typingUsers && typingUsers.length > 0);

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

        {/* Camera button */}
        {onCamera && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCamera(); }}
            hitSlop={6}
            style={({ pressed }) => [styles.cameraBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.cameraBtnText}>📷</Text>
          </Pressable>
        )}

        {/* GIF pill button */}
        {onGifPicker && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onGifPicker(); }}
            hitSlop={6}
            style={({ pressed }) => [styles.gifPill, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.gifPillText}>GIF</Text>
          </Pressable>
        )}

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

  // ── Camera button ──────────────────────────────────────────────────────────
  cameraBtn: {
    alignSelf: "flex-end",
    marginBottom: 2,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBtnText: {
    fontSize: 18,
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

  // ── GIF pill button (between input and send) ───────────────────────────────
  gifPill: {
    alignSelf: "flex-end",
    marginBottom: 2,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#FFD700",
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: "center",
  },
  gifPillText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#FFD700",
    letterSpacing: 0.5,
  },
});
