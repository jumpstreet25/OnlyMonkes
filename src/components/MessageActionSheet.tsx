/**
 * MessageActionSheet — long-press action sheet for a chat message
 * (react / reply / copy / edit / delete / pin / thread / sticker react).
 *
 * 2026-07-09: this used to live INSIDE MessageBubble, one GlassBottomSheet
 * instance per message row, nested deep inside ChatMessageList's ScrollView.
 * Gorhom's base <BottomSheet> (what GlassBottomSheet wraps) has no portal —
 * it renders inline at its position in the tree, sized/positioned relative
 * to its nearest parent. Nested inside a single scrolling message row, that
 * meant the sheet rendered squashed into that row's own bounds instead of
 * covering the screen (visible only by scrolling), and competed with the
 * ScrollView's own pan gesture for drag-to-dismiss — manifesting as the
 * gray-screen freeze on rapid reaction changes.
 *
 * Fix: a single instance lives at the screen level (ChatModals), same as
 * every other overlay (ImageLightbox, ChartModal, UserProfileModal). The
 * currently-long-pressed message is lifted into ChatScreen state and passed
 * down as `target`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";
import { THEME, FONTS } from "@/lib/constants";
import { GlassBottomSheet } from "@/components/GlassBottomSheet";
import { ReactionPicker } from "@/components/ReactionPicker";
import { searchStickers, getGiphyLastStatus, type GiphyItem } from "@/lib/giphy";
import type { ChatMessage, ReactionEmoji } from "@/types";

interface MessageActionSheetProps {
  target: ChatMessage | null;
  onClose: () => void;
  myAddress: string;
  isGroupAdmin: boolean;
  onReact: (emoji: ReactionEmoji, messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onThread?: (message: ChatMessage) => void;
  onStickerReact?: (url: string, messageId: string) => void;
}

export function MessageActionSheet({
  target,
  onClose,
  myAddress,
  isGroupAdmin,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onThread,
  onStickerReact,
}: MessageActionSheetProps) {
  const [stickerItems, setStickerItems] = useState<GiphyItem[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);

  // Fetch SagaMonkes stickers whenever the sheet opens for a new target
  useEffect(() => {
    if (!target) return;
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
  }, [target]);

  const isOwn = !!target && target.senderAddress === myAddress;
  const isMediaContent = !!target && (
    target.content.startsWith("GIF:") ||
    target.content.startsWith("IMAGE:") ||
    target.content.startsWith("VIDEO:") ||
    target.content.startsWith("STICKER:")
  );
  const canEdit = !!target && isOwn && !isMediaContent
    && (Date.now() - target.sentAt.getTime()) < 60_000;

  const myActiveEmojis = useMemo(() => {
    const s = new Set<string>();
    if (!target) return s;
    for (const r of Object.values(target.reactions)) {
      if (r && r.count > 0 && r.reactedByMe) s.add(r.emoji);
    }
    return s;
  }, [target]);

  const handleCopy = useCallback(() => {
    if (!target) return;
    const text = target.editedContent ?? target.content;
    const cleaned = text.startsWith("IMAGE:") ? "[Image]"
      : text.startsWith("GIF:") ? "[GIF]"
      : text.startsWith("VIDEO:") ? "[Video]"
      : text.startsWith("STICKER:") ? "[Sticker]"
      : text;
    // Copy + haptic immediately (no overlay), then dismiss the sheet.
    Clipboard.setStringAsync(cleaned);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
    // Defer the toast until after the sheet's own close animation clears —
    // see the class of gray-screen bug this file's header comment explains.
    setTimeout(() => toast.success("Copied to clipboard"), 350);
  }, [target, onClose]);

  const handleEdit = useCallback(() => {
    if (!target) return;
    onClose();
    onEdit?.(target);
  }, [target, onClose, onEdit]);

  const handlePickReaction = useCallback((emoji: ReactionEmoji) => {
    if (!target) return;
    onClose();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReact(emoji, target.id);
  }, [target, onClose, onReact]);

  const handlePickReply = useCallback(() => {
    if (!target) return;
    onClose();
    onReply(target);
  }, [target, onClose, onReply]);

  // Opens at the larger snap point (index 1) by default — at 45% the
  // reaction row + action buttons alone nearly filled the sheet, pushing
  // the SagaMonkes sticker grid below the fold with no visible affordance
  // to scroll for it, which read as "stickers don't show" entirely.
  return (
    <GlassBottomSheet visible={!!target} onClose={onClose} snapPoints={['45%', '85%']} initialIndex={1}>
      <View style={styles.pickerContent}>
        {target && (
          <>
            <ReactionPicker onPick={handlePickReaction} activeEmojis={myActiveEmojis} />

            <View style={styles.pickerActionRow}>
              <Pressable
                onPress={handlePickReply}
                style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
              >
                <Text style={styles.pickerReplyText}>↩  Reply</Text>
              </Pressable>

              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
              >
                <Text style={styles.pickerReplyText}>📋  Copy</Text>
              </Pressable>

              {canEdit && onEdit && (
                <Pressable
                  onPress={handleEdit}
                  style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
                >
                  <Text style={styles.pickerReplyText}>✏️  Edit</Text>
                </Pressable>
              )}

              {(isOwn || isGroupAdmin) && onDelete && (
                <Pressable
                  onPress={() => { onClose(); onDelete(target); }}
                  style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
                >
                  <Text style={[styles.pickerReplyText, { color: THEME.error }]}>🗑  Delete</Text>
                </Pressable>
              )}

              {onPin && (
                <Pressable
                  onPress={() => { onClose(); onPin(target); }}
                  style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
                >
                  <Text style={styles.pickerReplyText}>📌  Pin</Text>
                </Pressable>
              )}

              {onThread && (
                <Pressable
                  onPress={() => { onClose(); onThread(target); }}
                  style={({ pressed }) => [styles.pickerReplyBtn, pressed && styles.pickerReplyBtnPressed]}
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
                ) : stickerItems.length === 0 ? (
                  <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, textAlign: "center", paddingVertical: 12 }}>
                    No SagaMonkes stickers loaded.{"\n"}
                    status: {getGiphyLastStatus()}
                  </Text>
                ) : (
                  <View style={styles.stickerGrid}>
                    {stickerItems.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          onClose();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          onStickerReact(item.displayUrl, target.id);
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
          </>
        )}
      </View>
    </GlassBottomSheet>
  );
}

const styles = StyleSheet.create({
  pickerContent: {
    alignItems: "center",
    gap: 12,
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
  stickerSection: {
    alignSelf: "stretch",
    marginTop: 4,
    gap: 8,
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
