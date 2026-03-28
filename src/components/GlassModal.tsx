/**
 * GlassModal — Shared glassmorphism modal wrapper
 *
 * Provides a consistent frosted-glass popup style across the entire app:
 *   - BlurView backdrop (semi-transparent, blurs content behind)
 *   - Dark glass card with subtle border and inner gradient
 *   - Top-edge highlight (backlit panel effect)
 *
 * Usage:
 *   <GlassModal visible={open} onClose={close}>
 *     <Text>Content here</Text>
 *   </GlassModal>
 *
 *   <GlassModal visible={open} onClose={close} position="bottom">
 *     <Text>Bottom sheet content</Text>
 *   </GlassModal>
 */

import React from "react";
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";

const GLASS_BG = "rgba(12, 12, 22, 0.92)";
const GLASS_BORDER = "rgba(248, 248, 255, 0.10)";
const HIGHLIGHT = "rgba(255, 255, 255, 0.12)";

interface GlassModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** "center" (default) or "bottom" (bottom sheet) */
  position?: "center" | "bottom";
  /** Additional style for the glass card */
  cardStyle?: ViewStyle;
  /** Disable close on backdrop tap */
  persistent?: boolean;
  /** Animation type */
  animationType?: "fade" | "slide" | "none";
}

export function GlassModal({
  visible,
  onClose,
  children,
  position = "center",
  cardStyle,
  persistent = false,
  animationType = "fade",
}: GlassModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Blurred backdrop */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={persistent ? undefined : onClose}
        >
          <BlurView
            intensity={40}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.dimOverlay} />
        </Pressable>

        {/* Glass card */}
        <View
          style={[
            styles.card,
            position === "bottom" ? styles.cardBottom : styles.cardCenter,
            cardStyle,
          ]}
        >
          {/* Inner gradient — top lighter, bottom darker */}
          <LinearGradient
            colors={["rgba(248, 248, 255, 0.06)", "rgba(0, 0, 0, 0.12)"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 24 }]}
          />
          {/* Top-edge highlight */}
          <View style={styles.highlight} />

          {/* Handle bar for bottom sheets */}
          {position === "bottom" && <View style={styles.handle} />}

          {children}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Standalone glass card style — for inline usage without Modal wrapper.
 * Use when you need the glass look inside an existing Modal.
 */
export function GlassCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, styles.cardCenter, style]}>
      <LinearGradient
        colors={["rgba(248, 248, 255, 0.06)", "rgba(0, 0, 0, 0.12)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 24 }]}
      />
      <View style={styles.highlight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  card: {
    backgroundColor: GLASS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    overflow: "hidden",
  },
  cardCenter: {
    width: "88%",
    maxWidth: 360,
    maxHeight: "85%",
    padding: 24,
  },
  cardBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 20,
    paddingBottom: 32,
  },
  highlight: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1.5,
    backgroundColor: HIGHLIGHT,
    borderRadius: 1,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
});
