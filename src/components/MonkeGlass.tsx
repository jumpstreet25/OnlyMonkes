/**
 * MonkeGlass — the canonical Liquid Glass popup/picker primitive.
 *
 * Same real-blur-on-both-layers construction as GlassModal (BlurView on the
 * backdrop AND on the card itself — a flat tint alone hides the blur behind
 * it, the exact bug found and fixed across this app's popups on 2026-07-24),
 * given its own name per explicit request so new/fixed popups have one
 * clear, well-tuned source to pull from — rather than every native
 * Alert.alert or raw <Modal> reinventing (or skipping) glass styling.
 *
 * Existing GlassModal/GlassBottomSheet usages that are already correctly
 * wired are NOT migrated here — same underlying construction, no
 * regression risk from a purely cosmetic rename. MonkeGlass is for: new
 * popups going forward, and replacing anything found to be a raw
 * Modal/Alert.alert (which can't be styled at all in React Native).
 *
 * Usage:
 *   <MonkeGlass visible={open} onClose={close}>
 *     <Text>Content here</Text>
 *   </MonkeGlass>
 *
 *   <MonkeGlass visible={open} onClose={close} position="bottom">
 *     <Text>Bottom sheet content</Text>
 *   </MonkeGlass>
 *
 *   // Action-sheet style (replaces Alert.alert's button-list pattern,
 *   // which is a native OS dialog and cannot be styled at all):
 *   <MonkeGlass visible={open} onClose={close} position="bottom">
 *     <MonkeGlassActionButton label="📷 Photo" onPress={...} />
 *     <MonkeGlassActionButton label="🎥 Video" onPress={...} />
 *     <MonkeGlassActionButton label="Cancel" onPress={close} variant="cancel" />
 *   </MonkeGlass>
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  BackHandler,
  Dimensions,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { GLASS_BG, GLASS_BORDER, HIGHLIGHT, GLASS_GRADIENT_COLORS, getBlurProps } from "@/lib/glassTheme";
import { THEME, FONTS } from "@/lib/constants";

interface MonkeGlassProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** "center" (default) or "bottom" (bottom sheet) */
  position?: "center" | "bottom";
  cardStyle?: ViewStyle;
  persistent?: boolean;
  animationType?: "fade" | "slide" | "none";
  glassBg?: string;
}

export function MonkeGlass({
  visible,
  onClose,
  children,
  position = "center",
  cardStyle,
  persistent = false,
  animationType = "fade",
  glassBg,
}: MonkeGlassProps) {
  // Renders directly in the component tree, NOT via RN's <Modal> — Android
  // implements Modal as a separate native Dialog window, which BlurView
  // can't see across to blur real content behind it (confirmed on-device:
  // no visible blur, just a flat tint). Same fix as GlassModal/
  // GlassBottomSheet.
  const [shouldRender, setShouldRender] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const duration = animationType === "none" ? 0 : 220;

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(progress, { toValue: 1, duration, useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration, useNativeDriver: true }).start(() => {
        setShouldRender(false);
      });
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!shouldRender) return null;

  const screenHeight = Dimensions.get("window").height;
  const animatedStyle =
    animationType === "slide"
      ? { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [screenHeight, 0] }) }] }
      : animationType === "fade"
        ? { opacity: progress }
        : null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }, animatedStyle]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={persistent ? undefined : onClose}>
          <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
          <View style={styles.dimOverlay} />
        </Pressable>

        <View
          style={[
            styles.card,
            position === "bottom" ? styles.cardBottom : styles.cardCenter,
            cardStyle,
            glassBg ? { backgroundColor: glassBg } : null,
          ]}
        >
          {/* The card's OWN BlurView — the backdrop one above only ever
              blurs the dismiss-tap area around this card, never the card's
              own fill. This is what actually makes the visible card read
              as glass. */}
          <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={GLASS_GRADIENT_COLORS}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 24 }]}
          />
          <View style={styles.highlight} />
          {position === "bottom" && <View style={styles.handle} />}
          {children}
        </View>
      </View>
    </Animated.View>
  );
}

/** A single row in a MonkeGlass action sheet — replaces one Alert.alert
 *  button. `variant="cancel"` gets dimmer text, matching Alert's own
 *  cancel-button convention. */
export function MonkeGlassActionButton({
  label,
  onPress,
  variant = "default",
}: {
  label: string;
  onPress: () => void;
  variant?: "default" | "cancel" | "destructive";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
    >
      <Text
        style={[
          styles.actionBtnText,
          variant === "cancel" && styles.actionBtnTextCancel,
          variant === "destructive" && styles.actionBtnTextDestructive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
    backgroundColor: "rgba(0, 0, 0, 0.38)",
  },
  card: {
    backgroundColor: GLASS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    overflow: "hidden",
    elevation: 16,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
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
  actionBtn: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  actionBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  actionBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.text,
    textAlign: "center",
  },
  actionBtnTextCancel: {
    color: THEME.textMuted,
  },
  actionBtnTextDestructive: {
    color: THEME.error,
  },
});
