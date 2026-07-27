/**
 * PhotoReviewModal — shown right after taking a photo in Main Chat, before
 * it sends. Lets the user pick a caption: accept the bot's AI-generated
 * one (moondream description -> Monke-voiced rewrite via runLlmChain, same
 * pattern as imageCaption.ts/ollamaVision.ts), write their own, or send with
 * no caption at all. Nothing sends until the user makes one of those three
 * choices — see handleCamera in ChatScreen.tsx for the send-time wiring.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image as RNImage,
} from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";
import { usePhotoReviewStore } from "@/store/photoReviewStore";

interface PhotoReviewModalProps {
  visible: boolean;
  /** Local file URI for the preview image — not the base64/data URI. */
  imageUri: string | null;
  /** Correlates with the IMAGE_CAPTION_REQUEST fired for this photo. */
  requestId: string | null;
  /** caption is "" when the user chose to send with no caption. */
  onSend: (caption: string) => void;
  onCancel: () => void;
}

export function PhotoReviewModal({ visible, imageUri, requestId, onSend, onCancel }: PhotoReviewModalProps) {
  const [captionText, setCaptionText] = useState("");
  const [isGenerating, setIsGenerating] = useState(true);
  // Tracks whether the user has typed their own text — once true, an
  // incoming AI caption must NOT clobber what they're already writing.
  const userEditedRef = useRef(false);
  const aiCaption = usePhotoReviewStore((s) => (requestId ? s.captions[requestId] : undefined));

  useEffect(() => {
    if (visible) {
      setCaptionText("");
      setIsGenerating(true);
      userEditedRef.current = false;
      // 2026-07-26: real-world repro — bot-side vision generation can time
      // out (confirmed live: moondream cold-loading past its own 90s
      // server-side timeout), and with no client-side limit of our own
      // this modal was left showing "Monke is thinking..." forever with no
      // signal that it may never resolve — Send/Send-without-caption were
      // always technically tappable, but nothing told the user that. Give
      // up waiting after 20s and fall back to the plain "write your own"
      // state; the user can still send blank or type at any point before
      // that too.
      const giveUpTimer = setTimeout(() => setIsGenerating(false), 20_000);
      return () => clearTimeout(giveUpTimer);
    }
  }, [visible, requestId]);

  useEffect(() => {
    if (aiCaption === undefined) return;
    setIsGenerating(false);
    if (!userEditedRef.current) setCaptionText(aiCaption);
  }, [aiCaption]);

  if (!visible) return null;

  const handleChangeText = (text: string) => {
    userEditedRef.current = true;
    setCaptionText(text);
  };

  return (
    <GlassModal visible={visible} onClose={onCancel} position="center" cardStyle={styles.card}>
      <Text style={styles.title}>Add a caption?</Text>
      {imageUri && (
        <RNImage source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
      )}
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={captionText}
          onChangeText={handleChangeText}
          placeholder={isGenerating ? "Monke is thinking of something cheeky…" : "Write your own caption…"}
          placeholderTextColor={THEME.textDim}
          multiline
          maxLength={280}
        />
        {isGenerating && (
          <ActivityIndicator size="small" color={THEME.accent} style={styles.spinner} />
        )}
      </View>
      <View style={styles.buttonRow}>
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.blankBtn} onPress={() => onSend("")}>
          <Text style={styles.blankText}>Send without caption</Text>
        </Pressable>
        <Pressable style={styles.sendBtn} onPress={() => onSend(captionText.trim())}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "88%",
    padding: 18,
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 17,
    color: THEME.text,
    marginBottom: 12,
    textAlign: "center",
  },
  preview: {
    width: "100%",
    height: 220,
    borderRadius: 16,
    marginBottom: 14,
    backgroundColor: THEME.surfaceHigh,
  },
  inputWrap: {
    position: "relative",
    marginBottom: 14,
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 12,
    minHeight: 70,
    maxHeight: 140,
    textAlignVertical: "top",
  },
  spinner: {
    position: "absolute",
    right: 12,
    top: 12,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cancelText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  blankBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
  },
  blankText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textMuted,
  },
  sendBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: THEME.accent,
  },
  sendText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: THEME.text,
  },
});
