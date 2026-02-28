/**
 * TipModal
 *
 * Bottom sheet for selecting a SKR tip amount.
 * Shows 0.5 / 1 / 5 SKR options plus the recipient name.
 * Calls onConfirm(amount) when user taps Send.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, FONTS, TIP_MIN, TIP_MAX, type TipAmount } from "@/lib/constants";

interface TipModalProps {
  visible: boolean;
  recipientName: string;
  onConfirm: (amount: TipAmount) => Promise<void>;
  onClose: () => void;
}

export function TipModal({ visible, recipientName, onConfirm, onClose }: TipModalProps) {
  const { width: SCREEN_W } = useWindowDimensions();
  const [selected, setSelected] = useState<number>(10);
  const [sending, setSending] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const SIDE_PAD = 10;
  const bananaLeft =
    trackWidth > 0
      ? SIDE_PAD +
        (trackWidth - 2 * SIDE_PAD) *
          ((selected - TIP_MIN) / (TIP_MAX - TIP_MIN)) -
        11
      : 0;

  const handleSend = async () => {
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await onConfirm(selected);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>🍌  Tip with SKR</Text>
        <Text style={styles.subtitle}>
          Tipping <Text style={styles.recipientName}>{recipientName}</Text>
          {"\n"}
          <Text style={styles.feeNote}>5% goes to Jump.skr dev fund</Text>
        </Text>

        {/* Banana slider */}
        <View style={styles.sliderWrap}>
          <Text style={styles.sliderValue}>{Math.round(selected)} SKR</Text>
          <View
            style={styles.sliderTrackWrap}
            onLayout={(e: LayoutChangeEvent) =>
              setTrackWidth(e.nativeEvent.layout.width)
            }
          >
            <Slider
              style={{ width: SCREEN_W - 64, height: 48 }}
              minimumValue={TIP_MIN}
              maximumValue={TIP_MAX}
              step={1}
              value={selected}
              onValueChange={(v) => { setSelected(v); Haptics.selectionAsync(); }}
              minimumTrackTintColor="#FFD700"
              maximumTrackTintColor="rgba(255,255,255,0.18)"
              thumbTintColor={THEME.surfaceHigh}
              tapToSeek
            />
            {trackWidth > 0 && (
              <Text
                style={[styles.bananaThumb, { left: bananaLeft }]}
                pointerEvents="none"
              >
                🍌
              </Text>
            )}
          </View>
          <View style={[styles.sliderEndLabels, { width: SCREEN_W - 64 }]}>
            <Text style={styles.sliderEndLabel}>1 SKR</Text>
            <Text style={styles.sliderEndLabel}>500 SKR</Text>
          </View>
        </View>

        {/* Send button */}
        <Pressable
          style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={sending}
        >
          <LinearGradient
            colors={sending ? [THEME.surfaceHigh, THEME.surfaceHigh] : ["#FFD700", "#FFA500"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sendGradient}
          >
            {sending ? (
              <ActivityIndicator color={THEME.text} />
            ) : (
              <Text style={styles.sendText}>
                Send {Math.round(selected)} SKR 🍌
              </Text>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable onPress={onClose} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: THEME.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: THEME.border,
    padding: 24,
    paddingBottom: 36,
    alignItems: "center",
    gap: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    marginBottom: 4,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  recipientName: {
    fontFamily: FONTS.displayMed,
    color: THEME.accent,
  },
  feeNote: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
  },
  sliderWrap: {
    alignItems: "center",
    gap: 4,
    alignSelf: "stretch",
  },
  sliderTrackWrap: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    position: "relative",
  },
  bananaThumb: {
    position: "absolute",
    top: 13,
    fontSize: 22,
  },
  sliderValue: {
    fontFamily: FONTS.display,
    fontSize: 28,
    color: "#FFD700",
  },
  // slider uses inline width: SCREEN_W - 80 for Android compatibility
  sliderEndLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  sliderEndLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
  },
  sendBtn: {
    alignSelf: "stretch",
    borderRadius: 14,
    overflow: "hidden",
    elevation: 6,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  sendBtnDisabled: { elevation: 0, shadowOpacity: 0 },
  sendGradient: {
    paddingVertical: 16,
    alignItems: "center",
  },
  sendText: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#1A1A00",
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
  },
});
