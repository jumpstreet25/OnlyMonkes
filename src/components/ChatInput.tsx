/**
 * ChatInput
 *
 * Message composer with:
 *  - Reply-to preview strip
 *  - Auto-growing text input (capped at 4 lines)
 *  - Character counter
 *  - Send button (gradient, disabled when empty)
 */

import React, { useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Keyboard,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { THEME, FONTS, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import type { ChatMessage } from "@/types";

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  replyingTo: ChatMessage | null;
  onCancelReply: () => void;
  isSending?: boolean;
  onDevTip?: () => void;
}

export function ChatInput({
  value,
  onChangeText,
  onSend,
  replyingTo,
  onCancelReply,
  isSending,
  onDevTip,
}: ChatInputProps) {
  const inputRef = useRef<TextInput>(null);

  const canSend = value.trim().length > 0 && value.length <= MAX_MESSAGE_LENGTH && !isSending;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend();
    inputRef.current?.focus();
  }, [canSend, onSend]);

  const charsLeft = MAX_MESSAGE_LENGTH - value.length;
  const isNearLimit = charsLeft <= 50;

  return (
    <View style={styles.container}>
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
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
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

      {/* Dev tip strip — below the input */}
      {onDevTip && (
        <Pressable
          style={({ pressed }) => [styles.devTipRow, pressed && { opacity: 0.7 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDevTip(); }}
        >
          <Text style={styles.devTipText}>🍌  Support Jump.skr dev</Text>
        </Pressable>
      )}
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

  devTipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  devTipText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#FFD700",
    letterSpacing: 0.5,
  },
});
