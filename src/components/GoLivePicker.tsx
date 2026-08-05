/**
 * GoLivePicker
 *
 * "Go Live" chooser popup (Live Video / Avatar Room). Moved out of
 * ChatInput (2026-08-01) — ChatInput is mounted inside a short,
 * content-sized, bottom-docked wrapper in ChatScreen, so this popup's
 * MonkeGlass absoluteFill only ever got that tiny toolbar-height box to
 * render into instead of the full viewport (cut off at the bottom, backdrop
 * dim reading as a stray "black square"). Rendered here as a screen-root
 * sibling instead, same mounting level as every other correctly-behaving
 * modal in ChatScreen.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { FONTS } from "@/lib/constants";
import { MonkeGlass } from "@/components/MonkeGlass";

interface GoLivePickerProps {
  visible: boolean;
  onClose: () => void;
  onLiveVideo?: () => void;
  onAvatarRoom?: () => void;
}

export function GoLivePicker({ visible, onClose, onLiveVideo, onAvatarRoom }: GoLivePickerProps) {
  return (
    <MonkeGlass visible={visible} onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>Go Live</Text>

      {onLiveVideo && (
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
          onPress={() => {
            onClose();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onLiveVideo();
          }}
        >
          <Text style={styles.emoji}>📹</Text>
          <View>
            <Text style={styles.btnText}>Live Video</Text>
            <Text style={styles.btnSub}>Video call with sticker reactions</Text>
          </View>
        </Pressable>
      )}

      {onAvatarRoom && (
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
          onPress={() => {
            onClose();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onAvatarRoom();
          }}
        >
          <Text style={styles.emoji}>🐵</Text>
          <View>
            <Text style={styles.btnText}>Avatar Room</Text>
            <Text style={styles.btnSub}>Animated Monke avatar chat</Text>
          </View>
        </Pressable>
      )}

      <Pressable
        style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
        onPress={onClose}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </MonkeGlass>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderColor: "rgba(0,150,199,0.4)",
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    fontWeight: "700",
    color: "#0096C7",
    letterSpacing: 1,
    marginBottom: 4,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    backgroundColor: "rgba(0,150,199,0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,150,199,0.3)",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  emoji: {
    fontSize: 24,
  },
  btnText: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    fontWeight: "700",
    color: "#0096C7",
  },
  btnSub: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    marginTop: 1,
  },
  cancel: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  cancelText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
  },
});
