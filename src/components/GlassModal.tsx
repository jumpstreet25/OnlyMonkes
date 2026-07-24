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

import React, { useEffect, useRef, useState } from "react";
import {
  View,
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
  /** Override glass background (for theme support) */
  glassBg?: string;
}

export function GlassModal({
  visible,
  onClose,
  children,
  position = "center",
  cardStyle,
  persistent = false,
  animationType = "fade",
  glassBg,
}: GlassModalProps) {
  // 2026-07-23: replaces RN's <Modal> — Android implements Modal as a
  // SEPARATE native Dialog window from the Activity, which BlurView (below)
  // can't see across to actually blur the real content behind it (confirmed
  // on-device: no visible blur, just a flat tint). Rendering directly in the
  // component tree instead keeps this in the same window as everything
  // else, matching how GlassBottomSheet already avoids this exact problem.
  // This is the shared wrapper for most of the app's modals, so this one
  // fix covers all of them at once.
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
        : null; // "none" — no animated style at all

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }, animatedStyle]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <View style={styles.root}>
        {/* Blurred backdrop */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={persistent ? undefined : onClose}
        >
          <BlurView
            {...getBlurProps()}
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
            glassBg ? { backgroundColor: glassBg } : null,
          ]}
        >
          {/* 2026-07-24: the card's own BlurView — the backdrop one above
              only ever blurred the dismiss-tap area around this card, never
              the card's own (previously opaque) fill. This is what actually
              makes the visible card read as glass. */}
          <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
          {/* Inner gradient — top lighter, bottom darker */}
          <LinearGradient
            colors={GLASS_GRADIENT_COLORS}
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
    </Animated.View>
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
      <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
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
});
